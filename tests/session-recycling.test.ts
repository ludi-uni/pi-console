import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,stat,rm,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkspaceStore} from '../server/runtime/workspaces.ts';
import {RuntimeManager} from '../server/runtime/manager.ts';
import {SessionRecycling,validateRetention} from '../server/runtime/session-recycling.ts';

test('retention is disabled by default, persisted server-side, validates days and recycles only old registered sessions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-recycling-'));const workspacePath=join(root,'workspace'),sessionsRoot=join(root,'sessions'),trash=join(root,'trash');
  await Promise.all([mkdir(workspacePath),mkdir(sessionsRoot),mkdir(trash)]);
  try{
    const store=new WorkspaceStore(join(root,'workspaces.json'));await store.load();const workspace=await store.add(workspacePath);
    const old=join(sessionsRoot,'old.jsonl'),recent=join(sessionsRoot,'recent.jsonl');
    for(const [file,id] of [[old,'old'],[recent,'recent']])await writeFile(file,JSON.stringify({type:'session',id,cwd:workspacePath})+'\n');
    const aged=new Date(Date.now()-40*86400000);await utimes(old,aged,aged);
    const runtime=new RuntimeManager(store,sessionsRoot);const moves:string[]=[];
    const retentionFile=join(root,'retention.json');const recycler=new SessionRecycling(retentionFile,runtime,async file=>{moves.push(file);await rename(file,join(trash,file.split(/[\\/]/).at(-1)!))});
    await recycler.load();assert.deepEqual({enabled:recycler.settings().enabled,days:recycler.settings().days},{enabled:false,days:30});
    assert.equal(await recycler.sweep(),undefined);assert.deepEqual(moves,[]);
    for(const bad of [{enabled:true,days:0},{enabled:true,days:30.5},{enabled:'true',days:30},{enabled:true,days:3651}])assert.throws(()=>validateRetention(bad));
    await recycler.update({enabled:false,days:35});assert.equal((await readFile(retentionFile,'utf8')).includes('"days":35'),true);
    await recycler.update({enabled:true,days:35}); // update starts a sweep; concurrent explicit sweep safely does nothing.
    const until=Date.now()+5000;while(recycler.settings().lastRun?.moved!==1&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,30));
    assert.deepEqual(moves,[old]);assert.equal((await stat(join(trash,'old.jsonl'))).isFile(),true);assert.equal((await stat(recent)).isFile(),true);
    assert.equal((await recycler.sweep())?.moved,0);
    const restored=new SessionRecycling(retentionFile,runtime);await restored.load();assert.equal(restored.settings().enabled,true);assert.equal(restored.settings().days,35);
    await assert.rejects(recycler.recycle(workspace.id,'old'),/not found/);
  }finally{await rm(root,{recursive:true,force:true})}
});

test('manual recycling rejects running, waiting and concurrent sessions; move failure preserves file',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-recycling-safety-'));const workspacePath=join(root,'workspace'),sessionsRoot=join(root,'sessions');await mkdir(workspacePath);await mkdir(sessionsRoot);
  try{
    const store=new WorkspaceStore(join(root,'workspaces.json'));await store.load();const workspace=await store.add(workspacePath);const file=join(sessionsRoot,'only.jsonl');await writeFile(file,JSON.stringify({type:'session',id:'one',cwd:workspacePath})+'\n');
    const runtime=new RuntimeManager(store,sessionsRoot);let moved=0;
    const recycler=new SessionRecycling(join(root,'retention.json'),runtime,async()=>{moved++});
    const entries=(runtime as unknown as {active:Map<string,unknown>}).active;
    const entry={session:{id:'one',workspaceId:workspace.id},state:{activeRunId:'run',execution:{snapshot:()=>({nodes:[] as {status:string}[],decisionCount:0})}}};entries.set('one',entry);
    await assert.rejects(recycler.recycle(workspace.id,'one'),/active or awaiting/);
    entry.state.activeRunId='';entry.state.execution.snapshot=()=>({nodes:[{status:'waiting'}],decisionCount:1});
    await assert.rejects(recycler.recycle(workspace.id,'one'),/active or awaiting/);
    entry.state.execution.snapshot=()=>({nodes:[],decisionCount:0});
    await assert.rejects(runtime.recycleSession(workspace.id,'one',async()=>{moved++},Date.now()),/open in Pi Console/);
    assert.equal(moved,0);entries.delete('one');
    let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve});
    const concurrent=new SessionRecycling(join(root,'retention.json'),runtime,async()=>{await blocked;throw new Error('bin unavailable')});
    const first=concurrent.recycle(workspace.id,'one');await new Promise(resolve=>setTimeout(resolve,60));
    await assert.rejects(concurrent.recycle(workspace.id,'one'),/active or awaiting/);
    await assert.rejects(runtime.open(workspace.id,'one'),/being recycled/);
    release();await assert.rejects(first,/bin unavailable/);assert.equal((await stat(file)).isFile(),true);
    await assert.rejects(recycler.recycle(workspace.id,'wrong'),/not found/);
  }finally{await rm(root,{recursive:true,force:true})}
});
