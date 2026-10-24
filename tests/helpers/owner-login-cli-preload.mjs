// Only used in an owned dummy CLI child. No real manager/credentials/browser.
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import child from 'node:child_process';
import readline from 'node:readline/promises';
import {writeFileSync} from 'node:fs';
const mode=process.env.OWNER_LOGIN_FIXTURE_MODE;
const record={mode,requests:0,browserCalls:[],closed:false,realManagerOrBrowserCalled:false};
globalThis.__ownerFixtureRecord=record;
const manager=new URL('../../package/server-manager.mjs',import.meta.url).href;
registerHooks({load(url,context,next){if(url!==manager)return next(url,context);return {format:'module',shortCircuit:true,source:`
 const unsafe=()=>{throw Error('unexpected fixture lifecycle call')};
 export const startManagedServer=unsafe,stopManagedServer=unsafe,restartManagedServer=unsafe,managedServerStatus=unsafe;
 export async function requestManagedOwnerLogin(){globalThis.__ownerFixtureRecord.requests++;
  if(process.env.OWNER_LOGIN_FIXTURE_MODE==='request-fail')throw Error('dummy manager unavailable');
  return {url:process.env.OWNER_LOGIN_FIXTURE_MODE==='invalid-url'?'https://external.example.test/?code='+ 'a'.repeat(64):'http://127.0.0.1:45678/local-owner/',code:'a'.repeat(64),expiresAt:Date.now()+(process.env.OWNER_LOGIN_FIXTURE_MODE==='expired'?-1:90000)};
 }`};}});
Object.defineProperty(process.stdin,'isTTY',{value:mode!=='non-tty'});
Object.defineProperty(process.stdout,'isTTY',{value:mode!=='non-tty'});
readline.createInterface=()=>({question:async()=>mode==='cancel'?'no':'yes',close(){}});
child.execFile=(file,args,options,callback)=>{record.browserCalls.push({file,args,windowsHide:options.windowsHide,timeout:options.timeout,envKeys:Object.keys(options.env??{})});queueMicrotask(()=>callback(mode==='browser-fail'?Error('dummy-opener-secret-detail'):null,'',''));return {}};
syncBuiltinESMExports();
process.on('exit',()=>{record.closed=true;writeFileSync(process.env.OWNER_LOGIN_FIXTURE_RECORD,JSON.stringify(record));});
