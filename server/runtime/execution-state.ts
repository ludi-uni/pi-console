import type { ExecutionEvent, ExecutionNode, ExecutionStateSnapshot, ExecutionStatus } from '../../shared/types.ts';
import { liveExecutionNodes } from '../../shared/execution-activity.ts';
const terminal = new Set<ExecutionStatus>(['completed','failed','cancelled','interrupted']);
// Retention bounds for the in-memory node projection. Non-terminal nodes and
// their full ancestor chains are always protected; only wholly-terminal
// coherent groups (a terminal run/orchestrator root plus all its terminal
// descendants) may leave memory.
const retainedNodesHardCap = 4000;
const retainedNodesLowWater = 3500;
const terminalGroupCap = 300;
const retainedTombstonesCap = 4000;
const asNode = (value: unknown): ExecutionNode | undefined => {
  if (!value || typeof value !== 'object') return;
  const node = value as ExecutionNode;
  return typeof node.id === 'string' && typeof node.label === 'string' && typeof node.status === 'string' ? node : undefined;
};
export class ExecutionState {
  private nodes = new Map<string, ExecutionNode>();
  private seen = new Set<string>();
  // Bounded tombstones for pruned ids: a late nonterminal update must not
  // resurrect a pruned node. The one sanctioned exception — a newer authoritative
  // orchestrator store 'running' — is handled in apply() before the check.
  private tombstones = new Set<string>();
  // Sticky: once any terminal node has been pruned this projection no longer holds
  // the complete history, and readOnly/snapshot consumers must keep reporting that.
  private pruned = false;
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
    const authoritativeReopen = !previous && node.kind === 'orchestrator' && node.sourceKind === 'orchestrator' && node.details?.stateSource === 'store' && node.status === 'running';
    if (!previous && this.tombstones.has(node.id) && (terminal.has(node.status) || !authoritativeReopen)) return false;
    if (!previous && this.tombstones.has(node.id)) this.tombstones.delete(node.id);
    if (previous && node.updatedAt < previous.updatedAt) return false;
    // Only a newer authoritative kit store state may reopen a terminal run.
    // Public snapshots and late child updates must not resurrect completed work.
    const resumed = previous && node.kind === 'orchestrator' && node.sourceKind === 'orchestrator' && node.details?.stateSource === 'store' && node.status === 'running' && node.updatedAt > previous.updatedAt;
    if (previous && previous.kind !== 'task' && terminal.has(previous.status) && !terminal.has(node.status) && node.sourceKind === previous.sourceKind && !resumed) return false;
    const merged = { ...previous, ...node, startedAt: node.startedAt ?? previous?.startedAt, parentId: node.parentId ?? previous?.parentId };
    if (previous && JSON.stringify(previous) === JSON.stringify(merged)) return false;
    this.nodes.set(node.id, merged);
    if (['run','orchestrator'].includes(merged.kind) && terminal.has(merged.status)) this.pruneTerminalGroup(merged.id);
    if (this.nodes.size > retainedNodesHardCap) this.pruneOverflow();
    return true;
  }
  private evict(id: string) { this.nodes.delete(id); this.tombstones.add(id); this.pruned = true;
    if (this.tombstones.size > retainedTombstonesCap) this.tombstones.delete(this.tombstones.values().next().value!); }
  private ancestors(node: ExecutionNode, byId: Map<string, ExecutionNode>): string[] {
    const chain: string[] = [], visited = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId && !visited.has(parentId)) { visited.add(parentId); chain.push(parentId); parentId = byId.get(parentId)?.parentId; }
    return chain;
  }
  private childrenMap(byId: Map<string, ExecutionNode>): Map<string, ExecutionNode[]> {
    const children = new Map<string, ExecutionNode[]>();
    for (const node of byId.values()) if (node.parentId) { const bucket = children.get(node.parentId); if (bucket) bucket.push(node); else children.set(node.parentId, [node]); }
    return children;
  }
  private subtree(rootId: string, children: Map<string, ExecutionNode[]>): ExecutionNode[] {
    const out: ExecutionNode[] = [], queue = [rootId], visited = new Set<string>([rootId]);
    for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) ?? []) if (!visited.has(child.id)) { visited.add(child.id); out.push(child); queue.push(child.id); }
    return out;
  }
  // Ids that must never leave memory: every non-terminal node plus its full
  // ancestor chain. Waiting decisions are non-terminal, so pending input
  // relationships are covered here too.
  private protectedIds(byId: Map<string, ExecutionNode>): Set<string> {
    const protect = new Set<string>();
    for (const node of this.nodes.values()) {
      if (terminal.has(node.status)) continue;
      protect.add(node.id);
      for (const id of this.ancestors(node, byId)) protect.add(id);
    }
    return protect;
  }
  // Evict oldest fully-terminal descendants of a just-closed run/orchestrator
  // root once that run's group exceeds the per-group bound.
  private pruneTerminalGroup(rootId: string) {
    const byId = new Map(this.nodes);
    const protect = this.protectedIds(byId);
    const members = [this.nodes.get(rootId)!, ...this.subtree(rootId, this.childrenMap(byId))];
    if (members.length <= terminalGroupCap) { if (this.nodes.size > retainedNodesHardCap) this.pruneOverflow(); return; }
    const removable = members.filter(node => node.id !== rootId && !protect.has(node.id) && terminal.has(node.status))
      .sort((a, b) => (a.endedAt ?? a.updatedAt).localeCompare(b.endedAt ?? b.updatedAt));
    for (const node of removable.slice(0, Math.max(0, members.length - terminalGroupCap))) this.evict(node.id);
    if (this.nodes.size > retainedNodesHardCap) this.pruneOverflow();
  }
  // Global safety bound: evict oldest wholly-terminal coherent groups first
  // (root + all terminal descendants, none protected), then oldest orphan
  // terminal leaves. Protected nodes always stay.
  private pruneOverflow() {
    const byId = new Map(this.nodes);
    const protect = this.protectedIds(byId);
    const children = this.childrenMap(byId);
    const groups: { endedAt: string; ids: string[] }[] = [];
    for (const node of this.nodes.values()) {
      if (!['run','orchestrator'].includes(node.kind) || !terminal.has(node.status) || protect.has(node.id)) continue;
      const members = [node, ...this.subtree(node.id, children)];
      if (members.some(member => protect.has(member.id) || !terminal.has(member.status))) continue;
      groups.push({ endedAt: node.endedAt ?? node.updatedAt, ids: members.map(member => member.id) });
    }
    groups.sort((a, b) => a.endedAt.localeCompare(b.endedAt));
    for (const group of groups) {
      if (this.nodes.size <= retainedNodesLowWater) break;
      for (const id of group.ids) this.evict(id);
    }
    if (this.nodes.size <= retainedNodesLowWater) return;
    const leaves = [...this.nodes.values()].filter(node => !protect.has(node.id) && terminal.has(node.status))
      .sort((a, b) => (a.endedAt ?? a.updatedAt).localeCompare(b.endedAt ?? b.updatedAt));
    for (const node of leaves) {
      if (this.nodes.size <= retainedNodesLowWater) break;
      this.evict(node.id);
    }
  }
  private computed() {
    const nodes = [...this.nodes.values()]; const byId = new Map(nodes.map(n => [n.id,n]));
    const roots: string[] = [], unattached: string[] = [];
    const children = new Map<string,ExecutionNode[]>();
    for (const node of nodes) {
      if (!node.parentId && node.kind === 'run') roots.push(node.id);
      else if (!node.parentId || !byId.has(node.parentId) || node.parentId === node.id) unattached.push(node.id);
      if (node.parentId) { const bucket = children.get(node.parentId); if (bucket) bucket.push(node); else children.set(node.parentId, [node]); }
    }
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
  // A flat, bounded whitelist for local read-only observation. No labels,
  // commands, details or graph rendering (which can recurse over deep trees).
  // `truncated` stays true after terminal pruning: the retained subset is not the
  // complete projection history.
  readOnlyNodes() {
    const values: ExecutionNode[] = [];
    for (const node of this.nodes.values()) { if (values.length >= 5000) break; values.push(node); }
    return { truncated: this.pruned || this.nodes.size > values.length, nodes: values.map(node => ({
      id: node.id, kind: node.kind, status: node.status, parentId: node.parentId,
      sourceKind: node.sourceKind, startedAt: node.startedAt, updatedAt: node.updatedAt, endedAt: node.endedAt,
    })) };
  }
  // Content-read service only; not added to legacy status-only projections.
  readOnlyResultNodes() {
    return [...this.nodes.values()].slice(0,5000).map(n => ({ id:n.id,parentId:n.parentId,kind:n.kind,status:n.status,sourceKind:n.sourceKind,correlation:n.correlation,model:n.model,provider:n.provider }));
  }
  // Full node list without the rows/roots graph build — for activity summaries
  // that need labels/status but not hierarchy.
  flatNodes(): ExecutionNode[] { return [...this.nodes.values()]; }
  // `count` requests only the scalar activity data — no rows/visited graph
  // build. Callers polling on a timer use this to keep idle heartbeats cheap.
  snapshot(count = false): ExecutionStateSnapshot {
    if (count) {
      const nodes = [...this.nodes.values()];
      const active = liveExecutionNodes(nodes);
      return { nodes: [], roots: [], unattached: [], rows: [], activeCount: active.length,
        failedCount: nodes.filter(n => n.status === 'failed' || n.status === 'interrupted').length,
        decisionCount: active.filter(n => n.kind === 'decision' && n.status === 'waiting').length,
        ...(this.pruned ? { truncated: true } : {}) };
    }
    return { ...this.computed(), ...(this.pruned ? { truncated: true } : {}) };
  }
  markInterrupted() {
    for (const [id,node] of this.nodes) if (node.sourceKind === 'pi' && node.status === 'running') this.nodes.set(id,{...node,status:'interrupted',updatedAt:new Date().toISOString()});
  }
  // Idle-eviction liveness: exactly liveExecutionNodes over the retained set, so
  // closed-vs-failed scope decisions, orphans and cycles all match.
  hasLiveWork() { return liveExecutionNodes([...this.nodes.values()]).length > 0; }
}
