import { randomUUID } from 'node:crypto';
import type { ChatMessage, ChatTool, ExecutionEvent, EventType, SessionInfo, Snapshot, ProcessState, ExecutionNode, QueuedItem, StoredQueueItem, PromptAttachment } from '../../shared/types.ts';
import { prepareAttachments } from './attachments.ts';
import { QueueStore } from './queue-store.ts';
import { ExecutionState } from './execution-state.ts';
import { splitPromptAttachments } from '../../shared/attachments.ts';
import { ForegroundSubagentAdapter } from '../adapters/subagents/foreground.ts';
import { AsyncSubagentAdapter } from '../adapters/subagents/async-widget.ts';

type Raw = Record<string, any>;
const text = (message: Raw): string => Array.isArray(message.content) ? message.content.filter((v: Raw) => v.type === 'text').map((v: Raw) => String(v.text ?? '')).join('') : typeof message.content === 'string' ? message.content : '';
const summary = (value: unknown): string => typeof value === 'string' ? value.slice(0, 400) : '';
function toolInfo(value: Raw): ChatTool {
  const args = value.arguments ?? value.args;
  const key = args && typeof args === 'object' && !Array.isArray(args) ? ['command','program','script','code','path','file'].find(k => typeof args[k] === 'string') : undefined;
  const command = key ? String(args[key]) : undefined;
  return { id: String(value.id ?? ''), name: String(value.name ?? value.toolName ?? 'tool').slice(0,100), ...(command !== undefined ? {command:command.slice(0,4000),truncated:command.length>4000} : {}) };
}
export function assistantContent(message: Raw): Pick<ChatMessage,'text'|'thinking'|'tools'> {
  const blocks = Array.isArray(message.content) ? message.content : [];
  const thinking = blocks.filter((block:Raw)=>block.type==='thinking'&&typeof block.thinking==='string').map((block:Raw)=>block.thinking).join('\n').slice(0,16000);
  const tools = blocks.filter((block:Raw)=>block.type==='toolCall').slice(0,64).map(toolInfo);
  return { text:text(message), ...(thinking?{thinking}:{}), ...(tools.length?{tools}:{}) };
}
// Chat keeps the user's own text separate from attachment payloads. The full raw
// message (wrappers included) is what Pi receives; only the display projection is
// split here so resumed history matches the live echo exactly.
function userContent(value: string): Pick<ChatMessage, 'text' | 'attachments'> {
  const split = splitPromptAttachments(value);
  return { text: split.text, ...(split.attachments.length ? { attachments: split.attachments } : {}) };
}
// Claimed head item handed to the manager's drain loop; `prepared` is deferred to
// dispatch so edits to raw text + attachments are what Pi actually receives.
export type QueuedDispatch = { id: string; revision: number; text: string; attachments: PromptAttachment[] };
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
  // Unique per server process + session projection; seq alone resets across restarts, so
  // consumers key the event stream on (generation, seq) to reject stale late events.
  readonly generation = randomUUID();
  activeRunId?: string;
  private pendingRunId?: string;
  get busy() { return !!this.activeRunId || !!this.pendingRunId; }
  private currentMessage?: ChatMessage;
  private awaitingPromptEcho = false;
  private queuedPrompts: { id: string; message: string; parentId?: string }[] = [];
  // Console-owned pre-dispatch queue for "Queue after run" items. Entries keep their
  // prepared (wrapper-bearing) message and image payloads server-side; snapshots and
  // QueueChanged events expose display metadata only — never image bytes.
  private queue: StoredQueueItem[] = [];
  private dispatchingQueue = false;
  // Once an item is held (uncertain delivery, stop, restart) or fails, the queue pauses:
  // nothing else dispatches until an explicit Resume queued action. This is what makes
  // "never double-send" enforceable across restarts.
  private queueHeld = false;
  private queueRequest?: () => void;
  private publishedSteerQueued = false;
  private queueStore?: QueueStore;
  // Every mutation is persisted before it is acknowledged or dispatched. Saves are
  // serialized per session over an immutable snapshot so a slow write can never
  // reorder a newer queue behind a stale one.
  private queueWrite: Promise<void> = Promise.resolve();
  private queueMutation: Promise<void> = Promise.resolve();
  private mutateQueue<T>(change: () => Promise<T>): Promise<T> {
    const result = this.queueMutation.then(change);
    this.queueMutation = result.then(() => {}, () => {});
    return result;
  }
  resumeQueue() { return this.mutateQueue(() => this.commitResumeQueue()); }
  enqueueFollowUp(text: unknown, attachments: unknown) { return this.mutateQueue(() => this.commitEnqueueFollowUp(text, attachments)); }
  editQueueItem(id: string, revision: unknown, text: unknown) { return this.mutateQueue(() => this.commitEditQueueItem(id, revision, text)); }
  removeQueueItem(id: string) { return this.mutateQueue(() => this.commitRemoveQueueItem(id)); }
  beginQueueDispatch() { return this.mutateQueue(() => this.commitBeginQueueDispatch()); }
  finishQueueDispatch(id: string, completed: boolean, error?: string) { return this.mutateQueue(() => this.commitFinishQueueDispatch(id, completed, error)); }
  private queueDrained?: () => void;
  private queueWakePending = false;
  private queueDrainCancelled = false;
  setQueueStore(store: QueueStore | undefined) { this.queueStore = store; }
  // Serialized, latest-wins persistence: the queued write snapshots the CURRENT
  // queue at run time (inside .then), so N concurrent mutations produce N ordered
  // writes and the last one reflects the final in-memory state — never a stale order.
  private persistQueue(): Promise<void> {
    if (!this.queueStore) return Promise.resolve();
    const write = this.queueWrite.then(() => this.queueStore!.save(this.session.id,
      this.queue.map(item => ({ ...item, attachments: item.attachments.map(a => ({ ...a })) })), this.queueHeld));
    this.queueWrite = write.then(() => {}, () => {});
    return write;
  }
  private messageBlocks = new Map<number, string>();
  private thinkingBlocks = new Map<number, string>();
  private failure?: string;
  private stopped = false;
  private listeners = new Set<(e: ExecutionEvent) => void>();
  readonly execution = new ExecutionState();
  private readonly subagents = new ForegroundSubagentAdapter((node,type) => this.publishNode(node,type));
  private readonly asyncSubagents = new AsyncSubagentAdapter(node => this.publishNode(node));
  constructor(readonly session: SessionInfo, private readonly runtime: () => ProcessState) {}
  publishNode(node: ExecutionNode, type: EventType = 'ExecutionNodeUpdated') {
    this.emit(type,node.id,{node},{source:node.sourceKind === 'pi-subagents'?'pi-subagents':'orchestrator', sourceRef:{kind:node.sourceKind,nativeId:node.nativeId},parentId:node.parentId,status:node.status,certainty:node.correlation==='unknown'?'derived':'observed'});
  }
  subscribe(fn: (e: ExecutionEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  snapshot(): Snapshot { return { session: this.session, runtime: this.runtime(), activeRunId: this.activeRunId, chat: this.chat.map(m => ({...m})), events: [...this.events], execution: this.execution.snapshot(), queue: this.queueSnapshot(), queueHeld: this.queueHeld, seq: this.seq, generation: this.generation }; }
  private toQueuedItem(item: StoredQueueItem): QueuedItem {
    const split = splitPromptAttachments(this.preparedText(item));
    return { id: item.id, message: split.text, revision: item.revision, ...(split.attachments.length ? { attachments: split.attachments } : {}), queuedAt: item.queuedAt, status: item.status, ...(item.error ? { error: item.error } : {}) };
  }
  private preparedText(item: StoredQueueItem) { return prepareAttachments(item.text, item.attachments).message; }
  private queueSnapshot(): QueuedItem[] { return this.queue.map(item => this.toQueuedItem(item)); }
  // QueueChanged carries the same metadata-only projection as Snapshot.queue.
  private queueChanged() { this.emit('QueueChanged', 'queue', { queue: this.queueSnapshot(), queueHeld: this.queueHeld, steerQueued: this.publishedSteerQueued && this.queuedPrompts.length > 0 }, { source: 'console' }); }
  private queueNodeId(id: string) { return `console-queue:${id}`; }
  private queueNode(item: StoredQueueItem) {
    const status = item.status === 'pending' ? 'queued' : item.status === 'dispatching' ? 'waiting' : item.status === 'held' ? 'blocked' : 'failed';
    const suffix = item.status === 'dispatching' ? ' · sending to Pi' : item.status === 'held' ? ` · held${item.error ? `: ${item.error}` : ''}` : item.status === 'failed' ? ` · ${item.error ?? 'failed'}` : '';
    this.emit('ExecutionNodeUpdated', this.queueNodeId(item.id), { node: { id: this.queueNodeId(item.id), kind: 'task', label: `Queued: ${item.text.slice(0, 80)}${suffix}`, status, correlation: 'explicit', sourceKind: 'pi', parentId: this.activeRunId, updatedAt: new Date().toISOString() } }, { status, parentId: this.activeRunId });
  }
  // Restore the durable queue after a worker restart/open. EVERYTHING is demoted to
  // held and the queue is paused: 'dispatching' items may already have reached Pi and
  // plain 'pending' items could drain before the operator notices them. Nothing
  // auto-sends; an explicit Resume queued action is required. The demotion is
  // persisted so a second restart keeps the pause.
  async loadQueue(file: { held: boolean; items: StoredQueueItem[] }) {
    if (!file.items.length && !file.held) return;
    this.queue = file.items.map(item => item.status === 'pending'
      ? { ...item, status: 'held' as const, error: item.error ?? 'restored after restart; resume the queue to send' }
      : item.status === 'dispatching'
        ? { ...item, status: 'held' as const, error: item.error ?? 'dispatch interrupted by a server restart; delivery to Pi is unconfirmed' }
        : { ...item });
    this.queueHeld = true;
    for (const item of this.queue) this.queueNode(item);
    this.queueChanged();
    if (this.queueStore) await this.persistQueue();
  }
  hasPendingQueue() { return this.queue.length > 0; }
  isQueueDispatching() { return this.dispatchingQueue; }
  // Explicit operator action: held/failed items become pending again and the queue
  // resumes FIFO dispatch while the session is idle.
  private async commitResumeQueue() {
    if (!this.queueHeld && !this.queue.some(item => item.status === 'held' || item.status === 'failed')) return;
    const touched = this.queue.filter(item => item.status === 'held' || item.status === 'failed');
    this.queueHeld = false;
    for (const item of touched) { item.status = 'pending'; item.error = undefined; }
    if (this.queueStore) try { await this.persistQueue(); }
    catch (error) { for (const item of touched) item.status = 'held'; this.queueHeld = true; throw error; }
    for (const item of touched) this.queueNode(item);
    this.queueChanged(); this.maybeDrainQueue();
  }
  private statusError(code: number, message: string): Error { const e = new Error(message); (e as Error & { status?: number }).status = code; return e; }
  private async commitEnqueueFollowUp(text: unknown, attachments: unknown): Promise<QueuedItem> {
    prepareAttachments(text, attachments); // validate + enforce attachment limits before acknowledging
    const item: StoredQueueItem = { id: randomUUID(), text: text as string, attachments: Array.isArray(attachments) ? attachments as PromptAttachment[] : [], queuedAt: new Date().toISOString(), revision: 0, status: 'pending' };
    this.queueStore?.assertFits(this.queue, item);
    this.queue.push(item);
    // Persist BEFORE acknowledging: a queue that cannot be written must not confirm
    // the user's prompt as queued.
    if (this.queueStore) try { await this.persistQueue(); } catch (error) { this.queue.splice(this.queue.indexOf(item), 1); throw error; }
    this.queueNode(item); this.queueChanged(); this.maybeDrainQueue();
    return this.toQueuedItem(item);
  }

  private async commitEditQueueItem(id: string, expectedRevision: unknown, text: unknown): Promise<QueuedItem> {
    if (typeof id !== 'string' || typeof text !== 'string' || !text.trim() || text.length > 200_000) throw new Error('invalid queued message');
    if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)) throw new Error('revision is required');
    const item = this.queue.find(entry => entry.id === id);
    if (!item) throw this.statusError(404, 'queued item no longer exists');
    if (item.status !== 'pending') throw this.statusError(409, item.status === 'dispatching' ? 'queued item is already being sent to Pi' : 'queued item is held or failed; resume the queue to edit it');
    if (item.revision !== expectedRevision) throw this.statusError(409, 'queued item changed since it was loaded; reload and retry');
    // Text-only edit: original attachments are kept and wrappers/images are
    // regenerated via prepareAttachments at dispatch — no stale marker splicing.
    const next = { ...item, text, revision: item.revision + 1 };
    this.queueStore?.assertFits(this.queue, next, item.id);
    const previous = { text: item.text, revision: item.revision };
    Object.assign(item, next);
    // Acknowledge the edit only after it is durable; a failed write reverts in-memory.
    if (this.queueStore) try { await this.persistQueue(); } catch (error) { Object.assign(item, previous); throw error; }
    this.queueNode(item); this.queueChanged();
    return this.toQueuedItem(item);
  }
  private async commitRemoveQueueItem(id: string): Promise<void> {
    const index = this.queue.findIndex(entry => entry.id === id);
    if (index < 0) throw this.statusError(404, 'queued item no longer exists');
    const item = this.queue[index];
    // Pending, held and failed items may be discarded; a claimed dispatch cannot.
    if (item.status === 'dispatching') throw this.statusError(409, 'queued item is already being sent to Pi');
    this.queue.splice(index, 1);
    // Persist the post-mutation list: the serialized write reads the CURRENT queue at
    // run time, so two concurrent removes can never rewrite a stale snapshot.
    try { await this.persistQueue(); }
    catch (error) { this.queue.splice(index, 0, item); throw error; }
    this.emit('ExecutionNodeUpdated', this.queueNodeId(id), { node: { id: this.queueNodeId(id), kind: 'task', label: `Queued: ${item.text.slice(0, 80)}`, status: 'cancelled', correlation: 'explicit', sourceKind: 'pi', updatedAt: new Date().toISOString() } }, { status: 'cancelled' });
    this.queueChanged();
  }

  // CAS handoff for the manager's drain loop: the claim is marked synchronously before
  // any await, then the 'dispatching' state is persisted BEFORE the prompt RPC runs —
  // a crash between persist and send restores a held item instead of a lost one.
  private async commitBeginQueueDispatch(): Promise<QueuedDispatch | undefined> {
    if (this.busy || this.dispatchingQueue || this.queueHeld || this.queueDrainCancelled) return undefined;
    const item = this.queue.find(entry => entry.status === 'pending');
    if (!item) return undefined;
    item.status = 'dispatching'; this.dispatchingQueue = true;
    this.queueNode(item); this.queueChanged();
    try { if (this.queueStore) await this.persistQueue(); }
    catch (error) {
      // The claim could not be made durable: unclaim and pause rather than risk a
      // restart silently resending an acknowledged prompt.
      item.status = 'pending'; this.dispatchingQueue = false; this.queueHeld = true;
      item.error = undefined; this.queueNode(item); this.queueChanged();
      throw error;
    }
    return { id: item.id, revision: item.revision, text: item.text, attachments: item.attachments };
  }
  // called when the claimed item's run finished.
  private async commitFinishQueueDispatch(id: string, completed: boolean, error?: string): Promise<void> {
    const index = this.queue.findIndex(entry => entry.id === id);
    this.dispatchingQueue = false;
    if (index < 0) { this.maybeDrainQueue(); return; }
    const item = this.queue[index];
    // Stop/worker interruption already finalized this claim as held. A late RPC
    // result must not delete that item or overwrite its recovery reason.
    if (item.status !== 'dispatching') { this.maybeDrainQueue(); return; }
    if (completed) {
      this.queue.splice(index, 1);
      this.emit('ExecutionNodeUpdated', this.queueNodeId(id), { node: { id: this.queueNodeId(id), kind: 'task', label: `Queued: ${item.text.slice(0, 80)}`, status: 'completed', correlation: 'explicit', sourceKind: 'pi', updatedAt: new Date().toISOString() } }, { status: 'completed' });
    } else {
      // Uncertain or failed delivery: hold the item and pause the whole queue — the
      // operator decides whether re-sending is safe. No automatic resend.
      item.status = 'held'; item.error = (error ?? 'delivery outcome was not confirmed').slice(0, 400);
      this.queueHeld = true;
      this.queueNode(item);
    }
    try { await this.persistQueue(); }
    catch (saveError) {
      if (!this.queue.includes(item)) this.queue.splice(index, 0, item);
      item.status = 'held'; item.error = 'queue completion could not be saved; inspect the session before resuming';
      this.queueHeld = true; this.queueNode(item); this.queueChanged();
      throw saveError;
    }
    this.queueChanged();
    this.maybeDrainQueue();
  }
  waitQueueDrain(): Promise<void> {
    if (this.queueWakePending || this.queueDrainCancelled) { this.queueWakePending = false; return Promise.resolve(); }
    return new Promise(resolve => { this.queueRequest = resolve; this.queueDrained = resolve; });
  }
  // Bound the drain loop to this projection's lifetime: worker close/unload resolves
  // the waiter so no immortal loop outlives a closed session.
  cancelQueueDrain() { this.queueDrainCancelled = true; this.queueHeld = true; this.maybeDrainQueue(); }
  // Public wake-up for state changes outside this class (e.g. a kit job finishing).
  wakeQueueDrain() { this.maybeDrainQueue(); }
  private maybeDrainQueue() { const notify = this.queueRequest; this.queueRequest = undefined; this.queueDrained = undefined; if (notify) notify(); else this.queueWakePending = true; }
  load(messages: Raw[]) {
    this.chat.length = 0;
    for (const message of messages) if (message.role === 'user' || message.role === 'assistant') {
      const content = message.role === 'assistant' ? assistantContent(message) : userContent(text(message));
      if (content.text || 'attachments' in content || message.role === 'assistant' && ('thinking' in content || 'tools' in content)) this.chat.push({ id: randomUUID(), role: message.role, ...content, complete: true });
    }
    // A live assistant message can be streaming while the snapshot is applied: keep its
    // in-flight bubble so the eventual message_end completes a visible message instead of
    // updating an orphaned object dropped from chat.
    if (this.currentMessage && !this.chat.includes(this.currentMessage)) this.chat.push(this.currentMessage);
  }
  private emit(type: EventType, entityId: string, payload: Record<string, unknown> = {}, options: Partial<ExecutionEvent> = {}) {
    const event: ExecutionEvent = { schemaVersion: 1, eventId: randomUUID(), seq: ++this.seq, generation: this.generation, timestamp: new Date().toISOString(),
      workspaceId: this.session.workspaceId, sessionId: this.session.id,
      runId: this.activeRunId ?? this.pendingRunId ?? 'unattributed', type, entityId, source: 'pi-rpc', sourceRef:{kind:'pi',nativeId:options.toolCallId}, certainty: 'observed', payload, ...options };
    this.execution.apply(event);
    this.events.push(event); if (this.events.length > 5000) this.events.shift();
    for (const listener of this.listeners) listener(event);
  }
  preparePrompt(message?: string): string {
    if (this.activeRunId || this.pendingRunId) throw new Error('session already has an active run');
    this.pendingRunId = randomUUID(); this.failure = undefined; this.stopped = false;
    if (message) { this.chat.push({ id: randomUUID(), role: 'user', ...userContent(message), complete: true }); this.awaitingPromptEcho = true; }
    return this.pendingRunId;
  }
  accepted(): void { if (this.pendingRunId) this.begin(); }
  // A steer/follow-up accepted by Pi is queued inside Pi, not yet part of the delivered
  // conversation. Do NOT push it into `chat` — that would show a complete sent user bubble
  // before Pi delivers the message. Instead surface it only as a queued execution node so
  // the user can see it is pending; Pi will emit the real user message when it is delivered.
  queuePrompt(message: string, kind: 'steer' | 'followUp' = 'steer'): void {
    const id = `pi-queued:${this.activeRunId ?? 'pending'}:${randomUUID()}`;
    const parentId = this.activeRunId;
    this.queuedPrompts.push({ id, message, parentId });
    // Steer is handed to Pi immediately and cannot be recalled or edited — label it
    // honestly. Console follow-ups live in the editable pre-dispatch queue instead.
    const label = kind === 'steer' ? `Steered (immediate, not editable): ${message.slice(0, 80)}` : `Queued: ${message.slice(0, 80)}`;
    this.emit('ExecutionNodeUpdated', id, { node: { id, kind: 'task', label, status: 'queued', correlation: 'derived-safe', sourceKind: 'pi', parentId, updatedAt: new Date().toISOString() } }, { status: 'queued', parentId });
    if (kind === 'steer' && !this.publishedSteerQueued) { this.publishedSteerQueued = true; this.queueChanged(); }
  }
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
  // Pause the queue durably BEFORE the caller's awaited abort/clear_queue: a settle
  // arriving between them must never drain pending items.
  async pauseQueue() { this.queueHeld = true; this.queueChanged(); try { await this.persistQueue(); } catch { /* pause state best-effort durable; in-memory still held */ } }
  private clearPiQueueTracking() {
    // stop()/abort clears Pi's steering+follow-up queues; forget them so a later
    // identical user message isn't matched against dead entries and their nodes
    // don't sit at 'queued' forever.
    for (const item of this.queuedPrompts) this.emit('ExecutionNodeUpdated', item.id, { node: { id: item.id, kind: 'task', label: `Cancelled queued prompt: ${item.message.slice(0, 80)}`, status: 'cancelled', correlation: 'derived-safe', sourceKind: 'pi', parentId: item.parentId, updatedAt: new Date().toISOString() } }, { status: 'cancelled', parentId: item.parentId });
    const had = this.queuedPrompts.length > 0;
    this.queuedPrompts = [];
    if (this.publishedSteerQueued || had) { this.publishedSteerQueued = false; this.queueChanged(); }
  }
  markStop() { this.stopped = true; this.queueHeld = true; this.clearPiQueueTracking(); if (this.queue.length) this.queueChanged(); }
  interrupted(reason: string) {
    // A stopped/crashed run pauses the pending queue: nothing else dispatches until
    // the operator explicitly resumes, so an abort settle can never surprise-send.
    // An item claimed when the worker died is uncertain → held, not retried.
    this.queueHeld = true;
    if (this.dispatchingQueue) {
      this.dispatchingQueue = false;
      for (const item of this.queue) if (item.status === 'dispatching') { item.status = 'held'; item.error = item.error ?? 'worker interrupted during dispatch; delivery to Pi is unconfirmed'; this.queueNode(item); }
    }
    this.clearPiQueueTracking();
    if (this.pendingRunId) this.begin();
    if (this.activeRunId) this.end('interrupted', reason);
    else this.emit('ErrorEvent', 'runtime', { summary: reason }, { source: 'console', status: 'failed' });
    if (this.queue.length) { this.queueChanged(); void this.persistQueue().catch(() => {}); }
  }
  private end(status: 'completed' | 'failed' | 'cancelled' | 'interrupted', reason?: string) {
    if (!this.activeRunId) return;
    const id = this.activeRunId;
    this.emit(status === 'completed' ? 'RunCompleted' : 'RunFailed', id, { summary: reason ?? status }, { status, certainty: 'derived', source: 'console' });
    this.activeRunId = undefined; this.currentMessage = undefined; this.messageBlocks.clear(); this.thinkingBlocks.clear();
    this.maybeDrainQueue();
  }
  ingest(raw: Raw): void {
    this.asyncSubagents.ingest(raw);
    if (raw.type === 'console_dialog_cancelled') { this.emit('ErrorEvent', 'extension-ui', { summary: `Unsupported ${raw.method} dialog cancelled` }, { source: 'console' }); return; }
    if (raw.type === 'extension_error') { this.emit('ErrorEvent', 'extension', { summary: summary(raw.error) }); return; }
    if (raw.type === 'response') { if (raw.success === false) this.emit('ErrorEvent', 'rpc', { summary: summary(raw.error) }, { status: 'failed' }); return; }
    if (raw.type === 'agent_start') {
      // An extension may resume Pi after a detached child finishes, without an HTTP prompt.
      if (!this.activeRunId && !this.pendingRunId) { this.pendingRunId = randomUUID(); this.failure = undefined; this.stopped = false; }
      this.begin();
    }
    if (raw.type === 'agent_settled') {
      if (this.pendingRunId) this.begin();
      if (this.activeRunId) {
        this.emit('AgentSettled', this.activeRunId, {}, { status: 'completed' });
        this.end(this.stopped ? 'cancelled' : this.failure ? 'failed' : 'completed', this.failure);
      }
      return;
    }
    if (!this.activeRunId) return;
    // A queued steer/follow-up is delivered by Pi as a user message when it actually runs.
    // Render it on delivery (message_end) rather than when the console queued it, so Chat does
    // not show it prematurely.
    if (raw.type === 'message_end' && raw.message?.role === 'user') {
      const body = text(raw.message);
      // The user message that opened this run was already added by preparePrompt; only a
      // queued steer/follow-up delivered mid-run needs to appear now (it was withheld at queue time).
      if (body && !this.awaitingPromptEcho) {
        const index = this.queuedPrompts.findIndex(item => item.message === body);
        if (index >= 0) {
          const queued = this.queuedPrompts.splice(index, 1)[0];
          this.emit('ExecutionNodeUpdated', queued.id, { node: { id: queued.id, kind: 'task', label: `Queued: ${body.slice(0, 80)}`, status: 'completed', correlation: 'derived-safe', sourceKind: 'pi', parentId: queued.parentId, updatedAt: new Date().toISOString() } }, { status: 'completed', parentId: queued.parentId });
          if (!this.queuedPrompts.length && this.publishedSteerQueued) { this.publishedSteerQueued = false; this.queueChanged(); }
        }
        this.chat.push({ id: randomUUID(), role: 'user', ...userContent(body), complete: true });
        const user = userContent(body);
        this.emit('MessageCompleted', `pi-user:${this.activeRunId}:${randomUUID()}`, { text: user.text, attachments: user.attachments, role: 'user' }, { parentId: this.activeRunId, status: 'completed' });
      }
      this.awaitingPromptEcho = false;
    }
    if (raw.type === 'message_start' && raw.message?.role === 'assistant') {
      this.currentMessage = { id: randomUUID(), role: 'assistant', text: '', complete: false };
      this.messageBlocks.clear(); this.thinkingBlocks.clear(); this.chat.push(this.currentMessage);
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
      if (ev?.type === 'thinking_delta' && typeof ev.delta === 'string') {
        const index = Number(ev.contentIndex ?? 0);
        this.thinkingBlocks.set(index, (this.thinkingBlocks.get(index) ?? '') + ev.delta);
        this.currentMessage.thinking = [...this.thinkingBlocks.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v).join('\n').slice(0,16000);
        this.emit('MessageDelta', this.currentMessage.id, { delta: ev.delta, channel: 'thinking' }, { parentId: this.activeRunId });
      }
      if (ev?.type === 'thinking_end' && typeof ev.content === 'string') {
        this.thinkingBlocks.set(Number(ev.contentIndex ?? 0), ev.content);
        this.currentMessage.thinking = [...this.thinkingBlocks.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v).join('\n').slice(0,16000);
      }
      if (ev?.type === 'text_end' && typeof ev.content === 'string') {
        this.messageBlocks.set(Number(ev.contentIndex ?? 0), ev.content);
        this.currentMessage.text = [...this.messageBlocks.entries()].sort((a,b) => a[0]-b[0]).map(([,v]) => v).join('');
      }
    }
    if (raw.type === 'message_end' && raw.message?.role === 'assistant') {
      if (!this.currentMessage) { this.currentMessage = { id: randomUUID(), role: 'assistant', text: '', complete: false }; this.chat.push(this.currentMessage); this.emit('MessageStarted', this.currentMessage.id, { role: 'assistant' }); }
      Object.assign(this.currentMessage, assistantContent(raw.message)); this.currentMessage.complete = true;
      this.emit('MessageCompleted', this.currentMessage.id, { text: this.currentMessage.text, thinking: this.currentMessage.thinking, tools: this.currentMessage.tools, stopReason: raw.message.stopReason }, { parentId: this.activeRunId, status: raw.message.stopReason === 'error' ? 'failed' : 'completed' });
      if (raw.message.stopReason === 'error' || raw.message.stopReason === 'aborted') this.failure = raw.message.errorMessage ?? raw.message.stopReason;
      this.currentMessage = undefined;
    }
    if (raw.type === 'tool_execution_start' || raw.type === 'tool_execution_update' || raw.type === 'tool_execution_end') {
      const id = String(raw.toolCallId ?? 'unknown'); const entityId = `pi-tool:${this.activeRunId}:${id}`;
      const common = { toolCallId: id, toolName: String(raw.toolName ?? 'unknown') };
      if (raw.type === 'tool_execution_start' && this.currentMessage) {
        const tools = this.currentMessage.tools ?? [];
        if (!tools.some(tool => tool.id === id)) this.currentMessage.tools = [...tools,toolInfo({id,name:raw.toolName,args:raw.args})];
      }
      if (raw.type === 'tool_execution_start') this.emit('ToolStarted', entityId, { ...common, summary: 'Tool started', commandPreview: previewToolInput(raw.args), argumentKeys: Object.keys(raw.args ?? {}) }, { parentId: this.activeRunId, toolCallId: id, status: 'running' });
      if (raw.type === 'tool_execution_update') this.emit('ToolProgress', entityId, { ...common, summary: 'Tool output updated', contentBlocks: raw.partialResult?.content?.length ?? 0 }, { parentId: this.activeRunId, toolCallId: id, status: 'running' });
      if (raw.type === 'tool_execution_end') this.emit(raw.isError ? 'ToolFailed' : 'ToolCompleted', entityId, { ...common, summary: raw.isError ? 'Tool failed' : 'Tool completed', contentBlocks: raw.result?.content?.length ?? 0 }, { parentId: this.activeRunId, toolCallId: id, status: raw.isError ? 'failed' : 'completed' });
      this.subagents.ingest(raw,entityId,id);
    }
    if (raw.type === 'auto_retry_end') this.failure = raw.success ? undefined : String(raw.finalError ?? 'retry exhausted');
    if (raw.type === 'compaction_end' && raw.errorMessage && !raw.willRetry) this.failure = String(raw.errorMessage);
  }
}
