import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionEvents } from '../server/runtime/events.ts';
import { ExecutionState } from '../server/runtime/execution-state.ts';
import { OrchestratorSource } from '../server/adapters/orchestrator/source.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';
import type { ExecutionEvent, ExecutionNode } from '../shared/types.ts';
const session = { id: 'sid', workspaceId: 'wid', filePath: '/tmp/session.jsonl' };
const event = (over: Partial<ExecutionEvent>): ExecutionEvent => ({
  schemaVersion: 1, eventId: crypto.randomUUID(), seq: 0, generation: 'g', timestamp: new Date().toISOString(),
  workspaceId: 'wid', sessionId: 'sid', runId: 'run', type: 'ExecutionNodeUpdated', entityId: 'e', source: 'console', certainty: 'observed', payload: {}, ...over,
});
const node = (over: Partial<ExecutionNode>): ExecutionNode => ({ id: over.id!, kind: 'tool', label: 'n', status: 'completed', correlation: 'explicit', sourceKind: 'pi', updatedAt: new Date().toISOString(), ...over });

test('chat retained window evicts oldest complete messages and reports the truncation cursor', () => {
  const state = new SessionEvents(session, () => 'running');
  const messages = Array.from({ length: 520 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  state.load(messages);
  const snap = state.snapshot();
  assert.equal(snap.chat.length, 500);
  assert.equal(snap.chatTruncated, true);
  assert.equal(snap.chatEarlierCount, 20);
  assert.equal(snap.chat[0].text, 'm20');
  assert.equal(snap.chat.at(-1)?.text, 'm519');
});

test('in-flight streaming message and running tools are never evicted', () => {
  const state = new SessionEvents(session, () => 'running');
  state.load(Array.from({ length: 501 }, (_, i) => ({ role: 'user', content: `old${i}` })));
  const run = state.preparePrompt('go'); state.ingest({ type: 'agent_start' });
  state.ingest({ type: 'message_start', message: { role: 'assistant', content: [] } });
  state.ingest({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'x' } });
  state.ingest({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'partial' } });
  const snap = state.snapshot();
  const current = snap.chat.at(-1)!;
  assert.equal(current.complete, false);
  assert.equal(current.text, 'partial');
  assert.equal(current.tools?.[0].status, 'running');
  // The evicted window could not swallow the in-flight tail.
  assert.ok(snap.chat.length > 1);
  assert.equal(snap.chat.at(-1), current);
});

test('kit report boundary is identity-based and survives eviction of earlier messages', () => {
  const state = new SessionEvents(session, () => 'running');
  state.load(Array.from({ length: 490 }, (_, i) => ({ role: 'user', content: `before${i}` })));
  state.markChatBoundary();
  state.preparePrompt('kit report');
  state.ingest({ type: 'agent_start' });
  state.ingest({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'ack' }], stopReason: 'stop' } });
  state.ingest({ type: 'agent_settled' });
  const after = state.chatAfterBoundary();
  assert.ok(after.some(m => m.role === 'assistant' && m.complete && m.text.trim() === 'ack'));
  state.clearChatBoundary();
});

test('execution prunes only wholly-terminal descendants; live and waiting nodes and their ancestors stay', () => {
  const state = new ExecutionState();
  const at = (s: string) => `2026-01-01T00:00:${s}Z`;
  // A run with a live waiting decision: its whole ancestor chain is protected.
  state.apply(event({ type: 'RunStarted', entityId: 'run-1', status: 'running', timestamp: at('00') }));
  for (let i = 0; i < 400; i++)
    state.apply(event({ type: 'ToolStarted', entityId: `tool-${i}`, parentId: 'run-1', status: 'completed', toolCallId: `t${i}`, payload: { toolName: 'bash', node: node({ id: `tool-${i}`, parentId: 'run-1', status: 'completed', endedAt: at('01'), updatedAt: at('01') }) }, timestamp: at('01') }));
  state.apply(event({ type: 'RunCompleted', entityId: 'run-1', status: 'completed', timestamp: at('02') }));
  const afterClose = state.flatNodes();
  assert.ok(afterClose.find(n => n.id === 'run-1'), 'run root stays');
  assert.ok(afterClose.filter(n => n.parentId === 'run-1').length <= 300, 'terminal children pruned to group cap');
  assert.equal(state.readOnlyNodes().truncated, true, 'sticky truncation marker');
  // Waiting decision + its ancestors survive every pruning path.
  state.apply(event({ type: 'RunStarted', entityId: 'run-2', status: 'running', timestamp: at('03') }));
  state.apply(event({ type: 'ExecutionNodeUpdated', entityId: 'dec-1', payload: { node: node({ id: 'dec-1', kind: 'decision', parentId: 'run-2', status: 'waiting' }) }, timestamp: at('04') }));
  state.apply(event({ type: 'RunCompleted', entityId: 'run-2', status: 'failed', timestamp: at('05') }));
  const nodes = state.flatNodes();
  assert.ok(nodes.find(n => n.id === 'dec-1'), 'waiting decision kept');
  assert.ok(nodes.find(n => n.id === 'run-2'), 'its failed run ancestor kept');
  assert.equal(state.hasLiveWork(), true, 'waiting decision still counts as live work');
});

