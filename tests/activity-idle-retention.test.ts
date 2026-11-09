import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';
import { SessionEvents } from '../server/runtime/events.ts';
import type { SessionInfo } from '../shared/types.ts';

// Regression: an idle worker is closed by evictIdle after ~15 minutes, which
// dropped its whole Active entry — the finished run nodes that activity()
// derived completion notifications from vanished with it, so unread
// notifications disappeared after long uptime. Idle eviction now retains a
// bounded completion-only record; the worker still really closes.

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const completedConversation = (session: SessionInfo) => {
  const state = new SessionEvents(session, () => 'running');
  state.preparePrompt('work');
  state.accepted();
  state.ingest({ type: 'agent_settled' });
  state.lastAccess = 1; // ingestion re-touches; mark idle only after the run settled
  return state;
};

async function fixture(workspaceCwd?: string) {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-idle-retention-'));
  const store = new WorkspaceStore(join(root, 'workspaces.json'));
  const workspace = await store.add(workspaceCwd ?? root);
  return { root, store, workspace, cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) };
}

test('idle eviction keeps a completed-run notification with a stable id while the worker actually closes', async () => {
  const { root, store, workspace, cleanup } = await fixture();
  try {
    const filePath = join(root, 'session.jsonl');
    const session: SessionInfo = { id: 'idle-session', workspaceId: workspace.id, filePath };
    await writeFile(filePath, JSON.stringify({ type: 'session', id: session.id, cwd: workspace.path }) + '\n');
    const state = completedConversation(session);
    const worker = { state: 'running', hasPendingOperations: () => false, async close() { (worker as { state: string }).state = 'closed'; } };
    const entry = { session, state, worker, source: { stop: () => {} } };
    const runtime = new RuntimeManager(store, root);
    (runtime as any).active.set(session.id, entry);
    const before = (await runtime.activity()).find(a => a.sessionId === session.id);
    assert.ok(before?.completion, 'finished run reports a completion before eviction');
    assert.equal(before.completion?.scope, 'conversation');
    await runtime.evictIdle(Date.now());
    assert.equal(worker.state, 'closed', 'eviction still closes the worker');
    assert.equal((runtime as any).active.size, 0, 'the active entry is gone');
    assert.equal((runtime as any).retainedCompletions.size, 1, 'a bounded completion record is retained');
    const after = (await runtime.activity()).find(a => a.sessionId === session.id);
    assert.equal(after?.completion?.id, before.completion?.id, 'completion id stays stable across eviction');
    assert.equal(after?.completion?.status, 'completed');
    assert.equal(after?.running, false, 'a retained notification never claims live work');
    assert.equal(after?.decisionCount, 0);
    assert.deepEqual(after?.work, []);
  } finally { await cleanup(); }
});

test('an idle session with no completion leaves no retained record', async () => {
  const { root, store, workspace, cleanup } = await fixture();
  try {
    const filePath = join(root, 'session.jsonl');
    const session: SessionInfo = { id: 'quiet-session', workspaceId: workspace.id, filePath };
    await writeFile(filePath, JSON.stringify({ type: 'session', id: session.id, cwd: workspace.path }) + '\n');
    const state = new SessionEvents(session, () => 'running');
    state.lastAccess = 1; // never ran a prompt
    const worker = { state: 'running', hasPendingOperations: () => false, async close() {} };
    const runtime = new RuntimeManager(store, root);
    (runtime as any).active.set(session.id, { session, state, worker, source: { stop: () => {} } });
    await runtime.evictIdle(Date.now());
    assert.equal((runtime as any).retainedCompletions.size, 0);
    assert.deepEqual(await runtime.activity(), []);
  } finally { await cleanup(); }
});

test('reopen without new work keeps the unread completion; a newer run replaces its id', async () => {
  const { root, store, workspace, cleanup } = await fixture();
  try {
    const filePath = join(root, 'session.jsonl');
    const session: SessionInfo = { id: 'reopened-session', workspaceId: workspace.id, filePath };
    await writeFile(filePath, JSON.stringify({ type: 'session', id: session.id, cwd: workspace.path }) + '\n');
    const state = completedConversation(session);
    const runtime = new RuntimeManager(store, root);
    (runtime as any).active.set(session.id, { session, state, worker: { state: 'running', hasPendingOperations: () => false, async close() {} }, source: { stop: () => {} } });
    const originalId = (await runtime.activity())[0].completion!.id;
    await runtime.evictIdle(Date.now());
    assert.equal((runtime as any).active.size, 0);
    // Reopen without work: a fresh worker+state like open() produces — no run
    // nodes are rehydrated, but the unread completion must not be erased.
    const freshState = new SessionEvents(session, () => 'running');
    (runtime as any).active.set(session.id, { session, state: freshState, worker: { state: 'running', hasPendingOperations: () => false, async close() {} }, source: { stop: () => {} } });
    const reopened = (await runtime.activity()).find(a => a.sessionId === session.id);
    assert.equal(reopened?.completion?.id, originalId, 'unread completion survives reopen');
    assert.equal(reopened?.completion?.status, 'completed');
    // A new live run produces its own, newer completion id; the cache is a
    // fallback, never an override of live state.
    await sleep(1);
    freshState.preparePrompt('again');
    freshState.accepted();
    freshState.ingest({ type: 'agent_settled' });
    const renewed = (await runtime.activity()).find(a => a.sessionId === session.id);
    assert.ok(renewed?.completion?.id);
    assert.notEqual(renewed?.completion?.id, originalId, 'newer live completion replaces the retained id');
  } finally { await cleanup(); }
});

