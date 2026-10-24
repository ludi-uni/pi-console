import {test} from 'node:test';import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';import {once} from 'node:events';
import {mkdir,unlink} from 'node:fs/promises';
import {ownerFixture} from './final-owner.fixture.ts';
import {createFinalOwnerComposition} from '../server/final-owner-composition.ts';
import {WorkspacePermissions} from '../server/workspace-permissions.ts';
import {dummyReadKey,sampleAnswer} from './final-answer.fixture.ts';
export async function ownerHttp(f:Awaited<ReturnType<typeof ownerFixture>>){
  const server=createServer((req,res)=>void f.composition.handle(req,res).then(ok=>{if(!ok){res.writeHead(404);res.end();}}).catch(()=>{res.writeHead(500);res.end();}));server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port;assert(![31717,31718,31719].includes(port));const base=`http://127.0.0.1:${port}`;
  const post=async(route:string,body:unknown)=>{const r=await fetch(base+'/api/workspace-permissions/final/'+route,{method:'POST',headers:{origin:base,'sec-fetch-site':'same-origin','x-pi-console-admin':'1','content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  return {server,base,post,close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
}
async function fixture(work:(f:Awaited<ReturnType<typeof ownerFixture>>,http:Awaited<ReturnType<typeof ownerHttp>>)=>Promise<void>){const f=await ownerFixture(),http=await ownerHttp(f);try{await work(f,http);}finally{await http.close();await f.cleanup();}}
async function review(http:Awaited<ReturnType<typeof ownerHttp>>,revoke=false){const v=(await http.post('session',{})).body;const r=await http.post('review',{instance:v.instance,revision:v.revision,target:revoke?null:v.choices[0].target,expiresAt:revoke?null:Date.now()+60000});assert.equal(r.status,200);return r.body;}
const save=(http:Awaited<ReturnType<typeof ownerHttp>>,r:any)=>http.post('save',{reviewId:r.reviewId,requestId:r.requestId,confirmed:true});
test('final owner atomic schema, explicit grant, read, receipt, revoke and no status-checkbox implication',()=>fixture(async(f,http)=>{
  const v=(await http.post('session',{})).body;assert.equal(v.publication,null);await assert.rejects(f.composition.service.finalAnswer(v.choices[0].target));
  const r=await review(http);const saved=await save(http,r);assert.equal(saved.status,200);const target=saved.body.publication.target;
  assert.equal((await f.composition.service.finalAnswer(target)).text,sampleAnswer);assert.equal((await f.permissions.snapshot()).version,2);
  assert.equal((await save(http,r)).status,409);assert.equal((await http.post('result',{requestId:r.requestId})).body.state,'committed');
  assert.equal((await save(http,await review(http,true))).status,200);await assert.rejects(f.composition.service.finalAnswer(target));assert.equal(f.mutations(),0);assert.equal(f.runtime.controlIsolationVerified(),false);
}));
test('cancel/review one-use and CAS conflict do not grant or redispatch',()=>fixture(async(f,http)=>{
  const r=await review(http);await http.post('cancel',{reviewId:r.reviewId,requestId:r.requestId});assert.equal((await save(http,r)).status,409);
  const a=await review(http),b=await review(http);assert.equal((await save(http,a)).status,200);assert.equal((await save(http,b)).status,409);assert.equal((await f.permissions.snapshot()).finalRequests?.length,1);assert.equal(f.mutations(),0);
}));
test('replacement exposes exactly new run; base permission edits clear final scope',()=>fixture(async(f,http)=>{
  const first=(await save(http,await review(http))).body.publication.target;await f.populate('SECOND_DUMMY_FINAL');const v=(await http.post('session',{})).body;
  const target=v.choices.find((c:any)=>c.target.runId!==first.runId).target;const r=(await http.post('review',{instance:v.instance,revision:v.revision,target,expiresAt:Date.now()+60000})).body;
  const next=(await save(http,r)).body.publication.target;assert.equal((await f.composition.service.finalAnswer(next)).text,'SECOND_DUMMY_FINAL');await assert.rejects(f.composition.service.finalAnswer({...first,revision:next.revision}));
  const s=await f.permissions.snapshot();await f.permissions.replace(f.permissions.instance,s.revision,s.workspaces,async()=>s.workspaces.map(w=>({...w,eligible:true})));assert.equal((await f.permissions.snapshot()).finalPublication,null);await assert.rejects(f.composition.service.finalAnswer(next));
}));
test('save failure poisons scope and never restores earlier publication',()=>fixture(async(f,http)=>{
  await save(http,await review(http));const r=await review(http,true);const original=(f.permissions as any).persist.bind(f.permissions);(f.permissions as any).persist=async(next:any)=>{await unlink(f.permissions.file);await mkdir(f.permissions.file);return original(next);};
  assert.equal((await save(http,r)).status,409);await assert.rejects(f.permissions.snapshot());(f.permissions as any).persist=original;assert.equal((await http.post('result',{requestId:r.requestId})).status,409);
}));
test('restart/new epoch/unknown or Access/auth separation remain fail closed',()=>fixture(async(f,http)=>{
  const saved=(await save(http,await review(http))).body.publication.target,old=await f.permissions.snapshot();f.composition.dispose();await assert.rejects(f.composition.service.finalAnswer(saved));
  for(const config of [{...f.options},{...f.options,accessMode:'access' as const},{...f.options,accessMode:'unknown' as const},{...f.options,authentication:undefined},{...f.options,legacyCredentialKeys:[dummyReadKey]},{}]){
    const permissions=new WorkspacePermissions(f.permissions.file),comp=createFinalOwnerComposition(f.workspaces,permissions,f.paths,config);
    await assert.rejects(comp.service.finalAnswer({...saved,instance:permissions.instance}));if(config.enabled!==true||config.accessMode!=='local'||!config.authentication||config.legacyCredentialKeys?.includes(config.authentication.key)){assert.equal((comp.runtime as any).finalAnswerDirectory,undefined);assert.equal((await comp.view()).available,false);}assert.deepEqual(await permissions.snapshot(),old);comp.dispose();
  }
}));
test('credential changes during read prevent release',()=>fixture(async(f,http)=>{
  const saved=(await save(http,await review(http))).body.publication.target,record=(await f.permissions.snapshot()).finalPublication!;
  const original=f.runtime.readOnlyFinalAnswer.bind(f.runtime);f.runtime.readOnlyFinalAnswer=async(...args)=>{const value=await original(...args);f.composition.dispose();return value;};await assert.rejects(f.composition.service.finalAnswer(saved));assert.equal(record.feature,'final_answer');
}));
test('expiry and generation release fences reject content',async()=>{
  let offset=0;const f=await ownerFixture({now:()=>Date.now()+offset}),http=await ownerHttp(f);try{
    const target=(await save(http,await review(http))).body.publication.target;assert.equal((await f.composition.service.finalAnswer(target)).text,sampleAnswer);offset=120000;await assert.rejects(f.composition.service.finalAnswer(target));offset=0;
    const original=f.runtime.readOnlyFinalAnswer.bind(f.runtime);f.runtime.readOnlyFinalAnswer=async(...args)=>{const saved=await original(...args);f.state.generation='DUMMY_NEW_GENERATION';return saved;};await assert.rejects(f.composition.service.finalAnswer(target));
  }finally{await http.close();await f.cleanup();}
});
test('configured final/status/control secrets masked before chunking and never advertised as IDs',()=>fixture(async(f,http)=>{
  await f.populate('Dummy '+dummyReadKey+' / '+'a1'.repeat(32)+' / '+'b2'.repeat(32));const v=(await http.post('session',{})).body,target=v.choices.find((x:any)=>x.target.runId!==f.runId).target;
  const r=(await http.post('review',{instance:v.instance,revision:v.revision,target,expiresAt:Date.now()+60000})).body;
  const stored=(await save(http,r)).body.publication.target;const reply=await f.composition.service.finalAnswer(stored);for(const secret of [dummyReadKey,'a1'.repeat(32),'b2'.repeat(32)])assert(!JSON.stringify(reply).includes(secret));assert.equal((reply as any).redacted,true);
}));
test('missing ACK/running root excluded; UI metadata contains no text, prompt, secret or epoch',()=>fixture(async(f,http)=>{
  await f.populate('NOT_PUBLIC_UNKNOWN_ACK',false);const v=(await http.post('session',{})).body;assert.equal(v.choices.length,1);const serialized=JSON.stringify(v);for(const forbidden of [dummyReadKey,sampleAnswer,'DUMMY_PROMPT_NOT_PUBLIC','NOT_PUBLIC_UNKNOWN_ACK','credentialEpoch'])assert(!serialized.includes(forbidden));
  const denied=await fetch(http.base+'/api/workspace-permissions/final/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(denied.status,403);
}));
