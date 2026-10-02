import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { SessionEvents } from '../server/runtime/events.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';
import { QueueStore, MAX_QUEUE_ITEMS } from '../server/runtime/queue-store.ts';
import { prepareAttachments } from '../server/runtime/attachments.ts';

const settle = (state: SessionEvents, text = 'Done') => {
  state.ingest({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  state.ingest({ type: 'agent_settled' });
};
const tick = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));

async function rig(root: string, opts: { failDispatch?: boolean; queueDir?: string; autoSettle?: boolean; sabotage?: boolean } = {}) {
  const store = new WorkspaceStore(join(root, 'workspaces.json'));
  const workspace = await store.add(root);
  const runtime = new RuntimeManager(store, root, undefined, opts.queueDir);
  const session = { id: 'queue-edit-session', workspaceId: workspace.id, filePath: join(root, 'session.jsonl') };
  await writeFile(session.filePath, JSON.stringify({ type: 'session', version: 3, id: session.id, cwd: root, timestamp: new Date().toISOString() }) + '\n');
  const state = new SessionEvents(session, () => 'running');
  let qs: QueueStore = (runtime as any).queueStore;
  if (opts.sabotage) qs = { dir: opts.queueDir, assertFits() {}, save: async () => { throw new Error('queue write refused'); }, load: async () => ({ version: 1, held: false, items: [] }), exists: async () => false } as unknown as QueueStore;
  state.setQueueStore(qs);
  state.preparePrompt('First'); state.accepted();
  const calls: { type: string; args: any }[] = [];
  const worker = {
    call: async (type: string, args: any) => {
      calls.push({ type, args });
      if (type === 'prompt') {
        if (opts.failDispatch) throw new Error('Pi refused the prompt');
        if (opts.autoSettle !== false) setTimeout(() => settle(state), 0);
      }
      return { data: {} };
    },
    close: async () => {},
  };
  const entry = { session, state, worker };
  (runtime as any).active.set(session.id, entry);
  (runtime as any).drainSessionQueue(entry);
  return { workspace, runtime, session, state, calls, entry };
}

test('same text enqueues distinct ids; FIFO dispatch sends exactly one item per settled run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-qfifo-'));
  try {
    const { workspace, runtime, state, calls } = await rig(root, { autoSettle: false });
    await runtime.prompt(workspace.id, 'queue-edit-session', 'same', [], 'followUp');
    await runtime.prompt(workspace.id, 'queue-edit-session', 'same', [], 'followUp');
    const queue = state.snapshot().queue!;
    assert.equal(queue.length, 2);
    assert.notEqual(queue[0].id, queue[1].id);
    assert.ok(calls.every(c => c.type !== 'follow_up'));
    settle(state);
    await tick();
    // One item per run settle — the second must not be sent before the first's run ends.
    assert.deepEqual(calls.filter(c => c.type === 'prompt').map(c => c.args.message), ['same']);
    assert.equal(state.snapshot().queue!.length, 2); // claimed item remains until its run settles
    assert.equal(state.snapshot().queue![0].status, 'dispatching');
    settle(state);
    await tick();
    assert.equal(calls.filter(c => c.type === 'prompt').length, 2);
    assert.equal(state.snapshot().queue!.length, 1);
    settle(state);
    await tick();
    assert.equal(state.snapshot().queue!.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CAS: stale revision 409s; claim during edit attempt 409s; dispatch regenerates wrappers and keeps images', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-qcas-'));
  try {
    const { workspace, runtime, state } = await rig(root, { autoSettle: false });
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const image = { kind: 'image', name: 'pixel.png', mimeType: 'image/png', data: png };
    await runtime.prompt(workspace.id, 'queue-edit-session', 'look at this', [image], 'followUp');
    const item = state.snapshot().queue![0];
    assert.equal(item.message, 'look at this');
    assert.deepEqual(item.attachments?.map(a => a.name), ['pixel.png']);
    assert.ok(!JSON.stringify(state.snapshot()).includes(png), 'no base64 in snapshot');
    assert.ok(!JSON.stringify(state.events.find(e => e.type === 'QueueChanged')).includes(png), 'no base64 in SSE');

    await assert.rejects(runtime.editQueuedPrompt(workspace.id, 'queue-edit-session', item.id, 5, 'changed'), (e: Error) => (e as any).status === 409);
    const edited = await runtime.editQueuedPrompt(workspace.id, 'queue-edit-session', item.id, 0, 'look closer');
    assert.equal(edited.revision, 1);
    assert.equal(edited.message, 'look closer');
    // Claim while "editing" → CAS conflict on both edit and remove.
    state.ingest({ type: 'agent_settled' });
    const claimed = await state.beginQueueDispatch();
    assert.ok(claimed);
    assert.equal(claimed!.revision, 1);
    await assert.rejects(runtime.editQueuedPrompt(workspace.id, 'queue-edit-session', item.id, 1, 'too late'), (e: Error) => (e as any).status === 409);
    await assert.rejects(runtime.removeQueuedPrompt(workspace.id, 'queue-edit-session', item.id), (e: Error) => (e as any).status === 409);

    // Dispatch payload = edited text + regenerated wrappers + original image bytes.
    const p = prepareAttachments(claimed!.text, claimed!.attachments);
    assert.match(p.message, /^look closer/);
    assert.match(p.message, /<pi_attachment kind="image" name="pixel\.png"/);
    assert.deepEqual(p.images, [{ type: 'image', data: png, mimeType: 'image/png' }]);
    await state.finishQueueDispatch(item.id, true);
    assert.equal(state.snapshot().queue!.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a late dispatch result cannot finalize an item already held by interruption', async () => {
  const state = new SessionEvents({ id: 'late', workspaceId: 'w', filePath: 'unused' }, () => 'running');
  const item = await state.enqueueFollowUp('keep this instruction', []);
  assert.ok(await state.beginQueueDispatch());
  state.interrupted('worker interrupted');
  const held = state.snapshot().queue![0];
  await state.finishQueueDispatch(item.id, true);
  assert.deepEqual(state.snapshot().queue![0], held);
  assert.equal(state.snapshot().queue![0].status, 'held');
});

