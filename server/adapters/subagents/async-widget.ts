import type { ExecutionNode, ExecutionStatus } from '../../../shared/types.ts';

const PREFIX = 'PI_SUBAGENT_ASYNC_JSON:';
const states: Record<string, ExecutionStatus> = {
  queued: 'queued', running: 'running', complete: 'completed', failed: 'failed',
  partial: 'unknown', paused: 'waiting', stopped: 'cancelled', rejected: 'failed',
};
const terminal = new Set<ExecutionStatus>(['completed', 'failed', 'cancelled', 'interrupted']);
const date = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8.64e15 ? new Date(value).toISOString() : undefined;
const bounded = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : undefined;

type WidgetNode = { id?: unknown; kind?: unknown; label?: unknown; state?: unknown; startedAt?: unknown; endedAt?: unknown; activity?: { currentTool?: unknown; toolCount?: unknown; turnCount?: unknown }; children?: unknown };

/** Pi's session-scoped RPC widget is an authoritative bounded projection, not tool output text. */
export class AsyncSubagentAdapter {
  private known = new Map<string, { fingerprint: string; node: ExecutionNode }>();
  constructor(private readonly publish: (node: ExecutionNode) => void) {}
  ingest(raw: Record<string, any>): void {
    if (raw.type !== 'extension_ui_request' || raw.method !== 'setWidget' || raw.widgetKey !== 'subagent-async') return;
    if (raw.widgetLines == null) { this.markMissing(); return; }
    const line = raw.widgetLines?.[0];
    if (!Array.isArray(raw.widgetLines) || raw.widgetLines.length !== 1 || typeof line !== 'string' || line.length > 65536 || !line.startsWith(PREFIX)) return;
    let snapshot: any;
    try { snapshot = JSON.parse(line.slice(PREFIX.length)); } catch { return; }
    if (snapshot?.kind !== 'pi-subagents.async-status-snapshot' || snapshot.version !== 1 || !Array.isArray(snapshot.runs)) return;
    const seen = new Set<string>();
    const visit = (value: WidgetNode, parentId: string | undefined, path: string[], depth: number) => {
      if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > 256 ||
          typeof value.state !== 'string' || !Object.hasOwn(states, value.state) ||
          !['subagent', 'workflow', 'step'].includes(String(value.kind)) || depth > 3) return;
      const id = `pi-subagent-async:${JSON.stringify([...path, value.id])}`;
      if (seen.has(id)) return;
      seen.add(id);
      const status = states[value.state];
      const node: ExecutionNode = { id, kind: value.kind === 'workflow' ? 'orchestrator' : 'agent',
        label: bounded(value.label, 100) || 'Background subagent', status, parentId,
        correlation: 'explicit', sourceKind: 'pi-subagents', nativeId: value.id,
        startedAt: date(value.startedAt), updatedAt: new Date().toISOString(),
        endedAt: terminal.has(status) ? date(value.endedAt) ?? new Date().toISOString() : undefined,
        action: bounded(value.activity?.currentTool, 100),
        details: { ...(typeof value.activity?.toolCount === 'number' ? { toolCount: value.activity.toolCount } : {}),
          ...(typeof value.activity?.turnCount === 'number' ? { turnCount: value.activity.turnCount } : {}) } };
      const fingerprint = JSON.stringify([node.label, node.status, node.parentId, node.action, node.details]);
      if (this.known.get(id)?.fingerprint !== fingerprint) { this.publish(node); this.known.set(id, { fingerprint, node }); }
      if (Array.isArray(value.children)) for (const child of value.children.slice(0, 16)) visit(child, id, [...path, value.id], depth + 1);
    };
    for (const run of snapshot.runs.slice(0, 32)) visit(run, undefined, [], 0);
    if (snapshot.omitted?.runs === 0 && snapshot.omitted?.children === 0 && !snapshot.omitted?.byteLimitExceeded &&
        snapshot.runs.length <= 32 && !snapshot.runs.some((run: WidgetNode) => Array.isArray(run.children) && run.children.length > 16)) this.markMissing(seen);
  }
  private markMissing(seen = new Set<string>()) {
    for (const [id, previous] of this.known) {
      if (seen.has(id) || !['queued', 'running', 'waiting'].includes(previous.node.status)) continue;
      const node: ExecutionNode = { ...previous.node, status: 'unknown', action: 'Status no longer reported by Pi', updatedAt: new Date().toISOString() };
      this.publish(node); this.known.set(id, { fingerprint: JSON.stringify([node.label, node.status, node.parentId, node.action, node.details]), node });
    }
  }
}
