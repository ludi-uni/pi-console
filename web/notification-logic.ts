import type { ActiveSessionSummary } from '../shared/types.ts';

// Only conversation/kit-level ends notify; a finished background child must not
// masquerade as the whole conversation completing. `running` or pending decisions
// mean the session is still alive even when a stale terminal node is listed.
export function notifyEligible(session:ActiveSessionSummary):boolean {
  return !!session.completion&&session.completion.scope!=='subagent'&&!session.running&&!session.decisionCount;
}

export function freshCompletions(previous:Set<string>|undefined, sessions:ActiveSessionSummary[]):ActiveSessionSummary[] {
  if(!previous)return [];
  return sessions.filter(session=>notifyEligible(session)&&!previous.has(session.completion!.id));
}

// Consume only completions that are eligible to notify right now. A completion that
// stays pending because the session is still running or awaiting a decision is NOT
// recorded here: it must notify once when the busy state clears, exactly once.
export function notifiedCompletionIds(sessions:ActiveSessionSummary[]):Set<string> {
  return new Set(sessions.flatMap(session=>notifyEligible(session)?[session.completion!.id]:[]));
}
