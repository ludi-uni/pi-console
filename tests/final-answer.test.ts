import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createServer,request} from 'node:http';
import {finalFixture,dummyReadKey,dummySecret,sampleAnswer} from './final-answer.fixture.ts';
import {ResultsReadService} from '../server/results-read.ts';
import {createResultsReadTools} from '../server/results-read-tools.ts';
import {createFinalAnswerMcp} from '../server/final-answer-mcp.ts';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
async function isolated(work:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'final-answer-unit-'));try{await work(root);}finally{await rm(root,{recursive:true,force:true});}}
test('same SDK appendMessage storage -> runtime journal -> core final answer; not merely last message',()=>isolated(async root=>{
  const f=await finalFixture(root);const saved=await readFile(f.sdk.getSessionFile(),'utf8');assert(saved.includes(sampleAnswer.split('\n')[0]));
  const reply=await f.service.finalAnswer(f.target);assert.equal(reply.readable,true);assert.equal(reply.text,sampleAnswer);assert.equal(reply.sha256,sha(sampleAnswer));assert.equal(reply.aggregateCompletionConfirmed,false);
  assert.equal(f.mutations(),0);assert.equal(f.runtime.controlIsolationVerified(),false);f.adapter.dispose();
}));
test('missing persistence, no settled, non-final tool/length/error stop, body limit, unknown ACK fail closed',()=>isolated(async root=>{
  for(const [index,options] of [{persist:false},{settle:false},{stopReason:'length'},{stopReason:'toolUse'},{stopReason:'error'},{text:'x'.repeat(65537)},{ack:false}].entries()){
    const dir=join(root,String(index));await import('node:fs/promises').then(fs=>fs.mkdir(dir));const f=await finalFixture(dir,options);const r=await f.service.finalAnswer(f.target);assert.equal(r.readable,false);assert.equal(r.text,null);assert.equal(r.foregroundFinalConfirmed,false);
    if(options.text)assert.equal(r.storage,'too_large');f.adapter.dispose();
  }
}));
test('child continues while foreground answer is readable; aggregate never claimed complete',()=>isolated(async root=>{
  const f=await finalFixture(root);f.state.publishNode({id:'dummy-child',kind:'agent',label:'Dummy child',parentId:f.target.runId,correlation:'explicit',sourceKind:'pi-subagents',status:'running',updatedAt:new Date().toISOString()});
  const r=await f.service.finalAnswer(f.target);assert.equal(r.readable,true);assert.equal((r as any).relatedChildrenActive,true);assert.equal((r as any).overallState,'running');assert.equal(r.aggregateCompletionConfirmed,false);f.adapter.dispose();
}));
test('exact binding/feature/expiry/revocation and corrupt journal refuse content',()=>isolated(async root=>{
  const f=await finalFixture(root);
  for(const patch of [{runId:'other'},{sessionId:'other'},{generation:'old'},{instance:'old'},{revision:0}])await assert.rejects(f.service.finalAnswer({...f.target,...patch}));
  for(const grant of [{features:['history'] as const,expiresAt:Date.now()+60000},{features:['final_answer'] as const,expiresAt:0}]){
    const s=new ResultsReadService(f.permissions,f.runtime,{enabled:true,grants:[{target:f.target,features:[...grant.features],expiresAt:grant.expiresAt}]});await assert.rejects(s.finalAnswer(f.target),/content_scope_denied/);
  }
  const dir=join(root,'final-answers');const files=await readdir(dir);await writeFile(join(dir,files[0]),'{"forged":"dummy"}');assert.equal((await f.service.finalAnswer(f.target)).readable,false);
  await f.permissions.replace(f.permissions.instance,1,[],async()=>[]);await assert.rejects(f.service.finalAnswer(f.target));f.adapter.dispose();
}));
test('release fence rejects a changed foreground and reports disconnection without aggregate completion',()=>isolated(async root=>{
  const f=await finalFixture(root);const projection=f.runtime.readOnlyResultProjection.bind(f.runtime),read=f.runtime.readOnlyFinalAnswer.bind(f.runtime);let changed=false;
  f.runtime.readOnlyResultProjection=(...args)=>{const p=projection(...args);return p&&{...p,nodes:p.nodes.map(n=>changed&&n.id===f.target.runId?{...n,status:'running'}:n)};};
  f.runtime.readOnlyFinalAnswer=async(...args)=>{const saved=await read(...args);changed=true;return saved;};await assert.rejects(f.service.finalAnswer(f.target),/final_answer_changed/);
  changed=false;f.runtime.readOnlyResultProjection=projection;f.runtime.readOnlyFinalAnswer=read;f.worker.state='failed';const r=await f.service.finalAnswer(f.target);assert.equal((r as any).snapshotLive,false);assert.equal((r as any).overallState,'unknown');assert.equal(r.aggregateCompletionConfirmed,false);f.adapter.dispose();
}));
test('late authoritative ACK releases the saved answer without executing again; pending writes show saving',()=>isolated(async root=>{
  const f=await finalFixture(root,{ack:false});assert.equal((await f.service.finalAnswer(f.target)).readable,false);
  f.state.accepted(f.target.runId);const pending=await f.state.readOnlyFinalAnswer(f.target.runId);assert.equal(pending.storage,'saving');await f.state.flushFinalAnswers();
  assert.equal((await f.service.finalAnswer(f.target)).readable,true);assert.equal(f.mutations(),0);f.adapter.dispose();
}));
test('SDK session/leaf binding cannot be substituted by a last assistant lookalike',()=>isolated(async root=>{
  const f=await finalFixture(root);f.evidence.start(f.target.runId,f.sdk);const message={role:'assistant',stopReason:'stop',content:[{type:'text',text:sampleAnswer}]};f.evidence.observe({type:'message_end',message});
  const changed={getSessionId:()=> 'different',getSessionFile:()=>f.sdk.getSessionFile(),getLeafId:()=>f.sdk.getLeafId()};assert.equal(f.evidence.finish(changed)?.state,'binding_changed');
  f.evidence.start(f.target.runId,f.sdk);f.evidence.observe({type:'message_end',message});assert.equal(f.evidence.finish(f.sdk)?.state,'missing');f.adapter.dispose();
}));
test('signed final cursor retry/paging/hash and known-secret exclusion',()=>isolated(async root=>{
  const f=await finalFixture(root,{text:sampleAnswer+'\n'+dummySecret});const a=await f.service.finalAnswer(f.target,{limit:32});assert(a.nextCursor);
  const b=await f.service.finalAnswer(f.target,{cursor:a.nextCursor!,limit:32});assert.deepEqual(await f.service.finalAnswer(f.target,{cursor:a.nextCursor!,limit:32}),b);
  let text=a.text!;let next:string|null=a.nextCursor;while(next){const r=await f.service.finalAnswer(f.target,{cursor:next,limit:32});text+=r.text;next=r.nextCursor;}
  assert(!text.includes(dummySecret));assert.equal(sha(text),a.sha256);await assert.rejects(f.service.finalAnswer(f.target,{cursor:a.nextCursor!+'bad'}));
  const historyOnly=new ResultsReadService(f.permissions,f.runtime,{enabled:true,grants:[{target:f.target,features:['history'],expiresAt:Date.now()+1000}]});assert.equal((await createResultsReadTools(historyOnly,{enabled:true}).call('read_final_answer',f.target)).isError,true);f.adapter.dispose();
}));
test('real HTTP strict authenticated /mcp/dots final-only adapter; legacy/owner/control no bypass',()=>isolated(async root=>{
  const f=await finalFixture(root);const options={enabled:false},off=createFinalAnswerMcp(f.service,options);options.enabled=true;let status=0;
  await off.handle({url:'/mcp/dots'} as any,{writeHead(code:number){status=code;},end(){}} as any);assert.equal(status,404);off.dispose();
  assert.throws(()=>createFinalAnswerMcp(new ResultsReadService(f.permissions,f.runtime),{enabled:true,authentication:{mode:'shared_secret',key:dummyReadKey}}),/read_auth_secret_protection_required/);
  const server=createServer((req,res)=>void f.adapter.handle(req,res).then(ok=>{if(!ok){res.writeHead(404);res.end();}}));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
  const call=async({key=dummyReadKey,path='/mcp/dots',origin=false,name='read_final_answer',args=f.target}:{key?:string|string[];path?:string;origin?:boolean;name?:string;args?:any}={})=>new Promise<any>((resolve,reject)=>{
    const q=request({host:'127.0.0.1',port,path,method:'POST',headers:{'x-pi-console-dots-read-key':key,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name,...(origin?{origin:'https://fixture.invalid'}:{})}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body:body?JSON.parse(body):null}));});q.on('error',reject);q.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}}));
  });
  try{const r=await call();assert.equal(r.status,200);assert.equal(r.body.result.structuredContent.text,sampleAnswer);assert.equal((await call({key:'bad'})).status,401);assert.equal((await call({key:[dummyReadKey,dummyReadKey]})).status,401);assert.equal((await call({origin:true})).status,403);for(const path of ['/mcp/readonly','/api/workspace-permissions/save','/mcp/dots?x=1'])assert.equal((await call({path})).status,404);assert.equal((await call({name:'start_execution'})).status,404);assert.equal((await call({args:{...f.target,runId:'foreign'}})).body.result.isError,true);assert.equal(f.mutations(),0);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));f.adapter.dispose();}
}));
