export const localResumeClientId = 'codex-local-v1';
export const localResumePackage = '@ludi-uni/pi-console';
export type LocalResumeSource = 'npm' | 'clone';
export interface LocalResumeSetup {
  source: LocalResumeSource;
  /** Repository root for `source: 'clone'`; required and otherwise invalid. */
  repoRoot?: string;
  /** Node executable override for `source: 'clone'`; defaults to `node`. */
  nodeCommand?: string;
}

// PowerShell single-quoted literal: doubles any embedded apostrophe.
const powershellQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
// TOML basic string (double-quoted): escapes what the spec requires.
const tomlString = (value: string) => `"${value.replace(/([\\"])/g, '\\$1').replace(/[\u0001-\u001f]/g, ' ')}"`;

// npx resolves to a .cmd shim on Windows: a stdio MCP client spawning it
// through Node's shell:false process creation gets ENOENT, so the generated
// config launches it through cmd.exe. Only the static package/client argument
// list reaches the shell  -  no owner input is ever placed on this command line.
const npmLaunch = ['npx', '--yes', '--package', localResumePackage, '--', 'pi-console'];
const npmCommand = 'cmd.exe';
const npmArgs = ['/d', '/s', '/c', ...npmLaunch];

/** Command line used on the Console PC for owner verification. */
export function localOwnerLoginCommand(setup: LocalResumeSetup = { source: 'npm' }) {
  if (setup.source === 'clone') {
    const root = cloneEntry(setup), binary = nodeBinary(setup);
    return root && binary ? `& ${powershellQuote(binary)} ${powershellQuote(root.cli)} owner-login` : undefined;
  }
  // PowerShell resolves the npx shim itself, so the display stays a plain npx call.
  return `${npmLaunch.join(' ')} owner-login`;
}

function cloneEntry(setup: LocalResumeSetup) {
  const root = setup.repoRoot?.trim();
  // Only an absolute Windows drive/UNC root produces a copyable command;
  // partial or relative input is not quoted into a config the owner could run.
  if (!root || /[\u0000-\u001f]/.test(root) || !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(root)) return undefined;
  return { cli: `${root.replace(/[\\/]+$/, '')}\\package\\pi-console.mjs`, mcp: `${root.replace(/[\\/]+$/, '')}\\package\\local-resume-mcp.mjs`, root: root.replace(/[\\/]+$/, '') };
}
// A node executable override with control characters is rejected rather than
// sanitized: it is pasted verbatim into a PowerShell command the owner runs.
const nodeBinary = (setup: LocalResumeSetup) => {
  const command = setup.nodeCommand?.trim();
  if (!command) return 'node';
  return /[\u0000-\u001f\u007f]/.test(command) ? undefined : command;
};

/**
 * Local MCP launch configuration. npm mode runs the packaged CLI through npx;
 * clone mode points at an explicit repository checkout. Returns undefined when
 * clone is selected without a repository root  -  never copy an invalid config.
 */
export function localResumeConfig(format: 'codex' | 'stdio', setup: LocalResumeSetup = { source: 'npm' }) {
  let command: string, args: string[], cwd: string | undefined;
  if (setup.source === 'clone') {
    const entry = cloneEntry(setup), binary = nodeBinary(setup);
    if (!entry || !binary) return undefined;
    command = binary;
    args = [entry.mcp, '--local-resume', localResumeClientId];
    cwd = entry.root;
  } else {
    command = npmCommand;
    args = [...npmArgs, 'local-resume', localResumeClientId];
  }
  if (format === 'codex') {
    return `[mcp_servers.pi_console_local]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(', ')}]${cwd ? `\ncwd = ${tomlString(cwd)}` : ''}\n`;
  }
  return JSON.stringify({ mcpServers: { 'pi-console-local': { command, args, ...(cwd ? { cwd } : {}) } } }, null, 2);
}
