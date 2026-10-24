import { createServer } from 'node:http';
import { createReadOnlyMcpGuard, readOnlyMcpGuardTarget } from '../server/readonly-mcp-guard.ts';
import { loadReadOnlyMcpAuthentication } from '../server/readonly-mcp-auth.ts';

// Fixed deployment entry. Do not accept URL, port, channel or data-dir argv.
// The launcher validates the protected key before supplying only the key env.
try {
  if(process.argv.length!==2||process.env.PI_CONSOLE_READONLY_MCP_AUTH!=='shared_secret'||process.env.PI_CONSOLE_READONLY_MCP_KEY===undefined)throw Error();
  const authentication=await loadReadOnlyMcpAuthentication(process.env,'');
  if(!authentication)throw Error();
  const guard=createReadOnlyMcpGuard({authentication,upstreamUrl:readOnlyMcpGuardTarget.upstreamUrl});
  const server=createServer((req,res)=>void guard.handle(req,res));
  server.maxHeadersCount=64;server.headersTimeout=5000;server.requestTimeout=10000;
  server.on('error',()=>{guard.dispose();process.stderr.write('readonly_guard_start_failed\n');process.exitCode=1;});
  server.listen(readOnlyMcpGuardTarget.listenPort,readOnlyMcpGuardTarget.listenHost,()=>process.stdout.write('readonly_guard_ready\n'));
  const stop=()=>{guard.dispose();server.closeAllConnections();server.close();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
} catch {process.stderr.write('readonly_guard_start_failed\n');process.exitCode=1;}
