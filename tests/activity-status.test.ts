import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeManager } from '../server/runtime/manager.ts';
import { SessionEvents } from '../server/runtime/events.ts';
import { OrchestratorSource } from '../server/adapters/orchestrator/source.ts';
import { liveExecutionNodes } from '../shared/execution-activity.ts';
import type { ExecutionNode } from '../shared/types.ts';

const at = new Date().toISOString();
const node = (id: string, status: ExecutionNode['status'], parentId?: string, kind: ExecutionNode['kind'] = 'task'): ExecutionNode =>
  ({ id, status, parentId, kind, label: id, sourceKind: 'orchestrator', correlation: 'explicit', updatedAt: at });
function fixture() {
  const session = { id: 'activity-status', workspaceId: 'w', filePath: join(tmpdir(), `${randomUUID()}.jsonl`) };
  const state = new SessionEvents(session, () => 'running');
  const owner = Object.assign(Object.create(RuntimeManager.prototype), {
    active: new Map([[session.id, { session, state }]]), failed: new Map(), kitRuns: new Map(), sessionsRoot: join(tmpdir(), randomUUID()),
    workspaces: { get: () => ({ id: 'w', name: 'fixture', path: process.cwd(), lastOpenedAt: at }) },
  }) as RuntimeManager;
  return { state, owner };
}
test('blocked/waiting-only activity remains visible but does not mean Running, matching the reported screenshot', async () => {
  for (const status of ['blocked', 'waiting'] as const) {
    const { state, owner } = fixture();
    state.publishNode(node('Run tests', status)); state.publishNode(node('Review result and risks', status));
    const activity = await owner.activity();
    assert.equal(state.activeRunId, undefined); assert.equal(activity.length, 1);
    assert.equal(activity[0].running, false); assert.equal(activity[0].work.length, 2);
    assert.equal((await owner.sessions('w'))[0].running, false);
  }
});
test('closed ancestors exclude leftover work/decisions from live summaries without deleting history or hiding detached work', async () => {
  const { state, owner } = fixture();
  state.publishNode(node('finished', 'completed', undefined, 'orchestrator'));
  state.publishNode(node('Run tests', 'blocked', 'finished'));
  state.publishNode(node('old child', 'running', 'Run tests', 'agent'));
  state.publishNode(node('old decision', 'waiting', 'Run tests', 'decision'));
  assert.deepEqual(await owner.activity(), []);
  assert.equal((await owner.sessions('w'))[0].running, false);
  assert.equal(state.snapshot().execution.activeCount, 0); assert.equal(state.snapshot().execution.decisionCount, 0);
  assert.equal(state.snapshot().execution.nodes.length, 4);
  state.publishNode(node('detached', 'running', undefined, 'agent'));
  assert.equal((await owner.activity())[0].running, true);
  assert.deepEqual((await owner.activity())[0].work.map(w => w.id), ['detached']);
});
test('resumable orchestration tasks become live again under a reopened parent; missing parents and cycles do not invent completion', () => {
  assert.equal(liveExecutionNodes([node('failed-task', 'failed'), node('retry-decision', 'waiting', 'failed-task', 'decision')]).length, 1);
  assert.equal(liveExecutionNodes([node('failed-run', 'failed', undefined, 'orchestrator'), node('retry-decision', 'waiting', 'failed-run', 'decision')]).length, 1);
  assert.equal(liveExecutionNodes([node('parent', 'running', undefined, 'orchestrator'), node('task', 'blocked', 'parent')]).length, 2);
  assert.equal(liveExecutionNodes([node('orphan', 'running', 'missing', 'agent')]).length, 1);
  assert.equal(liveExecutionNodes([node('a', 'running', 'b'), node('b', 'blocked', 'a')]).length, 2);
});
test('only newer authoritative kit state can reopen a failed scope, not a stale public snapshot', async () => {
  const { state, owner } = fixture();
  const source = new OrchestratorSource('unused', 's', 'unused', n => state.publishNode(n));
  const snapshot = { runId: 'r', activity: { state: 'failed', updatedAt: at, tasks: [{ taskId: 't', title: 'Run tests', state: 'blocked' }], activeInvocations: [] } };
  source.project({ snapshot, run: { status: 'failed', updated_at: at }, tasks: [], decisions: [], trace: [] });
  assert.deepEqual(await owner.activity(), []);
  const later = new Date(Date.parse(at) + 1000).toISOString();
  const stale = { ...snapshot, activity: { ...snapshot.activity, state: 'running', updatedAt: later } };
  source.project({ snapshot: stale, tasks: [], decisions: [], trace: [] });
  assert.equal(state.snapshot().execution.nodes.find(n => n.kind === 'orchestrator')?.status, 'failed');
  source.project({ snapshot: stale, run: { status: 'running', updated_at: later }, tasks: [], decisions: [], trace: [] });
  assert.equal((await owner.activity())[0].running, true);
  assert.ok((await owner.activity())[0].work.some(w => w.status === 'blocked'));
});
test('active snapshots cannot override observed invocation end or advertise execution beneath a finished run', () => {
  for (const status of ['running', 'completed', 'failed', 'cancelled', 'interrupted', 'finished']) {
    const { state } = fixture(); const source = new OrchestratorSource('unused', 's', 'unused', n => state.publishNode(n));
    const data = { snapshot: { runId: 'r', activity: { state: 'running', updatedAt: at, tasks: [], activeInvocations: [
      { runId: 'r', taskId: 't', invocationId: 'done', agent: 'done' }, { runId: 'r', taskId: 't', invocationId: 'open', agent: 'open' },
    ] } }, run: { status, updated_at: at }, tasks: [], decisions: [], trace: [
      { type: 'invocation-end', at, payload: JSON.stringify({ runId: 'r', taskId: 't', invocationId: 'done', status: 'completed' }) },
    ] };
    source.project(data);
    const count = state.events.length; source.project(data); assert.equal(state.events.length, count);
    const nodes = state.snapshot().execution.nodes;
    assert.equal(nodes.find(n => n.nativeId === 'done')?.status, 'completed');
    assert.equal(nodes.find(n => n.nativeId === 'open')?.status, status === 'running' ? 'running' : 'unknown');
  }
});
