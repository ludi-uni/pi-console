import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyableExecutionEvent, serializeExecutionEvent, serializeExecutionNode, writeClipboardText } from '../web/execution-copy.ts';
import type { ExecutionEvent, ExecutionNode } from '../shared/types.ts';

const base: ExecutionEvent = {
  schemaVersion: 1, eventId: 'e-fail-1', seq: 42, timestamp: '2026-02-01T10:15:30.000Z',
  generation: 'gen-1', workspaceId: 'ws-1', sessionId: 's-1', runId: 'run-1',
  type: 'ToolFailed', entityId: 'pi-tool:run-1:call-1', parentId: 'run-1', toolCallId: 'call-1',
  source: 'pi-rpc', sourceRef: { kind: 'pi', nativeId: 'call-1' }, certainty: 'observed',
  status: 'failed', payload: {},
};
const event = (over: Partial<ExecutionEvent>): ExecutionEvent => ({ ...base, ...over });
const node = (over: Partial<ExecutionNode>): ExecutionNode => ({
  id: 'pi-tool:run-1:call-1', kind: 'tool', label: 'powershell', status: 'failed',
  parentId: 'run-1', correlation: 'derived-safe', sourceKind: 'pi', nativeId: 'call-1',
  updatedAt: '2026-02-01T10:15:30.000Z', ...over,
});

test('copyableExecutionEvent covers failed/interrupted status and the canonical issue types only', () => {
  for (const status of ['failed', 'interrupted'] as const)
    assert.equal(copyableExecutionEvent(event({ status, type: 'MessageCompleted' })), true, status);
  for (const type of ['RunFailed', 'ToolFailed', 'ErrorEvent'] as const)
    assert.equal(copyableExecutionEvent(event({ type, status: undefined })), true, type);
  for (const entry of [
    event({ type: 'ToolProgress', status: 'running' }),
    event({ type: 'ToolCompleted', status: 'completed' }),
    event({ type: 'DecisionRequired', status: 'waiting' }),
    event({ type: 'RunCompleted', status: 'cancelled' }),
    event({ type: 'ExecutionNodeUpdated', status: undefined }),
  ]) assert.equal(copyableExecutionEvent(entry), false, entry.type);
});

test('serializeExecutionEvent keeps identifiers, type, time, source, status and the full untruncated multiline payload', () => {
  const multiline = 'line one\nline two\n```\nstack frame\n```';
  const output = 'x'.repeat(9000) + '\nfinal line';
  const text = serializeExecutionEvent(event({
    payload: { summary: 'compile broke', output: multiline, stderr: output, exitCode: 1, retryable: false, meta: { a: 1 } },
  }));
  for (const part of [
    'Time: 2026-02-01T10:15:30.000Z', 'Type: ToolFailed', 'Status: failed', 'Source: pi',
    'Source native ID: call-1', 'Event ID: e-fail-1', 'Entity ID: pi-tool:run-1:call-1',
    'Parent entity ID: run-1', 'Tool call ID: call-1', 'Run ID: run-1', 'Session ID: s-1', 'Workspace ID: ws-1',
    'summary: compile broke', `output: ${multiline}`, `stderr: ${output}`, 'exitCode: 1', 'retryable: false',
  ]) assert.ok(text.includes(part), part);
  assert.equal(text.length > 9000, true, 'no truncation of large payload values');
  assert.equal(text.split('\n').filter(l => l.startsWith('stack frame')).length, 1, 'multiline preserved verbatim');
});

test('serializeExecutionEvent omits absent identifiers and renders ja field names', () => {
  const text = serializeExecutionEvent(event({ status: undefined, parentId: undefined, toolCallId: undefined, sourceRef: undefined, payload: { summary: 'x' } }), true);
  assert.ok(!text.includes('Status:'), 'missing status is not serialized');
  assert.ok(!text.includes('Parent entity ID'), 'missing parent omitted');
  assert.ok(!text.includes('Tool call ID'), 'missing tool call omitted');
  assert.ok(text.includes('Source: pi-rpc'), 'source falls back to event.source');
  assert.ok(text.includes('時刻: 2026-02-01T10:15:30.000Z'));
  assert.ok(text.includes('種類: ToolFailed'));
  assert.ok(text.includes('ペイロード:'));
});

test('serializeExecutionNode for a real-shaped ToolFailed node without details.reason still copies the event-carried reason', () => {
  // Mirrors server/runtime/execution-state.ts: ToolFailed nodes keep only
  // contentBlocks in details and no reason — the canonical ToolFailed event is
  // the only place the failure summary lives.
  const toolNode = node({ action: 'exit 3', details: { contentBlocks: 2 } });
  const failure = event({ payload: { summary: 'powershell exited with an error', stderr: 'boom\nstack' } });
  const text = serializeExecutionNode(toolNode, [failure]);
  for (const part of [
    'Label: powershell', 'Status: failed', 'Kind: tool', 'Node ID: pi-tool:run-1:call-1',
    'Action: exit 3', 'Details:', '"contentBlocks": 2', 'Related events:', 'Type: ToolFailed',
    'summary: powershell exited with an error', 'stderr: boom\nstack',
  ]) assert.ok(text.includes(part), part);
});

test('serializeExecutionNode includes attempts, model and blocked context without related events', () => {
  const text = serializeExecutionNode(node({
    kind: 'task', status: 'failed', attempt: 3, provider: 'openai', model: 'gpt-x',
    attempts: [{ attempt: 1, model: 'm1', failureClass: 'MODEL_FAILURE' }, { attempt: 2 }],
    details: { reason: 'orchestrator gave up' },
  }));
  for (const part of [
    'Attempt: 3', 'Model: openai / gpt-x', 'Attempt 1: m1 · MODEL_FAILURE', 'Attempt 2', '"reason": "orchestrator gave up"',
  ]) assert.ok(text.includes(part), part);
  assert.ok(!text.includes('Related events:'), 'no related section when empty');
});

test('serializeExecutionNode labels localize under ja', () => {
  const text = serializeExecutionNode(node({ status: 'interrupted', blockedReason: 'waiting on input' }), [], true);
  assert.ok(text.includes('ブロック理由: waiting on input'));
  assert.ok(text.includes('更新: 2026-02-01T10:15:30.000Z'));
});

test('writeClipboardText reports copied/failed without throwing', async () => {
  const navigatorRef = (globalThis as { navigator?: unknown }).navigator;
  try {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    assert.equal(await writeClipboardText('x'), 'failed', 'clipboard unavailable');
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } }, configurable: true });
    assert.equal(await writeClipboardText('x'), 'failed', 'writeText rejection');
    let written = '';
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: (t: string) => { written = t; return Promise.resolve(); } } }, configurable: true });
    assert.equal(await writeClipboardText('hello'), 'copied');
    assert.equal(written, 'hello');
  } finally {
    if (navigatorRef === undefined) delete (globalThis as { navigator?: unknown }).navigator;
    else Object.defineProperty(globalThis, 'navigator', { value: navigatorRef, configurable: true });
  }
});
