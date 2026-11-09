import test from'node:test';import assert from'node:assert/strict';
import{harness,memoryBackend,dummyCodec}from'./fixture.mjs';
import{createResumeStdioSession}from'../../package/local-resume-session.mjs';
const broker={origin:'http://127.0.0.1:31718',pid:1234,startedAt:'dummy-start',generation:'a'.repeat(32)};
const vector='0'.repeat(60)+'fffe';
async function setup(){const f=harness(),app=await f.boot();let saved=null,created=0,lose=true;
 const enrollment={async get(){return saved&&structuredClone(saved)},async begin(clientId,requestId,b){saved??={clientId,requestId,broker:b,proof:vector,createdAt:f.time(),expiresAt:f.time()+120000,state:'pending'};return structuredClone(saved)},async cancelling(){saved.state='cancelling'},async close(){saved.state='closed'},async dispose(){}};
 const state={async get(){return null},async dispose(){}};
 const make=async()=>{const s=createResumeStdioSession({clientId:'dummy-client-A',state,enrollment,verifyServer:async()=>broker,now:f.time,transport:{request:async b=>{const r=app.request(b);created=app.view().connections.length;if(lose){lose=false;throw Error('dummy lost response')}return r},claim:b=>app.claim(b),cancel:b=>app.cancelPending(b)}});await s.message({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}});await s.message({jsonrpc:'2.0',method:'notifications/initialized'});return s};return{f,app,make,enrollment,get created(){return created}}}
