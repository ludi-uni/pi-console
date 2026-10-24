import type { ExecutionEvent, ExecutionNode } from './types.ts';

export type ResultFeature = 'history' | 'aggregate' | 'artifacts' | 'metadata' | 'final_answer';
export interface ResultTarget {
  instance: string; revision: number; workspaceId: string; sessionId: string; generation: string; runId: string;
}
/** Additional content disclosure permission, never implied by existing status/read/control scope. */
export interface ResultGrant { target: ResultTarget; features: ResultFeature[]; expiresAt: number }
export type CoverageKind = 'pi' | 'subagents' | 'orchestrator' | 'queue' | 'background';
export interface ResultProjection {
  generation: string; seq: number; observedAt: number; live: boolean; truncated: boolean;
  coverage: Record<CoverageKind, 'complete' | 'incomplete' | 'unknown'>;
  nodes: Pick<ExecutionNode, 'id' | 'parentId' | 'kind' | 'status' | 'sourceKind' | 'correlation' | 'model' | 'provider'>[];
  events: ExecutionEvent[];
  messageRoles?: Record<string, 'user' | 'assistant'>;
  historyState: 'available' | 'saving' | 'expired' | 'unknown';
  metadata: { sessionName: string | null; savedModel: { provider: string; model: string } | null };
}
export interface ResultRuntime {
  readOnlyResultProjection(workspaceId: string, sessionId: string): ResultProjection | undefined;
  readOnlyFinalAnswer?(workspaceId:string,sessionId:string,generation:string,runId:string): Promise<import('../server/runtime/final-answer-journal.ts').SavedFinalAnswer | undefined>;
  workspaces: { get(id: string): { id: string; name: string; path: string } };
}
export const resultFeatures: readonly ResultFeature[] = ['history','aggregate','artifacts','metadata','final_answer'];
export const resultTargetKeys = ['instance','revision','workspaceId','sessionId','generation','runId'] as const;
