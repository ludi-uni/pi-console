import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileActivitySessions, visibleActivitySessions, stableVisibleActivity, activityCardKey, ACTIVITY_PAGE_SIZE, ACTIVITY_WORK_PREVIEW } from '../web/activity-rendering.ts';
import type { ActiveSessionSummary } from '../shared/types.ts';

const summary = (over: Partial<ActiveSessionSummary> = {}): ActiveSessionSummary => ({
  sessionId: 's1', workspaceId: 'w1', sessionName: 'Session', workspaceName: 'Workspace',
  running: true, decisionCount: 0, updatedAt: '2026-01-01T00:00:00Z', work: [], ...over,
});

test('an identical activity snapshot keeps the same array reference', () => {
  const first = [summary(), summary({ sessionId: 's2', sessionName: 'Other' })];
  // Every /api/activity reply decodes fresh objects; clone to simulate a re-fetch.
  const next = JSON.parse(JSON.stringify(first)) as ActiveSessionSummary[];
  const { sessions, changed } = reconcileActivitySessions(first, next);
  assert.equal(changed, false);
  assert.equal(sessions, first);
});

test('an updatedAt-only change is not a render change', () => {
  // updatedAt is order metadata stamped from the newest event; it never renders
  // inside a card, so it must not defeat identity reuse on busy sessions.
  const first = [summary({ updatedAt: '2026-01-01T00:00:00Z' })];
  const next = [summary({ updatedAt: '2026-01-01T00:05:00Z' })];
  const { sessions, changed } = reconcileActivitySessions(first, next);
  assert.equal(changed, false);
  assert.equal(sessions, first);
});

test('a changed session name replaces only that entry', () => {
  const other = summary({ sessionId: 's2', sessionName: 'Stable' });
  const first = [summary(), other];
  const next = [summary({ sessionName: 'Renamed' }), summary({ sessionId: 's2', sessionName: 'Stable' })];
  const { sessions, changed } = reconcileActivitySessions(first, next);
  assert.equal(changed, true);
  assert.equal(sessions[0].sessionName, 'Renamed');
  assert.equal(sessions[1], other);
});

test('reorders keep entry identity but emit the server order', () => {
  const a = summary(), b = summary({ sessionId: 's2', sessionName: 'Second' }), c = summary({ sessionId: 's3', sessionName: 'Third' });
  // The server sorts by urgency; a reorder must produce the new order so the
  // inbox ranking stays correct, while still reusing each entry's identity.
  const reordered = reconcileActivitySessions([a, b], [b, a]);
  assert.equal(reordered.changed, true);
  assert.deepEqual(reordered.sessions.map(s => s.sessionId), ['s2', 's1']);
  assert.equal(reordered.sessions[0], b);
  assert.equal(reordered.sessions[1], a);
  assert.equal(reconcileActivitySessions([a], [a, c]).changed, true);
  assert.equal(reconcileActivitySessions([a, b], [a]).changed, true);
  assert.equal(reconcileActivitySessions([a, b], [a]).sessions.length, 1);
});

test('new nested work and completion references count as changes', () => {
  const done = { id: 'w1', label: 'Run tests', status: 'completed' as const, kind: 'task' as const };
  const completion = { id: 'c1', status: 'completed' as const, at: '2026-01-01T01:00:00Z', scope: 'conversation' as const };
  const first = [summary({ running: false, work: [done] })];
  const finished = [summary({ running: false, work: [done], completion })];
  assert.equal(reconcileActivitySessions(first, finished).changed, true);
  assert.equal(reconcileActivitySessions(finished, first).changed, true);
  // A decoded clone with identical fields is not a change, but any field edit is.
  const cloned = [summary({ running: false, work: [{ ...done }] })];
  assert.equal(reconcileActivitySessions(first, cloned).changed, false);
  const edited = [summary({ running: false, work: [{ ...done, status: 'failed' as const }] })];
  const { sessions, changed } = reconcileActivitySessions(first, edited);
  assert.equal(changed, true);
  assert.equal(sessions[0].work[0].status, 'failed');
});

test('decisionCount and running flips are detected', () => {
  const idle = summary({ running: false });
  assert.equal(reconcileActivitySessions([idle], [summary({ running: false, decisionCount: 1 })]).changed, true);
  assert.equal(reconcileActivitySessions([idle], [summary()]).changed, true);
});

