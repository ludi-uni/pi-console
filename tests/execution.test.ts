import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SessionEvents } from '../server/runtime/events.ts';
import { ExecutionState } from '../server/runtime/execution-state.ts';
import { OrchestratorSource, readBoundOrchestrator, readSessionRunHistory, recordRunBinding } from '../server/adapters/orchestrator/source.ts';
import type { ExecutionNode } from '../shared/types.ts';
const fixture = (name:string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`,import.meta.url),'utf8'));
const session={id:'session-1',workspaceId:'workspace-1',filePath:'session.jsonl'};
const nodes=(state:SessionEvents) => state.snapshot().execution.nodes;

test('real-shaped Pi + child foreground + orchestrator fixture correlate only by explicit evidence',()=>{
  const state=new SessionEvents(session,()=> 'running');const run=state.preparePrompt('test');
  state.ingest({type:'agent_start'});
  const call='call-child',parent=`pi-tool:${run}:${call}`;
  state.ingest({type:'tool_execution_start',toolName:'subagent',toolCallId:call,args:{}});
  const child=fixture('subagent-foreground.json'); state.ingest(child);state.ingest(child);
  const agent=nodes(state).find(n=>n.sourceKind==='pi-subagents')!;
  assert.equal(agent.parentId,parent);assert.equal(agent.action,'powershell');
  assert.equal(nodes(state).filter(n=>n.sourceKind==='pi-subagents').length,1);
  state.ingest({type:'tool_execution_end',toolName:'subagent',toolCallId:call,result:{details:{mode:'single',runId:'child-run-1',results:[{index:0,agent:'coder',exitCode:0,model:'provider/model'}]}},isError:false});
  assert.equal(nodes(state).find(n=>n.id===agent.id)?.status,'completed');
  const data=fixture('orchestrator-run.json');
  data.tasks=data.tasks.map((x:any)=>({...x.row,payload:JSON.stringify(x.task)}));
  data.trace=data.trace.map((x:any)=>({...x,payload:JSON.stringify(x.payload)}));
  const orch=new OrchestratorSource('unused','session-1','unused',node=>state.publishNode(node));
  orch.project(data);
  const execution=state.snapshot().execution;
  assert.equal(execution.nodes.find(n=>n.id==='orchestrator:run-1')?.parentId,undefined);
  assert.ok(execution.unattached.includes('orchestrator:run-1'));
  assert.equal(execution.nodes.find(n=>n.id==='orch-task:run-1:t2')?.status,'blocked');
  assert.deepEqual(execution.nodes.find(n=>n.id==='orch-task:run-1:t2')?.dependencies,['t1']);
  assert.equal(execution.nodes.find(n=>n.id==='orch-task:run-1:t1')?.attempts?.[1].failureClass,'MODEL_FAILURE');
  assert.equal(execution.nodes.find(n=>n.id==='orch-agent:run-1:inv-1')?.status,'failed');
  assert.equal(execution.decisionCount,1);
  const count=state.events.length;orch.project(data);assert.equal(state.events.length,count,'duplicate snapshot must not emit');
});

test('session-scoped Pi async widget shows child lifecycle after the foreground run ends',()=>{
  const state=new SessionEvents(session,()=> 'running');
  const widget=(phase:string,childState:string)=>({type:'extension_ui_request',method:'setWidget',widgetKey:'subagent-async',widgetLines:[`PI_SUBAGENT_ASYNC_JSON:${JSON.stringify({kind:'pi-subagents.async-status-snapshot',version:1,generatedAt:Date.now(),omitted:{runs:0,children:0,byteLimitExceeded:false},runs:[{id:'run-async',kind:'workflow',label:'Review workflow',state:phase,children:[{id:'coder',kind:'subagent',label:'coder',state:childState,activity:{currentTool:'read',toolCount:2}}]}]})}`]});
  state.ingest(widget('running','running'));
  const root=nodes(state).find(n=>n.kind==='orchestrator'&&n.sourceKind==='pi-subagents')!;
  const child=nodes(state).find(n=>n.kind==='agent'&&n.sourceKind==='pi-subagents')!;
  assert.equal(child.parentId,root.id);assert.equal(child.action,'read');assert.equal(child.status,'running');
  const count=state.events.length;state.ingest(widget('running','running'));assert.equal(state.events.length,count);
  state.ingest(widget('complete','failed'));
  assert.equal(nodes(state).find(n=>n.id===root.id)?.status,'completed');
  assert.equal(nodes(state).find(n=>n.id===child.id)?.status,'failed');
  state.ingest({type:'extension_ui_request',method:'setWidget',widgetKey:'subagent-async'});
  assert.equal(nodes(state).find(n=>n.id===child.id)?.status,'failed','widget clearing does not invent a different terminal result');
});

test('async widget disappearing does not falsely report completion',()=>{
  const state=new SessionEvents(session,()=> 'running');
  state.ingest({type:'extension_ui_request',method:'setWidget',widgetKey:'subagent-async',widgetLines:[`PI_SUBAGENT_ASYNC_JSON:${JSON.stringify({kind:'pi-subagents.async-status-snapshot',version:1,omitted:{runs:0,byteLimitExceeded:false},runs:[{id:'run-1',kind:'subagent',label:'scout',state:'running'}]})}`]});
  state.ingest({type:'extension_ui_request',method:'setWidget',widgetKey:'subagent-async'});
  assert.equal(nodes(state).find(n=>n.sourceKind==='pi-subagents')?.status,'unknown');
  state.ingest({type:'extension_ui_request',method:'setWidget',widgetKey:'another-widget',widgetLines:['PI_SUBAGENT_ASYNC_JSON:{}']});
  assert.equal(nodes(state).filter(n=>n.sourceKind==='pi-subagents').length,1);
});

test('failed child fixture remains a failed observed node, without invented child tool',()=>{
  const state=new SessionEvents(session,()=> 'running'); state.preparePrompt(); state.ingest({type:'agent_start'});
  state.ingest({type:'tool_execution_start',toolName:'subagent',toolCallId:'call-child'});
  state.ingest(fixture('subagent-failed.json'));
  const child=nodes(state).find(n=>n.sourceKind==='pi-subagents');
  assert.equal(child?.status,'failed');assert.equal(child?.details?.exitCode,1);
  assert.equal(nodes(state).filter(n=>n.sourceKind==='pi-subagents'&&n.kind==='tool').length,0);
});

test('out-of-order source updates, duplicate terminal events, missing parent remain safe',()=>{
  const store=new ExecutionState();const node:ExecutionNode={id:'orphan',kind:'agent',label:'child',status:'completed',parentId:'missing',correlation:'unknown',sourceKind:'pi-subagents',updatedAt:'2026-01-02T00:00:00Z'};
  const event=(n:ExecutionNode,eventId:string)=>({schemaVersion:1 as const,eventId,seq:1,timestamp:n.updatedAt,workspaceId:'w',sessionId:'s',runId:'r',type:'ExecutionNodeUpdated' as const,entityId:n.id,source:'pi-subagents' as const,certainty:'observed' as const,payload:{node:n}});
  assert.equal(store.apply(event(node,'e1')),true);assert.equal(store.apply(event(node,'e1')),false);
  assert.equal(store.apply(event({...node,status:'running',updatedAt:'2026-01-01T00:00:00Z'},'e2')),false);
  assert.equal(store.apply(event({...node,status:'running',updatedAt:'2026-01-03T00:00:00Z'},'e3')),false);
  assert.equal(store.snapshot().nodes[0].status,'completed');assert.deepEqual(store.snapshot().unattached,['orphan']);
});

test('read-only exact bound snapshot + DB can rehydrate task and failure after restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-orch-fixture-'));
  const workspace=join(root,'workspace');const dbPath=join(root,'state.db');
  await mkdir(workspace); const clients=join(root,'.orchestration','activity','clients');await mkdir(clients,{recursive:true});
  const snap=fixture('orchestrator-completed.json');snap.repoRoot=workspace;
  await writeFile(join(clients,'pi-web-session-1.json'),JSON.stringify(snap));
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE runs(id TEXT,request TEXT,status TEXT,created_at TEXT,updated_at TEXT,repo_root TEXT);CREATE TABLE tasks(run_id TEXT,id TEXT,status TEXT,updated_at TEXT,payload TEXT);CREATE TABLE decisions(run_id TEXT,id TEXT,task_id TEXT,status TEXT,created_at TEXT,answered_at TEXT,reason TEXT);CREATE TABLE trace(id INTEGER PRIMARY KEY,run_id TEXT,at TEXT,type TEXT,payload TEXT)');
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run('run-done','test request','completed','2026-01-01T00:00:00Z','2026-01-01T00:01:00Z',workspace);
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?)').run('run-done','t1','completed','2026-01-01T00:00:30Z',JSON.stringify({title:'Investigate',dependencies:[],attempts:1})); db.close();
  try {
    const result=await readBoundOrchestrator(root,'session-1',workspace,dbPath);assert.equal(result?.tasks.length,1);assert.equal(result?.run?.request,'test request');
    const rejected=await readBoundOrchestrator(root,'other-session',workspace,dbPath);assert.equal(rejected,undefined);
    const output:ExecutionNode[]=[]; const source=new OrchestratorSource(root,'session-1',workspace,n=>output.push(n),dbPath);
    await source.poll();assert.ok(output.find(n=>n.id==='orch-task:run-done:t1'&&n.status==='completed'));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('session run history rehydrates only journaled, workspace-validated older runs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-orch-history-'));
  const workspace=join(root,'workspace');const dbPath=join(root,'state.db');
  await mkdir(workspace); const clients=join(root,'.orchestration','activity','clients');await mkdir(clients,{recursive:true});
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE runs(id TEXT,request TEXT,status TEXT,created_at TEXT,updated_at TEXT,repo_root TEXT);CREATE TABLE tasks(run_id TEXT,id TEXT,status TEXT,updated_at TEXT,payload TEXT);CREATE TABLE decisions(run_id TEXT,id TEXT,task_id TEXT,status TEXT,created_at TEXT,answered_at TEXT,reason TEXT);CREATE TABLE trace(id INTEGER PRIMARY KEY,run_id TEXT,at TEXT,type TEXT,payload TEXT)');
  // Older run owned by this session, a bound current run, an unbound run in the same workspace,
  // and a run in a different workspace.
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run('run-old','older request','completed','2026-01-01T00:00:00Z','2026-01-01T00:05:00Z',workspace);
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run('run-current','current request','completed','2026-01-02T00:00:00Z','2026-01-02T00:05:00Z',workspace);
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run('run-foreign','other request','completed','2026-01-03T00:00:00Z','2026-01-03T00:05:00Z',workspace);
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run('run-other-ws','elsewhere','completed','2026-01-04T00:00:00Z','2026-01-04T00:05:00Z',join(root,'other'));
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?)').run('run-old','t1','completed','2026-01-01T00:04:00Z',JSON.stringify({title:'Old task',attempts:1}));
  db.close();
  try {
    // No journal yet: nothing is rehydrated even though runs share the workspace.
    assert.equal((await readSessionRunHistory(root,'session-1',workspace,dbPath,'run-current')).length,0);
    await recordRunBinding(root,'session-1','run-old');
    await recordRunBinding(root,'session-1','run-current');
    const history=await readSessionRunHistory(root,'session-1',workspace,dbPath,'run-current');
    assert.deepEqual(history.map(h=>h.run?.id),['run-old']);
    assert.equal(history[0].tasks.length,1);
    // A different session does not own the journaled run.
    assert.equal((await readSessionRunHistory(root,'other-session',workspace,dbPath)).length,0);
  } finally { await rm(root,{recursive:true,force:true}); }
});