test('an evict-after-reopen cycle preserves the completion id, not a stale-override', async () => {
  const { root, store, workspace, cleanup } = await fixture();
  try {
    const filePath = join(root, 'session.jsonl');
    const session: SessionInfo = { id: 'cycle-session', workspaceId: workspace.id, filePath };
    await writeFile(filePath, JSON.stringify({ type: 'session', id: session.id, cwd: workspace.path }) + '\n');
    const state = completedConversation(session);
    const runtime = new RuntimeManager(store, root);
    (runtime as any).active.set(session.id, { session, state, worker: { state: 'running', hasPendingOperations: () => false, async close() {} }, source: { stop: () => {} } });
    const originalId = (await runtime.activity())[0].completion!.id;
    await runtime.evictIdle(Date.now());
    // Reopen idle (no nodes), then evict again: the merged retained record must
    // re-survive — this is the long-uptime loop the user reported.
    const reopenedState = new SessionEvents(session, () => 'running');
    reopenedState.lastAccess = 1;
    const worker = { state: 'running', hasPendingOperations: () => false, async close() {} };
    (runtime as any).active.set(session.id, { session, state: reopenedState, worker, source: { stop: () => {} } });
    await runtime.evictIdle(Date.now());
    const after = (await runtime.activity()).find(a => a.sessionId === session.id);
    assert.equal(after?.completion?.id, originalId, 'second eviction still keeps the unread completion');
  } finally { await cleanup(); }
});

test('a failed entry is never overridden by the retained record', async () => {
  const { root, store, workspace, cleanup } = await fixture();
  try {
    const filePath = join(root, 'session.jsonl');
    const session: SessionInfo = { id: 'failed-session', workspaceId: workspace.id, filePath };
    await writeFile(filePath, JSON.stringify({ type: 'session', id: session.id, cwd: workspace.path }) + '\n');
    const state = completedConversation(session);
    const runtime = new RuntimeManager(store, root);
    (runtime as any).active.set(session.id, { session, state, worker: { state: 'running', hasPendingOperations: () => false, async close() {} }, source: { stop: () => {} } });
    await runtime.evictIdle(Date.now());
    // Worker died later on reopen: failed entries are already not surfaced by
    // activity(); the retained row must not resurrect a summary for the same id
    // while a failed entry owns it.
    const failedState = new SessionEvents(session, () => 'failed');
    (runtime as any).failed.set(session.id, { session, state: failedState, worker: { state: 'closed' } });
    assert.equal((await runtime.activity()).find(a => a.sessionId === session.id), undefined);
  } finally { await cleanup(); }
});

test('recycling the session invalidates the retained notification', async () => {
  const { root, store, workspace, cleanup } = await fixture();
  try {
    const filePath = join(root, 'session.jsonl');
    const session: SessionInfo = { id: 'recycled-session', workspaceId: workspace.id, filePath };
    await writeFile(filePath, JSON.stringify({ type: 'session', id: session.id, cwd: workspace.path }) + '\n');
    const state = completedConversation(session);
    const runtime = new RuntimeManager(store, root);
    (runtime as any).active.set(session.id, { session, state, worker: { state: 'running', hasPendingOperations: () => false, async close() {} }, source: { stop: () => {} } });
    await runtime.evictIdle(Date.now());
    assert.equal((runtime as any).retainedCompletions.size, 1);
    await runtime.recycleSession(workspace.id, session.id, async () => { await rm(filePath, { force: true }); });
    assert.equal((runtime as any).retainedCompletions.size, 0, 'recycle drops the retained record');
    assert.deepEqual(await runtime.activity(), [], 'the notification cannot outlive its session');
  } finally { await cleanup(); }
});

test('removing the workspace invalidates retained notifications for its sessions', async () => {
  const { root, store, workspace, cleanup } = await fixture();
  try {
    const filePath = join(root, 'session.jsonl');
    const session: SessionInfo = { id: 'removed-session', workspaceId: workspace.id, filePath };
    await writeFile(filePath, JSON.stringify({ type: 'session', id: session.id, cwd: workspace.path }) + '\n');
    const state = completedConversation(session);
    const runtime = new RuntimeManager(store, root);
    (runtime as any).active.set(session.id, { session, state, worker: { state: 'running', hasPendingOperations: () => false, async close() {} }, source: { stop: () => {} } });
    await runtime.evictIdle(Date.now());
    assert.equal((runtime as any).retainedCompletions.size, 1);
    await runtime.removeWorkspace(workspace.id);
    assert.equal((runtime as any).retainedCompletions.size, 0);
    assert.deepEqual(await runtime.activity(), []);
  } finally { await cleanup(); }
});

