import type { ActiveSessionSummary } from '../shared/types.ts';

export function freshCompletions(previous:Set<string>|undefined, sessions:ActiveSessionSummary[]):ActiveSessionSummary[] {
  if(!previous)return [];
  return sessions.filter(session=>session.completion&&!previous.has(session.completion.id));
}

export function completionIds(sessions:ActiveSessionSummary[]):Set<string> {
  return new Set(sessions.flatMap(session=>session.completion?[session.completion.id]:[]));
}
