import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiProcess } from '../server/adapters/pi/process.ts';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';
import { fixturePrelude } from './helpers/worker-fixture.ts';

// Fake CLI used only by these tests. `behavior` decides when the process exits:
//  - exit-immediately:   closes before answering any RPC (raw PiProcess coverage)
//  - exit-before:<type>: reads the named command and exits WITHOUT replying — this is
//                        the reported failure (exit before get_state/get_messages)
//  - exit-on:<type>:     answers the named RPC, then exits right after replying
//  - no-exit:            healthy mock that keeps running
const fakeCli = (behavior: string) => `${fixturePrelude()}const fs=require('fs'),path=require('path'),readline=require('readline');
const dir=process.argv.includes('--session-dir')?process.argv[process.argv.indexOf('--session-dir')+1]:process.env.PI_CODING_AGENT_SESSION_DIR;fs.mkdirSync(dir,{recursive:true});
const file=process.argv.includes('--session')?process.argv[process.argv.indexOf('--session')+1]:path.join(dir,'fake.jsonl');
if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({type:'session',id:'fake-close',cwd:process.cwd()})+'\\n');
const behavior=${JSON.stringify(behavior)};
if(behavior==='exit-immediately')process.exit(0);
readline.createInterface({input:process.stdin}).on('line',s=>{const c=JSON.parse(s);
if('exit-before:'+c.type===behavior)process.exit(1);
if(c.type==='get_state')process.stdout.write(JSON.stringify({id:c.id,type:'response',success:true,data:{sessionId:'fake-close',sessionFile:file,isStreaming:false}})+'\\n');
else if(c.type==='get_commands')process.stdout.write(JSON.stringify({id:c.id,type:'response',success:true,data:{commands:[{name:'pi-console-history-rpc',source:'extension'}]}})+'\\n');
else if(c.type==='prompt'&&/^\\/pi-console-history-rpc\\s/.test(c.message||'')){
  const requestId=c.message.split(/\\s+/)[1];
  const data=Buffer.from(JSON.stringify({kind:'pi-console.history',version:1,requestId,sessionId:'fake-close',leafId:null,dirty:false,messages:[]}),'utf8').toString('base64');
  process.stdout.write(JSON.stringify({type:'extension_ui_request',id:'w1',method:'setWidget',widgetKey:'pi-console-history',widgetLines:['PI_CONSOLE_HISTORY_JSON:'+JSON.stringify({kind:'pi-console.history-chunk',version:1,requestId,seq:0,total:1,data})]})+'\\n');
  process.stdout.write(JSON.stringify({id:c.id,type:'response',success:true,data:{disposition:'handled'}})+'\\n');
}
else process.stdout.write(JSON.stringify({id:c.id,type:'response',success:true,data:{}})+'\\n');
if('exit-on:'+c.type===behavior)process.exit(0);});`;

async function setup(behavior: string) {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-close-'));
  const cli = join(root, 'fake-pi.cjs');
  await writeFile(cli, fakeCli(behavior));
  const sessions = join(root, 'sessions');
  await mkdir(sessions, { recursive: true });
  const sessionFile = join(sessions, 'fake.jsonl');
  const store = new WorkspaceStore(join(root, 'workspaces.json'));
  const workspace = await store.add(root);
  await writeFile(sessionFile, JSON.stringify({ type: 'session', id: 'fake-close', cwd: root }) + '\n');
  const manager = new RuntimeManager(store, sessions);
  const previous = process.env.PI_CONSOLE_WORKER_COMMAND;
  const previousKit = process.env.PI_CONSOLE_KIT_ROOT;
  process.env.PI_CONSOLE_WORKER_COMMAND = cli;
  process.env.PI_CONSOLE_KIT_ROOT = join(root, 'no-kit'); // keep kitRoot() undefined for these tests
  const cleanup = async () => {
    if (previous === undefined) delete process.env.PI_CONSOLE_WORKER_COMMAND; else process.env.PI_CONSOLE_WORKER_COMMAND = previous;
    if (previousKit === undefined) delete process.env.PI_CONSOLE_KIT_ROOT; else process.env.PI_CONSOLE_KIT_ROOT = previousKit;
    await Promise.race([manager.shutdown(), new Promise<void>(r => setTimeout(r, 10000))]);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { root, cli, sessionFile, workspace, manager, cleanup };
}

// Timeout that clears its timer on settle so a passing test is not delayed.
const timeout = <T>(promise: Promise<T>, ms = 15000) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`settle timeout after ${ms}ms — likely a lost close event`)), ms);
  promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});

