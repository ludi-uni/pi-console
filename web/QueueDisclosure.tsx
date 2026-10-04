import React, { useEffect, useRef, useState } from 'react';

export default function QueueDisclosure({ compact, count, editing, warning, children }: {
  compact: boolean;
  count: number;
  editing: boolean;
  warning?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = useRef<HTMLElement>(null);
  const open = !compact || expanded || editing;
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing && compact && !expanded) summary.current?.focus();
    wasEditing.current = editing;
  }, [editing, compact, expanded]);
  return <div className="prompt-queue" aria-label="Queued follow-ups" data-compact={compact} data-warning={!!warning}>
    {warning}
    <details className="queue-disclosure" open={open} onKeyDown={event => {
      if (compact && !editing && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); setExpanded(false); summary.current?.focus();
      }
    }}>
      <summary ref={summary} className="prompt-queue-title" role={compact ? 'button' : 'heading'} aria-level={compact ? undefined : 3} aria-disabled={!compact || editing} tabIndex={compact ? 0 : -1} onClick={event => {
        event.preventDefault(); if (compact && !editing) setExpanded(value => !value);
      }}>
        <strong>Queued · {count}{compact && <span aria-hidden="true"> {open ? '▴' : '▾'}</span>}</strong>
        {!compact && <small>Sends after Pi finishes · pending items remain editable</small>}
      </summary>
      <div className="queue-list">{compact && <small className="queue-list-help">Sends after Pi finishes · pending items remain editable</small>}{children}</div>
    </details>
  </div>;
}
