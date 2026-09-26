import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';
import { SessionEvents } from '../server/runtime/events.ts';

test('activity retains session-scoped background subagent status after parent Pi run settles', async () => {
  const root=await mkdtemp(join(tmpdir(),'pi-console-background-'));
  try {
    const store=new WorkspaceStore(join(root,'workspaces.json'));const workspace=await store.add(root);
    const file=join(root,'session.jsonl'),session={id:'session-async',workspaceId:workspace.id,filePath:file};
    await writeFile(file,JSON.stringify({type:'session',id:session.id,cwd:root})+'\n');
    const state=new SessionEvents(session,()=> 'running');const runtime=new RuntimeManager(store,root);
    (runtime as any).active.set(session.id,{state,session});
    const widget=(status:string)=>({type:'extension_ui_request',method:'setWidget',widgetKey:'subagent-async',widgetLines:[`PI_SUBAGENT_ASYNC_JSON:${JSON.stringify({kind:'pi-subagents.async-status-snapshot',version:1,omitted:{runs:0,byteLimitExceeded:false},runs:[{id:'run-async',kind:'subagent',label:'reviewer',state:status,children:[]}]})}`]});
    state.ingest(widget('running'));
    assert.equal((await runtime.activity())[0]?.work.find(w=>w.label==='reviewer')?.status,'running');
    state.ingest(widget('complete'));
    const complete=(await runtime.activity())[0];
    assert.equal(complete?.work.find(w=>w.label==='reviewer')?.status,'completed');
    assert.equal(complete?.completion?.status,'completed');
  } finally {await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});

test('activity shows live foreground child and finished run with updated session title', async () => {
  const root=await mkdtemp(join(tmpdir(),'pi-console-activity-'));
  try {
    const store=new WorkspaceStore(join(root,'workspaces.json'));
    const workspace=await store.add(root);
    const file=join(root,'session.jsonl');const session={id:'session-1',workspaceId:workspace.id,filePath:file};
    await writeFile(file,JSON.stringify({type:'session',id:session.id,cwd:root})+'\n'+JSON.stringify({type:'session_info',name:'Updated title'})+'\n');
    const state=new SessionEvents(session,()=> 'running');
    const runtime=new RuntimeManager(store,root);
    (runtime as any).active.set(session.id,{state,session});
    state.preparePrompt('Work');state.accepted();
    state.ingest({type:'tool_execution_start',toolName:'subagent',toolCallId:'child',args:{}});
    state.ingest(JSON.parse(await readFile(join('tests','fixtures','subagent-foreground.json'),'utf8')));
    const active=(await runtime.activity())[0];
    assert.equal(active.sessionName,'Updated title');
    assert.equal(active.work.find(w=>w.kind==='agent')?.label,'coder');
    assert.equal(active.work.find(w=>w.kind==='agent')?.status,'running');
    state.ingest({type:'tool_execution_end',toolName:'subagent',toolCallId:'child',result:{details:{mode:'single',runId:'child-run-1',results:[{index:0,agent:'coder',exitCode:0}]}}});
    state.ingest({type:'agent_settled'});
    const finished=(await runtime.activity())[0];
    assert.equal(finished.completion?.status,'completed');
    assert.equal(finished.work.find(w=>w.kind==='agent')?.status,'completed');
  } finally {await rm(root,{recursive:true,force:true});}
});