test('overflow evicts oldest wholly-terminal run groups including roots', () => {
  const state = new ExecutionState();
  const at = (i: number) => `2026-01-02T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`;
  // Many small completed runs: each group is root+1 tool = under the group cap,
  // so only the global overflow path removes them — oldest groups first.
  for (let i = 0; i < 2100; i++) {
    state.apply(event({ type: 'RunStarted', entityId: `r${i}`, status: 'running', timestamp: at(i) }));
    state.apply(event({ type: 'ToolStarted', entityId: `t${i}`, parentId: `r${i}`, status: 'completed', toolCallId: `c${i}`, payload: { toolName: 'bash', node: node({ id: `t${i}`, parentId: `r${i}`, status: 'completed', endedAt: at(i), updatedAt: at(i) }) }, timestamp: at(i) }));
    state.apply(event({ type: 'RunCompleted', entityId: `r${i}`, status: 'completed', timestamp: at(i) }));
  }
  assert.ok(state.flatNodes().length <= 4000);
  assert.equal(state.readOnlyNodes().truncated, true);
  // Newest groups survive; oldest are gone.
  assert.ok(state.flatNodes().find(n => n.id === 'r2099'));
  assert.ok(!state.flatNodes().find(n => n.id === 'r0'));
});

test('hasLiveWork treats live orphan and open-scope work conservatively', () => {
  const state = new ExecutionState();
  assert.equal(state.hasLiveWork(), false);
  state.apply(event({ type: 'ExecutionNodeUpdated', entityId: 'orphan', payload: { node: node({ id: 'orphan', parentId: 'missing-parent', status: 'running' }) } }));
  assert.equal(state.hasLiveWork(), true, 'orphan live node is never evidence of completion');
  state.apply(event({ type: 'ExecutionNodeUpdated', entityId: 'orphan', payload: { node: node({ id: 'orphan', parentId: 'missing-parent', status: 'completed', endedAt: '2026-01-01T00:00:00Z' }) } }));
  // A still-live open run keeps the session un-evictable even after orphans settle.
  state.apply(event({ type: 'RunStarted', entityId: 'open-run', status: 'running' }));
  assert.equal(state.hasLiveWork(), true, 'non-terminal run scope blocks eviction');
});

