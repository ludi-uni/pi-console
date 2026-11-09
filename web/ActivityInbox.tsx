import React, { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ActiveSessionSummary } from '../shared/types.ts';
import { ACTIVITY_PAGE_SIZE, ACTIVITY_WORK_PREVIEW, activityCardKey, stableVisibleActivity } from './activity-rendering.ts';

const completionLabel = (completion: NonNullable<ActiveSessionSummary['completion']>) => completion.scope === 'conversation' ? 'Conversation' : completion.scope === 'kit' ? 'Kit run' : 'Subagent';

// One notification card. Memoized on the summary object (kept stable by
// reconcileActivitySessions) plus stable callbacks, so an unrelated render or a
// poll that only touched other sessions does not redo this card's work.
const ActivityCard = memo(function ActivityCard({ item, current, dismissed, ja, onOpen, onDismiss }: {
  item: ActiveSessionSummary;
  current: boolean;
  dismissed: string[];
  ja: boolean;
  onOpen: (item: ActiveSessionSummary, card: HTMLElement) => void;
  onDismiss: (item: ActiveSessionSummary, id: string) => void;
}) {
  return <div className={`activity-card${current ? ' is-current' : ''}`} data-key={activityCardKey(item)}>
    <button aria-current={current ? 'page' : undefined} onClick={e => onOpen(item, e.currentTarget)}>
      <span className="activity-inbox-name"><b title={item.sessionName}>{item.sessionName}</b><small title={item.workspaceName}>{item.workspaceName}</small>{current && <small className="activity-current-label">{ja ? '表示中' : 'Current session'}</small>}{item.work.slice(0, ACTIVITY_WORK_PREVIEW).map(w => <small key={w.id}>{w.kind}: {w.label} · {w.status}{w.action ? ` · ${w.action}` : ''}</small>)}</span>
      <span className="activity-inbox-status">{item.decisionCount > 0 && <em>{item.decisionCount} need input</em>}{item.running && <em className="is-running">Running</em>}{!item.running && item.work.some(w => w.status === 'blocked') && <em>Blocked</em>}{!item.running && !item.decisionCount && !item.work.some(w => w.status === 'blocked') && item.work.some(w => w.status === 'waiting') && <em>Waiting</em>}{item.completion && !dismissed.includes(item.completion.id) && <em>{completionLabel(item.completion)} {item.completion.status} · {new Date(item.completion.at).toLocaleTimeString()}</em>}</span>
    </button>
    {item.completion && !dismissed.includes(item.completion.id) && <button className="activity-dismiss" aria-label={`Dismiss ${item.sessionName} completion`} onClick={() => onDismiss(item, item.completion!.id)}>×</button>}
  </div>;
});

