import React from 'react';
import type { KitJob } from './KitRunCard.tsx';

/** Kit output is a separate view, never an invented Pi transcript message. */
export default function KitChatReport({ job }: { job: KitJob }) {
  return <section className="kit-chat-report" aria-label="Orchestrator reports">
    <header><strong>ludi-agent-kit · Orchestrator</strong><span>{job.preparing ? 'Preparing session' : job.reporting && job.running ? 'Saving report to Pi' : job.running ? 'Running' : job.error ? 'Failed' : 'Finished'}</span></header>
    {job.preparing && <p className="kit-chat-entry">Pi の受付応答を待っています…</p>}
    {!!job.progress?.length && <div className="kit-chat-updates" aria-label="Progress reports" aria-live="polite">{job.progress.map((message, index) => <p className="kit-chat-entry" key={`${index}:${message}`}>{message}</p>)}</div>}
    {job.running && !job.preparing && !job.progress?.length && <p className="kit-chat-entry">オーケストレータの報告を待っています…</p>}
    {job.report && !job.reportedToPi && <div className="kit-chat-final"><strong>最終レポート{job.reporting && job.running ? ' · Pi に保存中' : ''}</strong><pre>{job.report}</pre></div>}
    {job.reportError && <p className="kit-chat-entry kit-chat-error" role="alert">Pi の会話への保存に失敗しました: {job.reportError}</p>}
    {job.error && <p className="kit-chat-entry kit-chat-error" role="alert">{job.error}</p>}
    {!job.running && !job.report && !job.error && <p className="kit-chat-entry">実行が終了しました。タスクの詳細は Execution で確認できます。</p>}
    <small>{job.reportedToPi ? '最終結果はこの上の Pi 応答として保存されました。' : '進捗は Kit の一時表示です。最終結果は Pi の応答として保存します。'}</small>
  </section>;
}
