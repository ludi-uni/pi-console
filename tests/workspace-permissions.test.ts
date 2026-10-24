import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WorkspacePermissions, validatePermissionSnapshot } from '../server/workspace-permissions.ts';
import { createDotsPermissionsApi } from '../server/dots-permissions-api.ts';
import { PromptReceipts } from '../server/runtime/prompt-receipts.ts';
import type { RuntimeManager } from '../server/runtime/manager.ts';
const readKey='1'.repeat(64),controlKey='2'.repeat(64);
const uuid='00000000-0000-4000-8000-000000000001';
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'dots-permissions-'));
  const path=join(root,'workspace');await mkdir(path);
  let generation='generation-1',prompts=0,stops=0;
  // This fake runtime can only update dummy counters; it has no tools/OS access.
  const runtime={controlIsolationVerified:()=>true,workspaces:{list:()=>[{id:'workspace-1',path}]},
    readOnlySessions:async()=>({sessions:[{id:'session-1'}],unavailable:false,truncated:false,ambiguousSessionIds:[] as string[]}),
    readOnlyObservation:()=>({observation:'observed',generation,runtime:'running',seq:1,truncated:false,nodes:[{id:'run-1',kind:'run',sourceKind:'pi',status:'running'}]}),
    controlState:()=>({generation,activeRunId:'run-1'}),controlAdmission:async()=>{},
    prompt:async()=>{prompts++;return 'run-1';},stop:async()=>{stops++;}};
  const permissions=new WorkspacePermissions(join(root,'stable','workspace-permissions.json'));
  let api=createDotsPermissionsApi(runtime as unknown as RuntimeManager,permissions,new PromptReceipts(join(root,'receipts')),{authentication:{mode:'shared_secret',key:readKey},controlKey});
  const server=createServer((req,res)=>{void api.handle(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address==='object');
  const base=`http://127.0.0.1:${address.port}`;
  const owner=async(route:string,body:unknown,grant?:string,extra:Record<string,string>={})=>{
    const response=await fetch(`${base}/api/workspace-permissions/${route}`,{method:'POST',headers:{origin:base,'sec-fetch-site':'same-origin','x-pi-console-admin':'1','content-type':'application/json',...(grant?{'x-pi-console-permission-grant':grant}:{}),...extra},body:JSON.stringify(body)});
    return {status:response.status,value:await response.json()};
  };
  const native=async(name:string,args:unknown,key=readKey,extra:Record<string,string>={})=>{
    const response=await fetch(`${base}/mcp/dots`,{method:'POST',headers:{'content-type':'application/json',[key===readKey?'x-pi-console-readonly-key':'x-pi-console-control-key']:key,...extra},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
    return {status:response.status,value:await response.json()};
  };
  return {root,path,runtime,permissions,api,owner,native,restart(){api.dispose();api=createDotsPermissionsApi(runtime as unknown as RuntimeManager,new WorkspacePermissions(permissions.file),new PromptReceipts(join(root,'receipts')),{authentication:{mode:'shared_secret',key:readKey},controlKey});},counts:()=>({prompts,stops}),generation:(g:string)=>{generation=g;},async cleanup(){api.dispose();server.close();server.closeAllConnections();await once(server,'close');await rm(root,{recursive:true,force:true});}};
}
test('default none, owner boundary, explicit sessions, read/control separation and revocation invalidate replay',async()=>{
  const f=await fixture();try{
    let r=(await f.owner('session',{})).value;
    assert.deepEqual(r.snapshot.workspaces,[]);
    assert.equal((await f.owner('session',{},undefined,{'sec-fetch-site':'none'})).status,403);
    assert.equal((await f.owner('session',{},undefined,{'x-forwarded-for':'127.0.0.1'})).status,403);
    const selection={id:'workspace-1',path:f.path,scope:'read',sessions:[{id:'session-1',generation:'generation-1'}]};
    const save=(scope:unknown,confirmed=true)=>f.owner('save',{instance:r.instance,revision:r.snapshot.revision,workspaces:scope,confirmed},r.grant);
    assert.equal((await save([selection],false)).status,409);
    r=(await f.owner('session',{})).value;
    r=(await save([selection])).value;
    const args={instance:r.instance,revision:r.snapshot.revision,workspaceId:'workspace-1',sessionId:'session-1',generation:'generation-1'};
    assert.equal((await f.native('get_progress',args)).status,200);
    assert.equal((await f.native('submit_instruction',{...args,requestId:uuid,message:'dummy'})).status,403);
    assert.equal((await f.native('submit_instruction',{...args,requestId:uuid,message:'dummy'},controlKey)).status,409);
    r=(await save([{...selection,scope:'control'}])).value;args.revision=r.snapshot.revision;
    assert.equal((await f.native('submit_instruction',{...args,requestId:uuid,message:'dummy'},controlKey)).status,200);
    assert.equal((await f.native('start_execution',{...args,requestId:uuid},controlKey)).status,200);
    assert.equal((await f.native('start_execution',{...args,requestId:uuid},controlKey)).status,200);
    assert.equal(f.counts().prompts,1);
    const stopId='00000000-0000-4000-8000-000000000002';
    assert.equal((await f.native('stop_execution',{...args,requestId:stopId,runId:'run-1'},controlKey)).status,200);
    assert.equal((await f.native('stop_execution',{...args,requestId:stopId,runId:'run-1'},controlKey)).status,200);
    assert.equal(f.counts().stops,1);
    assert.equal((await f.native('get_request',{...args,requestId:stopId},controlKey)).value.result.structuredContent.state,'accepted');
    assert.equal((await f.native('get_progress',{...args,sessionId:'not-selected'})).status,409);
    assert.equal((await f.native('get_progress',args,readKey,{origin:'http://attacker'})).status,403);
    const stale={...args};r=(await save([])).value;
    assert.equal((await f.native('start_execution',{...stale,requestId:uuid},controlKey)).status,409);
    assert.equal(f.counts().prompts,1);
    const restarted=new WorkspacePermissions(f.permissions.file);
    await assert.rejects(restarted.admit(stale.instance,stale.revision,stale,'control',async()=>{},async()=>{}),/permission_stale/);
    assert.deepEqual((await restarted.snapshot()).workspaces,[]);
  }finally{await f.cleanup();}
});
test('control credential and owner scope cannot substitute for an unverified worker boundary',async()=>{
  const f=await fixture();try{
    f.runtime.controlIsolationVerified=()=>false;
    let r=(await f.owner('session',{})).value;
    assert.equal(r.controlAvailable,false);
    const rule={id:'workspace-1',path:f.path,scope:'control',sessions:[{id:'session-1',generation:'generation-1'}]};
    r=(await f.owner('save',{instance:r.instance,revision:0,workspaces:[rule],confirmed:true},r.grant)).value;
    assert.equal(r.controlAvailable,false);
    const args={instance:r.instance,revision:r.snapshot.revision,workspaceId:'workspace-1',sessionId:'session-1',generation:'generation-1',requestId:uuid};
    for(const [name,extra] of [['submit_instruction',{message:'dummy'}],['start_execution',{}],['stop_execution',{runId:'run-1'}]] as const){
      const response=await f.native(name,{...args,...extra},controlKey);
      assert.equal(response.status,409);assert.equal(response.value.error.message,'worker_isolation_unverified');
    }
    assert.deepEqual(f.counts(),{prompts:0,stops:0});
    const {requestId,...readArgs}=args;
    assert.equal((await f.native('get_progress',readArgs)).status,200);
  }finally{await f.cleanup();}
});
test('CAS, in-flight admission/revoke linearization, corruption, partial save failure and duplicate paths fail closed',async()=>{
  const f=await fixture();try{
    const candidates=await f.api.inventory();
    const rule={id:'workspace-1',path:f.path,scope:'control',sessions:[{id:'session-1',generation:'generation-1'}]};
    const [a,b]=await Promise.allSettled([f.permissions.replace(f.permissions.instance,0,[rule],async()=>candidates),f.permissions.replace(f.permissions.instance,0,[rule],async()=>candidates)]);
    assert.equal([a,b].filter(v=>v.status==='fulfilled').length,1);
    await assert.rejects(f.permissions.replace(f.permissions.instance,0,[],async()=>candidates),/permission_stale/);
    let release!:()=>void, entered!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;}), ready=new Promise<void>(resolve=>{entered=resolve;});
    const active=f.permissions.admit(f.permissions.instance,1,{workspaceId:'workspace-1',sessionId:'session-1',generation:'generation-1'},'control',async()=>{},async()=>{entered();await pending;});
    await ready;
    await assert.rejects(f.permissions.replace(f.permissions.instance,1,[],async()=>candidates),/permission_busy/);
    release();await active;
    await f.permissions.replace(f.permissions.instance,1,[],async()=>candidates);
    await assert.rejects(f.permissions.admit(f.permissions.instance,1,{workspaceId:'workspace-1',sessionId:'session-1',generation:'generation-1'},'control',async()=>{},async()=>{}),/permission_stale/);
    assert.throws(()=>validatePermissionSnapshot({version:1,revision:0,workspaces:[rule,{...rule,id:'duplicate'}]}));
    await writeFile(f.permissions.file,'broken');await assert.rejects(f.permissions.snapshot(),/permission_unavailable/);
    const failure=new WorkspacePermissions(join(f.root,'failure.json'));
    await assert.rejects(failure.replace(failure.instance,0,[rule],async()=>{await mkdir(failure.file);return candidates;}),/permission_save_failed/);
    await rm(failure.file,{recursive:true});await assert.rejects(failure.snapshot(),/permission_unavailable/);
    await assert.rejects(new WorkspacePermissions(failure.file).snapshot(),/permission_busy/);
  }finally{await f.cleanup();}
});
test('unregistered/unobserved/ambiguous targets, old generations and stale grants are denied; separate control credential required',async()=>{
  const f=await fixture();try{
    assert.throws(()=>createDotsPermissionsApi(f.runtime as unknown as RuntimeManager,f.permissions,new PromptReceipts(join(f.root,'other')),{authentication:{mode:'shared_secret',key:readKey},controlKey:readKey}),/invalid_control_authentication/);
    let r=(await f.owner('session',{})).value;
    const rule={id:'workspace-1',path:f.path,scope:'control',sessions:[{id:'session-1',generation:'generation-1'}]};
    const body={instance:r.instance,revision:0,workspaces:[rule],confirmed:true};
    r=(await f.owner('save',body,r.grant)).value;
    assert.equal((await f.owner('save',body,r.grant)).status,409);
    f.generation('generation-2');
    assert.equal((await f.native('get_progress',{instance:r.instance,revision:1,workspaceId:'workspace-1',sessionId:'session-1',generation:'generation-1'})).status,409);
    const old=f.runtime.readOnlyObservation;
    f.runtime.readOnlyObservation=()=>({...old(),observation:'unobserved'});
    assert.equal((await f.api.inventory())[0].eligible,false);
    f.runtime.readOnlyObservation=old;
    const listing=f.runtime.readOnlySessions;
    f.runtime.readOnlySessions=async()=>({...await listing(),ambiguousSessionIds:['session-1']});
    assert.equal((await f.api.inventory())[0].eligible,false);
    assert.equal(f.counts().prompts,0);
    assert.equal(JSON.parse(await readFile(f.permissions.file,'utf8')).revision,1);
  }finally{await f.cleanup();}
});

test('lost native acknowledgement leaves a durable uncertain receipt; scope switching/restart cannot replay it',async()=>{
  const f=await fixture();try{
    let r=(await f.owner('session',{})).value;
    const rule={id:'workspace-1',path:f.path,scope:'control',sessions:[{id:'session-1',generation:'generation-1'}]};
    const save=async(scope:string)=>{r=(await f.owner('save',{instance:r.instance,revision:r.snapshot.revision,workspaces:[{...rule,scope}],confirmed:true},r.grant)).value;};
    await save('control');
    let args={instance:r.instance,revision:r.snapshot.revision,workspaceId:'workspace-1',sessionId:'session-1',generation:'generation-1',requestId:uuid};
    const original=f.runtime.prompt;f.runtime.prompt=async()=>{await original();throw Error('dummy lost ACK');};
    assert.equal((await f.native('submit_instruction',{...args,message:'dummy'},controlKey)).status,200);
    assert.equal((await f.native('start_execution',args,controlKey)).status,409);
    assert.equal((await f.native('start_execution',args,controlKey)).status,409);
    assert.equal(f.counts().prompts,1);
    assert.equal(JSON.parse(await readFile(join(f.root,'receipts',`${uuid}.json`),'utf8')).state,'uncertain');
    const stale={...args};await save('read');
    assert.equal((await f.native('start_execution',stale,controlKey)).status,409);
    await save('control');args={...args,revision:r.snapshot.revision};
    assert.equal((await f.native('start_execution',args,controlKey)).status,409);
    f.restart();r=(await f.owner('session',{})).value;
    assert.equal((await f.native('start_execution',args,controlKey)).status,409);
    args={...args,instance:r.instance,revision:r.snapshot.revision};
    assert.equal((await f.native('submit_instruction',{...args,message:'dummy'},controlKey)).status,200);
    assert.equal((await f.native('start_execution',args,controlKey)).status,409);
    assert.equal(f.counts().prompts,1);
  }finally{await f.cleanup();}
});
