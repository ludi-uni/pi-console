import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {agentDirectory} from './startup-manager.mjs';
import {loadConsoleEnvironment} from './environment.mjs';
import {resolvePiCli} from './launcher.mjs';

/** Resolve only installed public code; never invoke Pi or mutate its selector.
 * Startup keeps MCP OFF even if a legacy stable configuration opted in. */
export async function startupEnvironment(env=process.env){
 const configured=await loadConsoleEnvironment({...env,PI_CONSOLE_READONLY_MCP:'0'});
 let cli;
 try{cli=resolvePiCli(configured);}catch(error){
  if(configured.PI_CONSOLE_PI_COMMAND||error.message!=='Pi CLI not found; set PI_CONSOLE_PI_COMMAND to the absolute cli.js path')throw error;
  try{
   const install=join(agentDirectory(configured),'install'),selector=join(install,'current-version');
   const st=await lstat(selector);if(!st.isFile()||st.isSymbolicLink()||st.size>128)throw Error();
   const version=(await readFile(selector,'utf8')).trim();if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))throw Error();
   const pkgRoot=join(install,'releases',version,'node_modules','@earendil-works','pi-coding-agent'),manifest=join(pkgRoot,'package.json');
   const ms=await lstat(manifest);if(!ms.isFile()||ms.isSymbolicLink()||ms.size>65536)throw Error();
   const pkg=JSON.parse(await readFile(manifest,'utf8'));if(pkg.name!=='@earendil-works/pi-coding-agent'||pkg.version!==version||pkg.bin?.pi!=='dist/bundle/cli.js')throw Error();
   cli=join(pkgRoot,'dist','bundle','cli.js');const cs=await lstat(cli);if(!cs.isFile()||cs.isSymbolicLink())throw Error();
  }catch{throw Error('Managed Pi installation unavailable; Startup refused without reinstall or fallback execution');}
 }
 return {...configured,PI_CONSOLE_PI_COMMAND:cli,PI_CONSOLE_READONLY_MCP:'0'};
}