test('exit before the get_state reply: open() fails, close() settles, starting is released', { timeout: 60000 }, async () => {
  const { manager, workspace, cleanup } = await setup('exit-before:get_state');
  try {
    await assert.rejects(timeout(manager.open(workspace.id, 'fake-close')));
    assert.equal((manager as any).starting.has('fake-close'), false, 'starting entry leaked');
    assert.equal((manager as any).active.has('fake-close'), false);
  } finally { await cleanup(); }
});

test('exit before the get_commands reply: open() fails, attached entry is removed, retry on a healthy fake succeeds', { timeout: 90000 }, async () => {
  const { manager, workspace, cleanup } = await setup('exit-before:get_commands');
  try {
    await assert.rejects(timeout(manager.open(workspace.id, 'fake-close')));
    assert.equal((manager as any).starting.has('fake-close'), false, 'starting entry leaked');
    assert.equal((manager as any).active.has('fake-close'), false, 'attached entry must be removed when get_messages fails');
  } finally { await cleanup(); }
  // Same workspace/session file, now a healthy CLI: retry must not reuse stale state.
  const healthy = await setup('no-exit');
  try {
    const entry = await timeout(healthy.manager.open(healthy.workspace.id, 'fake-close'));
    assert.equal(entry.session.id, 'fake-close');
    await timeout(healthy.manager.closeSession(healthy.workspace.id, 'fake-close'));
  } finally { await healthy.cleanup(); }
});

test('exit right after a reply: close() on the dying child settles, duplicate close resolves, state ends stopped/failed', { timeout: 60000 }, async () => {
  const { root, sessionFile, cleanup } = await setup('exit-on:get_state');
  try {
    const worker = new PiProcess(root, sessionFile, join(root, 'sessions'));
    await timeout(worker.start());
    await worker.call('get_state').catch(() => {}); // CLI exits right after this reply
    await timeout(worker.close(), 8000);
    await timeout(worker.close(), 8000);
    assert.ok(['stopped', 'failed'].includes(worker.state), `unexpected state ${worker.state}`);
  } finally { await cleanup(); }
});

test('spawn-level failure (valid CLI, missing cwd) settles start() and close() within the deadline', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-spawn-'));
  try {
    const cli = join(root, 'fake.cjs');
    await writeFile(cli, 'process.exit(0)');
    const previous = process.env.PI_CONSOLE_WORKER_COMMAND;
    process.env.PI_CONSOLE_WORKER_COMMAND = cli;
    try {
      const worker = new PiProcess(join(root, 'no-such-dir'));
      await assert.rejects(timeout(worker.start(), 20000));
      await timeout(worker.close(), 5000);
      await timeout(worker.close(), 5000);
    } finally { if (previous === undefined) delete process.env.PI_CONSOLE_WORKER_COMMAND; else process.env.PI_CONSOLE_WORKER_COMMAND = previous; }
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});

test('duplicate close during a live session and after a normal exit both settle inside the deadline', { timeout: 60000 }, async () => {
  const { manager, workspace, cleanup } = await setup('no-exit');
  try {
    const entry = await timeout(manager.open(workspace.id, 'fake-close'));
    const worker = entry.worker;
    await Promise.all([timeout(worker.close(), 8000), timeout(worker.close(), 8000)]);
    assert.equal(worker.state, 'stopped');
    await timeout(worker.close(), 5000);
  } finally { await cleanup(); }
});

