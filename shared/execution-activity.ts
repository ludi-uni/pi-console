import type { ExecutionNode } from './types.ts';
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const live = new Set(['running', 'waiting', 'blocked']);

// Historical child statuses remain visible in Execution, but a closed run scope
// makes them ineligible for current activity. Missing parents are not evidence of
// completion; detached work stays live. Bound traversal also tolerates cycles.
export function liveExecutionNodes(nodes: readonly ExecutionNode[]): ExecutionNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return nodes.filter(node => {
    if (!live.has(node.status)) return false;
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      // A failed task can still have a valid retry/input decision. Only closed
      // execution scopes establish that their descendants are no longer live.
      if (['run', 'orchestrator'].includes(parent.kind) && terminal.has(parent.status)) {
        // Failed kit runs can retain an explicit pending decision for recovery.
        // Preserve that request for input, without claiming execution is running.
        if (!(parent.status === 'failed' && node.kind === 'decision' && node.status === 'waiting')) return false;
      }
      parentId = parent.parentId;
    }
    return true;
  });
}
