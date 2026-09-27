import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { orchestratorKit, startKitRun } from '../server/adapters/orchestrator/start.ts';
import { kitRoot } from '../server/adapters/orchestrator/source.ts';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { SessionEvents } from '../server/runtime/events.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';

test('discovers the official Pi npm kit when the legacy extension junction is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-kit-discovery-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const override = process.env.PI_CONSOLE_KIT_ROOT;
  try {
    process.env.PI_CODING_AGENT_DIR = root;
    delete process.env.PI_CONSOLE_KIT_ROOT;
    assert.equal(await kitRoot(), undefined);
    const kit = join(root,'npm','node_modules','@ludi-uni','ludi-agent-kit');
    for (const path of ['adapters/pi/orchestrator-ext','adapters/pi/lib','lib/orchestrator']) await mkdir(join(kit,path),{recursive:true});
    for (const path of ['adapters/pi/orchestrator-ext/index.js','adapters/pi/lib/invoke.mjs','adapters/pi/lib/subagent.mjs','lib/orchestrator/api.mjs']) await writeFile(join(kit,path),'');
    assert.equal(await kitRoot(),kit);
    assert.equal(await orchestratorKit(),kit);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    if (override === undefined) delete process.env.PI_CONSOLE_KIT_ROOT; else process.env.PI_CONSOLE_KIT_ROOT = override;
    await rm(root,{recursive:true,force:true});
  }
});

