import { randomUUID } from 'node:crypto';
import type { ChatMessage, ExecutionEvent, EventType, SessionInfo, Snapshot, ProcessState, ExecutionNode } from '../../shared/types.ts';
import { ExecutionState } from './execution-state.ts';
import { ForegroundSubagentAdapter } from '../adapters/subagents/foreground.ts';

type Raw = Record<string, any>;
const text = (message: Raw): string => Array.isArray(message.content) ? message.content.filter((v: Raw) => v.type === 'text').map((v: Raw) => String(v.text ?? '')).join('') : typeof message.content === 'string' ? message.content : '';
const summary = (value: unknown): string => typeof value === 'string' ? value.slice(0, 400) : '';
export function previewToolInput(args: unknown): string {
  if(!args||typeof args!=='object'||Array.isArray(args))return '';
  const fields=args as Record<string,unknown>;
  for(const key of ['command','program','script','code','path','file']){
    const value=fields[key];
    if(typeof value!=='string'||!value.trim())continue;
    const line=value.replace(/[\x00-\x1f\x7f]+/g,' ').replace(/\s+/g,' ').trim();
    return line.length>160?`${line.slice(0,157)}…`:line;
  }
  return '';
}
export class SessionEvents {
  readonly chat: ChatMessage[] = [];
  readonly events: ExecutionEvent[] = [];
  seq = 0;
  activeRunId?: string;
  private pendingRunId?: string;
  get busy() { return !!this.activeRunId || !!this.pendingRunId; }
  private currentMessage?: ChatMessage;
  private messageBlocks = new Map<number, string>();
  private failure?: string;
  private stopped = false;
  private listeners = new Set<(e: ExecutionEvent) => void>();
  readonly execution = new ExecutionState();
  private readonly subagents = new ForegroundSubagentAdapter((node,type) => this.publishNode(node,type));
  constructor(readonly session: SessionInfo, private readonly runtime: () => ProcessState) {}
  publishNode(node: ExecutionNode, type: EventType = 'ExecutionNodeUpdated') {
    this.emit(type,node.id,{node},{source:node.sourceKind === 'pi-subagents'?'pi-subagents':'orchestrator', sourceRef:{kind:node.sourceKind,nativeId:node.nativeId},parentId:node.parentId,status:node.status,certainty:node.correlation==='unknown'?'derived':'observed'});
  }
  subscribe(fn: (e: ExecutionEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  snapshot(): Snapshot { return { session: this.session, runtime: this.runtime(), activeRunId: this.activeRunId, chat: this.chat.map(m => ({...m})), events: [...this.events], execution: this.execution.snapshot(), seq: this.seq }; }
  load(messages: Raw[]) {
    this.chat.length = 0;
    for (const message of messages) if (message.role === 'user' || message.role === 'assistant') {
      const content = text(message);
      if (content) this.chat.push({ id: randomUUID(), role: message.role, text: content, complete: true });
    }
  }
  private emit(type: EventType, entityId: string, payload: Record<string, unknown> = {}, options: Partial<ExecutionEvent> = {}) {
    const event: ExecutionEvent = { schemaVersion: 1, eventId: randomUUID(), seq: ++this.seq, timestamp: new Date().toISOString(),
      workspaceId: this.session.workspaceId, sessionId: this.session.id,
      runId: this.activeRunId ?? this.pendingRunId ?? 'unattributed', type, entityId, source: 'pi-rpc', sourceRef:{kind:'pi',nativeId:options.toolCallId}, certainty: 'observed', payload, ...options };
    this.execution.apply(event);
    this.events.push(event); if (this.events.length > 5000) this.events.shift();
    for (const listener of this.listeners) listener(event);
  }
  preparePrompt(message?: string): string {
    if (this.activeRunId || this.pendingRunId) throw new Error('session already has an active run');
    this.pendingRunId = randomUUID(); this.failure = undefined; this.stopped = false;
    if (message) this.chat.push({ id: randomUUID(), role: 'user', text: message, complete: true });
    return this.pendingRunId;
  }
  accepted(): void { if (this.pendingRunId) this.begin(); }
  rejected(reason: string): void {
    if (!this.pendingRunId) return;
    this.emit('ErrorEvent', this.pendingRunId, { summary: reason }, { source: 'console', status: 'failed' });
    this.pendingRunId = undefined;
  }
  private begin() {
    if (!this.pendingRunId) return;
    this.activeRunId = this.pendingRunId; this.pendingRunId = undefined;
    this.emit('RunStarted', this.activeRunId, {}, { status: 'running', certainty: 'derived', source: 'console' });
  }
  markStop() { this.stopped = true; }
  interrupted(reason: string) {
    if (this.pendingRunId) this.begin();
    if (this.activeRunId) this.end('interrupted', reason);
    else this.emit('ErrorEvent', 'runtime', { summary: reason }, { source: 'console', status: 'failed' });
  }
  private end(status: 'completed' | 'failed' | 'cancelled' | 'interrupted', reason?: string) {
    if (!this.activeRunId) return;
    const id = this.activeRunId;
    this.emit(status === 'completed' ? 'RunCompleted' : 'RunFailed', id, { summary: reason ?? status }, { status, certainty: 'derived', source: 'console' });
    this.activeRunId = undefined; this.currentMessage = undefined; this.messageBlocks.clear();
  }
  ingest(raw: Raw): void {
    if (raw.type === 'console_dialog_cancelled') { this.emit('ErrorEvent', 'extension-ui', { summary: `Unsupported ${raw.method} dialog cancelled` }, { source: 'console' }); return; }
    if (raw.type === 'extension_error') { this.emit('ErrorEvent', 'extension', { summary: summary(raw.error) }); return; }
    if (raw.type === 'response') { if (raw.success === false) this.emit('ErrorEvent', 'rpc', { summary: summary(raw.error) }, { status: 'failed' }); return; }
    if (raw.type === 'agent_start') this.begin();
    if (raw.type === 'agent_settled') {
      if (this.pendingRunId) this.begin();
      if (this.activeRunId) {
        this.emit('AgentSettled', this.activeRunId, {}, { status: 'completed' });
        this.end(this.stopped ? 'cancelled' : this.failure ? 'failed' : 'completed', this.failure);
      }
      return;
    }
    if (!this.activeRunId) return;
    if (raw.type === 'message_start' && raw.message?.role === 'assistant') {
      this.currentMessage = { id: randomUUID(), role: 'assistant', text: '', complete: false };
      this.messageBlocks.clear(); this.chat.push(this.currentMessage);
      this.emit('MessageStarted', this.currentMessage.id, { role: 'assistant' }, { parentId: this.activeRunId });
    }
    if (raw.type === 'message_update' && this.currentMessage) {
      const ev = raw.assistantMessageEvent;
      if (ev?.type === 'text_delta' && typeof ev.delta === 'string') {
        const index = Number(ev.contentIndex ?? 0);
        this.messageBlocks.set(index, (this.messageBlocks.get(index) ?? '') + ev.delta);
        this.currentMessage.text = [...this.messageBlocks.entries()].sort((a,b) => a[0]-b[0]).map(([,v]) => v).join('');
        this.emit('MessageDelta', this.currentMessage.id, { delta: ev.delta, contentIndex: index }, { parentId: this.activeRunId });
      }
      if (ev?.type === 'text_end' && typeof ev.content === 'string') {
        this.messageBlocks.set(Number(ev.contentIndex ?? 0), ev.content);
        this.currentMessage.text = [...this.messageBlocks.entries()].sort((a,b) => a[0]-b[0]).map(([,v]) => v).join('');
      }
    }
    if (raw.type === 'message_end' && raw.message?.role === 'assistant') {
      if (!this.currentMessage) { this.currentMessage = { id: randomUUID(), role: 'assistant', text: '', complete: false }; this.chat.push(this.currentMessage); this.emit('MessageStarted', this.currentMessage.id, { role: 'assistant' }); }
      this.currentMessage.text = text(raw.message); this.currentMessage.complete = true;
      this.emit('MessageCompleted', this.currentMessage.id, { text: this.currentMessage.text, stopReason: raw.message.stopReason }, { parentId: this.activeRunId, status: raw.message.stopReason === 'error' ? 'failed' : 'completed' });
      if (raw.message.stopReason === 'error' || raw.message.stopReason === 'aborted') this.failure = raw.message.errorMessage ?? raw.message.stopReason;
      this.currentMessage = undefined;
    }
    if (raw.type === 'tool_execution_start' || raw.type === 'tool_execution_update' || raw.type === 'tool_execution_end') {
      const id = String(raw.toolCallId ?? 'unknown'); const entityId = `pi-tool:${this.activeRunId}:${id}`;
      const common = { toolCallId: id, toolName: String(raw.toolName ?? 'unknown') };
      if (raw.type === 'tool_execution_start') this.emit('ToolStarted', entityId, { ...common, summary: 'Tool started', commandPreview: previewToolInput(raw.args), argumentKeys: Object.keys(raw.args ?? {}) }, { parentId: this.activeRunId, toolCallId: id, status: 'running' });
      if (raw.type === 'tool_execution_update') this.emit('ToolProgress', entityId, { ...common, summary: 'Tool output updated', contentBlocks: raw.partialResult?.content?.length ?? 0 }, { parentId: this.activeRunId, toolCallId: id, status: 'running' });
      if (raw.type === 'tool_execution_end') this.emit(raw.isError ? 'ToolFailed' : 'ToolCompleted', entityId, { ...common, summary: raw.isError ? 'Tool failed' : 'Tool completed', contentBlocks: raw.result?.content?.length ?? 0 }, { parentId: this.activeRunId, toolCallId: id, status: raw.isError ? 'failed' : 'completed' });
      this.subagents.ingest(raw,entityId,id);
    }
    if (raw.type === 'auto_retry_end') this.failure = raw.success ? undefined : String(raw.finalError ?? 'retry exhausted');
    if (raw.type === 'compaction_end' && raw.errorMessage && !raw.willRetry) this.failure = String(raw.errorMessage);
  }
}