test('a missing or identity-mismatched session file drops the retained record on the next read', async () => {
  const { root, store, workspace, cleanup } = await fixture();
  try {
    const filePath = join(root, 'session.jsonl');
    const session: SessionInfo = { id: 'ghost-session', workspaceId: workspace.id, filePath };
    await writeFile(filePath, JSON.stringify({ type: 'session', id: session.id, cwd: workspace.path }) + '\n');
    const state = completedConversation(session);
    const runtime = new RuntimeManager(store, root);
    (runtime as any).active.set(session.id, { session, state, worker: { state: 'running', hasPendingOperations: () => false, async close() {} }, source: { stop: () => {} } });
    await runtime.evictIdle(Date.now());
    assert.equal((await runtime.activity()).length, 1);
    await rm(filePath, { force: true });
    assert.deepEqual(await runtime.activity(), [], 'missing file ends the notification');
    assert.equal((runtime as any).retainedCompletions.size, 0);
    // Identity mismatch (file replaced by a different session id) also drops it.
    await writeFile(filePath, JSON.stringify({ type: 'session', id: session.id, cwd: workspace.path }) + '\n');
    (runtime as any).retainedCompletions.set(session.id, { workspaceId: workspace.id, filePath, completion: { id: 'x:at', status: 'completed', scope: 'conversation', at: new Date().toISOString() }, updatedAt: new Date().toISOString() });
    await writeFile(filePath, JSON.stringify({ type: 'session', id: 'other-id', cwd: workspace.path }) + '\n');
    assert.deepEqual(await runtime.activity(), [], 'a different session id invalidates the record');
  } finally { await cleanup(); }
});

test('retained completions stay bounded and do not resurrect beyond the cap', async () => {
  const { root, store, workspace, cleanup } = await fixture();
  try {
    const runtime = new RuntimeManager(store, root);
    for (let i = 0; i < 300; i++) {
      const filePath = join(root, `s${i}.jsonl`);
      const session: SessionInfo = { id: `s${i}`, workspaceId: workspace.id, filePath };
      await writeFile(filePath, JSON.stringify({ type: 'session', id: session.id, cwd: workspace.path }) + '\n');
      const state = completedConversation(session);
      (runtime as any).active.set(session.id, { session, state, worker: { state: 'running', hasPendingOperations: () => false, async close() {} }, source: { stop: () => {} } });
    }
    await runtime.evictIdle(Date.now());
    assert.equal((runtime as any).active.size, 0, 'every idle worker closed');
    assert.ok((runtime as any).retainedCompletions.size <= 256, 'the retained map is bounded');
    assert.equal((runtime as any).retainedCompletions.size, 256, 'oldest records evicted first');
    const summaries = await runtime.activity();
    assert.ok(summaries.length <= 100, 'activity() output stays within its existing cap');
    assert.ok(summaries.every(a => !a.running && a.completion), 'every retained row is a non-running notification');
    assert.ok(summaries.find(a => a.sessionId === 's299'), 'newest completion retained');
  } finally { await cleanup(); }
});

test('old completions no longer age out on a wall clock while unread', async () => {
  const { root, store, workspace, cleanup } = await fixture();
  try {
    const filePath = join(root, 'session.jsonl');
    const session: SessionInfo = { id: 'old-session', workspaceId: workspace.id, filePath };
    await writeFile(filePath, JSON.stringify({ type: 'session', id: session.id, cwd: workspace.path }) + '\n');
    const state = new SessionEvents(session, () => 'running');
    state.lastAccess = 1;
    state.preparePrompt('ancient work');
    state.accepted();
    // Simulate a completion that settled more than a day ago.
    state.ingest({ type: 'agent_settled' });
    state.lastAccess = 1;
    const runNode = state.execution.flatNodes().find(n => n.kind === 'run' && n.status === 'completed')!;
    const old = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    runNode.endedAt = old;
    runNode.updatedAt = old;
    const runtime = new RuntimeManager(store, root);
    (runtime as any).active.set(session.id, { session, state, worker: { state: 'running', hasPendingOperations: () => false, async close() {} }, source: { stop: () => {} } });
    const live = (await runtime.activity()).find(a => a.sessionId === session.id);
    assert.equal(live?.completion?.id, `${runNode.id}:${old}`, 'a >24h completion still notifies while active');
    await runtime.evictIdle(Date.now());
    const after = (await runtime.activity()).find(a => a.sessionId === session.id);
    assert.equal(after?.completion?.id, `${runNode.id}:${old}`, 'the unread notification survives eviction regardless of age');
  } finally { await cleanup(); }
});
