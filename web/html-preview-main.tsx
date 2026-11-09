import React from 'react';
import { createRoot } from 'react-dom/client';
import HtmlPreview from './HtmlPreview.tsx';
import './html-preview.css';

// Dedicated consent shell for workspace HTML preview. The parent serves this
// page for /api/workspace/html under a strict CSP (frame-src 'none' etc.), so
// the sandboxed srcdoc frame can never reach the network or navigate away.
const params = new URL(location.href).searchParams;
const workspaceId = params.get('workspaceId') ?? '';
const path = params.get('path') ?? '';

createRoot(document.getElementById('root')!).render(
  workspaceId && path
    ? <HtmlPreview workspaceId={workspaceId} path={path} />
    : <main className="preview-shell"><p role="alert" className="preview-error">workspaceId と path の指定がないため、プレビューを開始できません。</p></main>,
);
