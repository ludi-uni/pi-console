import React from 'react';
import type { ExecutionNode } from '../shared/types.ts';

export type KitJob = { running: boolean; preparing?: boolean; reporting?: boolean; reportedToPi?: boolean; reportError?: string; request: string; startedAt?: string; runId?: string; error?: string; progress?: string[]; report?: string; sessionPersisted?: boolean };
const rank: Record<string, number> = { failed: 0, interrupted: 0, running: 1, waiting: 2, blocked: 2, queued: 3, completed: 4, cancelled: 4 };

export function kitRequestTitle(request: string) {
  const line = request.split(/\r?\n/).map(s => s.trim()).find(Boolean) ?? '';
  return line.replace(/^#{1,6}\s*/, '').slice(0, 120) || 'Untitled request';
}

/** Do not mix tasks from another kit run while this session is starting a new one. */
export function kitRunProgress(job: KitJob, nodes: ExecutionNode[]) {
  const roots = nodes.filter(n => n.sourceKind === 'orchestrator' && n.kind === 'orchestrator' && !n.parentId);
  const root = job.runId ? roots.find(n => n.nativeId === job.runId) : undefined;
  if (!root) return { root: undefined, tasks: [] as ExecutionNode[], agents: [] as ExecutionNode[] };
  const tasks = nodes.filter(n => n.parentId === root.id && n.kind === 'task' && n.sourceKind === 'orchestrator')
    .sort((a,b) => (rank[a.status] ?? 5) - (rank[b.status] ?? 5) || a.label.localeCompare(b.label));
  const taskIds = new Set(tasks.map(n => n.id));
  const agents = nodes.filter(n => n.kind === 'agent' && n.sourceKind === 'orchestrator' && !!n.parentId && taskIds.has(n.parentId));
  return { root, tasks, agents };
}

export default function KitRunCard({ job, nodes }: { job: KitJob; nodes: ExecutionNode[] }) {
  const { root, tasks, agents } = kitRunProgress(job, nodes);
  const running = tasks.filter(n => n.status === 'running').length;
  const waiting = tasks.filter(n => ['waiting', 'blocked', 'queued'].includes(n.status)).length;
  const done = tasks.filter(n => n.status === 'completed').length;
  const failed = tasks.filter(n => n.status === 'failed' || n.status === 'interrupted').length;
  const agentRunning = agents.filter(n => n.status === 'running').length;
  const title = kitRequestTitle(job.request);
  const task = (node: ExecutionNode) => <li key={node.id}><b data-status={node.status}>{node.status}</b><span title={node.label}>{node.label}</span></li>;
  return <section className="kit-run-status" aria-label="Orchestrator run status" role="status">
    <div className="kit-run-heading"><strong>ludi-agent-kit</strong><b data-status={job.running ? 'running' : job.error ? 'failed' : 'completed'}>{job.preparing ? 'Preparing session' : job.reporting && job.running ? 'Saving report' : job.running ? 'Running' : job.error ? 'Failed' : 'Finished'}</b></div>
    <h3 title={title}>{title}</h3>
    {root ? <><p>{tasks.length ? `${done}/${tasks.length} tasks done · ${running} running${waiting ? ` · ${waiting} pending` : ''}${failed ? ` · ${failed} failed` : ''}` : 'No tasks reported yet.'}{agentRunning ? ` · ${agentRunning} ${agentRunning === 1 ? 'agent' : 'agents'} running` : ''}</p>
      {!!tasks.length && <ul className="kit-run-tasks">{tasks.slice(0,4).map(task)}</ul>}
      {tasks.length > 4 && <details><summary>Show all {tasks.length} tasks</summary><ul className="kit-run-tasks">{tasks.slice(4).map(task)}</ul></details>}
    </> : <p>{job.preparing ? 'Waiting for the Pi acknowledgement and saved session…' : job.running ? 'Waiting for the first task update from the kit…' : 'Task details are not available for this run.'}</p>}
    {!!job.progress?.length && <div className="kit-run-progress" aria-label="Orchestrator progress"><strong>Latest update</strong><p aria-live="polite">{job.progress.at(-1)}</p>{job.progress.length > 1 && <details><summary>Earlier updates · {job.progress.length - 1}</summary><ol>{job.progress.slice(0,-1).map((message,index)=><li key={index}>{message}</li>)}</ol></details>}</div>}
    {job.sessionPersisted === false && !job.preparing && <p>Pi session file is not saved; this session cannot be recovered after a server restart.</p>}
    {job.reportError && <p className="kit-run-error" role="alert">Report was not saved in Pi chat: {job.reportError}</p>}
    {job.error && <p className="kit-run-error" role="alert">{job.error}</p>}
    {job.runId && <small>Run ID: {job.runId}</small>}
    <details><summary>Full request</summary><pre>{job.request}</pre></details>
  </section>;
}
