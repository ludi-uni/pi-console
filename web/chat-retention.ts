import type { ChatMessage } from '../shared/types.ts';

export type ComposerDraftLike = { text: string; files: unknown[]; submission?: unknown };
export const chatWindowSize = 240;
export const chatPageSize = 120;
export const composerDraftCacheLimit = 8;
export const seenCompletionLimit = 500;
export const refreshPromptDelayMs = 120;
export const refreshMinIntervalMs = 800;
export const streamFlushIntervalMs = 150;

/** A sliding DOM window over either the live snapshot or one fetched page. */
export function chatWindow<T>(chat: readonly T[], top?: number, windowSize = chatWindowSize): { messages: T[]; hiddenCount: number; shown: number } {
  const end = top === undefined ? chat.length : Math.max(0, Math.min(top, chat.length));
  const start = Math.max(0, end - windowSize);
  return { messages: chat.slice(start, end), hiddenCount: start, shown: end - start };
}

export function earlierChatCount(snapshot: { chatTruncated?: boolean; chatEarlierCount?: number } | undefined): number {
  if (!snapshot?.chatTruncated) return 0;
  const count = snapshot.chatEarlierCount;
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

// Absolute projected-history indexes: a single held page covers [earlier, end).
// Replacing the page rather than merging pages bounds retained history as well
// as the DOM, and allows append-stable navigation in either direction.
export type ChatHistoryHold = { messages: ChatMessage[]; earlier: number; end: number };
export function checkedHistoryPage(before: number, page: { messages: ChatMessage[]; earlier: number }): ChatHistoryHold {
  if (!Array.isArray(page.messages) || !Number.isSafeInteger(page.earlier) || page.earlier < 0 ||
      page.messages.length > chatPageSize || page.earlier + page.messages.length !== before ||
      (before > 0 && !page.messages.length)) throw Error('History changed; reload the latest messages and retry.');
  return { messages: page.messages, earlier: page.earlier, end: before };
}

export type DraftProtectionSets = {
  dirty: ReadonlySet<string>;
  conflicted: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  unreadable: ReadonlySet<string>;
  inFlight: ReadonlySet<string>;
  revisions: ReadonlyMap<string, number>;
};

/** Only confirmed-persisted, inactive drafts can leave memory. */
export function draftEvictable(scope: string, draft: ComposerDraftLike | undefined, protection: DraftProtectionSets): boolean {
  if (!draft || draft.submission) return false;
  if (protection.dirty.has(scope) || protection.conflicted.has(scope) || protection.failed.has(scope) || protection.unreadable.has(scope) || protection.inFlight.has(scope)) return false;
  return protection.revisions.get(scope) !== undefined;
}

export function draftEvictionCandidates(lru: readonly string[], drafts: Record<string, ComposerDraftLike | undefined>, protection: DraftProtectionSets, activeScope: string, excess: number): string[] {
  const victims: string[] = [];
  for (const scope of lru) {
    if (victims.length >= excess) break;
    if (scope !== activeScope && draftEvictable(scope, drafts[scope], protection)) victims.push(scope);
  }
  return victims;
}

export function capIdSet<T>(ids: ReadonlySet<T>, limit = seenCompletionLimit): Set<T> {
  return new Set(ids.size <= limit ? ids : [...ids].slice(ids.size - limit));
}
