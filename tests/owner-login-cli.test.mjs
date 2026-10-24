import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const preload=new URL('./helpers/owner-login-cli-preload.mjs',import.meta.url).href;
const cli=fileURLToPath(new URL('../package/pi-console.mjs',import.meta.url));
async function run(mode,fn){
 const root=await mkdtemp(join(tmpdir(),'owner-cli-dummy-')),recordFile=join(root,'record.json');
 const env={};for(const k of ['SystemRoot','WINDIR','PATH','PATHEXT','ComSpec'])if(process.env[k])env[k]=process.env[k];
 Object.assign(env,{HOME:root,USERPROFILE:root,APPDATA:root,LOCALAPPDATA:root,TEMP:root,TMP:root,OWNER_LOGIN_FIXTURE_MODE:mode,OWNER_LOGIN_FIXTURE_RECORD:recordFile});
 const p=spawn(process.execPath,['--import',preload,cli,'owner-login'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>output+=x);
 try{const code=await new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',resolve);});let record;try{record=JSON.parse(await readFile(recordFile,'utf8'));}catch{throw Error(`owned dummy CLI failed before record (${code}): ${output.slice(0,4000)}`);}assert.equal(record.closed,true);assert.equal(record.realManagerOrBrowserCalled,false);await fn({code,output,record});}
 finally{if(p.exitCode===null){p.kill();await new Promise(r=>p.once('close',r));}await rm(root,{recursive:true,force:true});}
}
test('explicit confirmed local CLI opens only the nonsecret authentication URL',()=>run('success',({code,output,record})=>{
 assert.equal(code,0);assert.equal(record.requests,1);assert.equal(record.browserCalls.length,1);
 const call=record.browserCalls[0];assert.equal(call.windowsHide,true);assert.equal(call.timeout,5000);
 assert(!call.envKeys.some(k=>/^(PI_|OPENAI_|ANTHROPIC_|OWNER_LOGIN_)/.test(k)));
 assert.deepEqual(call.args.slice(0,3),['-NoProfile','-NonInteractive','-EncodedCommand']);
 const script=Buffer.from(call.args[3],'base64').toString('utf16le');assert.match(script,/Start-Process -FilePath 'http:\/\/127\.0\.0\.1:45678\/local-owner\/'/);
 assert(!script.includes('a'.repeat(64)));assert(!/code=|token=|secret=/i.test(script));assert(!call.args.join(' ').includes('a'.repeat(64)));
 assert(output.includes('a'.repeat(64)));assert.match(output,/Enter it only in the local owner page/);
}));
test('browser opener failure keeps URL fallback and never prints opener error details',()=>run('browser-fail',({code,output,record})=>{assert.equal(code,0);assert.equal(record.requests,1);assert.equal(record.browserCalls.length,1);assert.match(output,/Browser did not open\. Open locally: http:\/\/127\.0\.0\.1:45678\/local-owner\//);assert(!output.includes('dummy-opener-secret-detail'));}));
test('cancel never issues bootstrap or opens browser',()=>run('cancel',({code,record})=>{assert.equal(code,0);assert.equal(record.requests,0);assert.equal(record.browserCalls.length,0);}));
test('non-TTY refuses before bootstrap and browser',()=>run('non-tty',({code,record,output})=>{assert.equal(code,1);assert.equal(record.requests,0);assert.equal(record.browserCalls.length,0);assert.match(output,/interactive local terminal/);assert(!output.includes('a'.repeat(64)));}));
test('untrusted URL is rejected before secret display and browser',()=>run('invalid-url',({code,record,output})=>{assert.equal(code,1);assert.equal(record.requests,1);assert.equal(record.browserCalls.length,0);assert(!output.includes('external.example.test'));assert(!output.includes('a'.repeat(64)));}));
test('expired bootstrap is refused without browser or secret output',()=>run('expired',({code,record,output})=>{assert.equal(code,1);assert.equal(record.browserCalls.length,0);assert(!output.includes('a'.repeat(64)));}));
test('manager failure does not replay bootstrap or open browser',()=>run('request-fail',({code,record})=>{assert.equal(code,1);assert.equal(record.requests,1);assert.equal(record.browserCalls.length,0);}));
test('literal URL guard rejects aliases, credentials, paths, queries and invalid ports before opener',async()=>{
 const {openOwnerLoginBrowser}=await import('../package/local-owner-browser.mjs');let calls=0;
 const exec=async()=>{calls++};
 for(const url of ['https://127.0.0.1:45678/local-owner/','http://localhost:45678/local-owner/','http://2130706433:45678/local-owner/','http://127.1:45678/local-owner/','http://127.0.0.1:0/local-owner/','http://127.0.0.1:80/local-owner/','http://127.0.0.1:65536/local-owner/','http://127.0.0.1:045678/local-owner/','http://x@127.0.0.1:45678/local-owner/','http://127.0.0.1:45678/elsewhere/','http://127.0.0.1:45678/local-owner/?code=dummy','http://127.0.0.1:45678/local-owner/#dummy','http://127.0.0.1:45678/local-owner/\n'])await assert.rejects(()=>openOwnerLoginBrowser(url,{exec,platform:'win32'}),/local owner address rejected/);
 assert.equal(calls,0);
 const result=await openOwnerLoginBrowser('http://127.0.0.1:45678/local-owner/',{exec,platform:'linux'});assert.equal(result.opened,false);assert.equal(calls,0);
});