test('tombstones reject late nonterminal updates on pruned ids; newer authoritative store reopen is allowed', () => {
  const state = new ExecutionState();
  const at = (i: number) => `2026-01-03T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`;
  for (let i = 0; i < 2100; i++) {
    state.apply(event({ type: 'RunStarted', entityId: `r${i}`, status: 'running', timestamp: at(i) }));
    state.apply(event({ type: 'ToolStarted', entityId: `t${i}`, parentId: `r${i}`, status: 'completed', toolCallId: `c${i}`, payload: { toolName: 'bash', node: node({ id: `t${i}`, parentId: `r${i}`, status: 'completed', endedAt: at(i), updatedAt: at(i) }) }, timestamp: at(i) }));
    state.apply(event({ type: 'RunCompleted', entityId: `r${i}`, status: 'completed', timestamp: at(i) }));
  }
  assert.ok(!state.flatNodes().find(n => n.id === 'r0'), 'oldest run pruned');
  // A stale nonterminal update on a pruned id is dropped — no resurrection.
  const before = state.flatNodes().length;
  state.apply(event({ type: 'ExecutionNodeUpdated', entityId: 'r0', payload: { node: node({ id: 'r0', kind: 'run', status: 'running', sourceKind: 'pi' }) }, timestamp: at(3000) }));
  assert.equal(state.flatNodes().length, before, 'tombstone rejected the resurrection');
  assert.ok(!state.flatNodes().find(n => n.id === 'r0'));
  // A newer authoritative orchestrator store 'running' may legitimately reopen.
  state.apply(event({ type: 'ExecutionNodeUpdated', entityId: 'r0', payload: { node: node({ id: 'r0', kind: 'orchestrator', status: 'running', sourceKind: 'orchestrator', details: { stateSource: 'store' } }) }, timestamp: at(3001) }));
  assert.ok(state.flatNodes().find(n => n.id === 'r0'), 'authoritative store reopen allowed');
});

test('interrupted runs finalize partial chat and running tools so the window stays bounded', () => {
  const state = new SessionEvents(session, () => 'running');
  // 600 interrupted turns: each leaves a partial assistant bubble. Without
  // finalization every one is pinned forever and the cap never applies.
  for (let i = 0; i < 600; i++) {
    state.preparePrompt(`p${i}`); state.ingest({ type: 'agent_start' });
    state.ingest({ type: 'message_start', message: { role: 'assistant', content: [] } });
    state.ingest({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: `part${i}` } });
    state.ingest({ type: 'tool_execution_start', toolCallId: `t${i}`, toolName: 'bash', args: {} });
    state.interrupted('stopped');
  }
  const snap = state.snapshot();
  assert.equal(snap.chat.length, 500, 'window bounded across repeated interruptions');
  assert.equal(snap.chatTruncated, true);
  assert.equal(snap.chatEarlierCount, 700, '700 evicted: 600 prompts + 600 partials - 500 retained');
  const last = snap.chat.at(-1)!;
  assert.equal(last.complete, true, 'last partial was finalized');
  assert.equal(last.text, 'part599', 'partial text preserved');
  assert.equal(last.tools?.[0].status, 'failed', 'running tool marked failed');
});