const call=(s,id,name,args={})=>s.message({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
test('lost initial reply retries same request without duplicating pending connection',async()=>{const x=await setup(),s=await x.make();try{assert((await call(s,2,'begin_local_connection',{requestId:'dummy-request'})).error);const r=await call(s,3,'begin_local_connection',{requestId:'dummy-request'});assert(!r.error);assert.equal(JSON.parse(r.result.content[0].text).state,'pending');assert.equal(x.created,1);assert.equal(JSON.stringify(r).includes(vector),false)}finally{await s.dispose();await x.app.dispose()}});
test('companion restart explicitly recovers the saved initial request instead of creating another',async()=>{const x=await setup();let s=await x.make();try{await call(s,2,'begin_local_connection',{requestId:'dummy-request'});await s.dispose();s=await x.make();
 // get alone never implicitly recovers a pending target after restart.
 assert((await call(s,3,'get_local_connection')).error);
 const r=await call(s,4,'begin_local_connection',{requestId:'dummy-request'});assert(!r.error);assert.equal(JSON.parse(r.result.content[0].text).state,'pending');assert.equal(x.created,1)}finally{await s.dispose();await x.app.dispose()}});
test('approve recover: committed stays committed; uncommitted review is invalidated to a definite not_committed',async()=>{const f=harness(),a=await f.boot();try{
 const p=a.request({name:'Dummy',clientId:'client-A'}),r=await a.review({connectionId:p.connectionId,parent:'D:\\Dummy\\Allowed',operations:['list'],period:7},f.check);
 // A lost approve response must not leave the review approvable: recover first.
 const v=await a.recover({requestId:r.requestId,reviewId:r.reviewId},f.check);assert.equal(v.state,'not_committed');
 await assert.rejects(a.approve({reviewId:r.reviewId,requestId:r.requestId,confirmed:true},f.check,f.time()+600000),/review/);
 assert.equal(a.view().connections[0].state,'pending');
 // Same reviewId is never reusable; a second recover is idempotent not_committed.
 assert.equal((await a.recover({requestId:r.requestId,reviewId:r.reviewId},f.check)).state,'not_committed');
 // Queue order decides the outcome: approve-then-recover is committed.
 const r2=await a.review({connectionId:p.connectionId,parent:'D:\\Dummy\\Allowed',operations:['list'],period:7},f.check);
 await a.approve({reviewId:r2.reviewId,requestId:r2.requestId,confirmed:true},f.check,f.time()+600000);
 assert.equal((await a.recover({requestId:r2.requestId,reviewId:r2.reviewId},f.check)).state,'committed');
 await assert.rejects(a.recover({requestId:'not-an-id'},f.check));
}finally{await a.dispose()}});
test('approve recover is owner-checked and rejects mismatched ids without touching the review',async()=>{const f=harness(),a=await f.boot();try{
 const p=a.request({name:'Dummy',clientId:'client-A'}),r=await a.review({connectionId:p.connectionId,parent:'D:\\Dummy\\Allowed',operations:['list'],period:7},f.check);
 // A mismatched requestId/reviewId pair is a binding failure, never a
 // not_committed success: the live review must not be reported as safely
 // discarded while it can still be approved.
 await assert.rejects(a.recover({requestId:'other-request',reviewId:r.reviewId},f.check),/recover_binding_mismatch/);
 await assert.rejects(a.recover({requestId:r.requestId,reviewId:'other-review-id'},f.check),/recover_binding_mismatch/);
 f.setOwnerValid(false);await assert.rejects(a.recover({requestId:r.requestId,reviewId:r.reviewId},f.check));f.setOwnerValid(true);
 // Nothing was invalidated: the original review still approves normally.
 await a.approve({reviewId:r.reviewId,requestId:r.requestId,confirmed:true},f.check,f.time()+600000);
 assert.equal(a.view().connections[0].state,'connected');
}finally{await a.dispose()}});
test('re-review replaces the stale review; recover of either reviewId is definite and the new review approves',async()=>{const f=harness(),a=await f.boot();try{
 const p=a.request({name:'Dummy',clientId:'client-A'}),mk=()=>a.review({connectionId:p.connectionId,parent:'D:\\Dummy\\Allowed',operations:['list'],period:7},f.check);
 const r1=await mk(),r2=await mk();assert.notEqual(r1.reviewId,r2.reviewId);assert.notEqual(r1.requestId,r2.requestId);
 // The stale review's recover resolves to a definite not_committed (the
 // internal cancelled receipt proves it can never be approved), and a late
 // approve on it fails — never review_unavailable ambiguity.
 assert.equal((await a.recover({requestId:r1.requestId,reviewId:r1.reviewId},f.check)).state,'not_committed');
 await assert.rejects(a.approve({reviewId:r1.reviewId,requestId:r1.requestId,confirmed:true},f.check,f.time()+600000),/review/);
 // A stale-reviewId recover for the LIVE requestId is a mismatch, never a
 // false not_committed that could hide an approvable or committed review.
 await assert.rejects(a.recover({requestId:r2.requestId,reviewId:r1.reviewId},f.check),/recover_binding_mismatch/);
 // The new review still approves normally, and its recover reports committed.
 await a.approve({reviewId:r2.reviewId,requestId:r2.requestId,confirmed:true},f.check,f.time()+600000);
 assert.equal((await a.recover({requestId:r2.requestId,reviewId:r2.reviewId},f.check)).state,'committed');
 assert.equal(a.view().connections[0].state,'connected');
}finally{await a.dispose()}});

test('expired approval failure is recoverable without resending',async()=>{const f=harness(),a=await f.boot();try{
 const p=a.request({name:'Dummy',clientId:'client-A'}),r=await a.review({connectionId:p.connectionId,parent:'D:\\Dummy\\Allowed',operations:['list'],period:7},f.check);
 f.advance(300000);
 await assert.rejects(a.approve({reviewId:r.reviewId,requestId:r.requestId,confirmed:true},f.check,f.time()+600000),/review/);
 assert.equal((await a.recover({requestId:r.requestId,reviewId:r.reviewId},f.check)).state,'not_committed');
 await assert.rejects(a.approve({reviewId:r.reviewId,requestId:r.requestId,confirmed:true},f.check,f.time()+600000),/review/);
 assert.equal(f.backend.snapshot(),null);
}finally{await a.dispose()}});
test('recovery after restart explicitly abandons the old approval',async()=>{const f=harness();let a=await f.boot();try{
 const p=a.request({name:'Dummy',clientId:'client-A'}),r=await a.review({connectionId:p.connectionId,parent:'D:\\Dummy\\Allowed',operations:['list'],period:7},f.check);
 await a.dispose();a=await f.boot();
 assert.equal((await a.recover({requestId:r.requestId,reviewId:r.reviewId},f.check)).state,'not_committed');
 await assert.rejects(a.approve({reviewId:r.reviewId,requestId:r.requestId,confirmed:true},f.check,f.time()+600000),/review/);
 assert.equal(f.backend.snapshot(),null);
}finally{await a.dispose()}});
test('owner expiry after inner re-review cannot strand stale outer recovery',async()=>{const f=harness(),a=await f.boot();try{
 const p=a.request({name:'Dummy',clientId:'client-A'}),body={connectionId:p.connectionId,parent:'D:\\Dummy\\Allowed',operations:['list'],period:7};
 const old=await a.review(body,f.check);let checks=0;
 await assert.rejects(a.review(body,()=>{if(++checks===2)throw Error('owner expired after inner review')}),/owner expired/);
 assert.equal((await a.recover({requestId:old.requestId,reviewId:old.reviewId},f.check)).state,'not_committed');
 const fresh=await a.review(body,f.check);
 await a.approve({reviewId:fresh.reviewId,requestId:fresh.requestId,confirmed:true},f.check,f.time()+600000);
 assert.equal(a.view().connections[0].state,'connected');
}finally{await a.dispose()}});

test('approve/recover queue order decides the outcome, both orders verified',async()=>{const f=harness(),a=await f.boot();try{
 const p=a.request({name:'Dummy',clientId:'client-A'}),p2=a.request({name:'Dummy',clientId:'client-A'});
 const fresh=connectionId=>a.review({connectionId,parent:'D:\\Dummy\\Allowed',operations:['list'],period:7},f.check);
 // approve enqueued before recover commits: recover then reports committed.
 const r1=await fresh(p.connectionId);
 const approveFirst=a.approve({reviewId:r1.reviewId,requestId:r1.requestId,confirmed:true},f.check,f.time()+600000);
 const recoverAfter=a.recover({requestId:r1.requestId,reviewId:r1.reviewId},f.check);
 await approveFirst;assert.equal((await recoverAfter).state,'committed');
 // recover enqueued before approve invalidates the review first: the late
 // approve can no longer succeed and recover reports not_committed.
 const r2=await fresh(p2.connectionId);
 const recoverFirst=a.recover({requestId:r2.requestId,reviewId:r2.reviewId},f.check);
 const approveLate=a.approve({reviewId:r2.reviewId,requestId:r2.requestId,confirmed:true},f.check,f.time()+600000);
 assert.equal((await recoverFirst).state,'not_committed');
 await assert.rejects(approveLate,/review/);
}finally{await a.dispose()}});