// Worker-start instrumentation: every PiProcess spawned by the manager is counted
// and tracked so a failing (red) run can never leak a real subprocess.
function trackWorkerStarts() {
  const workers: PiProcess[] = [];
  const original = PiProcess.prototype.start;
  const state = { starts: 0, workers };
  (PiProcess.prototype as any).start = async function (this: PiProcess) {
    state.starts++;
    workers.push(this);
    return original.call(this);
  };
  const restore = async () => {
    PiProcess.prototype.start = original;
    // Bound every close so a failing (red) run can never hang cleanup or leak a child.
    await Promise.allSettled(workers.map(worker => timeout(worker.close(), 8000)));
  };
  return { state, restore };
}

test('concurrent open() calls share one start: same Active entry and exactly one worker spawned', { timeout: 60000 }, async () => {
  const { manager, workspace, cleanup } = await setup('no-exit');
  const { state, restore } = trackWorkerStarts();
  try {
    const [a, b] = await Promise.all([
      timeout(manager.open(workspace.id, 'fake-close')),
      timeout(manager.open(workspace.id, 'fake-close')),
    ]);
    // Reference identity only: assert.equal on Active/PiProcess would deep-walk a
    // huge cyclic object graph and stall the test on a red run.
    assert.ok(a === b, 'concurrent opens must return the same Active entry');
    assert.ok(a.worker === b.worker, 'concurrent opens must share one worker');
    assert.equal(state.starts, 1, `expected exactly one worker start, got ${state.starts}`);
    assert.ok(manager.activeWorker('fake-close') === a.worker, 'active map must hold the shared worker');
  } finally { await restore(); await cleanup(); }
});

test('concurrent open() rejects a different workspace without sharing the pending session', { timeout: 60000 }, async () => {
  const { manager, workspace, root, cleanup } = await setup('no-exit');
  const { state, restore } = trackWorkerStarts();
  try {
    const otherPath = join(root, 'other-workspace');
    await mkdir(otherPath);
    const other = await manager.workspaces.add(otherPath);
    const results = await Promise.allSettled([
      timeout(manager.open(workspace.id, 'fake-close')),
      timeout(manager.open(other.id, 'fake-close')),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected', 'a pending session must not cross workspace boundaries');
    assert.match((results[1] as PromiseRejectedResult).reason.message, /session belongs to another workspace/);
    assert.equal(state.starts, 1);
  } finally { await restore(); await cleanup(); }
});

test('concurrent open() calls share one failure: both reject, starting is cleared, a later retry attempts a fresh start', { timeout: 60000 }, async () => {
  const { manager, workspace, cleanup } = await setup('exit-before:get_state');
  const { state, restore } = trackWorkerStarts();
  try {
    const attempts = await Promise.allSettled([
      timeout(manager.open(workspace.id, 'fake-close')),
      timeout(manager.open(workspace.id, 'fake-close')),
    ]);
    assert.ok(attempts.every(result => result.status === 'rejected'), 'both concurrent opens must reject');
    const [first, second] = attempts as PromiseRejectedResult[];
    assert.ok(first.reason === second.reason, 'concurrent opens must share the same start failure');
    assert.equal(state.starts, 1, `shared failure must come from a single worker start, got ${state.starts}`);
    assert.equal((manager as any).starting.has('fake-close'), false, 'starting entry leaked');
    assert.equal((manager as any).active.has('fake-close'), false);
    // The cleared `starting` entry must not short-circuit a later retry.
    await assert.rejects(timeout(manager.open(workspace.id, 'fake-close')));
    assert.equal(state.starts, 2, 'retry after a cleared failure must attempt a fresh worker start');
    assert.equal((manager as any).starting.has('fake-close'), false, 'starting entry leaked after retry');
  } finally { await restore(); await cleanup(); }
});
