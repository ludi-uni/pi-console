import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,rename,symlink,link} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {WorkspacePermissions} from '../server/workspace-permissions.ts';
import {ResultsReadService} from '../server/results-read.ts';
import {createResultsReadTools} from '../server/results-read-tools.ts';
import {RuntimeManager} from '../server/runtime/manager.ts';
import {WorkspaceStore} from '../server/runtime/workspaces.ts';
import {SessionEvents} from '../server/runtime/events.ts';
import {createReadOnlyMcp} from '../server/readonly-mcp.ts';
import type {ResultProjection,ResultTarget,ResultRuntime} from '../shared/results-read.ts';
import type {ExecutionEvent} from '../shared/types.ts';
const secret='DUMMY_SECRET_NEVER_EXPORT_0123456789';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function fixture(work:(f:Awaited<ReturnType<typeof setup>>)=>Promise<void>){const f=await setup();try{await work(f);}finally{await rm(f.root,{recursive:true,force:true});}}
async function setup(){
  const root=await mkdtemp(join(tmpdir(),'results-read-dummy-')),workspace=join(root,'workspace');await mkdir(workspace);
  const permissions=new WorkspacePermissions(join(root,'permissions.json'));
  await permissions.replace(permissions.instance,0,[{id:'w',path:workspace,scope:'read',sessions:[{id:'s',generation:'g'}]}],async()=>[{id:'w',path:workspace,eligible:true,sessions:[{id:'s',generation:'g'}]}]);
  const target:ResultTarget={instance:permissions.instance,revision:1,workspaceId:'w',sessionId:'s',generation:'g',runId:'parent'};
  const p:ResultProjection={generation:'g',seq:0,observedAt:Date.now(),live:true,truncated:false,coverage:{pi:'complete',subagents:'complete',orchestrator:'complete',queue:'complete',background:'complete'},
    nodes:[{id:'parent',kind:'run',status:'completed',sourceKind:'pi',correlation:'explicit',provider:'dummy-provider',model:'actual-run-model'}],events:[],historyState:'available',metadata:{sessionName:'Dummy session',savedModel:{provider:'dummy-config',model:'saved-not-run'}}};
  let reads=0;
  const runtime:ResultRuntime={workspaces:{get(id){if(id!=='w')throw Error('not allowed');return {id:'w',path:workspace,name:'Dummy workspace'};}},readOnlyResultProjection(w,s){reads++;return w==='w'&&s==='s'?p:undefined;}};
  const grants=[{target,features:['history','aggregate','artifacts','metadata'] as const,expiresAt:Date.now()+60000}];
  const service=new ResultsReadService(permissions,runtime,{enabled:true,grants:grants.map(g=>({...g,features:[...g.features]})),knownSecrets:[secret]});
  const events=(texts:string[],types:ExecutionEvent['type'][]=[])=>{p.events=texts.map((text,i)=>({schemaVersion:1,eventId:`e${i}`,seq:i+1,timestamp:new Date().toISOString(),generation:'g',workspaceId:'w',sessionId:'s',runId:'parent',type:types[i]??'MessageDelta',entityId:'message',source:'pi-rpc',certainty:'observed',payload:{delta:text}}));p.seq=texts.length;};
  return {root,workspace,permissions,target,p,runtime,service,events,reads:()=>reads};
}
test('default OFF and status-only scope do not imply disclosure; tools have no registration side effect',()=>fixture(async f=>{
  const off=new ResultsReadService(f.permissions,f.runtime);await assert.rejects(off.metadata(f.target),/feature_disabled/);
  const noGrant=new ResultsReadService(f.permissions,f.runtime,{enabled:true});await assert.rejects(noGrant.history(f.target),/content_scope_denied/);
  assert.deepEqual(createResultsReadTools(f.service).list(),[]);assert.equal(f.reads(),0);
}));
test('foreground completed with explicit running/waiting child is not aggregate completion',()=>fixture(async f=>{
  f.p.nodes.push({id:'child',parentId:'parent',kind:'agent',sourceKind:'pi-subagents',correlation:'explicit',status:'running'});
  let state=await f.service.aggregate(f.target);assert.equal(state.foreground.terminal,true);assert.equal(state.aggregate,'running');assert.equal(state.completionConfirmed,false);
  f.p.nodes[1].status='waiting';state=await f.service.aggregate(f.target);assert.equal(state.aggregate,'waiting');assert.equal(state.wholeOSIdleConfirmed,false);
}));
test('failed/cancelled/unknown and coverage/freshness/disconnection are explicit',()=>fixture(async f=>{
  for(const status of ['failed','cancelled','unknown'] as const){f.p.nodes[0].status=status;const result=await f.service.aggregate(f.target);assert.equal(result.aggregate,status);assert.equal(result.completionConfirmed,status!=='unknown');}
  f.p.nodes[0].status='completed';f.p.coverage.background='incomplete';assert.equal((await f.service.aggregate(f.target)).aggregate,'unknown');
  f.p.coverage.background='complete';f.p.observedAt=Date.now()-60000;assert.equal((await f.service.aggregate(f.target)).completionConfirmed,false);
  f.p.live=false;assert.equal((await f.service.aggregate(f.target)).aggregate,'unknown');
}));
test('unrelated orphan is not guessed into target run; duplicate node IDs are incomplete',()=>fixture(async f=>{
  f.p.nodes.push({id:'unrelated',kind:'agent',sourceKind:'pi-subagents',correlation:'unknown',status:'running'});
  const result=await f.service.aggregate(f.target);assert.equal(result.nodes.length,1);assert.equal(result.unboundWorkObserved,true);
  f.p.nodes.push({...f.p.nodes[0]});assert.equal((await f.service.aggregate(f.target)).incomplete,true);
}));
test('stable cursor paging, repeat, append and no selected sequence loss',()=>fixture(async f=>{
  f.events(['first','second','third']);const a=await f.service.history(f.target,{limit:1});assert.equal(a.items[0].sequence,1);assert.equal(a.paging,true);
  const b=await f.service.history(f.target,{cursor:a.nextCursor,limit:1});assert.equal(b.items[0].sequence,2);assert.deepEqual(await f.service.history(f.target,{cursor:a.nextCursor,limit:1}),b);
  const c=await f.service.history(f.target,{cursor:b.nextCursor});assert.deepEqual(c.items.map(x=>x.sequence),[3]);
  f.events(['first','second','third','fourth']);assert.deepEqual((await f.service.history(f.target,{cursor:c.nextCursor})).items.map(x=>x.sequence),[4]);
  await assert.rejects(f.service.history(f.target,{cursor:c.nextCursor+'invalid'}),/cursor_invalid/);
}));
test('duplicates/gaps/retention expiry/saving/unknown/truncation never claim readable completion',()=>fixture(async f=>{
  f.events(['one','two']);f.p.events[1].seq=1;assert.equal((await f.service.history(f.target)).gap,true);
  f.events(['one','two']);f.p.events.shift();assert.equal((await f.service.history(f.target)).gap,true);
  for(const storage of ['saving','expired','unknown'] as const){f.p.historyState=storage;const r=await f.service.history(f.target);assert.equal(r.storage,storage);assert.equal(r.readable,false);assert.equal(r.completionConfirmed,false);}
  f.p.historyState='available';f.events(['x'.repeat(20000)]);assert.equal((await f.service.history(f.target)).truncation,true);
}));
test('tool error output and approval wait are read-only; missing body is not full success',()=>fixture(async f=>{
  f.events([''],['ToolFailed']);f.p.events[0].status='failed';f.p.events[0].payload={chatTool:{output:'dummy error',outputTruncated:false}};
  const r=await f.service.history(f.target);assert.equal(r.items[0].text,'dummy error');assert.equal(r.items[0].status,'failed');assert.equal(r.items[0].instructions,false);
  f.p.events[0].payload={summary:'Tool failed'};assert.equal((await f.service.history(f.target)).readable,false);
  f.p.nodes.push({id:'approval',parentId:'parent',kind:'decision',sourceKind:'orchestrator',correlation:'explicit',status:'waiting'});assert.equal((await f.service.aggregate(f.target)).aggregate,'waiting');
}));
test('known secret redaction crosses delta and page boundary, partial prefix holds cursor',()=>fixture(async f=>{
  f.events([secret.slice(0,17),secret.slice(17)]);const page=await f.service.history(f.target,{limit:1});const next=await f.service.history(f.target,{cursor:page.nextCursor});
  assert(!JSON.stringify([page,next]).includes(secret));assert(!page.items[0].text.includes(secret.slice(0,17)));assert(!next.items[0].text.includes(secret.slice(17)));
  f.events([secret.slice(0,17)]);const held=await f.service.history(f.target);assert.equal(held.redactionPending,true);assert.equal(held.sequence,0);assert.equal(held.readable,false);
}));
test('metadata is target-only with saved and actual model separated; unknown never inferred',()=>fixture(async f=>{
  const r=await f.service.metadata(f.target);assert.equal(r.workspaceName,'Dummy workspace');assert.equal(r.canonicalPath,f.workspace);assert.equal(r.savedModel?.model,'saved-not-run');assert.equal(r.runModel?.model,'actual-run-model');
  f.p.metadata.savedModel=null;delete f.p.nodes[0].model;assert.deepEqual((await f.service.metadata(f.target)).unknownFields,['savedModel','runModel']);
  const tools=createResultsReadTools(f.service,{enabled:true});const refused=await tools.call('read_target_metadata',{...f.target,workspaceId:'foreign'});assert.equal(refused.isError,true);assert(!JSON.stringify(refused).includes(f.workspace));
}));
test('instance/revision/generation/run mismatch and expired grants refuse without side effects',()=>fixture(async f=>{
  for(const patch of [{instance:'other'},{revision:0},{generation:'old'},{runId:'different'},{sessionId:'other'}])await assert.rejects(f.service.metadata({...f.target,...patch}));
  const expired=new ResultsReadService(f.permissions,f.runtime,{enabled:true,grants:[{target:f.target,features:['metadata'],expiresAt:0}]});await assert.rejects(expired.metadata(f.target),/content_scope_denied/);
}));
test('revocation fence serializes active read; future reads fail stale after revoke',()=>fixture(async f=>{
  f.events(['dummy']);const original=f.runtime.readOnlyResultProjection;
  let attempted=false;f.runtime.readOnlyResultProjection=(w,s)=>{if(!attempted){attempted=true;void f.permissions.replace(f.permissions.instance,1,[],async()=>[]).then(()=>assert.fail('concurrent revoke must not pass'),e=>assert.equal(e.code,'permission_busy'));}return original(w,s);};
  await f.service.history(f.target);await f.permissions.replace(f.permissions.instance,1,[],async()=>[]);await assert.rejects(f.service.history(f.target),e=>(e as any).code==='permission_stale');
}));
test('generation changes across await fence cannot release artifact bytes',()=>fixture(async f=>{
  await writeFile(join(f.workspace,'result.txt'),'dummy result');let calls=0;const original=f.runtime.readOnlyResultProjection;
  f.runtime.readOnlyResultProjection=(w,s)=>{const p=original(w,s);if(++calls===3)f.p.generation='restarted';return p;};
  await assert.rejects(f.service.registerArtifact(f.target,{relativePath:'result.txt',name:'result.txt',mime:'text/plain',kind:'generated'}),/target_unavailable/);
}));
test('explicit text/binary artifacts transfer bounded inline chunks with size/version/hash; no URL',()=>fixture(async f=>{
  const bytes=Buffer.alloc(70000);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  await writeFile(join(f.workspace,'binary.bin'),bytes);await writeFile(join(f.workspace,'answer.txt'),'dummy answer');
  const a=await f.service.registerArtifact(f.target,{relativePath:'binary.bin',name:'binary.bin',mime:'application/octet-stream',kind:'generated'});
  await f.service.registerArtifact(f.target,{relativePath:'answer.txt',name:'answer.txt',mime:'text/plain',kind:'attached'});
  assert.equal(a.sha256,sha(bytes));assert.equal(a.size,70000);assert.equal((await f.service.listArtifacts(f.target,0,1)).nextOffset,1);
  const parts:Buffer[]=[];let offset=0;while(true){const r=await f.service.readArtifact(f.target,a.artifactId,a.version,offset);const chunk=Buffer.from(r.data,'base64');assert.equal(r.chunkSha256,sha(chunk));assert(chunk.length<=32768);parts.push(chunk);if(r.eof)break;offset=r.nextOffset!;}
  assert.deepEqual(Buffer.concat(parts),bytes);assert(!JSON.stringify(a).includes(f.workspace));assert(!Object.hasOwn(a,'url'));
  const tool=createResultsReadTools(f.service,{enabled:true});assert.equal((await tool.call('read_artifact',{...f.target,artifactId:a.artifactId,version:a.version})).isError,false);
}));
test('arbitrary path/URL/traversal and credential files are never artifact read APIs',()=>fixture(async f=>{
  for(const path of ['../foreign.txt',f.workspace,'https://fixture.invalid/secret','.env','private.key','auth.json'])await assert.rejects(f.service.registerArtifact(f.target,{relativePath:path,name:'dummy',mime:'text/plain',kind:'generated'}));
  const tools=createResultsReadTools(f.service,{enabled:true});for(const field of ['path','url'])assert.equal((await tools.call('read_artifact',{...f.target,artifactId:'unknown',version:'0'.repeat(64),[field]:'https://fixture.invalid'})).isError,true);
  assert.equal((await tools.call('read_artifact',{...f.target,artifactId:'https://fixture.invalid',version:'0'.repeat(64)})).isError,true);
}));
test('links, hardlinks, replace/delete and known-secret artifacts are rejected',()=>fixture(async f=>{
  const other=join(f.root,'dummy-outside');await mkdir(other);await writeFile(join(other,'file.txt'),'outside dummy');await symlink(other,join(f.workspace,'junction'),'junction');
  await assert.rejects(f.service.registerArtifact(f.target,{relativePath:'junction/file.txt',name:'file.txt',mime:'text/plain',kind:'generated'}));
  await writeFile(join(f.workspace,'plain.txt'),'plain');await link(join(f.workspace,'plain.txt'),join(f.workspace,'hard.txt'));await assert.rejects(f.service.registerArtifact(f.target,{relativePath:'hard.txt',name:'hard.txt',mime:'text/plain',kind:'generated'}));
  await writeFile(join(f.workspace,'secret.txt'),secret);await assert.rejects(f.service.registerArtifact(f.target,{relativePath:'secret.txt',name:'secret.txt',mime:'text/plain',kind:'generated'}),/artifact_known_secret/);
  await writeFile(join(f.workspace,'replace.txt'),'original');const a=await f.service.registerArtifact(f.target,{relativePath:'replace.txt',name:'replace.txt',mime:'text/plain',kind:'generated'});
  await rename(join(f.workspace,'replace.txt'),join(f.workspace,'old.txt'));await writeFile(join(f.workspace,'replace.txt'),'original');await assert.rejects(f.service.readArtifact(f.target,a.artifactId,a.version),/artifact_changed/);
  await rm(join(f.workspace,'replace.txt'));await assert.rejects(f.service.readArtifact(f.target,a.artifactId,a.version));
}));
test('oversize artifacts and wrong version/scope fail; no implicit file discovery',()=>fixture(async f=>{
  await writeFile(join(f.workspace,'large.bin'),Buffer.alloc(8*1024*1024+1));await assert.rejects(f.service.registerArtifact(f.target,{relativePath:'large.bin',name:'large.bin',mime:'application/octet-stream',kind:'generated'}));
  await writeFile(join(f.workspace,'unregistered.txt'),'not declared');assert.deepEqual((await f.service.listArtifacts(f.target)).artifacts,[]);
  await writeFile(join(f.workspace,'small.txt'),'small');const a=await f.service.registerArtifact(f.target,{relativePath:'small.txt',name:'small.txt',mime:'text/plain',kind:'generated'});
  await assert.rejects(f.service.readArtifact(f.target,a.artifactId,'0'.repeat(64)));await assert.rejects(f.service.readArtifact({...f.target,runId:'foreign'},a.artifactId,a.version));
}));
test('real runtime passive projection does not open workers/queue or claim census; legacy unchanged',async()=>{
  const root=await mkdtemp(join(tmpdir(),'results-runtime-dummy-'));try{
    const store=new WorkspaceStore(join(root,'workspaces.json')),w=await store.add(root),runtime=new RuntimeManager(store,join(root,'sessions'),join(root,'reports'),join(root,'queue'));
    let mutations=0;for(const name of ['open','resume','prompt','stop','options','startOrchestrator']) (runtime as any)[name]=()=>{mutations++;throw Error('forbidden');};
    const session={id:'dummy',workspaceId:w.id,filePath:join(root,'dummy.jsonl'),name:'Dummy'};const events=new SessionEvents(session,()=> 'running');
    (runtime as any).active.set('dummy',{session,state:events,worker:{state:'running',call(){mutations++;throw Error('no RPC');}}});
    const projection=runtime.readOnlyResultProjection(w.id,'dummy')!;assert.equal(projection.coverage.background,'incomplete');assert.equal(projection.metadata.savedModel,null);assert.equal(mutations,0);assert.equal(runtime.controlIsolationVerified(),false);
    const legacy=createReadOnlyMcp(runtime,{enabled:false});assert.equal(runtime.readOnlyResultProjection(w.id,'other'),undefined);legacy.dispose();assert.equal(mutations,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('unknown enum values and model claims are bounded rather than copied into results',()=>fixture(async f=>{
  f.p.nodes[0].status=secret as any;f.p.nodes[0].model=secret;(f.p.coverage as any).background=secret;
  const aggregate=await f.service.aggregate(f.target);assert.equal(aggregate.foreground.state,'unknown');assert.equal(aggregate.completionConfirmed,false);assert(!JSON.stringify(aggregate).includes(secret));
  const metadata=await f.service.metadata(f.target);assert.equal(metadata.runModel,null);assert(!JSON.stringify(metadata).includes(secret));
}));
test('known-secret node identities fail closed without returning ancestor identifiers',()=>fixture(async f=>{
  f.p.nodes.push({id:secret,parentId:'parent',kind:'agent',status:'running',sourceKind:'pi-subagents',correlation:'explicit'});
  const reply=await createResultsReadTools(f.service,{enabled:true}).call('read_work_state',f.target);assert.equal(reply.isError,true);assert(!JSON.stringify(reply).includes(secret));
}));