test('stop pauses pending queue before clear_queue; explicit Resume sends; no auto-drain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-qstop-'));
  try {
    const { workspace, runtime, state, calls } = await rig(root);
    await runtime.prompt(workspace.id, 'queue-edit-session', 'later', [], 'followUp');
    await runtime.stop(workspace.id, 'queue-edit-session');
    state.ingest({ type: 'agent_settled' });
    await tick();
    assert.equal(calls.filter(c => c.type === 'prompt').length, 0, 'no dispatch after stop');
    assert.equal(state.snapshot().queueHeld, true);
    assert.equal(state.snapshot().queue!.length, 1);
    await runtime.resumeQueuedPrompts(workspace.id, 'queue-edit-session');
    await tick();
    assert.deepEqual(calls.filter(c => c.type === 'prompt').map(c => c.args.message), ['later']);
    settle(state); await tick();
    assert.equal(state.snapshot().queue!.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed dispatch holds the item and pauses the queue — no automatic resend', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-qfail-'));
  try {
    const { workspace, runtime, state, calls } = await rig(root, { failDispatch: true });
    await runtime.prompt(workspace.id, 'queue-edit-session', 'will fail', [], 'followUp');
    await runtime.prompt(workspace.id, 'queue-edit-session', 'behind it', [], 'followUp');
    state.ingest({ type: 'agent_settled' });
    await tick();
    assert.equal(calls.filter(c => c.type === 'prompt').length, 1);
    const queue = state.snapshot().queue!;
    assert.equal(queue.length, 2);
    assert.equal(queue[0].status, 'held');
    assert.match(queue[0].error ?? '', /refused|unconfirmed/i);
    assert.equal(queue[1].status, 'pending');
    assert.equal(state.snapshot().queueHeld, true);
    await tick();
    assert.equal(calls.filter(c => c.type === 'prompt').length, 1, 'queue paused — second item not sent');
    await assert.rejects(runtime.editQueuedPrompt(workspace.id, 'queue-edit-session', queue[0].id, queue[0].revision, 'x'), (e: Error) => (e as any).status === 409);
    await runtime.removeQueuedPrompt(workspace.id, 'queue-edit-session', queue[0].id);
    await runtime.resumeQueuedPrompts(workspace.id, 'queue-edit-session');
    assert.equal(state.snapshot().queueHeld, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('idle prompt refuses while queue non-empty; enqueued items persist before ack', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-qidle-'));
  const queueDir = join(root, 'queue');
  try {
    const { workspace, runtime, state } = await rig(root, { queueDir });
    await runtime.prompt(workspace.id, 'queue-edit-session', 'held back', [], 'followUp');
    // The enqueue was acked only after the durable write.
    assert.match(await readFile(join(queueDir, 'queue-edit-session.json'), 'utf8'), /held back/);
    // End the run but keep the queue paused (stop semantics) so nothing drains.
    state.markStop(); state.ingest({ type: 'agent_settled' });
    await tick();
    assert.equal(state.busy, false);
    assert.equal(state.snapshot().queue!.length, 1);
    // An idle manual send must not jump ahead of the queued item.
    await assert.rejects(runtime.prompt(workspace.id, 'queue-edit-session', 'new prompt'), /queued follow-ups/);
    assert.deepEqual(state.snapshot().queue!.map(i => i.message), ['held back']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a persist failure rejects the ack and never sends; edits also fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-qperm-'));
  try {
    const { workspace, runtime, state } = await rig(root, { sabotage: true });
    await assert.rejects(runtime.prompt(workspace.id, 'queue-edit-session', 'unpersisted', [], 'followUp'), /queue write refused/);
    assert.equal(state.snapshot().queue!.length, 0, 'nothing acknowledged without a durable write');
    // Force an item in (in-memory) then break persistence: edit must reject.
    (state as any).queue.push({ id: 'x1', text: 'mem', attachments: [], queuedAt: '2026-01-01T00:00:00Z', revision: 0, status: 'pending' });
    await assert.rejects(runtime.editQueuedPrompt(workspace.id, 'queue-edit-session', 'x1', 0, 'edit'), /queue write refused/);
    assert.equal(state.snapshot().queue![0].message, 'mem', 'failed edit did not apply');
    // Dispatch claim that cannot persist unclaims + pauses instead of sending.
    state.ingest({ type: 'agent_settled' });
    await tick(80);
    assert.equal((state.snapshot().queue ?? []).find(i => i.id === 'x1')?.status, 'pending');
    assert.equal(state.snapshot().queueHeld, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('restart restores every item as held (pending too), persists pause, no auto-resend', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-qdur-'));
  const queueDir = join(root, 'queue');
  try {
    const store2 = new QueueStore(queueDir);
    await store2.save('queue-edit-session', [
      { id: 'q1', text: 'persisted item', attachments: [], queuedAt: '2026-01-01T00:00:00Z', revision: 0, status: 'dispatching' },
      { id: 'q2', text: 'second', attachments: [], queuedAt: '2026-01-01T00:00:01Z', revision: 0, status: 'pending' },
    ], false);
    const runtime2 = new RuntimeManager(new WorkspaceStore(join(root, 'w2.json')), root, undefined, queueDir);
    const session2 = { id: 'queue-edit-session', workspaceId: 'w1', filePath: join(root, 'session.jsonl') };
    const state2 = new SessionEvents(session2, () => 'stopped');
    state2.setQueueStore((runtime2 as any).queueStore);
    await state2.loadQueue(await store2.load('queue-edit-session'));
    const queue = state2.snapshot().queue!;
    assert.equal(queue.length, 2);
    assert.equal(queue[0].status, 'held');
    assert.match(queue[0].error ?? '', /restart|unconfirmed/i);
    // Plain pending items are also held after restart: nothing sends without Resume.
    assert.equal(queue[1].status, 'held');
    assert.equal(state2.snapshot().queueHeld, true);
    assert.equal(await state2.beginQueueDispatch(), undefined, 'no claim while held');
    // The pause is durable: the file records held items so a second restart stays paused.
    const persisted = await store2.load('queue-edit-session');
    assert.equal(persisted.held, true);
    assert.ok(persisted.items.every(i => i.status === 'held'));
    await state2.resumeQueue();
    assert.equal(state2.snapshot().queue![0].status, 'pending');
    const again = await state2.editQueueItem('q1', 0, 'persisted edit');
    assert.equal(again.revision, 1);
    await tick();
    assert.match(await readFile(join(queueDir, 'queue-edit-session.json'), 'utf8'), /persisted edit/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt or invalid persisted queue fails closed — never loads as empty', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-qcorrupt-'));
  const queueDir = join(root, 'queue');
  try {
    const store = new QueueStore(queueDir);
    await assert.rejects(store.save('bad\nid', [], false), /invalid session id/);
    const file = join(queueDir, 'queue-edit-session.json');
    await writeFile(file, 'not json');
    await assert.rejects(store.load('queue-edit-session'), /corrupt/);
    await writeFile(file, JSON.stringify({ version: 1, held: false, items: [{ id: 'x', text: 't', attachments: [{ kind: 'image', name: 'a.png', mimeType: 'image/png', data: 'not!!!base64' }], queuedAt: '2026-01-01T00:00:00Z', revision: 0, status: 'pending' }] }));
    await assert.rejects(store.load('queue-edit-session'), /invalid item/);
    await writeFile(file, JSON.stringify({ version: 1, held: false, items: Array.from({ length: 17 }, (_, i) => ({ id: `i${i}`, text: 'x', attachments: [], queuedAt: '2026-01-01T00:00:00Z', revision: 0, status: 'pending' })) }));
    await assert.rejects(store.load('queue-edit-session'), /exceeds/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('queue bounds: >16 items rejected; close/recycle/remove refuse while items pending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-qbound-'));
  const queueDir = join(root, 'queue');
  try {
    const { workspace, runtime, state, session } = await rig(root, { queueDir });
    for (let i = 0; i < MAX_QUEUE_ITEMS; i++) await runtime.prompt(workspace.id, session.id, `item ${i}`, [], 'followUp');
    assert.equal(state.snapshot().queue!.length, MAX_QUEUE_ITEMS);
    await assert.rejects(runtime.prompt(workspace.id, session.id, 'one too many', [], 'followUp'), /queue is full/);
    assert.equal(state.snapshot().queue!.length, MAX_QUEUE_ITEMS);
    await assert.rejects(runtime.closeSession(workspace.id, session.id), /queued follow-ups|active run/);
    await assert.rejects(runtime.recycleSession(workspace.id, session.id, async () => {}), /queued follow-ups|active|recycled/i);
    await assert.rejects(runtime.removeWorkspace(workspace.id), /queued follow-ups|active/i);
    // An unopened session's durable queue blocks removal too.
    await (runtime as any).queueStore.save('closed-session', [{ id: 'a', text: 'x', attachments: [], queuedAt: '2026-01-01T00:00:00Z', revision: 0, status: 'pending' }], true);
    assert.equal(await (runtime as any).queueStore.exists('closed-session'), true);
    (runtime as any).active.clear();
    await assert.rejects(runtime.recycleSession(workspace.id, session.id, async () => {}), /queued follow-ups/);
    await assert.rejects(runtime.removeWorkspace(workspace.id), /queued follow-ups/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('serialized saves: concurrent mutations persist in order, latest wins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-qser-'));
  const queueDir = join(root, 'queue');
  try {
    const { workspace, runtime, state } = await rig(root, { queueDir });
    await runtime.prompt(workspace.id, 'queue-edit-session', 'one', [], 'followUp');
    const id = state.snapshot().queue![0].id;
    await Promise.all([
      runtime.editQueuedPrompt(workspace.id, 'queue-edit-session', id, 0, 'uno'),
      runtime.prompt(workspace.id, 'queue-edit-session', 'two', [], 'followUp'),
    ]);
    await tick();
    const file = await storeLoad(join(queueDir, 'queue-edit-session.json'));
    assert.deepEqual(file.items.map((i: any) => i.text), ['uno', 'two']);
    // Concurrent teardown: many writes race and still leave a consistent file.
    await Promise.all([runtime.removeQueuedPrompt(workspace.id, 'queue-edit-session', id), runtime.removeQueuedPrompt(workspace.id, 'queue-edit-session', file.items[1].id)]);
    const after = await storeLoad(join(queueDir, 'queue-edit-session.json')).catch(() => ({ items: [] }));
    assert.equal(after.items.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('failed edit cannot roll back a concurrent accepted edit; failed remove keeps the item', async () => {
  const state = new SessionEvents({ id: 'transactions', workspaceId: 'w', filePath: 'unused' }, () => 'running');
  let failRemove = false;
  state.setQueueStore({ assertFits() {}, async save(_id: string, items: any[]) {
    await tick(5);
    if (items[0]?.text === 'rejected' || failRemove && !items.length) throw new Error('write refused');
  } } as unknown as QueueStore);
  const item = await state.enqueueFollowUp('original', []);
  const results = await Promise.allSettled([
    state.editQueueItem(item.id, 0, 'rejected'),
    state.editQueueItem(item.id, 0, 'accepted'),
  ]);
  assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'fulfilled');
  assert.equal(state.snapshot().queue![0].message, 'accepted');
  failRemove = true;
  await assert.rejects(state.removeQueueItem(item.id), /write refused/);
  assert.equal(state.snapshot().queue![0].message, 'accepted');
});
const storeLoad = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
