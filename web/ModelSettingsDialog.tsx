import React, { useEffect, useRef } from 'react';

// Native modal focus containment, Escape handling and focus restoration keep the
// controls usable with touch, keyboard and assistive technology.
export default function ModelSettingsDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    if (open) {
      dialog.showModal();
      dialog.querySelector<HTMLSelectElement>('select[aria-label="Model"]:not(:disabled)')?.focus();
    }
    return () => {
      if (dialog.open) dialog.close();
      if (open && previous?.isConnected && !previous.getClientRects().length) requestAnimationFrame(() => {
        const triggers = document.querySelectorAll<HTMLButtonElement>('.model-summary-bar>button,.compact-controls-trigger');
        Array.from(triggers).find(button => button.getClientRects().length && !button.disabled)?.focus();
      });
    };
  }, [open]);
  return <dialog ref={ref} id="model-settings-dialog" className="model-settings-dialog" aria-label="Model settings" onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)'));
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <header className="model-settings-heading"><h3>Model settings</h3><button aria-label="Close model settings" onClick={onClose}>✕</button></header>
    {children}
  </dialog>;
}
