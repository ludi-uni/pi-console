export type ProcessState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
export type EventType = 'RunStarted' | 'RunCompleted' | 'RunFailed' | 'MessageStarted' | 'MessageDelta' | 'MessageCompleted' | 'ToolStarted' | 'ToolProgress' | 'ToolCompleted' | 'ToolFailed' | 'AgentSettled' | 'AgentStarted' | 'AgentProgress' | 'AgentCompleted' | 'AgentFailed' | 'ErrorEvent' | 'ExecutionNodeUpdated' | 'DecisionRequired' | 'DecisionResolved';
export type ExecutionNodeKind = 'run' | 'orchestrator' | 'task' | 'agent' | 'tool' | 'decision';
export type ExecutionStatus = 'queued' | 'running' | 'waiting' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';
export interface ExecutionNode { id: string; kind: ExecutionNodeKind; label: string; status: ExecutionStatus; parentId?: string; correlation: 'explicit' | 'derived-safe' | 'unknown'; sourceKind: 'pi' | 'pi-subagents' | 'orchestrator'; nativeId?: string; startedAt?: string; updatedAt: string; endedAt?: string; action?: string; attempt?: number; model?: string; provider?: string; dependencies?: string[]; blockedReason?: string; attempts?: { attempt: number; model?: string; failureClass?: string }[]; details?: Record<string, string | number | boolean | null> }
export interface ExecutionStateSnapshot { nodes: ExecutionNode[]; roots: string[]; unattached: string[]; rows: { node: ExecutionNode; depth: number; unattached: boolean }[]; activeCount: number; failedCount: number; decisionCount: number };
export interface ExecutionEvent {
  schemaVersion: 1; eventId: string; seq: number; timestamp: string;
  // Server-side run identity for this session's event stream. `seq` restarts at 0 on
  // every server boot, so clients must compare generation before trusting seq ordering.
  generation: string;
  workspaceId: string; sessionId: string; runId: string;
  type: EventType; entityId: string; parentId?: string; toolCallId?: string;
  source: 'pi-rpc' | 'console' | 'pi-subagents' | 'orchestrator'; sourceRef?: { kind: 'pi' | 'pi-subagents' | 'orchestrator'; nativeId?: string }; certainty: 'observed' | 'derived';
  status?: ExecutionStatus;
  payload: Record<string, unknown>;
}
export type PromptAttachment = { kind: 'text'; name: string; mimeType: string; text: string } | { kind: 'image'; name: string; mimeType: string; data: string };
// Display-only metadata parsed from the model-bound prompt text. `preview` carries
// small text attachments; large text and images stay metadata-only in chat.
export type ChatAttachment = { name: string; kind: 'text' | 'image'; mimeType: string; preview?: string; truncated?: boolean; bytes?: number };
export interface SessionOptions { models: { provider: string; id: string; name: string }[]; model?: { provider: string; id: string }; thinkingLevel: string; thinkingLevels: string[]; contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null } }
export interface ChatTool { id: string; name: string; command?: string; truncated?: boolean }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; thinking?: string; tools?: ChatTool[]; complete: boolean; attachments?: ChatAttachment[] }
export interface Workspace { id: string; name: string; path: string; pinned: boolean; lastOpenedAt: string; valid?: boolean }
export interface SessionInfo { id: string; workspaceId: string; filePath: string; name?: string; updatedAt?: string; running?: boolean; decisionCount?: number }
export interface ActiveSessionSummary { sessionId: string; workspaceId: string; sessionName: string; workspaceName: string; running: boolean; decisionCount: number; updatedAt: string; work: { id: string; label: string; status: ExecutionStatus; kind: ExecutionNodeKind; action?: string }[]; completion?: { id: string; status: 'completed' | 'failed' | 'cancelled' | 'interrupted'; at: string; scope: 'conversation' | 'subagent' | 'kit' } }
export interface Snapshot { session: SessionInfo; runtime: ProcessState; activeRunId?: string; chat: ChatMessage[]; events: ExecutionEvent[]; execution: ExecutionStateSnapshot; seq: number; generation: string }
