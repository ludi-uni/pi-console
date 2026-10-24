import {createInterface} from 'node:readline/promises';
import {requestManagedOwnerLogin} from './server-manager.mjs';
import {localOwnerAddress,openOwnerLoginBrowser} from './local-owner-browser.mjs';

export async function runOwnerLogin({input=process.stdin,output=process.stdout,ask,requestLogin=requestManagedOwnerLogin,openBrowser=openOwnerLoginBrowser}={}){
 if(!input.isTTY||!output.isTTY)throw Error('owner-login needs an interactive local terminal; secret output to pipes/logs is refused');
 const ui=ask?undefined:createInterface({input,output});
 try{
  const confirmed=await (ask??(question=>ui.question(question)))('Display a short-lived one-time code here and open the local authentication page? Type yes: ');
  if(confirmed!=='yes'){output.write('owner-login cancelled; nothing requested\n');return;}
  const v=await requestLogin();
  const url=localOwnerAddress(v?.url),now=Date.now();
  if(typeof v.code!=='string'||!/^[0-9a-f]{64}$/.test(v.code)||!Number.isSafeInteger(v.expiresAt)||v.expiresAt<=now||v.expiresAt>now+120000)throw Error('owner bootstrap outcome unavailable; do not replay automatically');
  output.write(`One-time code (do not log/share): ${v.code}\nExpires: ${new Date(v.expiresAt).toISOString()}\nEnter it only in the local owner page. Authentication still requires your code input.\n`);
  let opened=false;try{opened=(await openBrowser(url))?.opened===true;}catch{/* Manual fallback; no raw opener output. */}
  output.write(opened?`Opening local authentication page: ${url}\n`:`Browser did not open. Open locally: ${url}\n`);
 }finally{ui?.close();}
}
