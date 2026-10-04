import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationStatus } from '../web/conversation-status.ts';
import type { Snapshot, ExecutionEvent, ExecutionNode } from '../shared/types.ts';
const at = '2026-10-03T00:00:00Z';
const snapshot = (): Snapshot => ({ session: { id: 's', workspaceId: 'w', filePath: '/s' }, runtime: 'running', chat: [], events: [], execution: { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 }, seq: 0, generation: 'g' });
const event = (type: ExecutionEvent['type'], status?: ExecutionEvent['status']): ExecutionEvent => ({ schemaVersion: 1, eventId: 'e', seq: 1, generation: 'g', workspaceId: 'w', sessionId: 's', runId: 'r', entityId: 'r', timestamp: at, source: 'pi-rpc', certainty: 'observed', type, status, payload: {} });
const node = (id: string, status: ExecutionNode['status'], parentId?: string): ExecutionNode => ({ id, status, parentId, kind: 'agent', label: id, sourceKind: 'pi-subagents', correlation: 'explicit', updatedAt: at });
const project = (s?: Snapshot, options: Partial<Parameters<typeof conversationStatus>[0]> = {}) => conversationStatus({ selected: true, snapshot: s, sending: false, ...options });

test('selection/loading/acknowledgement are distinct, and sending precedes old completion', () => {
  assert.equal(project(undefined, { selected: false }).kind, 'idle');
  assert.equal(project().kind, 'loading');
  const s = snapshot(); s.events = [event('RunCompleted')];
  assert.equal(project(s, { sending: true }).kind, 'sending');
  assert.equal(project(s).kind, 'completed');
  assert.equal(project(snapshot()).label, 'Ready');
});
test('live conversation, decision and kit stages retain their distinct meaning', () => {
  const s = snapshot(); s.activeRunId = 'r';
  assert.equal(project(s).kind, 'running');
  s.execution.decisionCount = 1;
  assert.equal(project(s).kind, 'needs-input');
  assert.equal(project(s, { sending: true }).kind, 'needs-input');
  assert.match(project(s, { sending: true }).detail!, /acknowledgement/);
  s.execution.decisionCount = 0;
  assert.equal(project(s, { needsInput: true }).kind, 'needs-input');
  assert.equal(project(s, { kit: { running: true, reporting: true } }).label, 'Saving report');
  assert.equal(project(s, { kit: { running: true, preparing: true } }).label, 'Preparing run');
});
test('detached running or waiting work does not invent conversation running or completion', () => {
  const s = snapshot(); s.execution.nodes = [node('child', 'running')];
  assert.equal(project(s).kind, 'background');
  s.execution.nodes = [node('child', 'waiting')];
  assert.equal(project(s).label, 'Work waiting');
  s.execution.nodes = [node('child', 'completed')]; s.events = [event('AgentCompleted')];
  assert.equal(project(s).label, 'Ready');
  s.events = [{ ...event('RunCompleted'), source: 'pi-subagents' }];
  assert.equal(project(s).label, 'Ready');
});
test('terminal history is scope-bound and latest top-level outcome wins over old failures', () => {
  const s = snapshot(); s.execution.failedCount = 10;
  s.events = [event('RunFailed', 'failed'), event('RunCompleted')];
  assert.equal(project(s).kind, 'completed');
  s.events = [{ ...event('RunCompleted'), sessionId: 'other' }];
  assert.equal(project(s).label, 'Ready');
  s.events = [{ ...event('RunCompleted'), workspaceId: 'other' }];
  assert.equal(project(s).label, 'Ready');
  s.events = [event('RunFailed', 'cancelled')];
  assert.equal(project(s).kind, 'cancelled');
  s.events = [event('RunFailed', 'interrupted')];
  assert.equal(project(s).label, 'Interrupted');
});
test('interrupted worker, unconfirmed delivery and unsaved kit reports are never reported as ready', () => {
  const s = snapshot(); s.runtime = 'failed';
  assert.equal(project(s).kind, 'failed');
  s.runtime = 'running'; s.queueHeld = true;
  assert.equal(project(s).label, 'Queue paused');
  s.queueHeld = false;
  assert.equal(project(s, { kit: { running: false, reportError: 'Unconfirmed' } }).label, 'Report not saved');
  assert.equal(project(s, { kit: { running: false, error: 'Failed task' } }).label, 'Orchestrator failed');
});
