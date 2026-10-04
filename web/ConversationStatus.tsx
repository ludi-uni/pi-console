import React from 'react';
import type { Snapshot } from '../shared/types.ts';
import { liveExecutionNodes } from '../shared/execution-activity.ts';
import type { ConversationStatus as Status } from './conversation-status.ts';

export default function ConversationStatus({ status, snapshot, onExecution }: { status: Status; snapshot?: Snapshot; onExecution: () => void }) {
  const live = liveExecutionNodes(snapshot?.execution.nodes ?? []);
  return <details className="conversation-status" data-tone={status.tone} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
  }}>
    <summary aria-label="Conversation status details"><span role="status" aria-label="Current conversation status" data-state={status.kind}>{status.label}</span></summary>
    <div className="conversation-status-body">
      <strong>{status.label}</strong>
      {status.detail && <p>{status.detail}</p>}
      {snapshot && <><small>Execution nodes · {live.filter(n => n.status === 'running').length} running · {live.filter(n => n.status === 'blocked' || n.status === 'waiting').length} waiting · {snapshot.execution.decisionCount} input requests</small>
        {!!snapshot.execution.failedCount && <small>Execution history · {snapshot.execution.failedCount} failed</small>}
        {!!snapshot.queue?.length && <small>Queued messages · {snapshot.queue.length}</small>}</>}
      <small>Connection health is shown separately in the app header.</small>
      <button onClick={onExecution}>{status.kind === 'needs-input' ? 'Answer in Execution' : 'Open execution details'}</button>
    </div>
  </details>;
}
