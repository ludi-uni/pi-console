import type { Snapshot } from '../shared/types.ts';
import { liveExecutionNodes } from '../shared/execution-activity.ts';

export type ConversationStatusKind = 'idle' | 'loading' | 'sending' | 'running' | 'needs-input' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'background' | 'stopped';
export type ConversationStatus = { kind: ConversationStatusKind; label: string; detail?: string; tone: 'neutral' | 'live' | 'warning' | 'success' | 'danger' };
type KitState = { running: boolean; needsInput?: boolean; reporting?: boolean; preparing?: boolean; reportError?: string; error?: string; reportedToPi?: boolean };

// This projection is about one selected conversation, not connection health or
// other sessions. Completion needs an observed top-level Pi terminal event;
// finishing a detached child must never imply the conversation has finished.
export function conversationStatus({ selected, snapshot, sending, needsInput, kit }: {
  selected: boolean; snapshot?: Snapshot; sending: boolean; needsInput?: boolean; kit?: KitState;
}): ConversationStatus {
  if (!selected) return { kind: 'idle', label: 'No session selected', tone: 'neutral' };
  if (snapshot && (needsInput || kit?.needsInput || snapshot.execution.decisionCount > 0)) return { kind: 'needs-input', label: 'Input required', detail: sending ? 'Review the pending question in execution details. A message is also awaiting server acknowledgement; do not resend.' : 'Review the pending question in execution details.', tone: 'warning' };
  if (sending) return { kind: 'sending', label: 'Sending', detail: 'Waiting for the server acknowledgement. Do not resend.', tone: 'live' };
  if (!snapshot) return { kind: 'loading', label: 'Loading session', tone: 'neutral' };
  if (snapshot.runtime === 'failed') return { kind: 'failed', label: 'Session interrupted', detail: 'Reopen the session before continuing.', tone: 'danger' };
  if (kit?.running) return { kind: 'running', label: kit.reporting ? 'Saving report' : kit.preparing ? 'Preparing run' : 'Orchestrator running', tone: 'live' };
  const live = liveExecutionNodes(snapshot.execution.nodes);
  if (snapshot.activeRunId) {
    const tool = live.slice().reverse().find(n => n.kind === 'tool' && n.status === 'running');
    return { kind: 'running', label: 'Running', detail: tool ? `${tool.label}${tool.action ? ` · ${tool.action}` : ''}` : 'Pi is processing this conversation.', tone: 'live' };
  }
  if (snapshot.queueHeld) return { kind: 'paused', label: 'Queue paused', detail: 'Delivery is unconfirmed. Review the queue before resuming.', tone: 'warning' };
  if (kit?.reportError) return { kind: 'failed', label: 'Report not saved', detail: kit.reportError, tone: 'danger' };
  if (kit?.error) return { kind: 'failed', label: 'Orchestrator failed', detail: kit.error, tone: 'danger' };
  if (live.some(n => n.status === 'running')) return { kind: 'background', label: 'Background work running', detail: 'This does not indicate an active Pi conversation run.', tone: 'live' };
  if (live.some(n => n.status === 'waiting' || n.status === 'blocked')) return { kind: 'paused', label: 'Work waiting', detail: 'Open execution details for the dependency or reason.', tone: 'warning' };
  const terminal = snapshot.events.filter(e => e.workspaceId === snapshot.session.workspaceId && e.sessionId === snapshot.session.id &&
    (e.source === 'pi-rpc' || e.source === 'console') && (e.type === 'RunCompleted' || e.type === 'RunFailed')).at(-1);
  if (terminal?.type === 'RunCompleted') return { kind: 'completed', label: 'Completed', tone: 'success' };
  if (terminal) return terminal.status === 'cancelled' ? { kind: 'cancelled', label: 'Stopped', tone: 'neutral' } :
    { kind: 'failed', label: terminal.status === 'interrupted' ? 'Interrupted' : 'Run failed', detail: typeof terminal.payload.summary === 'string' ? terminal.payload.summary : undefined, tone: 'danger' };
  if (snapshot.runtime === 'stopped' || snapshot.runtime === 'stopping') return { kind: 'stopped', label: 'Session stopped', tone: 'neutral' };
  return { kind: 'idle', label: 'Ready', tone: 'neutral' };
}
