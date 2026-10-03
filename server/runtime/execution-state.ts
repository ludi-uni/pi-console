import type { ExecutionEvent, ExecutionNode, ExecutionStateSnapshot, ExecutionStatus } from '../../shared/types.ts';
import { liveExecutionNodes } from '../../shared/execution-activity.ts';
const terminal = new Set<ExecutionStatus>(['completed','failed','cancelled','interrupted']);
const asNode = (value: unknown): ExecutionNode | undefined => {
  if (!value || typeof value !== 'object') return;
  const node = value as ExecutionNode;
  return typeof node.id === 'string' && typeof node.label === 'string' && typeof node.status === 'string' ? node : undefined;
};
export class ExecutionState {
  private nodes = new Map<string, ExecutionNode>();
  private seen = new Set<string>();
  apply(event: ExecutionEvent): boolean {
    if (this.seen.has(event.eventId)) return false;
    this.seen.add(event.eventId);
    if (this.seen.size > 20000) this.seen.clear();
    const fromSource = asNode(event.payload.node);
    let node: ExecutionNode | undefined = fromSource;
    if (!node && ['RunStarted','RunCompleted','RunFailed'].includes(event.type)) {
      node = { id: event.entityId, kind: 'run', label: `Pi run ${event.runId.slice(0,8)}`, status: event.status ?? 'unknown', correlation: 'explicit', sourceKind: 'pi', nativeId: event.runId, startedAt: event.type === 'RunStarted' ? event.timestamp : undefined, updatedAt: event.timestamp, endedAt: event.type !== 'RunStarted' ? event.timestamp : undefined };
    }
    if (!node && ['ToolStarted','ToolProgress','ToolCompleted','ToolFailed'].includes(event.type)) {
      node = { id: event.entityId, kind: 'tool', label: String(event.payload.toolName ?? 'tool'), status: event.status ?? 'unknown', parentId: event.parentId, correlation: event.parentId ? 'derived-safe' : 'unknown', sourceKind: 'pi', nativeId: event.toolCallId, updatedAt: event.timestamp, startedAt: event.type === 'ToolStarted' ? event.timestamp : undefined, endedAt: ['ToolCompleted','ToolFailed'].includes(event.type) ? event.timestamp : undefined, action: String(event.payload.commandPreview || this.nodes.get(event.entityId)?.action || ''), details: { contentBlocks: Number(event.payload.contentBlocks ?? 0) } };
    }
    if (!node) return false;
    const previous = this.nodes.get(node.id);
    if (previous && node.updatedAt < previous.updatedAt) return false;
    // Only a newer authoritative kit store state may reopen a terminal run.
    // Public snapshots and late child updates must not resurrect completed work.
    const resumed = previous && node.kind === 'orchestrator' && node.sourceKind === 'orchestrator' && node.details?.stateSource === 'store' && node.status === 'running' && node.updatedAt > previous.updatedAt;
    if (previous && previous.kind !== 'task' && terminal.has(previous.status) && !terminal.has(node.status) && node.sourceKind === previous.sourceKind && !resumed) return false;
    const merged = { ...previous, ...node, startedAt: node.startedAt ?? previous?.startedAt, parentId: node.parentId ?? previous?.parentId };
    if (previous && JSON.stringify(previous) === JSON.stringify(merged)) return false;
    this.nodes.set(node.id, merged);
    return true;
  }
  snapshot(): ExecutionStateSnapshot {
    const nodes = [...this.nodes.values()]; const byId = new Map(nodes.map(n => [n.id,n]));
    const roots: string[] = [], unattached: string[] = [];
    for (const node of nodes) {
      if (!node.parentId && node.kind === 'run') roots.push(node.id);
      else if (!node.parentId || !byId.has(node.parentId) || node.parentId === node.id) unattached.push(node.id);
    }
    const children = new Map<string,ExecutionNode[]>();
    for (const node of nodes) if (node.parentId) children.set(node.parentId,[...(children.get(node.parentId)??[]),node]);
    const rows: ExecutionStateSnapshot['rows'] = [], visited = new Set<string>();
    const visit = (node:ExecutionNode,depth:number,orphan:boolean) => {
      if (visited.has(node.id)) return; visited.add(node.id); rows.push({node,depth,unattached:orphan});
      for (const child of children.get(node.id)??[]) visit(child,depth+1,orphan);
    };
    for (const id of roots) visit(byId.get(id)!,0,false);
    for (const id of unattached) visit(byId.get(id)!,0,true);
    for (const node of nodes) if (!visited.has(node.id)) visit(node,0,true);
    const active = liveExecutionNodes(nodes);
    return { nodes, roots, unattached, rows, activeCount: active.length,
      failedCount: nodes.filter(n => n.status === 'failed' || n.status === 'interrupted').length,
      decisionCount: active.filter(n => n.kind === 'decision' && n.status === 'waiting').length };
  }
  markInterrupted() {
    for (const [id,node] of this.nodes) if (node.sourceKind === 'pi' && node.status === 'running') this.nodes.set(id,{...node,status:'interrupted',updatedAt:new Date().toISOString()});
  }
}