// Notification inbox. Cards are only mounted while the details element is open —
// a closed inbox costs just the summary row — and long lists mount in pages of
// ACTIVITY_PAGE_SIZE behind an explicit "show more" button so every entry stays
// reachable without rendering the whole list at once.
function ActivityInbox({ items, needsInput, activeCount, completedCount, currentWorkspace, currentSession, dismissed, ja, onOpen, onDismiss }: {
  items: ActiveSessionSummary[];
  needsInput: number;
  activeCount: number;
  completedCount: number;
  currentWorkspace: string;
  currentSession: string;
  dismissed: string[];
  ja: boolean;
  onOpen: (item: ActiveSessionSummary, card: HTMLElement) => void;
  onDismiss: (id: string) => void;
}) {
  // Open state lives in React: closing removes the card DOM entirely, and the
  // header badge sets details.open programmatically → the toggle event keeps this
  // in sync.
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(ACTIVITY_PAGE_SIZE);
  // While the inbox is open the displayed order is frozen: polls re-sort the
  // live list by urgency, but moving mounted cards shifts them out from under
  // the pointer and the scroll viewport. Fresh summary objects still flow in,
  // sessions vanished by an authoritative poll stay as inert tombstones in
  // their slot (a same-position click must not open a different session) and
  // sessions new to the displayed order append at the end; the latest urgency
  // order applies on the next open.
  const [order, setOrder] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  // Last committed height per key; a poll-vanished card keeps it so the
  // tombstone holds the exact same geometry as the live card it replaced.
  const tombstoneHeights = useRef(new Map<string, number>());
  // Card positions recorded after the last commit; the layout effect compares
  // them with the new positions to keep the same card under the scroll port.
  const offsetsRef = useRef(new Map<string, number>());
  const scrollTopRef = useRef(0);
  const onToggle = useCallback((e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const next = e.currentTarget.open;
    setOpen(next);
    setLimit(ACTIVITY_PAGE_SIZE);
    setOrder(next ? items.map(activityCardKey) : []);
  }, [items]);
  const ordered = open ? stableVisibleActivity(items, order) : [];
  const shown = ordered.slice(0, limit);
  const remaining = items.length - shown.reduce((live, entry) => live + (entry.item ? 1 : 0), 0);
  const showMore = useCallback(() => setLimit(limit => limit + ACTIVITY_PAGE_SIZE), []);
  // Explicit dismissal is a removal, not a tombstone: dropping the key before
  // the parent updates `dismissed` keeps the card sliding out as before. Only
  // server-side removals hold their slot.
  const onCardDismiss = useCallback((item: ActiveSessionSummary, id: string) => {
    // A dismissed completion can coexist with live work: keep that card's slot.
    if (!item.running && !item.decisionCount && !item.work.some(w => w.status === 'waiting' || w.status === 'blocked')) {
      const key = activityCardKey(item);
      setOrder(keys => keys.filter(k => k !== key));
    }
    onDismiss(id);
  }, [onDismiss]);
  // Inputs that can change mounted cards; the measuring effect below only runs
  // its layout work when one of them actually changed.
  const syncRef = useRef<{ items: ActiveSessionSummary[]; dismissed: string[]; limit: number; current: string; ja: boolean } | undefined>(undefined);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !open) { syncRef.current = undefined; offsetsRef.current.clear(); tombstoneHeights.current.clear(); scrollTopRef.current = 0; return; }
    const last = syncRef.current;
    if (last && last.items === items && last.dismissed === dismissed && last.limit === limit && last.current === `${currentWorkspace}:${currentSession}` && last.ja === ja) return;
    syncRef.current = { items, dismissed, limit, current: `${currentWorkspace}:${currentSession}`, ja };
    const previous = offsetsRef.current;
    const offsets = new Map<string, number>();
    const heights = new Map<string, number>();
    for (const card of Array.from(list.querySelectorAll<HTMLElement>('.activity-card[data-key]'))) {
      offsets.set(card.dataset.key!, card.offsetTop);
      heights.set(card.dataset.key!, card.offsetHeight);
    }
    tombstoneHeights.current = heights;
    // Use the PREVIOUS viewport, not post-update offsets: even a large height
    // change or a removed card above it must preserve the nearest surviving
    // anchor. Assign an absolute position so native browser scroll anchoring
    // cannot double-compensate (no overflow-anchor support required).
    const scrollTop = scrollTopRef.current;
    if (scrollTop > 0) {
      let anchor: { before: number; after: number } | undefined;
      for (const [key, before] of previous) {
        const after = offsets.get(key);
        if (after === undefined) continue;
        if (!anchor || before <= scrollTop && (anchor.before > scrollTop || before > anchor.before)) anchor = { before, after };
      }
      if (anchor) list.scrollTop = scrollTop + anchor.after - anchor.before;
    }
    scrollTopRef.current = list.scrollTop;
    offsetsRef.current = offsets;
    // Freeze the full order, including below-fold entries and new arrivals.
    // Return the same array when unchanged to avoid an extra render loop.
    const next = ordered.map(entry => entry.key);
    setOrder(keys => next.length === keys.length && next.every((key, i) => key === keys[i]) ? keys : next);
  });
  // Always mounted from the parent so a poll that empties the live list cannot
  // unmount the open inbox out from under the pointer; with nothing ever seen
  // there is still no section at all.
  if (!open && !items.length) return null;
  return <section className="activity-inbox" aria-label="Activity notifications">
    <details className="activity-inbox-details" onToggle={onToggle}>
      <summary className="activity-inbox-heading"><strong>{ja ? '通知' : 'Notifications'}</strong><span>{needsInput} need input · {activeCount} running · {completedCount} finished</span></summary>
      <div className="activity-inbox-list" ref={listRef} onScroll={e => { scrollTopRef.current = e.currentTarget.scrollTop; }}>
        {shown.map(entry => entry.item
          ? <ActivityCard key={entry.key} item={entry.item} current={entry.item.sessionId === currentSession && entry.item.workspaceId === currentWorkspace} dismissed={dismissed} ja={ja} onOpen={onOpen} onDismiss={onCardDismiss} />
          : <div key={entry.key} className="activity-card is-removed" data-key={entry.key} aria-hidden="true" style={{ height: tombstoneHeights.current.get(entry.key) }}>
              <button type="button" disabled tabIndex={-1} />
            </div>)}
        {open && remaining > 0 && <button type="button" className="activity-show-more" onClick={showMore}>{ja ? `さらに表示 · 残り ${remaining}/${items.length} 件` : `Show more · ${remaining} of ${items.length} remaining`}</button>}
      </div>
    </details>
  </section>;
}

// Every prop is stable across unrelated renders (reconciled items, stable
// callbacks), so typing in the composer never re-slices the list.
export default memo(ActivityInbox);
