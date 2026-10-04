import React, { useId, useRef, useState } from 'react';

export default function SessionItemMenu({ name, disabled, onRecycle }: {
  name: string;
  disabled: boolean;
  onRecycle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const escape = (event: React.KeyboardEvent) => {
    if (open && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close();
    }
  };
  return <>
    <button ref={trigger} className="session-menu-trigger" aria-label={`Session menu for ${name}`} title={`Session menu · ${name}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} onKeyDown={escape}>⋯</button>
    {open && <div id={id} className="session-menu-body" role="group" aria-label={`Session actions for ${name}`} onKeyDown={escape}>
      <button className="session-recycle" aria-label={`Move ${name} to Recycle Bin`} disabled={disabled} onClick={() => { close(); onRecycle(); }}>Move to Windows Recycle Bin</button>
      <small>This server's Recycle Bin. Other apps may also use this Pi session.</small>
    </div>}
  </>;
}
