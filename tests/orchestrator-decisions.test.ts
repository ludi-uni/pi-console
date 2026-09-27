import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {WorkspaceStore} from '../server/runtime/workspaces.ts';
import {RuntimeManager} from '../server/runtime/manager.ts';
import {SessionEvents} from '../server/runtime/events.ts';

test('kit questions are bound to the exact session/run and resume only after all answers',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-kit-decisions-'));
  const kit=join(root,'kit'),workspacePath=join(root,'workspace');
  const oldKit=process.env.PI_CONSOLE_KIT_ROOT,oldStore=process.env.PI_CONSOLE_ORCHESTRATOR_STORE;
  try{
    await mkdir(workspacePath);for(const dir of ['lib/orchestrator','adapters/pi/lib','.orchestration/activity/clients'])await mkdir(join(kit,dir),{recursive:true});
    const resumed=join(root,'resumed.txt');
    await writeFile(join(kit,'lib/orchestrator/api.mjs'),`import {appendFileSync} from 'node:fs';
const pending=[{id:'d1',runId:'run-one',question:'Choose a plan?',reason:'Need input',options:[{id:'yes',summary:'Proceed'},{id:'no',summary:'Stop'}]},{id:'d2',runId:'run-one',question:'Explain why?',reason:'',options:[]}];
export const defaultStorePath=()=>'';
export const loadOrchestrationContext=()=>({errors:[],session:{close(){}}});
export const pendingDecisions=(_ctx,{runId})=>pending.filter(d=>d.runId===runId);
export const answerOrchestration=(_ctx,{runId,decisionId,answer})=>{const i=pending.findIndex(d=>d.runId===runId&&d.id===decisionId);if(i<0)throw Error('not pending');if(pending[i].options.length&&!pending[i].options.some(o=>o.id===answer))throw Error('invalid option');pending.splice(i,1);};
export const createRunHealth=()=>({});export const createRunRunner=()=>({});
let resumeAttempts=0;
export const resumeOrchestration=async(_ctx,{runId})=>{appendFileSync(${JSON.stringify(resumed)},runId+'\\n');if(++resumeAttempts===1)throw Error('intentional resume failure');return {status:'needs-user'}};
export const formatReport=()=>'';`);
    await writeFile(join(kit,'adapters/pi/lib/invoke.mjs'),'export const createPiInvoker=()=>()=>{};');
    await writeFile(join(kit,'adapters/pi/lib/subagent.mjs'),'export const createPiSubagentRunner=()=>()=>{};');
    const clients=join(kit,'.orchestration/activity/clients');
    await writeFile(join(clients,'pi-web-session-one.json'),JSON.stringify({version:1,runId:'run-one',repoRoot:workspacePath,clientContext:{kind:'pi-web',sessionId:'session-one'},activity:{runId:'run-one',state:'waiting_for_user',tasks:[],activeInvocations:[],updatedAt:new Date().toISOString()}}));
    const dbPath=join(kit,'.orchestration','state.db');const db=new DatabaseSync(dbPath);
    db.exec('CREATE TABLE runs(id TEXT,request TEXT,status TEXT,created_at TEXT,updated_at TEXT,repo_root TEXT);CREATE TABLE tasks(run_id TEXT,id TEXT,status TEXT,updated_at TEXT,payload TEXT);CREATE TABLE decisions(run_id TEXT,id TEXT,task_id TEXT,status TEXT,created_at TEXT,answered_at TEXT,reason TEXT);CREATE TABLE trace(id INTEGER PRIMARY KEY,run_id TEXT,at TEXT,type TEXT,payload TEXT)');
    db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run('run-one','Run request','waiting_for_user','2026-01-01T00:00:00Z','2026-01-01T00:01:00Z',workspacePath);
    db.close();
    process.env.PI_CONSOLE_KIT_ROOT=kit;delete process.env.PI_CONSOLE_ORCHESTRATOR_STORE;
    const store=new WorkspaceStore(join(root,'workspaces.json')),workspace=await store.add(workspacePath);
    const runtime=new RuntimeManager(store,root);const session={id:'session-one',workspaceId:workspace.id,filePath:join(root,'session.jsonl')};
    (runtime as any).active.set(session.id,{session,state:new SessionEvents(session,()=> 'running'),worker:{}});
    (runtime as any).kitRuns.set(session.id,{workspaceId:workspace.id,running:false,needsInput:true});
    await assert.rejects(runtime.prompt(workspace.id,session.id,'Another prompt'),/awaiting input/);
    await assert.rejects(runtime.startOrchestrator(workspace.id,session.id,'Another kit run'),/answer pending orchestrator questions/);
    (runtime as any).kitRuns.delete(session.id);
    const listed=await runtime.kitDecisions(workspace.id,session.id);
    assert.equal(listed.runId,'run-one');assert.deepEqual(listed.decisions.map(d=>d.id),['d1','d2']);
    assert.deepEqual(listed.decisions[0].options,[{id:'yes',summary:'Proceed'},{id:'no',summary:'Stop'}]);
    await assert.rejects(runtime.kitDecisions(workspace.id,'different-session'),/session not found/);
    const otherPath=join(root,'other');await mkdir(otherPath);const otherWorkspace=await store.add(otherPath);
    await assert.rejects(runtime.answerOrchestrator(otherWorkspace.id,session.id,'run-one','d1','yes'),/session belongs to another workspace/);
    await assert.rejects(runtime.answerOrchestrator(workspace.id,session.id,'foreign-run','d1','yes'),/not bound/);
    await assert.rejects(runtime.answerOrchestrator(workspace.id,session.id,'run-one','other-decision','yes'),/no longer pending/);
    await assert.rejects(runtime.answerOrchestrator(workspace.id,session.id,'run-one','d1','not-an-option'),/invalid option/);
    assert.deepEqual(await runtime.answerOrchestrator(workspace.id,session.id,'run-one','d1','yes'),{runId:'run-one',remaining:1,resuming:false});
    await assert.rejects(readFile(resumed,'utf8'),{code:'ENOENT'});
    assert.deepEqual((await runtime.kitDecisions(workspace.id,session.id)).decisions.map(d=>d.id),['d2']);
    assert.deepEqual(await runtime.answerOrchestrator(workspace.id,session.id,'run-one','d2','Because'),{runId:'run-one',remaining:0,resuming:true});
    await assert.rejects(runtime.answerOrchestrator(workspace.id,session.id,'run-one','d2','Again'),/busy|no longer pending/);
    for(let i=0;i<30;i++){if(await readFile(resumed,'utf8').catch(()=>''))break;await new Promise(resolve=>setTimeout(resolve,10))}
    assert.equal(await readFile(resumed,'utf8'),'run-one\n');
    for(let i=0;i<30;i++){if(!(await runtime.kitStatus(workspace.id,session.id)).job?.running)break;await new Promise(resolve=>setTimeout(resolve,10))}
    assert.match((await runtime.kitStatus(workspace.id,session.id)).job?.error??'',/intentional resume failure/);
    const dbAnswered=new DatabaseSync(dbPath);
    dbAnswered.prepare('INSERT INTO decisions VALUES(?,?,?,?,?,?,?)').run('run-one','d2','task-one','answered','2026-01-01T00:00:00Z','2026-01-01T00:02:00Z','User answered');
    dbAnswered.close();
    assert.equal((await runtime.kitDecisions(workspace.id,session.id)).canResume,true);
    await assert.rejects(runtime.retryOrchestrator(workspace.id,session.id,'wrong-run'),/not bound/);
    await assert.rejects(runtime.retryOrchestrator(otherWorkspace.id,session.id,'run-one'),/session belongs to another workspace/);
    assert.deepEqual(await runtime.retryOrchestrator(workspace.id,session.id,'run-one'),{runId:'run-one',resuming:true});
    await assert.rejects(runtime.retryOrchestrator(workspace.id,session.id,'run-one'),/busy/);
    for(let i=0;i<30;i++){if((await readFile(resumed,'utf8')).split('run-one').length===3)break;await new Promise(resolve=>setTimeout(resolve,10))}
    assert.equal(await readFile(resumed,'utf8'),'run-one\nrun-one\n');
    assert.deepEqual((await runtime.kitDecisions(workspace.id,session.id)).decisions,[]);
    for(let i=0;i<30;i++){if(!(await runtime.kitStatus(workspace.id,session.id)).job?.running)break;await new Promise(resolve=>setTimeout(resolve,10))}
    const terminal=new DatabaseSync(dbPath);terminal.prepare('UPDATE runs SET status=? WHERE id=?').run('completed','run-one');terminal.close();
    assert.equal((await runtime.kitDecisions(workspace.id,session.id)).canResume,false);
    await assert.rejects(runtime.retryOrchestrator(workspace.id,session.id,'run-one'),/no answered decision awaiting a resumable retry/);
  }finally{
    if(oldKit===undefined)delete process.env.PI_CONSOLE_KIT_ROOT;else process.env.PI_CONSOLE_KIT_ROOT=oldKit;
    if(oldStore===undefined)delete process.env.PI_CONSOLE_ORCHESTRATOR_STORE;else process.env.PI_CONSOLE_ORCHESTRATOR_STORE=oldStore;
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
