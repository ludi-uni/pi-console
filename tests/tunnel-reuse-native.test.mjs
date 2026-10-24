import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {appendFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ownerGuiBinding} from '../package/owner-gui-dialog.mjs';
import {createWindowsTunnelLauncher} from '../package/tunnel-key-dialog.mjs';
const tuple={requestId:'11111111-1111-4111-8111-111111111111',subject:'dummy-owner',issuer:'https://dummy.example',audience:'dummy',pid:1234,port:31717,startedAt:'2026-10-12T00:00:00Z',generation:'a'.repeat(32),expiresAt:Date.now()+120000};
const view=Object.freeze({...tuple,bindingDigest:ownerGuiBinding(tuple),leaseUntil:tuple.expiresAt+60000});
async function record(path,removed){const root=process.env.PI_CONSOLE_TEST_EVIDENCE_ROOT;if(root)await appendFile(join(root,'native-fake-ownership.jsonl'),JSON.stringify({path,removed,actualProcessCreated:false})+'\n')}
async function waitFor(fn){const end=Date.now()+3000;while(!fn()&&Date.now()<end)await new Promise(r=>setImmediate(r));assert(fn(),'expected dummy pipe message')}
async function setup(){
 let child,count=0,dir,closed=false;const abort=new AbortController(),states=[];
 const launcher=createWindowsTunnelLauncher({spawnProcess:(_exe,_args,o)=>{count++;dir=o.cwd;child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();return child}});
 const task=launcher(view,{signal:abort.signal,onState:s=>states.push(s)});await waitFor(()=>child);await record(dir,false);
 let payload='';child.stdin.on('data',b=>payload+=b);
 const commands=()=>payload.split('\n').filter(Boolean).map(v=>JSON.parse(v)).filter(v=>v.action==='verify');
 const reply=(state,probeId)=>child.stdout.write(JSON.stringify({requestId:view.requestId,state,...(probeId?{probeId}:{})})+'\n');reply('tunnel-ready');
 return {launcher,task,child,reply,states,commands,count:()=>count,payload:()=>payload,abort,cleanup:async()=>{if(closed)return;closed=true;reply('stopped');child.emit('close',0);await task;await record(dir,true)}};
}
test('fresh verification over owned pipe never respawns or cancels; cloned binding denied',async()=>{const f=await setup();try{assert.equal(typeof f.launcher.verifyConnection,'function');assert.equal(await f.launcher.verifyConnection({...view}),false);const probe=f.launcher.verifyConnection(view);await waitFor(()=>f.commands().length===1);assert(!f.payload().includes('"action":"cancel"'));f.reply('connection-verified',f.commands()[0].probeId);assert.equal(await probe,true);assert.equal(f.count(),1);assert.deepEqual(f.states,['tunnel-ready']);assert(!f.payload().includes('CONTROL_PLANE_API_KEY'))}finally{await f.cleanup()}});
test('native unverified reply and exited transport never verify existing connection',async()=>{const f=await setup();try{assert.equal(typeof f.launcher.verifyConnection,'function');const probe=f.launcher.verifyConnection(view);await waitFor(()=>f.commands().length===1);f.reply('connection-unverified',f.commands()[0].probeId);assert.equal(await probe,false);await f.cleanup();assert.equal(await f.launcher.verifyConnection(view),false)}finally{await f.cleanup()}});
test('two simultaneous probes share one check and close fails both without respawn',async()=>{const f=await setup();try{assert.equal(typeof f.launcher.verifyConnection,'function');const a=f.launcher.verifyConnection(view),b=f.launcher.verifyConnection(view);await waitFor(()=>f.commands().length===1);await new Promise(r=>setTimeout(r,20));assert.equal(f.commands().length,1);await f.cleanup();assert.equal(await a,false);assert.equal(await b,false);assert.equal(f.count(),1)}finally{await f.cleanup()}});
test('late reply from timed out check cannot authenticate the next check',async()=>{const f=await setup();try{const a=f.launcher.verifyConnection(view);await waitFor(()=>f.commands().length===1);assert.equal(await a,false);const old=f.commands()[0].probeId;let settled=false;const b=f.launcher.verifyConnection(view).then(v=>{settled=true;return v});await waitFor(()=>f.commands().length===2);const current=f.commands()[1].probeId;assert.notEqual(old,current);f.reply('connection-verified',old);await new Promise(r=>setTimeout(r,20));assert.equal(settled,false);f.reply('connection-unverified',current);assert.equal(await b,false);assert(!f.payload().includes('"action":"cancel"'))}finally{await f.cleanup()}});
test('native source separates input mutex and unattributed daemon, probes only its held process',async()=>{
 const source=await readFile(new URL('../package/tunnel-key-dialog.ps1',import.meta.url),'utf8');
 for(const text of ["$reason='input-busy';throw 'active_launcher'","$reason='daemon-unattributed';throw 'existing'",'function Confirm-OwnedConnection','$child.StartTime.ToUniversalTime() -ne $daemonStart','-MaximumRedirection 0','probeId=$value.probeId','connection-unverified','ReparsePoint'])assert(source.includes(text),text);
 assert(!source.includes('-Property CommandLine'));assert(!source.includes('Set-Content'));assert(!source.includes('GetEnvironmentVariables'));
});