test('Pi steering and follow-up queue through RPC without starting a second run', async () => {
  const root=await mkdtemp(join(tmpdir(),'pi-console-queue-'));
  try {
    const store=new WorkspaceStore(join(root,'workspaces.json')),workspace=await store.add(root);
    const runtime=new RuntimeManager(store,root),session={id:'queue-session',workspaceId:workspace.id,filePath:join(root,'session.jsonl')};
    const state=new SessionEvents(session,()=> 'running');state.preparePrompt('First');state.accepted();
    const calls: unknown[]=[];
    (runtime as any).active.set(session.id,{session,state,worker:{call:async(type:string,args:unknown)=>{calls.push({type,args});return {data:{}}}}});
    await assert.rejects(runtime.prompt(workspace.id,session.id,'No mode'),/select steer or follow-up/);
    await runtime.prompt(workspace.id,session.id,'Later',[],'followUp');
    await runtime.prompt(workspace.id,session.id,'Change direction',[],'steer');
    assert.deepEqual(calls,[{type:'follow_up',args:{message:'Later'}},{type:'steer',args:{message:'Change direction'}}]);
    // Queued steer/follow-up text must NOT appear as a sent chat bubble before Pi delivers it.
    assert.deepEqual(state.chat.map(m=>m.text),['First']);
    // It is still surfaced as a pending queued execution node, not a premature chat message.
    const queued=state.execution.snapshot().nodes.filter(n=>n.status==='queued'&&n.sourceKind==='pi');
    assert.deepEqual(queued.map(n=>n.label),['Queued: Later','Queued: Change direction']);
    state.ingest({type:'message_end',message:{role:'user',content:[{type:'text',text:'First'}]}});
    assert.deepEqual(state.chat.map(m=>m.text),['First']);
    state.ingest({type:'message_end',message:{role:'user',content:[{type:'text',text:'Later'}]}});
    assert.deepEqual(state.chat.map(m=>m.text),['First','Later']);
    assert.deepEqual(state.execution.snapshot().nodes.filter(n=>n.sourceKind==='pi'&&n.kind==='task').map(n=>n.status),['completed','queued']);
    assert.equal(state.busy,true);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('running kit job receives a run ID only from a new, exact bound run and request', async () => {
  const root=await mkdtemp(join(tmpdir(),'pi-console-current-run-'));
  const previous=process.env.PI_CONSOLE_KIT_ROOT;
  try {
    for(const dir of ['lib/orchestrator','adapters/pi/lib'])await mkdir(join(root,dir),{recursive:true});
    for(const file of ['lib/orchestrator/api.mjs','adapters/pi/lib/invoke.mjs','adapters/pi/lib/subagent.mjs'])await writeFile(join(root,file),'');
    process.env.PI_CONSOLE_KIT_ROOT=root;
    const store=new WorkspaceStore(join(root,'workspaces.json')),workspace=await store.add(root);
    const runtime=new RuntimeManager(store,root),sessionId='exact-session';
    const source={boundRun:{id:'old',request:'same request',createdAt:'2026-01-01T00:00:00.000Z'}};
    (runtime as any).active.set(sessionId,{session:{workspaceId:workspace.id},source});
    const job={workspaceId:workspace.id,request:'same request',running:true,startedAt:'2026-01-02T00:00:00.000Z',runId:undefined as string|undefined};
    (runtime as any).kitRuns.set(sessionId,job);
    assert.equal((await runtime.kitStatus(workspace.id,sessionId)).job?.runId,undefined);
    source.boundRun={id:'other',request:'different request',createdAt:'2026-01-02T00:00:01.000Z'};
    assert.equal((await runtime.kitStatus(workspace.id,sessionId)).job?.runId,undefined);
    source.boundRun={id:'current',request:'same request',createdAt:'2026-01-02T00:00:01.000Z'};
    assert.equal((await runtime.kitStatus(workspace.id,sessionId)).job?.runId,'current');
  } finally { if(previous===undefined)delete process.env.PI_CONSOLE_KIT_ROOT;else process.env.PI_CONSOLE_KIT_ROOT=previous;await rm(root,{recursive:true,force:true}); }
});

test('running kit job exposes bounded progress in the exact session and retains it on completion', async () => {
  const root=await mkdtemp(join(tmpdir(),'pi-console-kit-progress-'));
  const previous=process.env.PI_CONSOLE_KIT_ROOT;
  try {
    for(const dir of ['lib/orchestrator','adapters/pi/lib'])await mkdir(join(root,dir),{recursive:true});
    process.env.PI_CONSOLE_KIT_ROOT=root;
    await writeFile(join(root,'lib/orchestrator/api.mjs'), `export const defaultStorePath=()=>'';
export const loadOrchestrationContext=()=>({errors:[],session:{close(){}}});
export const createRunHealth=()=>({});
export const createRunRunner=()=>({});
export const formatReport=result=>'完了: '+result.runId;
export const startOrchestration=async(_ctx,args)=>{args.onProgress?.('計画中');await new Promise(resolve=>setTimeout(resolve,30));for(let i=0;i<15;i++)args.onProgress?.('報告 '+i);return {runId:'progress-run'}};`);
    await writeFile(join(root,'adapters/pi/lib/invoke.mjs'),'export const createPiInvoker=()=>()=>{};');
    await writeFile(join(root,'adapters/pi/lib/subagent.mjs'),'export const createPiSubagentRunner=()=>()=>{};');
    const store=new WorkspaceStore(join(root,'workspaces.json')),workspace=await store.add(root);
    const runtime=new RuntimeManager(store,root),session={id:'progress-session',workspaceId:workspace.id,filePath:join(root,'session.jsonl')};
    await writeFile(session.filePath,JSON.stringify({type:'session',id:session.id,cwd:root})+'\n'+JSON.stringify({type:'session_info',name:'Progress task'})+'\n'+JSON.stringify({type:'message',message:{role:'assistant',content:[]}})+'\n');
    const calls: unknown[]=[];let reportPrompted=false;
    const state=new SessionEvents(session,()=> 'running');
    (runtime as any).active.set(session.id,{session,state,worker:{call:async(type:string,args:unknown)=>{calls.push({type,args});if(type==='get_messages')return {data:{messages:[{role:'assistant',content:[{type:'toolCall',id:'old-tool'}]},...(reportPrompted?[{role:'user',content:'report'},{role:'assistant',content:[{type:'text',text:'保存した最終報告'}]}]:[])]}};if(type==='prompt'){reportPrompted=true;setTimeout(()=>{state.ingest({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'保存した最終報告'}]}});state.ingest({type:'agent_settled'});},0);}return {data:{}}}}});
    const started=await runtime.startOrchestrator(workspace.id,session.id,'Progress task');
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.deepEqual(calls,[{type:'get_state',args:undefined},{type:'set_session_name',args:{name:'Progress task'}}]);
    assert.equal((await runtime.sessions(workspace.id))[0]?.name,'Progress task');
    assert.equal(started.job.running,true);
    await new Promise(resolve=>setTimeout(resolve,100));
    const job=(await runtime.kitStatus(workspace.id,session.id)).job!;
    assert.equal(job.running,false);
    assert.equal(job.runId,'progress-run');
    assert.equal((await runtime.sessions(workspace.id))[0]?.id,session.id);
    assert.equal(job.progress?.length,12);
    assert.equal(job.progress?.at(-1),'報告 14');
    assert.equal(job.report,'完了: progress-run');
    assert.equal(job.reportedToPi,true);
    assert.ok(calls.some((call:any)=>call.type==='prompt'&&call.args.message.includes('完了: progress-run')));
    assert.equal((await runtime.kitStatus(workspace.id,'other-session')).job,undefined);
  } finally {if(previous===undefined)delete process.env.PI_CONSOLE_KIT_ROOT;else process.env.PI_CONSOLE_KIT_ROOT=previous;await rm(root,{recursive:true,force:true});}
});

