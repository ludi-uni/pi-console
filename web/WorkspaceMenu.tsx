import React, { useRef } from 'react';

export default function WorkspaceMenu({ name, disabled, onOpenHost, onEdit }: {
  name: string;
  disabled: boolean;
  onOpenHost: () => void;
  onEdit: () => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const close = () => {
    if (details.current) details.current.open = false;
    summary.current?.focus();
  };
  return <details className="workspace-menu" ref={details} onKeyDown={event => {
    if (event.key === 'Escape' && details.current?.open) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  }}>
    <summary ref={summary}>Workspace menu <span aria-hidden="true">⌄</span></summary>
    <div className="workspace-menu-body" role="group" aria-label="Workspace actions">
      <small title={name}>Selected workspace · {name}</small>
      <button onClick={() => { close(); onEdit(); }}>Edit selected workspace</button>
      <button className="workspace-explorer" title="Opens this workspace on the host Windows desktop, not this device" disabled={disabled} onClick={() => { close(); onOpenHost(); }}>Open on host PC</button>
      <small>Opens on the host Windows desktop, not this device.</small>
    </div>
  </details>;
}
