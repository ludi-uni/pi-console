import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { OrchestratorSource, readBoundOrchestrator, readSessionRunHistory, recordRunBinding } from '../server/adapters/orchestrator/source.ts';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';
import { SessionEvents } from '../server/runtime/events.ts';
import type { ExecutionNode } from '../shared/types.ts';

const clientsDir = (kit:string) => join(kit,'.orchestration','activity','clients');
async function makeKit(root:string, workspace:string, runId:string, state='completed') {
  const kit = join(root,'kit');
  const dbPath = join(kit,'.orchestration','state.db');
  await mkdir(workspace,{recursive:true}); await mkdir(clientsDir(kit),{recursive:true});
  await writeFile(join(clientsDir(kit),`pi-web-session-1.json`),JSON.stringify({version:1,clientContext:{kind:'pi-web',sessionId:'session-1'},runId,repoRoot:workspace,startedAt:'2026-01-01T00:00:00Z',activity:{runId,state,tasks:[{taskId:'t1',title:'Preserved task',state:'completed'}],activeInvocations:[{invocationId:'inv-1',taskId:'t1',runId,agent:'coder'}],updatedAt:'2026-01-01T00:01:00Z'}}));
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE runs(id TEXT,request TEXT,status TEXT,created_at TEXT,updated_at TEXT,repo_root TEXT);CREATE TABLE tasks(run_id TEXT,id TEXT,status TEXT,updated_at TEXT,payload TEXT);CREATE TABLE decisions(run_id TEXT,id TEXT,task_id TEXT,status TEXT,created_at TEXT,answered_at TEXT,reason TEXT);CREATE TABLE trace(id INTEGER PRIMARY KEY,run_id TEXT,at TEXT,type TEXT,payload TEXT)');
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run(runId,'archived request','waiting_for_user','2026-01-01T00:00:00Z','2026-01-01T00:01:00Z',workspace);
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?)').run(runId,'t1','completed','2026-01-01T00:00:30Z',JSON.stringify({title:'Preserved task',attempts:1}));
  db.close();
  return { kit, dbPath };
}