test('visibleActivitySessions keeps actionable sessions and hides dismissed completions', () => {
  const completion = { id: 'c1', status: 'completed' as const, at: '2026-01-01T01:00:00Z', scope: 'conversation' as const };
  const waiting = { id: 'w', label: 'x', status: 'waiting' as const, kind: 'task' as const };
  const running = summary();
  const needsInput = summary({ sessionId: 's2', running: false, decisionCount: 2 });
  const finished = summary({ sessionId: 's3', running: false, completion });
  const waitingWork = summary({ sessionId: 's4', running: false, work: [waiting] });
  const quiet = summary({ sessionId: 's5', running: false });
  const visible = visibleActivitySessions([running, needsInput, finished, waitingWork, quiet], []);
  assert.deepEqual(visible.map(s => s.sessionId), ['s1', 's2', 's3', 's4']);
  assert.deepEqual(visibleActivitySessions([finished], ['c1']), []);
});

test('every displayed work/completion field invalidates reuse and workspace identity stays scoped', () => {
  const item = summary({ work: [{ id: 'task', label: 'Before', status: 'running', kind: 'task', action: 'read' }],
    completion: { id: 'done', at: '2026-01-01T01:00:00Z', scope: 'conversation', status: 'completed' } });
  const check = (mutate: (next: ActiveSessionSummary) => void) => {
    const next = structuredClone(item); mutate(next);
    assert.equal(reconcileActivitySessions([item], [next]).changed, true);
  };
  for (const change of [
    { id: 'other' }, { label: 'After' }, { status: 'blocked' as const }, { kind: 'agent' as const }, { action: 'write' },
  ]) check(next => { Object.assign(next.work[0], change); });
  for (const change of [
    { id: 'new-completion' }, { at: '2026-01-01T02:00:00Z' }, { scope: 'kit' as const }, { status: 'failed' as const },
  ]) check(next => { Object.assign(next.completion!, change); });
  check(next => { next.workspaceName = 'Renamed workspace'; });
  check(next => { next.work.push({ ...next.work[0], id: 'extra' }); });
  const otherWorkspace = summary({ workspaceId: 'w2' });
  const result = reconcileActivitySessions([item, otherWorkspace], [structuredClone(otherWorkspace), structuredClone(item)]);
  assert.equal(result.sessions[0], otherWorkspace);
  assert.equal(result.sessions[1], item);
});

test('stableVisibleActivity keeps displayed positions and appends new sessions', () => {
  // A poll that re-sorts by urgency must not move mounted cards: kept keys
  // hold their slot with the fresh summary object, new sessions go last.
  const a = summary(), b = summary({ sessionId: 's2', sessionName: 'Second' }), c = summary({ sessionId: 's3', sessionName: 'Third' });
  const renamed = summary({ sessionName: 'Renamed' });
  const order = [a, b].map(activityCardKey);
  const result = stableVisibleActivity([c, b, renamed], order);
  assert.deepEqual(result.map(e => e.item?.sessionId), ['s1', 's2', 's3']);
  assert.equal(result[0].item, renamed); // The displayed card shows the live data.
  assert.equal(result[1].item, b);
});

test('stableVisibleActivity holds a tombstone slot for sessions vanished by a poll', () => {
  const a = summary(), b = summary({ sessionId: 's2' }), c = summary({ sessionId: 's3' });
  // A session that left the live list keeps its slot as an inert tombstone:
  // removing it would slide the next card under a resting pointer and a
  // same-position click would open the wrong session.
  const dropped = stableVisibleActivity([c, a], [a, b].map(activityCardKey));
  assert.deepEqual(dropped.map(e => e.key), [a, b, c].map(activityCardKey));
  assert.equal(dropped[0].item, a);
  assert.equal(dropped[1].item, undefined); // tombstone for w1:s2
  assert.equal(dropped[2].item, c);
  // The tombstone survives later polls but is refilled if the session returns.
  const stillGone = stableVisibleActivity([], [a, b].map(activityCardKey));
  assert.deepEqual(stillGone.map(e => e.item), [undefined, undefined]);
  const returned = stableVisibleActivity([b], [a, b].map(activityCardKey));
  assert.equal(returned[1].item, b);
  // No frozen order (closed inbox) lists live cards with no tombstones.
  const live = [b, a];
  assert.deepEqual(stableVisibleActivity(live, []).map(e => e.item), live);
});

test('inbox paging uses an explicit step so a full list stays reachable', () => {
  assert.equal(ACTIVITY_PAGE_SIZE, 20);
  assert.equal(ACTIVITY_WORK_PREVIEW, 4);
});
