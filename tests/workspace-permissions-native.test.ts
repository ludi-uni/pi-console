import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PiProcess } from '../server/adapters/pi/process.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { SessionEvents } from '../server/runtime/events.ts';

test('native worker fences clear_queue and abort to the exact run; old tokens cannot affect a replacement run', {timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'dots-native-'));
  const previous={...process.env};let worker:PiProcess|undefined;
  try{
    // Never carry provider credentials or a real user profile into an isolated child.
    for(const key of Object.keys(process.env))delete process.env[key];
    for(const key of ['SystemRoot','WINDIR','PATH','PATHEXT','ComSpec'])if(previous[key])process.env[key]=previous[key];
    const profile=join(root,'profile');await mkdir(profile);
    Object.assign(process.env,{TEMP:root,TMP:root,HOME:profile,USERPROFILE:profile,APPDATA:profile,LOCALAPPDATA:profile,PI_CODING_AGENT_DIR:profile});
    const entry=join(root,'worker.mjs');
    await writeFile(entry,`process.argv.push('--sdk-entry',${JSON.stringify(fileURLToPath(new URL('./helpers/fake-sdk.mjs',import.meta.url)))},'--sdk-version','1.0.2');await import(${JSON.stringify(new URL('../package/sdk-worker.mjs',import.meta.url).href)});`);
    process.env.PI_CONSOLE_WORKER_COMMAND=entry;
    worker=new PiProcess(root,undefined,join(root,'sessions'));await worker.start();
    const first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002';
    await worker.call('prompt',{message:'/slow',consoleRunId:first});
    await assert.rejects(worker.call('clear_queue',{expectedConsoleRunId:second}),/control_run_not_active/);
    await assert.rejects(worker.call('abort',{expectedConsoleRunId:second}),/control_run_not_active/);
    assert.equal((await worker.call('get_state')).data.isStreaming,true);
    await worker.call('clear_queue',{expectedConsoleRunId:first});await worker.call('abort',{expectedConsoleRunId:first});
    await worker.call('prompt',{message:'/slow',consoleRunId:second});
    await assert.rejects(worker.call('abort',{expectedConsoleRunId:first}),/control_run_not_active/);
    await assert.rejects(worker.call('clear_queue',{expectedConsoleRunId:first}),/control_run_not_active/);
    assert.equal((await worker.call('get_state')).data.isStreaming,true);
    await worker.call('abort',{expectedConsoleRunId:second});
    await assert.rejects(worker.call('abort',{expectedConsoleRunId:second}),/control_run_not_active/);
  }finally{
    await worker?.close();for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,previous);
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
test('runtime control cannot open unobserved workers and rechecks generation/run after awaited queue operations',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dots-runtime-'));
  try{
    const store=new WorkspaceStore(join(root,'workspaces.json'));await store.load();const ws=await store.add(root);
    const runtime=new RuntimeManager(store,join(root,'sessions'),join(root,'reports'),join(root,'queue'));
    assert.equal(runtime.controlIsolationVerified(),false,'normal owner-user workers must not be treated as sandboxed');
    await assert.rejects(runtime.prompt(ws.id,'missing','dummy',[],undefined,{generation:'g',requestId:'r'}),/target_unavailable/);
    const state=new SessionEvents({id:'session',workspaceId:ws.id,filePath:join(root,'dummy.jsonl')},()=> 'running');
    const run=state.preparePrompt('dummy');state.accepted();
    let calls=0;
    const worker={state:'running',call:async()=>{calls++;return {};}};
    (runtime as any).active.set('session',{session:{id:'session',workspaceId:ws.id},state,worker});
    state.pauseQueue=async()=>{(runtime as any).active.delete('session');};
    await assert.rejects(runtime.stop(ws.id,'session',{generation:state.generation,requestId:'r',runId:run}),/target_unavailable/);
    assert.equal(calls,0);
    assert.equal((await runtime.readOnlySessions(ws.id)).sessions.length,0);
    const queued=new SessionEvents({id:'queued',workspaceId:ws.id,filePath:join(root,'queue-dummy.jsonl')},()=> 'running');
    queued.queuePrompt('dummy');
    (runtime as any).active.set('queued',{session:{id:'queued',workspaceId:ws.id},state:queued,worker});
    assert.equal(runtime.controlState(ws.id,'queued').queuePending,true);
    await assert.rejects(runtime.prompt(ws.id,'queued','dummy',[],undefined,{generation:queued.generation,requestId:'r'}),/queue_pending/);
    assert.equal(calls,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
