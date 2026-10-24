// An owned startup dummy child: suppress all real manager lifecycle calls.
import {registerHooks} from 'node:module';
import {writeFileSync} from 'node:fs';
const record={calls:0,closed:false,realConsoleStarted:false};globalThis.__startupFixtureRecord=record;
const manager=new URL('../../package/server-manager.mjs',import.meta.url).href;
registerHooks({load(url,context,next){if(url!==manager)return next(url,context);return {format:'module',shortCircuit:true,source:`export async function startManagedServer(options){const r=globalThis.__startupFixtureRecord;r.calls++;if(process.env.STARTUP_FIXTURE_FAIL==='1')throw Error('dummy-startup-secret-log-tail');r.legacyMcpOff=options?.env?.PI_CONSOLE_READONLY_MCP==='0';r.publicOrigin=options?.env?.PI_CONSOLE_PUBLIC_ORIGIN;r.explicitPiCli=options?.env?.PI_CONSOLE_PI_COMMAND;r.dataDir=options?.env?.PI_CONSOLE_DATA_DIR;return {status:'running',changed:false};}`};}});
process.on('exit',()=>{record.closed=true;writeFileSync(process.env.STARTUP_FIXTURE_RECORD,JSON.stringify(record));});
