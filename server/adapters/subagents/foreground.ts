import type { ExecutionNode, ExecutionStatus } from '../../../shared/types.ts';
type Raw = Record<string, any>;
const statusOf = (result: Raw, finished: boolean): ExecutionStatus => {
  if (result.stopped) return 'cancelled';
  if (result.progress?.activityState === 'needs_attention') return 'waiting';
  if (finished) return result.exitCode === 0 && !result.error ? 'completed' : 'failed';
  return 'running';
};
export class ForegroundSubagentAdapter {
  private known = new Map<string, Set<string>>();
  constructor(private readonly publish: (node: ExecutionNode, type: 'AgentStarted'|'AgentProgress'|'AgentCompleted'|'AgentFailed') => void) {}
  ingest(raw: Raw, parentToolId: string, toolCallId: string): void {
    if (raw.toolName !== 'subagent' || !['tool_execution_update','tool_execution_end'].includes(raw.type)) return;
    const finished = raw.type === 'tool_execution_end';
    const details = (finished ? raw.result : raw.partialResult)?.details;
    if (!details || typeof details.runId !== 'string' || !Array.isArray(details.results) || details.mode === 'management') return;
    const owner = `${toolCallId}:${details.runId}`;
    const known = this.known.get(owner) ?? new Set<string>();
    for (const result of details.results as Raw[]) {
      if (!Number.isSafeInteger(result.index) || typeof result.agent !== 'string') continue;
      const nativeId = `${details.runId}:${result.index}`;
      const id = `pi-subagent:${nativeId}`;
      const progress = result.progress ?? details.progress?.[result.index] ?? {};
      const status = statusOf({ ...result, progress }, finished);
      const node: ExecutionNode = { id, kind: 'agent', label: result.agent.slice(0,100), status, parentId: parentToolId,
        correlation: 'explicit', sourceKind: 'pi-subagents', nativeId, startedAt: !known.has(id) ? new Date().toISOString() : undefined, updatedAt: new Date().toISOString(), endedAt: finished ? new Date().toISOString() : undefined,
        action: typeof progress.currentTool === 'string' ? progress.currentTool.slice(0,100) : undefined,
        model: typeof result.model === 'string' ? result.model.slice(0,120) : undefined,
        details: { ...(typeof progress.toolCount === 'number' ? {toolCount:progress.toolCount} : {}),
          ...(typeof progress.turnCount === 'number' ? {turnCount:progress.turnCount} : {}),
          ...(typeof result.exitCode === 'number' ? {exitCode:result.exitCode} : {}) } };
      this.publish(node, finished ? status === 'completed' ? 'AgentCompleted' : 'AgentFailed' : !known.has(id) ? 'AgentStarted' : 'AgentProgress');
      known.add(id);
    }
    this.known.set(owner, known);
  }
}
