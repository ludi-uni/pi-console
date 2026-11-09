import test from'node:test';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';import{localResumeConfig,localResumeClientId,localOwnerLoginCommand,localResumePackage}from'../../web/local-resume-config.ts';
const clone={source:'clone',repoRoot:'D:\\Develop\\pi-console'};
// CLI dispatch must keep stdio (JSON-RPC stdout) clean and reject bad ids on stderr.
test('pi-console local-resume dispatches safely without stdout pollution',()=>{
 const cli=['package/pi-console.mjs','local-resume'];
 const missing=spawnSync(process.execPath,cli,{encoding:'utf8'});assert.equal(missing.status,2);assert.equal(missing.stdout,'');assert.match(missing.stderr,/requires a client id/);
 const invalid=spawnSync(process.execPath,[...cli,'bad!id'],{encoding:'utf8'});assert.equal(invalid.status,1);assert.equal(invalid.stdout,'');assert.match(invalid.stderr,/invalid local-resume client id/);
 const help=spawnSync(process.execPath,['package/pi-console.mjs','help'],{encoding:'utf8'});assert.match(help.stdout,/local-resume <id>/);
 // Direct entry: bad args exit non-zero on stderr with empty stdout; a plain
 // import performs no launch and leaves stdout untouched.
 const direct=spawnSync(process.execPath,['package/local-resume-mcp.mjs','--bogus'],{encoding:'utf8'});assert.equal(direct.status,2);assert.equal(direct.stdout,'');assert.match(direct.stderr,/invalid local-resume arguments/);
 const imported=spawnSync(process.execPath,['--input-type=module','-e','import "./package/local-resume-mcp.mjs"'],{encoding:'utf8'});assert.equal(imported.status,0);assert.equal(imported.stdout,'');
});
test('npm distribution launches through cmd.exe so Windows Node spawn works without a shell',()=>{
 const s=localResumeConfig('codex');assert.match(s,/^\[mcp_servers\.pi_console_local\]/);assert.match(s,/^command = "cmd\.exe"$/m);
 assert(s.includes('"/d", "/s", "/c"'));assert(s.includes(`--package`));assert(s.includes(localResumePackage));assert(s.includes('"local-resume"'));assert(s.includes(localResumeClientId));
 // `--` separates npx arguments from the CLI arguments, passed to the shell as one static tail.
 assert(s.includes('"--", "pi-console", "local-resume"'));
 assert(!s.includes('cwd'));assert(!/D:\\|\\package\\|C:\\Program Files/.test(s));
 assert.equal(s,localResumeConfig('codex'));assert(!/token|secret|code=|Bearer|https?:/i.test(s));assert(!s.includes('mcpServers'));
 const v=JSON.parse(localResumeConfig('stdio')).mcpServers['pi-console-local'];
 assert.equal(v.command,'cmd.exe');assert.deepEqual(v.args,['/d','/s','/c','npx','--yes','--package',localResumePackage,'--','pi-console','local-resume',localResumeClientId]);
 // PowerShell resolves the npx shim itself: the displayed login command needs no cmd wrapper.
 assert.equal(localOwnerLoginCommand(),`npx --yes --package ${localResumePackage} -- pi-console owner-login`);
});
test('a bare npx command fails Windows Node spawn while the generated cmd wrapper runs',()=>{
 if(process.platform!=='win32')return;
 // shell:false mirrors how a stdio MCP client launches the configured command.
 const bare=spawnSync('npx',['--version'],{encoding:'utf8'});
 assert.equal(bare.status,null);assert.match(String(bare.error),/ENOENT/);
 const v=JSON.parse(localResumeConfig('stdio')).mcpServers['pi-console-local'];
 // Probe with a dummy `--version` tail: proves the cmd wrapper reaches npx
 // under real Node spawn. It does not fetch the package — package resolution
 // still requires the published package to exist.
 const probe=spawnSync(v.command,[...v.args.slice(0,4),'--version'],{encoding:'utf8'});
 assert.equal(probe.status,0,probe.stderr);assert.match(probe.stdout.trim(),/^\d+\.\d+\.\d+/);
});
test('clone setup uses the entered repository root with escaped Node entry paths',()=>{
 const s=localResumeConfig('codex',clone);assert.match(s,/command = "node"/);assert(s.includes('D:\\\\Develop\\\\pi-console\\\\package\\\\local-resume-mcp.mjs'));
 assert(s.includes('D:\\\\Develop\\\\pi-console'));assert(!s.includes('D:\\Develop'));
 const v=JSON.parse(localResumeConfig('stdio',clone)).mcpServers['pi-console-local'];
 assert.equal(v.command,'node');assert.deepEqual(v.args,['D:\\Develop\\pi-console\\package\\local-resume-mcp.mjs','--local-resume',localResumeClientId]);assert.equal(v.cwd,'D:\\Develop\\pi-console');
 const custom=JSON.parse(localResumeConfig('stdio',{source:'clone',repoRoot:'D:\\My App\\pi-console',nodeCommand:'C:\\Program Files\\nodejs\\node.exe'})).mcpServers['pi-console-local'];
 assert.equal(custom.command,'C:\\Program Files\\nodejs\\node.exe');assert.equal(custom.args[0],'D:\\My App\\pi-console\\package\\local-resume-mcp.mjs');assert.equal(custom.cwd,'D:\\My App\\pi-console');
 // TOML escapes backslashes and double quotes in basic strings.
 const toml=localResumeConfig('codex',{source:'clone',repoRoot:'D:\\My App\\pi-console',nodeCommand:'C:\\Program Files\\nodejs\\node.exe'});
 assert(toml.includes('"C:\\\\Program Files\\\\nodejs\\\\node.exe"'));assert(toml.includes('"D:\\\\My App\\\\pi-console\\\\package\\\\local-resume-mcp.mjs"'));
 // Forward slashes and trailing separators are preserved/normalized, never doubled.
 const slash=JSON.parse(localResumeConfig('stdio',{source:'clone',repoRoot:'D:/Develop/pi-console/'})).mcpServers['pi-console-local'];
 assert.equal(slash.args[0],'D:/Develop/pi-console\\package\\local-resume-mcp.mjs');
 assert.equal(localOwnerLoginCommand(clone),"& 'node' 'D:\\Develop\\pi-console\\package\\pi-console.mjs' owner-login");
 assert(localOwnerLoginCommand(clone).endsWith(' owner-login'));assert(!localOwnerLoginCommand(clone).includes('--yes'));
 const spaced=localOwnerLoginCommand({source:'clone',repoRoot:"D:\\O'Brien\\pi-console",nodeCommand:'C:\\Program Files\\nodejs\\node.exe'});
 assert.equal(spaced,"& 'C:\\Program Files\\nodejs\\node.exe' 'D:\\O''Brien\\pi-console\\package\\pi-console.mjs' owner-login");
});
test('clone without a repository root yields no copyable configuration or command',()=>{
 for(const setup of[{source:'clone'},{source:'clone',repoRoot:'   '}]){assert.equal(localResumeConfig('codex',setup),undefined);assert.equal(localResumeConfig('stdio',setup),undefined);assert.equal(localOwnerLoginCommand(setup),undefined)}
 assert.deepEqual(Object.keys(JSON.parse(localResumeConfig('stdio',clone)).mcpServers['pi-console-local']),['command','args','cwd']);
});
test('incomplete or unsafe clone input is rejected instead of quoted verbatim',()=>{
 // A relative or bare-name root is not an absolute checkout location.
 for(const root of['pi-console','repo\\pi-console','.\\pi-console']){
  const setup={source:'clone',repoRoot:root};
  assert.equal(localResumeConfig('codex',setup),undefined);
  assert.equal(localOwnerLoginCommand(setup),undefined);
 }
 // Control characters in the node command cannot be smuggled into PowerShell.
 const evil={source:'clone',repoRoot:'D:\\Develop\\pi-console',nodeCommand:'node\n& evil'};
 assert.equal(localResumeConfig('codex',evil),undefined);
 assert.equal(localResumeConfig('stdio',evil),undefined);
 assert.equal(localOwnerLoginCommand(evil),undefined);
 // Absolute drive and UNC roots stay accepted.
 assert(localResumeConfig('codex',{source:'clone',repoRoot:'\\\\server\\share\\pi-console'})?.includes('server'));
});