test('kit-only session waits for a real Pi response and persisted identity before starting kit', async () => {
  const root=await mkdtemp(join(tmpdir(),'pi-console-kit-session-'));
  const previous=process.env.PI_CONSOLE_KIT_ROOT;
  try {
    for(const dir of ['lib/orchestrator','adapters/pi/lib'])await mkdir(join(root,dir),{recursive:true});
    process.env.PI_CONSOLE_KIT_ROOT=root;
    await writeFile(join(root,'lib/orchestrator/api.mjs'),`import {writeFileSync} from 'node:fs';
export const defaultStorePath=()=>'';
export const loadOrchestrationContext=()=>({errors:[],session:{close(){}}});
export const createRunHealth=()=>({});export const createRunRunner=()=>({});
export const startOrchestration=async()=>{writeFileSync(${JSON.stringify(join(root,'launched'))},'yes');return {runId:'persisted-run'}};`);
    await writeFile(join(root,'adapters/pi/lib/invoke.mjs'),'export const createPiInvoker=()=>()=>{};');
    await writeFile(join(root,'adapters/pi/lib/subagent.mjs'),'export const createPiSubagentRunner=()=>()=>{};');
    const store=new WorkspaceStore(join(root,'workspaces.json')),workspace=await store.add(root);
    const runtime=new RuntimeManager(store,root),session={id:'persist-session',workspaceId:workspace.id,filePath:join(root,'session.jsonl')};
    const state=new SessionEvents(session,()=> 'running');let promptText='',prompts=0;
    const worker={call:async(type:string,args:any)=>{if(type==='get_state')return {data:{sessionName:undefined}};if(type==='get_messages')return {data:{messages:[{role:'assistant',content:[{type:'text',text:'受付しました'}]},...(prompts>=2?[{role:'user',content:'report'},{role:'assistant',content:[{type:'text',text:'最終報告'}]}]:[])]}};if(type==='prompt'){promptText=args.message;if(++prompts===2)setTimeout(()=>{state.ingest({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'最終報告'}]}});state.ingest({type:'agent_settled'});},0);}return {data:{}}}};
    (runtime as any).active.set(session.id,{session,state,worker});
    const started=await runtime.startOrchestrator(workspace.id,session.id,'# My kit task');
    assert.equal(started.job.preparing,true);
    await new Promise(resolve=>setTimeout(resolve,15));
    assert.match(promptText,/My kit task/);
    await assert.rejects(readFile(join(root,'launched'),'utf8'));
    await writeFile(session.filePath,JSON.stringify({type:'session',id:session.id,cwd:root})+'\n'+JSON.stringify({type:'session_info',name:'My kit task'})+'\n'+JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'text',text:'受付しました'}]}})+'\n');
    state.ingest({type:'agent_settled'});
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(await readFile(join(root,'launched'),'utf8'),'yes');
    assert.equal((await runtime.kitStatus(workspace.id,session.id)).job?.runId,'persisted-run');
    assert.equal((await runtime.kitStatus(workspace.id,session.id)).job?.reportedToPi,true);
    assert.equal(prompts,2);
    assert.equal((await runtime.kitStatus(workspace.id,session.id)).job?.sessionPersisted,true);
    assert.equal((await runtime.sessions(workspace.id))[0]?.name,'My kit task');
  } finally {if(previous===undefined)delete process.env.PI_CONSOLE_KIT_ROOT;else process.env.PI_CONSOLE_KIT_ROOT=previous;await rm(root,{recursive:true,force:true});}
});

test('kit start uses exact session/workspace binding, leaves model execution to kit and closes store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-kit-'));
  const api = join(root, 'lib/orchestrator'), pi = join(root, 'adapters/pi/lib');
  try {
    await mkdir(api, {recursive:true});await mkdir(pi, {recursive:true});
    await writeFile(join(api, 'api.mjs'), `import {writeFileSync} from 'node:fs';
export const defaultStorePath=root=>root+'/default.db';
export const loadOrchestrationContext=args=>({args,errors:[],session:{close(){writeFileSync(args.kit+'/closed','yes')}}});
export const createRunHealth=()=>({});
export const createRunRunner=(_ctx,args)=>args;
export const formatReport=result=> 'Final report: '+result.runId;
export const startOrchestration=async(ctx,args)=>{args.onProgress?.('開始: 計画中');writeFileSync(ctx.args.kit+'/received',JSON.stringify({binding:ctx.args.clientContext,store:ctx.args.storePath,request:args.request,repo:args.repoRoot,apply:args.runner.apply}));args.onProgress?.('終了: completed');return {runId:'test-run'}};`);
    await writeFile(join(pi, 'invoke.mjs'), 'export const createPiInvoker=()=>()=>{};');
    await writeFile(join(pi, 'subagent.mjs'), 'export const createPiSubagentRunner=()=>()=>{};');
    const updates: string[] = [];
    const reports: string[] = [];
    assert.equal(await startKitRun(root,'exact-session','C:/project','Implement feature', message => updates.push(message), report => reports.push(report)), 'test-run');
    assert.deepEqual(updates, ['開始: 計画中', '終了: completed']);
    assert.deepEqual(reports, ['Final report: test-run']);
    assert.deepEqual(JSON.parse(await readFile(join(root,'received'),'utf8')),{binding:{kind:'pi-web',sessionId:'exact-session'},store:root+'/default.db',request:'Implement feature',repo:'C:/project',apply:false});
    assert.equal(await readFile(join(root,'closed'),'utf8'),'yes');
  } finally { await rm(root,{recursive:true,force:true}); }
});
