export const localResumeClientId = 'codex-local-v1';
const command = 'C:\\Program Files\\nodejs\\node.exe';
const entry = 'D:\\Develop\\pi-console\\package\\local-resume-mcp.mjs';
export const localOwnerLoginCommand = "& 'C:\\Program Files\\nodejs\\node.exe' 'D:\\Develop\\pi-console\\package\\pi-console.mjs' owner-login";
export function localResumeConfig(format: 'codex' | 'stdio') {
 const args = [entry, '--local-resume', localResumeClientId];
 return format === 'codex' ? `[mcp_servers.pi_console_local]\ncommand = '${command}'\nargs = [${args.map(v => `'${v}'`).join(', ')}]\ncwd = 'D:\\Develop\\pi-console'\n` : JSON.stringify({mcpServers:{'pi-console-local':{command,args}}},null,2);
}