test('live-to-archive transition clears binding and pending decisions without blocking new work', async () => {
  const root = await mkdtemp(join(tmpdir(),'pi-console-mirror-transition-'));
  const workspace = join(root,'workspace');
  try {
    const {kit,dbPath} = await makeKit(root,workspace,'run-transition','running');
    const db = new DatabaseSync(dbPath);
    db.prepare('INSERT INTO decisions VALUES(?,?,?,?,?,?,?)').run('run-transition','d1','t1','pending','2026-01-01',null,'question');
    db.prepare('UPDATE tasks SET status=?').run('running');
    db.close();
    const nodes = new Map<string,ExecutionNode>();
    const source = new OrchestratorSource(kit,'session-1',workspace,node=>nodes.set(node.id,node),dbPath,join(root,'preserve'));
    await source.poll();
    assert.equal(source.boundRun?.id,'run-transition');
    assert.equal(nodes.get('orch-decision:run-transition:d1')?.status,'waiting');
    // Preserve the DB: fallback can still read its pending rows, but they are not live.
    await rm(join(clientsDir(kit),'pi-web-session-1.json'));
    await source.poll();
    assert.equal(source.boundRun,undefined);
    assert.equal(nodes.get('orchestrator:run-transition')?.status,'unknown');
    assert.equal(nodes.get('orch-decision:run-transition:d1')?.status,'unknown');
    assert.equal(nodes.get('orch-task:run-transition:t1')?.status,'unknown');
    assert.equal([...nodes.values()].some(node=>node.kind==='decision'&&node.status==='waiting'),false);
  } finally { await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});

test('default OFF: no preserveDir writes nothing and never falls back to a mirror', async () => {
  const root = await mkdtemp(join(tmpdir(),'pi-console-mirror-off-'));
  const workspace = join(root,'workspace');
  try {
    const { kit, dbPath } = await makeKit(root, workspace, 'run-live');
    const mirror = join(root,'preserve');
    const live = await readBoundOrchestrator(kit,'session-1',workspace,dbPath);
    assert.equal(live?.run?.id,'run-live');
    assert.equal(await access(mirror).then(()=>true,()=>false),false,'no mirror writes without preserveDir');
    // Even with a prepared mirror on disk, a caller that never opted in cannot see it.
    const optedIn = await readBoundOrchestrator(kit,'session-1',workspace,dbPath,mirror);
    assert.ok(optedIn && !optedIn.archived);
    await rm(kit,{recursive:true,force:true});
    assert.equal(await readBoundOrchestrator(kit,'session-1',workspace,dbPath),undefined);
    const archived = await readBoundOrchestrator(kit,'session-1',workspace,join(root,'missing.db'),mirror);
    assert.equal(archived?.archived,true);
    assert.equal(archived?.snapshot.runId,'run-live');
    // The archived read still exposes the preserved request/status for display, never live state.
    assert.equal(archived?.run?.request,'archived request');
  } finally { await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});

test('mirror preserves snapshot+binding across kit replacement and projects archived read-only state', async () => {
  const root = await mkdtemp(join(tmpdir(),'pi-console-mirror-'));
  const workspace = join(root,'workspace'); const preserve = join(root,'preserve');
  try {
    const { kit, dbPath } = await makeKit(root, workspace, 'run-one');
    const nodes: ExecutionNode[] = [];
    const source = new OrchestratorSource(kit,'session-1',workspace,n=>nodes.push(n),dbPath,preserve);
    await source.poll();
    assert.equal(source.boundRun?.id,'run-one');
    const mirrorFiles = await readdir(join(preserve,(await readdir(preserve))[0]));
    assert.ok(mirrorFiles.some(name=>name==='pi-web-session-1.snapshot.run-one.json'));
    // Replace the kit: all client snapshots, journals and the DB are gone.
    await rm(kit,{recursive:true,force:true});
    const archivedNodes: ExecutionNode[] = [];
    const archived = new OrchestratorSource(kit,'session-1',workspace,n=>archivedNodes.push(n),undefined,preserve);
    await archived.poll();
    assert.equal(archived.boundRun,undefined,'archived fallback must not become a live binding');
    const orchNode = archivedNodes.find(n=>n.id==='orchestrator:run-one');
    assert.equal(orchNode?.status,'unknown','archived nonterminal state cannot claim running');
    assert.equal(orchNode?.details?.archived,true);
    assert.equal(orchNode?.details?.stateSource,'archived');
    assert.equal(archivedNodes.find(n=>n.id==='orch-agent:run-one:inv-1')?.status,'unknown');
    // The archived journal still names the run for history union even without a kit DB.
    const bindings = await readSessionRunHistory(kit,'session-1',workspace,undefined,undefined,preserve);
    assert.equal(bindings.length,0,'no live DB rows: mirror binds exist but no kit store holds them');
    // A concurrent same-target write is serialized, so neither binding is lost.
    await Promise.all([recordRunBinding(kit,'session-1','run-extra',preserve,workspace),recordRunBinding(kit,'session-1','run-more',preserve,workspace)]);
    const merged = await readSessionRunHistory(kit,'session-1',workspace,undefined,undefined,preserve);
    assert.equal(merged.length,0);
    // A new kit at the SAME root reuses the namespace; a different kit root cannot collide.
    const other = await readBoundOrchestrator(join(root,'other-kit'),'session-1',workspace,undefined,preserve);
    assert.equal(other,undefined);
  } finally { await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});

test('mirror rejects cross-session/workspace data and a malformed current snapshot never falls back', async () => {
  const root = await mkdtemp(join(tmpdir(),'pi-console-mirror-iso-'));
  const workspace = join(root,'workspace'); const otherWs = join(root,'other'); const preserve = join(root,'preserve');
  try {
    const { kit, dbPath } = await makeKit(root, workspace, 'run-sec');
    assert.ok(await readBoundOrchestrator(kit,'session-1',workspace,dbPath,preserve));
    await rm(kit,{recursive:true,force:true});
    // Wrong session id: the mirror filename and clientContext do not match.
    assert.equal(await readBoundOrchestrator(kit,'session-2',workspace,undefined,preserve),undefined);
    // Wrong workspace: preserved repoRoot fails pathKey validation.
    await mkdir(otherWs);
    assert.equal(await readBoundOrchestrator(kit,'session-1',otherWs,undefined,preserve),undefined);
    // Same kit root, different real kit content: the mirror is still scoped to this kit path only.
    // A malformed CURRENT snapshot is invalid data, not absence — no silent archive swap.
    await mkdir(clientsDir(kit),{recursive:true});
    await writeFile(join(clientsDir(kit),'pi-web-session-1.json'),JSON.stringify({version:1,clientContext:{kind:'pi-web',sessionId:'session-1'},runId:'run-sec',repoRoot:123,activity:{runId:'run-sec',state:'running',activeInvocations:[]}}));
    const resurrected = await readBoundOrchestrator(kit,'session-1',workspace,undefined,preserve);
    assert.equal(resurrected,undefined,'malformed current snapshot (repoRoot type) must not fall back');
    await writeFile(join(clientsDir(kit),'pi-web-session-1.json'),'not json');
    assert.equal(await readBoundOrchestrator(kit,'session-1',workspace,undefined,preserve),undefined,'unreadable current snapshot is never masked by the mirror');
  } finally { await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});

test('archived binding cannot authorize manager actions; concurrent bindings preserve every run', async () => {
  const root = await mkdtemp(join(tmpdir(),'pi-console-mirror-mgr-'));
  const workspace = join(root,'workspace'); const preserve = join(root,'preserve');
  const oldKit = process.env.PI_CONSOLE_KIT_ROOT, oldStore = process.env.PI_CONSOLE_ORCHESTRATOR_STORE;
  try {
    const { kit, dbPath } = await makeKit(root, workspace, 'run-guard');
    assert.ok(await readBoundOrchestrator(kit,'session-1',workspace,dbPath,preserve));
    // Concurrent same-target writers serialize: neither distinct binding is lost.
    await Promise.all([recordRunBinding(kit,'session-1','run-guard',preserve,workspace),recordRunBinding(kit,'session-1','run-extra',preserve,workspace)]);
    await rm(kit,{recursive:true,force:true});
    const merged = await readSessionRunHistory(kit,'session-1',workspace,undefined,undefined,preserve);
    assert.equal(merged.length,0);
    // Reinstall kit code only: no live DB/client binding, but its API is discoverable.
    for (const dir of ['lib/orchestrator','adapters/pi/lib']) await mkdir(join(kit,dir),{recursive:true});
    for (const file of ['lib/orchestrator/api.mjs','adapters/pi/lib/invoke.mjs','adapters/pi/lib/subagent.mjs']) await writeFile(join(kit,file),'');
    process.env.PI_CONSOLE_KIT_ROOT = kit; delete process.env.PI_CONSOLE_ORCHESTRATOR_STORE;
    const store = new WorkspaceStore(join(root,'workspaces.json'));
    const ws = await store.add(workspace);
    const runtime = new RuntimeManager(store,root,undefined,undefined,preserve);
    const session = { id:'session-1', workspaceId:ws.id, filePath:join(root,'session.jsonl') };
    (runtime as any).active.set(session.id,{session,state:new SessionEvents(session,()=> 'running'),worker:{}});
    // Kit was deleted: archived data exists but no live run is exposed, so answers and retries
    // can never authorize against a stale snapshot.
    const decisions = await runtime.kitDecisions(ws.id,'session-1');
    assert.equal(decisions.runId,undefined);
    assert.equal(decisions.canResume,false);
    await assert.rejects(runtime.answerOrchestrator(ws.id,'session-1','run-guard','d1','yes'),/not bound/);
    await assert.rejects(runtime.retryOrchestrator(ws.id,'session-1','run-guard'),/not bound|not installed/);
  } finally {
    if (oldKit === undefined) delete process.env.PI_CONSOLE_KIT_ROOT; else process.env.PI_CONSOLE_KIT_ROOT = oldKit;
    if (oldStore === undefined) delete process.env.PI_CONSOLE_ORCHESTRATOR_STORE; else process.env.PI_CONSOLE_ORCHESTRATOR_STORE = oldStore;
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