test('chatHistory pages the projected transcript with an append-stable absolute cursor', async () => {
  const state = new SessionEvents(session, () => 'running');
  const transcript = Array.from({ length: 620 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  state.load(transcript);
  const calls: string[] = [];
  const worker = { state: 'running', async call() { throw new Error('unused'); }, async getMessages() { return transcript; }, async close() {} };
  const entry = { session, state, worker };
  const owner = Object.assign(Object.create(RuntimeManager.prototype), {
    active: new Map([[session.id, entry]]), failed: new Map(), kitRuns: new Map(),
    workspaces: { get: () => ({ id: 'wid', name: 'w', path: process.cwd(), lastOpenedAt: '' }) },
  }) as RuntimeManager;
  // before = chatEarlierCount returns the page directly preceding the retained tail.
  const page1 = await owner.chatHistory('wid', 'sid', state.chatEarlierCount, 100, undefined);
  assert.equal(page1.messages.length, 100);
  assert.equal(page1.messages.at(-1)!.text, `m${state.chatEarlierCount - 1}`);
  assert.equal(page1.earlier, 20);
  // Appends after the snapshot do not shift the absolute cursor.
  transcript.push({ role: 'user', content: 'appended' });
  const page2 = await owner.chatHistory('wid', 'sid', page1.earlier, 100, undefined);
  assert.equal(page2.messages.at(-1)!.text, 'm19');
  assert.equal(page2.earlier, 0);
  // Invalid cursors fail explicitly — never clamped.
  await assert.rejects(() => owner.chatHistory('wid', 'sid', -1, 10, undefined), /invalid chat history cursor/);
  await assert.rejects(() => owner.chatHistory('wid', 'sid', 10.5, 10, undefined), /invalid chat history cursor/);
  // before beyond the transcript end is out of range, not silently skipped.
  await assert.rejects(() => owner.chatHistory('wid', 'sid', 9999, 10, undefined), /invalid chat history cursor/);
  // Generation mismatch fails closed with 409, never silent.
  await assert.rejects(() => owner.chatHistory('wid', 'sid', 100, 10, 'other-generation'), (e: any) => e.status === 409);
});

test('idle eviction skips subscribed/busy/queued/live-work/pending-report sessions and clears on shutdown', async () => {
  const closed: string[] = [];
  const base = (id: string) => {
    const s = { id, workspaceId: 'wid', filePath: `/tmp/${id}.jsonl` };
    const state = new SessionEvents(s, () => 'running');
    state.lastAccess = 1; // older than the 15-minute idle threshold
    return { session: s, state, worker: { state: 'running', hasPendingOperations: () => false, async close() { closed.push(id); } } };
  };
  const evicted = base('evicted');
  const subscribed = base('subscribed'); subscribed.state.subscribe(() => {});
  const busy = base('busy'); busy.state.preparePrompt('x');
  const queued = base('queued'); queued.state.loadQueue({ held: true, items: [{ id: 'q1', text: 'hi', attachments: [], queuedAt: '', revision: 0, status: 'held' }] });
  const live = base('live'); live.state.publishNode({ id: 'a', kind: 'agent', label: 'a', status: 'running', correlation: 'explicit', sourceKind: 'pi', updatedAt: new Date().toISOString() });
  const owner = Object.assign(Object.create(RuntimeManager.prototype), {
    active: new Map([evicted, subscribed, busy, queued, live].map(e => [e.session.id, e])),
    failed: new Map(), kitRuns: new Map(), starting: new Map(), retiring: new Set(), answeringKit: new Set(),
    reportStore: undefined,
  }) as RuntimeManager;
  await owner.evictIdle(Date.now());
  assert.deepEqual(closed, ['evicted'], 'only the fully idle worker was closed');
  for (const id of ['subscribed', 'busy', 'queued', 'live']) assert.ok(owner['active'].has(id), `${id} kept`);
  assert.ok(!owner['active'].has('evicted'));
  // A pending report-recovery also blocks eviction.
  const reported = base('reported');
  const owner2 = Object.assign(Object.create(RuntimeManager.prototype), {
    active: new Map([[reported.session.id, reported]]), failed: new Map(), kitRuns: new Map(), starting: new Map(), retiring: new Set(), answeringKit: new Set(),
    reportStore: { read: async () => ({ status: 'pending' }) },
  }) as RuntimeManager;
  await owner2.evictIdle(Date.now());
  assert.ok(!closed.includes('reported'), 'pending report blocks eviction');
  // shutdown() clears the eviction timer.
  owner.startIdleEviction(10);
  assert.ok(owner['idleEvictionTimer'], 'timer started');
  await owner.shutdown();
  assert.equal(owner['idleEvictionTimer'], undefined, 'timer cleared on shutdown');
});

test('idle eviction requires the 15-minute quiet period and skips workers with pending RPCs', async () => {
  const closed: string[] = [];
  const base = (id: string, pending: boolean) => {
    const s = { id, workspaceId: 'wid', filePath: `/tmp/${id}.jsonl` };
    const state = new SessionEvents(s, () => 'running');
    state.lastAccess = 1;
    return { session: s, state, worker: { state: 'running', hasPendingOperations: () => pending, async close() { closed.push(id); } } };
  };
  const fresh = base('fresh', false); fresh.state.lastAccess = Date.now(); // just used
  const idle = base('idle', false);
  const rpc = base('rpc', true);
  const owner = Object.assign(Object.create(RuntimeManager.prototype), {
    active: new Map([fresh, idle, rpc].map(e => [e.session.id, e])),
    failed: new Map(), kitRuns: new Map(), starting: new Map(), retiring: new Set(), answeringKit: new Set(),
    reportStore: undefined,
  }) as RuntimeManager;
  await owner.evictIdle(Date.now());
  assert.deepEqual(closed, ['idle'], 'only the quiet-and-idle worker closed');
  assert.ok(owner['active'].has('fresh'), 'recently active session kept');
  assert.ok(owner['active'].has('rpc'), 'worker with an outstanding RPC kept');
});

test('idle eviction rechecks after the awaited report read: a prompt arriving mid-read is not closed', async () => {
  const closed: string[] = [];
  const s = { id: 'racy', workspaceId: 'wid', filePath: '/tmp/racy.jsonl' };
  const state = new SessionEvents(s, () => 'running');
  state.lastAccess = 1;
  const entry = { session: s, state, worker: { state: 'running', hasPendingOperations: () => false, async close() { closed.push('racy'); } } };
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const owner = Object.assign(Object.create(RuntimeManager.prototype), {
    active: new Map([[s.id, entry]]), failed: new Map(), kitRuns: new Map(), starting: new Map(), retiring: new Set(), answeringKit: new Set(),
    reportStore: { read: () => gate.then(() => undefined) },
  }) as RuntimeManager;
  const sweep = owner.evictIdle(Date.now());
  // While the report read is still in flight a prompt/subscriber arrives.
  state.touch();
  state.preparePrompt('racer');
  release();
  await sweep;
  assert.deepEqual(closed, [], 'recheck caught the new prompt — entry not closed');
  assert.ok(owner['active'].has('racy'));
});

test('chat byte budget includes tool payloads and trims enough complete messages at once', () => {
  const state = new SessionEvents(session, () => 'running');
  const messages: Record<string, unknown>[] = [];
  for (let i = 0; i < 30; i++) {
    messages.push({ role: 'assistant', content: [
      { type: 'text', text: `answer-${i}` },
      ...Array.from({ length: 8 }, (_, j) => ({ type: 'toolCall', id: `${i}-${j}`, name: 'read', arguments: { command: 'x'.repeat(4000) } })),
    ] });
    for (let j = 0; j < 8; j++) messages.push({ role: 'toolResult', toolCallId: `${i}-${j}`, content: 'y'.repeat(16000) });
  }
  state.load(messages);
  const snapshot = state.snapshot();
  assert.ok(snapshot.chat.length < 20, 'large tools enforce byte budget well below the message-count cap');
  assert.equal(snapshot.chatEarlierCount! + snapshot.chat.length, 30);
  assert.equal(snapshot.chat.at(-1)?.text, 'answer-29');
  assert.equal(snapshot.chat.at(-1)?.tools?.at(-1)?.output?.length, 16000);
});

test('one oversized latest message remains readable without dropping its text', () => {
  const state = new SessionEvents(session, () => 'running');
  const text = 'x'.repeat(5 * 1024 * 1024);
  state.load([{ role: 'user', content: 'old' }, { role: 'assistant', content: text }]);
  const snapshot = state.snapshot();
  assert.equal(snapshot.chat.length, 1);
  assert.equal(snapshot.chat[0].text, text);
  assert.equal(snapshot.chatEarlierCount, 1);
});

test('explicit worker close releases finished kit progress but keeps unresolved reports', async () => {
  for (const pendingReport of [false, true]) {
    const state = new SessionEvents(session, () => 'running');
    const job = { workspaceId: 'wid', running: false, request: 'done', startedAt: '', reportError: pendingReport ? 'delivery uncertain' : undefined };
    const owner = Object.assign(Object.create(RuntimeManager.prototype), {
      active: new Map([['sid', { session, state, worker: { close: async () => {} } }]]), failed: new Map(), kitRuns: new Map([['sid', job]]),
    }) as RuntimeManager;
    await owner.closeSession('wid', 'sid');
    assert.equal(owner['kitRuns'].has('sid'), pendingReport);
  }
});

test('orchestrator node deduplication is bounded without hiding changed node details', () => {
  let published = 0;
  const source = new OrchestratorSource('/unused', 'sid', '/workspace', () => { published++; });
  for (let i = 0; i < 9000; i++) source['upsert'](node({ id: `task-${i}`, kind: 'task' }));
  assert.ok(source['last'].size <= 8192);
  const latest = node({ id: 'last', kind: 'task', updatedAt: '2026-01-01T00:00:00Z' });
  source['upsert'](latest);
  const before = published;
  source['upsert']({ ...latest });
  assert.equal(published, before);
  source['upsert']({ ...latest, label: 'Changed details with identical timestamp' });
  assert.equal(published, before + 1);
});
