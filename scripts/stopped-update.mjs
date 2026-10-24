#!/usr/bin/env node
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {EXPECTED_TARGET,assertPinnedTarget,EXTERNAL_START_BASELINE_REQUIRED} from '../package/stopped-update.mjs';
import {diagnoseStoppedUpdate} from '../package/stopped-update-diagnostics.mjs';
export async function runStoppedUpdateCli(argv,{io=console,diagnose=diagnoseStoppedUpdate}={}){
  if(argv[0]==='--help'){io.log('Usage: node scripts/stopped-update.mjs --check [--identity-port <explicit loopback port>] [--data-dir <pinned> --prefix <pinned> --entry <pinned>]\nRead-only Windows inventory. --apply is blocked; no force/mock option. No state/token/.env reads.');return 0;}
  if(argv[0]!=='--check'&&argv[0]!=='--apply')throw Error('Use --check or --help; production apply is blocked');
  const target={...EXPECTED_TARGET};let identityPort;const seen=new Set();
  const fields={'--data-dir':'dataDir','--prefix':'prefix','--entry':'entry'};
  for(let i=1;i<argv.length;i+=2){const key=argv[i],value=argv[i+1];if(seen.has(key)||value===undefined||(!fields[key]&&key!=='--identity-port'))throw Error('invalid or duplicate stopped-update option');seen.add(key);
    if(key==='--identity-port'){if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>65535)throw Error('invalid identity port');identityPort=Number(value);}else target[fields[key]]=value;
  }
  assertPinnedTarget(target);
  if(argv[0]==='--apply'){io.error(`${EXTERNAL_START_BASELINE_REQUIRED}: direct-start exclusion/complete baseline unavailable; no target, lock, archive or network access attempted`);return 2;}
  io.log(JSON.stringify(await diagnose(target,{identityPort}),null,2));return 2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runStoppedUpdateCli(process.argv.slice(2)).then(code=>process.exitCode=code).catch(()=>{console.error('STOPPED_UPDATE_DIAGNOSTIC_REFUSED: invalid request or OS observation failed; stopped without fallback.');process.exitCode=2;});
