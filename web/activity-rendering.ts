import type { ActiveSessionSummary } from '../shared/types.ts';

// Number of notification cards mounted per expansion step in the activity inbox.
// The server reports at most 100 entries; opening the details must not create all
// of them at once.
export const ACTIVITY_PAGE_SIZE = 20;

// Same subset rule as the previous inline map: the first few work items are shown.
export const ACTIVITY_WORK_PREVIEW = 4;

// updatedAt only orders the list and is never rendered inside a card. Comparing it
// would defeat identity reuse: the server stamps it from the newest event, so a
// busy session's card would be recreated on every poll.
type ActivityCardFields = Omit<ActiveSessionSummary, 'updatedAt'>;

// Field-level comparison for one summary. Every field the card or the header
// counters render is compared; nested work items (a handful: live nodes plus up
// to 2 recent) and completion are compared member-by-member because each poll
// decodes fresh arrays/objects.
function sameWorkItem(a: ActiveSessionSummary['work'][number], b: ActiveSessionSummary['work'][number]): boolean {
  return a.id === b.id && a.label === b.label && a.status === b.status && a.kind === b.kind && a.action === b.action;
}

function sameCompletion(a: ActiveSessionSummary['completion'], b: ActiveSessionSummary['completion']): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && a.status === b.status && a.at === b.at && a.scope === b.scope;
}

function sameActivitySummary(a: ActivityCardFields, b: ActivityCardFields): boolean {
  return a.sessionId === b.sessionId &&
    a.workspaceId === b.workspaceId &&
    a.sessionName === b.sessionName &&
    a.workspaceName === b.workspaceName &&
    a.running === b.running &&
    a.decisionCount === b.decisionCount &&
    a.work.length === b.work.length &&
    a.work.every((w, i) => sameWorkItem(w, b.work[i])) &&
    sameCompletion(a.completion, b.completion);
}

// Reconciles a fresh /api/activity snapshot with the previous one so unchanged
// sessions keep their object identity (memoized cards skip re-render) and an
// identical snapshot keeps the same array reference, avoiding a state update.
// Order is preserved: the server already sorts by urgency (need input, running,
// most recently updated).
export function reconcileActivitySessions(previous: ActiveSessionSummary[], next: ActiveSessionSummary[]): { sessions: ActiveSessionSummary[]; changed: boolean } {
  const byKey = new Map(previous.map(item => [`${item.workspaceId}:${item.sessionId}`, item]));
  // The server sorts by urgency (need input, running, most recent). A reorder
  // must re-emit the new order even when every entry reuses its identity, or the
  // inbox would show a stale ranking.
  let changed = previous.length !== next.length || !next.every((item, i) => item.sessionId === previous[i]?.sessionId && item.workspaceId === previous[i]?.workspaceId);
  const sessions = next.map(item => {
    const before = byKey.get(`${item.workspaceId}:${item.sessionId}`);
    if (before && sameActivitySummary(before, item)) return before;
    changed = true;
    return item;
  });
  return { sessions: changed ? sessions : previous, changed };
}

// The card list filters out sessions with nothing actionable. Kept as a helper so
// the header counters and the inbox share exactly one definition.
export function visibleActivitySessions(sessions: ActiveSessionSummary[], dismissed: string[]): ActiveSessionSummary[] {
  return sessions.filter(s => (s.running || s.decisionCount || s.completion && !dismissed.includes(s.completion.id) || s.work.some(w => w.status === 'waiting' || w.status === 'blocked')));
}

// Card identity used both for the React key and for the stable displayed order.
export const activityCardKey = (item: ActiveSessionSummary) => `${item.workspaceId}:${item.sessionId}`;

// One row of the displayed inbox list: a live session card, or a tombstone
// (`item === undefined`) for a session an authoritative poll removed while the
// inbox is open. The tombstone holds the slot — with the card's last recorded
// height — so no other card slides under a resting pointer and a click cannot
// land on the wrong session. It renders disabled and does nothing.
export interface ActivityInboxEntry {
  key: string;
  item: ActiveSessionSummary | undefined;
}

// While the inbox is open the displayed cards keep their order even when the
// server re-sorts by urgency: a card sliding under the pointer or the scroll
// viewport is how a click lands on the wrong session. `order` is the key
// sequence currently displayed; kept positions swap in the fresh summary
// objects, vanished sessions stay as tombstones and sessions new to the
// displayed order append at the end. Explicit user dismissal removes the key
// from `order` first, so only server-side removals become tombstones.
export function stableVisibleActivity(live: ActiveSessionSummary[], order: string[]): ActivityInboxEntry[] {
  if (!order.length) return live.map(item => ({ key: activityCardKey(item), item }));
  const pending = new Map(live.map(item => [activityCardKey(item), item]));
  const kept: ActivityInboxEntry[] = [];
  for (const key of order) {
    const item = pending.get(key);
    kept.push({ key, item });
    if (item) pending.delete(key);
  }
  for (const item of pending.values()) kept.push({ key: activityCardKey(item), item });
  return kept;
}
