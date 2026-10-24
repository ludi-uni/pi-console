import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {SettingsTunnel} from '../server/settings-tunnel.ts';
import {ownerFixture,settingsFixture} from './helpers/settings-mcp.fixture.ts';

async function setup(){
  const f=await ownerFixture();await f.register();let identity={pid:1234,startedAt:'2026-10-12T00:00:00Z',port:31717,generation:'a'.repeat(32)},time=Date.now(),launches=0,checks=0,ready=true;
  let events=(s:string)=>{},finish=(v:{stopped:boolean})=>{},signal:AbortSignal|undefined,probe=async()=>ready;
  const options={available:true,generation:()=>identity,verifyIdentity:async()=>identity,verifyConnection:async()=>{checks++;return probe()},launch:async(_v:any,o:any)=>{launches++;events=o.onState;signal=o.signal;return new Promise<{stopped:boolean}>(r=>finish=r)}};
  const app=new SettingsTunnel(f.owners,options,()=>time),id=randomUUID();app.request(f.p,{requestId:id,confirmed:true});await new Promise(r=>setImmediate(r));events('starting');events('tunnel-ready');
  return {...f,app,id,options,events,counts:()=>({launches,checks}),signal:()=>signal,setProbe:(p:()=>Promise<boolean>)=>probe=p,setReady:(v:boolean)=>ready=v,advance:(v:number)=>time+=v,changeGeneration:()=>identity={...identity,generation:'b'.repeat(32)},cleanup:async()=>{app.cancel(f.p,{requestId:id});finish({stopped:true});await app.idle()}};
}
test('same owner generation uses verified existing connection without launch, signal or lease extension',async()=>{
 const f=await setup();try{const before=f.app.result(f.p,f.id);for(let i=0;i<2;i++){const r=await (f.app as any).reuse(f.p,{requestId:f.id,confirmed:true});assert.equal(r.reused,true);assert.equal(r.requestId,f.id);assert.equal(r.state,'tunnel-ready');assert.equal(r.leaseUntil,before.leaseUntil);assert.equal(r.appConnectionVerified,false)}assert.deepEqual(f.counts(),{launches:1,checks:2});assert(!f.signal()?.aborted)}finally{await f.cleanup()}
});
test('reuse keeps exact request owner boundary, explicit intent and whitelist',async()=>{const f=await setup();try{for(const p of [undefined,f.other,{...f.p}])await assert.rejects(()=> (f.app as any).reuse(p,{requestId:f.id,confirmed:true}));for(const body of [{requestId:f.id},{requestId:f.id,confirmed:false},{requestId:randomUUID(),confirmed:true},{requestId:f.id,confirmed:true,durationMinutes:480},{requestId:f.id,confirmed:true,key:'DUMMY'}])await assert.rejects(()=> (f.app as any).reuse(f.p,body));assert.equal(f.counts().checks,0);assert(!f.signal()?.aborted)}finally{await f.cleanup()}});
test('no fresh readiness proof does not claim reused and leaves existing process untouched',async()=>{const f=await setup();try{f.setReady(false);await assert.rejects(()=> (f.app as any).reuse(f.p,{requestId:f.id,confirmed:true}),/tunnel_connection_unverified/);assert(!f.signal()?.aborted);assert.equal(f.counts().launches,1);assert.equal(f.app.result(f.p,f.id).reused,false)}finally{await f.cleanup()}});
test('pending, input busy and unattributed daemon cannot be reused',async()=>{const f=await setup();try{for(const state of ['input-open','input-busy','daemon-unattributed']){f.events(state);assert.equal(f.app.result(f.p,f.id).state,state);await assert.rejects(()=> (f.app as any).reuse(f.p,{requestId:f.id,confirmed:true}));assert(!f.signal()?.aborted)}assert.equal(f.counts().checks,0)}finally{await f.cleanup()}});
test('generation changes while verifying fail closed without adopting another daemon',async()=>{const f=await setup();try{f.setProbe(async()=>{f.changeGeneration();return true});await assert.rejects(()=> (f.app as any).reuse(f.p,{requestId:f.id,confirmed:true}));assert.equal(f.counts().launches,1)}finally{await f.cleanup()}});
test('expiry while verifying cannot extend or reuse a connection',async()=>{const f=await setup();try{f.setProbe(async()=>{f.advance(3600001);return true});await assert.rejects(()=> (f.app as any).reuse(f.p,{requestId:f.id,confirmed:true}));assert.equal(f.counts().launches,1)}finally{await f.cleanup()}});
test('reuse API inherits owner, CSRF and local-route denial without new grants',async()=>{
 let signal:AbortSignal|undefined,finish=(v:{stopped:boolean})=>{},probes=0;
 const identity={pid:1234,startedAt:'2026-10-12T00:00:00Z',port:31717,generation:'a'.repeat(32)};
 const f=await settingsFixture({tunnel:{available:true,generation:()=>identity,verifyIdentity:async()=>identity,verifyConnection:async()=>{probes++;return true},launch:async(_v:any,o:any)=>{signal=o.signal;o.onState('tunnel-ready');return new Promise(r=>finish=r)}}});await f.register();const id=randomUUID();await f.call('tunnel/request',{requestId:id,confirmed:true});await new Promise(r=>setImmediate(r));
 try{for(const o of [{who:'other' as const},{who:'none' as const},{local:true},{headers:{origin:'https://evil.test'}},{headers:{'x-pi-console-admin':undefined}}])assert.equal((await f.call('tunnel/reuse',{requestId:id,confirmed:true},o)).status,409);const r=await f.call('tunnel/reuse',{requestId:id,confirmed:true});assert.equal(r.status,200);assert.equal(r.body.reused,true);assert.equal(probes,1);assert(!signal?.aborted);assert.equal(f.issues(),0);assert.equal(f.starts(),0)}finally{await f.call('tunnel/cancel',{requestId:id});finish({stopped:true});await f.app.dispose()}
});
