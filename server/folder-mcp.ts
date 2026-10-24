import {LOCAL_RESUME_REQUEST_WAIT_MS} from '../package/local-resume-policy.mjs';
import {CONFIRMATION_WAIT_MS, MAX_GRANT_MS, MAX_CONNECTION_MS, grantExpired} from '../package/connection-expiry.mjs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PermissionFault, strictPermissionObject } from './workspace-permissions.ts';
import { readJsonBody } from './body.ts';

function fail(code: string): never { throw new PermissionFault(code); }
const digest = (s: string) => createHash('sha256').update(s).digest();
const secretValue = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const identifier = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
const operations = ['list', 'directory', 'repo', 'workspace'] as const;
type Operation = typeof operations[number];
type Parent = { path: string; identity: string };
type Artifact = { name: string; path: string };
type Workspace = { id: string; path: string };
export interface FolderTransaction {
  // All operations are create-only, anchored to the same verified parent handle.
  createDirectory(name: string): Promise<Artifact>;
  gitInit(artifact: Artifact): Promise<void>;
  registerWorkspace(artifact: Artifact): Promise<Workspace>;
}
export interface FolderProvider {
  kind: 'fake' | 'handle-anchored';
  /** Inspect every ancestor from volume root, refuse ALL reparse tags; obtain volume+file identity. */
  inspect(path: string): Promise<Parent>;
  /** MUST pin the inspected parent with an OS handle, reject changed identity/reparse,
   * hold the pin for all stages, refuse existing names (case-insensitive), and call guard
   * immediately before EACH side effect. gitInit must use a fixed empty-repository recipe
   * (or separately verified fixed args), no hooks/templates, no inherited Git configuration,
   * no shell/clone/remote. Do not implement via path checks. */
  withParent<T>(pin: Parent, guard: () => void, work: (tx: FolderTransaction) => Promise<T>): Promise<T>;
}
export const unavailableFolderProvider: FolderProvider = {
  kind: 'handle-anchored',
  async inspect() { return fail('safe_folder_provider_unavailable'); },
  async withParent() { return fail('safe_folder_provider_unavailable'); }
};
export function childName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80 || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(value) || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) fail('invalid_child_name');
  return value;
}
export function canonicalParent(value: unknown): string {
  if (typeof value !== 'string' || value.length > 220 || !/^[A-Za-z]:\\[^\\]/.test(value)) fail('invalid_parent_path');
  const parts = value.slice(3).split('\\');
  for (const part of parts) childName(part);
  return value.toLowerCase();
}
type Receipt = { state: 'completed' | 'partial' | 'failed' | 'unknown'; stage: string; artifact?: Artifact; workspace?: Workspace };
export type ManagedOperationReceipt=Receipt;
type Connection = {
  id: string; name: string; proof: Buffer; pendingUntil: number;
  state: 'pending' | 'connected' | 'cancelled' | 'revoked';
  connectionUntil?: number; continuationEpoch?: number; admission?:'open'|'closed';
  grant?: { parent: Parent; operations: Operation[]; expiresAt: number | null };
  token?: Buffer; roles?: Record<'read' | 'control' | 'final', Buffer>;
  // Only the companion proof holder can fetch its token, never browser view/result.
  handoff?: string; receipts: Map<string, Receipt>;
};
type Review = { reviewId: string; requestId: string; connectionId: string; parent: Parent; operations: Operation[]; expiresAt: number | null; reviewUntil: number };
type ContinuationInput={id:string;name:string;ownerProofHash:string;parent:Parent;operations:Operation[];grantExpiresAt:number|null;operationJournal?:{requestId:string;receipt:ManagedOperationReceipt}[];bundle:{read:string;control:string;final:string;handoff:string;renewal:string;expiresAt:number;epoch:number}};
/** Ephemeral owner-approved Console management only. No Pi admission, history/final export,
 * environment/profile discovery, filesystem enumeration, public OAuth, or listener activation. */
export class FolderMcp {
  private connections = new Map<string, Connection>();
  private reviews = new Map<string, Review>();
  private results = new Map<string, { state: 'committed' | 'cancelled'; connectionId: string }>();
  private pending: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private now: () => number;
  private secret: () => string;
  private continuation: boolean;
  private pendingWaitMs: number;
  private operationJournal?: (id:string,requestId:string,receipt:ManagedOperationReceipt)=>Promise<void>;
  private initial?: (id: string, bundle: {read:string;control:string;final:string;handoff:string;expiresAt:number;epoch:number}) => Promise<void>;
  private stages = new Map<string,{connection:Connection;bundle:{read:string;control:string;final:string;handoff:string;renewal:string;expiresAt:number;epoch:number};grant:string;epoch:number}>();
  constructor(private provider: FolderProvider = unavailableFolderProvider, options: { now?: () => number; secret?: () => string; continuation?:boolean; pendingWaitMs?:number; onOperation?:(id:string,requestId:string,receipt:ManagedOperationReceipt)=>Promise<void>; onInitial?: (id:string,bundle:{read:string;control:string;final:string;handoff:string;expiresAt:number;epoch:number})=>Promise<void> } = {}) {
    this.pendingWaitMs=options.pendingWaitMs??CONFIRMATION_WAIT_MS;
    if(![CONFIRMATION_WAIT_MS,LOCAL_RESUME_REQUEST_WAIT_MS].includes(this.pendingWaitMs))fail('invalid_pending_wait');
    this.continuation=options.continuation===true;this.initial=options.onInitial;this.operationJournal=options.onOperation;this.now = options.now ?? Date.now; this.secret = options.secret ?? (() => randomBytes(32).toString('hex'));
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.then(() => { if (this.disposed) fail('connection_unavailable'); return work(); });
    this.pending = next.catch(() => {}); return next;
  }
  private issue(): string { const s = this.secret(); if (!secretValue(s)) fail('credential_generation_failed'); return s; }
  private live(c: Connection) {
    if (this.disposed || c.state !== 'connected' || this.continuation&&c.admission!=='open' || !c.grant || grantExpired(c.grant.expiresAt, this.now()) || c.connectionUntil === undefined || c.connectionUntil <= this.now()) fail('connection_unavailable');
  }
  private byToken(token: unknown): Connection {
    if (!secretValue(token)) fail('connection_unavailable'); const d = digest(token);
    const c = [...this.connections.values()].find(v => v.token && timingSafeEqual(v.token, d));
    if (!c) fail('connection_unavailable'); this.live(c); return c;
  }
  private purpose(c: Connection, role: 'read' | 'control') {
    this.live(c); const key = c.roles?.[role]; if (!key) fail('purpose_authority_unavailable');
    const ticket = Buffer.from(key);
    return () => { this.live(c); const current = c.roles?.[role]; if (!current || !timingSafeEqual(current, ticket)) fail('purpose_authority_unavailable'); };
  }
  private wipe(c: Connection) { c.admission='closed';c.token?.fill(0); Object.values(c.roles ?? {}).forEach(b => b.fill(0)); c.handoff = undefined; c.proof.fill(0); }
  request(body: any) {
    strictPermissionObject(body, ['name']);
    for (const [id, c] of this.connections) if (c.state === 'revoked' || c.state === 'cancelled' || c.state === 'pending' && c.pendingUntil <= this.now() || c.state === 'connected' && grantExpired(c.grant!.expiresAt, this.now())) { this.wipe(c); this.connections.delete(id); }
    if (this.disposed || typeof body.name !== 'string' || !/^[A-Za-z0-9 ._-]{1,60}$/.test(body.name) || this.connections.size >= 16) fail('connection_request_rejected');
    const id = randomUUID(), proof = this.issue(), pendingUntil = this.now() + this.pendingWaitMs;
    this.connections.set(id, { id, name: body.name, proof: digest(proof), pendingUntil, state: 'pending', receipts: new Map() });
    return { connectionId: id, proof, ownerAction: 'Open the verified local owner browser and approve this connection', expiresAt: pendingUntil };
  }
  claim(body: any) {
    strictPermissionObject(body, ['connectionId', 'proof']);
    const c = this.connections.get(body.connectionId);
    if (this.disposed || !c || !secretValue(body.proof) || !timingSafeEqual(c.proof, digest(body.proof))) fail('connection_unavailable');
    if (c.state === 'pending' && c.pendingUntil > this.now()) return { state: 'pending' as const };
    if (this.continuation) {
      // Initial private handoff may bootstrap normal renewal after access expires.
      // Keep the original request deadline; restored runtimes have pendingUntil=0.
      if (c.state !== 'connected' || c.admission !== 'open' || c.pendingUntil <= this.now() || !c.grant || grantExpired(c.grant.expiresAt, this.now()) || !Number.isSafeInteger(c.continuationEpoch) || c.continuationEpoch! < 1 || !secretValue(c.handoff) || c.connectionUntil === undefined) fail('connection_unavailable');
    } else this.live(c);
    return { state: 'connected' as const, connectionId: c.id, token: c.handoff, expiresAt: c.connectionUntil!, grantExpiresAt: c.grant!.expiresAt };
  }
  view() {
    return { revokeRequestId: randomUUID(), provider: this.provider === unavailableFolderProvider ? 'unavailable' : this.provider.kind, disclosure: 'No run/history/final content or Pi command authority', connections: [...this.connections.values()].map(c => ({ connectionId: c.id, name: c.name, state: c.state === 'pending' && c.pendingUntil <= this.now() || c.state === 'connected' && (grantExpired(c.grant!.expiresAt, this.now()) || c.connectionUntil === undefined || c.connectionUntil <= this.now()) ? 'expired' : c.state, parent: c.grant?.parent.path ?? null, operations: c.grant?.operations ?? [], expiresAt: c.grant ? c.grant.expiresAt : c.pendingUntil, connectionExpiresAt: c.connectionUntil ?? c.pendingUntil })) };
  }
  async review(body: any) {
    return this.serial(async () => {
      strictPermissionObject(body, Object.hasOwn(body ?? {}, 'noExpiry') ? ['connectionId', 'parent', 'operations', 'expiresAt', 'noExpiry'] : ['connectionId', 'parent', 'operations', 'expiresAt']);
      const validExpiry = body.expiresAt === null ? body.noExpiry === true : !Object.hasOwn(body, 'noExpiry') && Number.isSafeInteger(body.expiresAt) && body.expiresAt > this.now() && body.expiresAt <= this.now() + (this.continuation ? 31*86400000 : MAX_GRANT_MS);
      const c = this.connections.get(body.connectionId);
      if (!c || c.state !== 'pending' || c.pendingUntil <= this.now() || !validExpiry || !Array.isArray(body.operations) || !body.operations.includes('list') || new Set(body.operations).size !== body.operations.length || body.operations.some((op: any) => !operations.includes(op))) fail('invalid_folder_review');
      const path = canonicalParent(body.parent), parent = await this.provider.inspect(path);
      if (canonicalParent(parent.path) !== path || !identifier(parent.identity.replaceAll(':', '_'))) fail('parent_identity_unavailable');
      // Replacing a review is Back/edit, never approval.
      for (const [id, r] of this.reviews) if (r.connectionId === c.id) { this.reviews.delete(id); this.results.set(r.requestId, { state: 'cancelled', connectionId: c.id }); }
      if (this.results.size + this.reviews.size >= 256) fail('request_capacity');
      const r: Review = { reviewId: randomUUID(), requestId: randomUUID(), connectionId: c.id, parent: { ...parent, path }, operations: [...body.operations], expiresAt: body.expiresAt, reviewUntil: Math.min(this.now() + CONFIRMATION_WAIT_MS, c.pendingUntil) };
      this.reviews.set(r.reviewId, r); return structuredClone(r);
    });
  }
  async approve(body: any, owner: () => void, ownerExpiresAt: number = this.now() + MAX_CONNECTION_MS) {
    return this.serial(async () => {
      strictPermissionObject(body, ['reviewId', 'requestId', 'confirmed']);
      if (!Number.isSafeInteger(ownerExpiresAt) || ownerExpiresAt <= this.now()) fail('authenticated_connection_expiry_required');
      if (this.results.has(body.requestId)) fail('request_already_recorded');
      const r = this.reviews.get(body.reviewId), c = r && this.connections.get(r.connectionId);
      if (!r || !c || c.state !== 'pending' || r.requestId !== body.requestId || body.confirmed !== true || r.reviewUntil <= this.now() || grantExpired(r.expiresAt, this.now())) fail('review_unavailable');
      owner();
      return this.provider.withParent(r.parent, () => { owner(); if (!this.reviews.has(r.reviewId) || c.state !== 'pending' || r.reviewUntil <= this.now() || grantExpired(r.expiresAt, this.now())) fail('review_unavailable'); }, async () => {
        owner();
        const keys = [this.issue(), this.issue(), this.issue(), this.issue()];
        if (new Set(keys).size !== 4 || keys.some(k => timingSafeEqual(c.proof, digest(k))) || [...this.connections.values()].some(v => keys.some(k => v.token && timingSafeEqual(v.token, digest(k)) || Object.values(v.roles ?? {}).some(d => timingSafeEqual(d, digest(k)))))) fail('credential_generation_failed');
        c.roles = { read: digest(keys[0]), control: digest(keys[1]), final: digest(keys[2]) }; c.token = digest(keys[3]); c.handoff = keys[3]; c.grant = { parent: r.parent, operations: r.operations, expiresAt: r.expiresAt }; c.connectionUntil = this.continuation ? Math.min(this.now()+300000,r.expiresAt??Infinity) : Math.min(ownerExpiresAt, this.now() + MAX_CONNECTION_MS, r.expiresAt ?? Infinity);c.continuationEpoch=this.continuation?1:undefined; c.state = 'connected';
        c.admission='closed';
        if(this.continuation&&this.initial){try{await this.initial(c.id,{read:keys[0],control:keys[1],final:keys[2],handoff:keys[3],expiresAt:c.connectionUntil!,epoch:1})}catch{c.state='revoked';this.wipe(c);fail('continuation_bootstrap_unavailable')}}
        if(this.continuation){owner();if(ownerExpiresAt<=this.now()||this.disposed||c.state!=='connected'||grantExpired(c.grant!.expiresAt,this.now())||c.connectionUntil!<=this.now()){c.state='revoked';this.wipe(c);fail('continuation_bootstrap_unavailable')}}
        c.admission='open';
        this.results.set(r.requestId, { state: 'committed', connectionId: c.id }); this.reviews.delete(r.reviewId);
        return { state: 'committed', requestId: r.requestId, current: this.view() };
      });
    });
  }
  cancel(reviewId: string) {
    return this.serial(async () => {
      const r = this.reviews.get(reviewId); if (!r) fail('review_unavailable');
      this.reviews.delete(reviewId); this.results.set(r.requestId, { state: 'cancelled', connectionId: r.connectionId });
      return { state: 'cancelled' };
    });
  }
  result(requestId: string) {
    if (!identifier(requestId)) fail('invalid_request_id');
    return { ...(this.results.get(requestId) ?? { state: 'unknown' }), current: this.view() };
  }
  abandon(requestId: string, owner: () => void) {
    return this.serial(async () => {
      if (!identifier(requestId) || this.results.size >= 256) fail('invalid_request_id'); owner();
      // Serial behind approval: a committed result is reported, never silently undone.
      if (this.results.has(requestId)) return this.result(requestId);
      let connectionId = 'none';
      for (const [id, r] of this.reviews) if (r.requestId === requestId) { connectionId = r.connectionId; this.reviews.delete(id); }
      this.results.set(requestId, { state: 'cancelled', connectionId }); return this.result(requestId);
    });
  }
  async revoke(body: any, owner: () => void) {
    return this.serial(async () => {
      strictPermissionObject(body, ['connectionId', 'requestId']);
      if (!identifier(body.requestId) || this.results.size >= 256) fail('invalid_request_id');
      if (this.results.has(body.requestId)) fail('request_already_recorded');
      const targets = body.connectionId === 'all' ? [...this.connections.values()] : [this.connections.get(body.connectionId)];
      if (targets.some(c => !c)) fail('connection_unavailable'); owner();
      for (const c of targets as Connection[]) { c.state = 'revoked'; this.wipe(c); for (const [id, r] of this.reviews) if (r.connectionId === c.id) this.reviews.delete(id); }
      this.results.set(body.requestId, { state: 'committed', connectionId: body.connectionId }); return this.result(body.requestId);
    });
  }
  /** Trusted composition only; never exposed as an HTTP/MCP management action. */
  restoreContinuation(input:ContinuationInput,verify:()=>Promise<void>){return this.loadContinuation(input,verify,false)}
  /** Authenticated composition only: hydrate a CLOSED rotation context, never enable expired access. */
  prepareRotationContinuation(input:ContinuationInput,verify:()=>Promise<void>){return this.loadContinuation(input,verify,true)}
  private loadContinuation(input:ContinuationInput,verify:()=>Promise<void>,rotation:boolean){return this.serial(async()=>{
    if(!this.continuation||!identifier(input.id)||this.connections.has(input.id)||this.connections.size>=16||!/^[-\w .]{1,60}$/.test(input.name)||!/^[0-9a-f]{64}$/.test(input.ownerProofHash)||canonicalParent(input.parent.path)!==input.parent.path||!input.operations.includes('list')||new Set(input.operations).size!==input.operations.length||input.operations.some(op=>!operations.includes(op))||grantExpired(input.grantExpiresAt,this.now())||!Number.isSafeInteger(input.bundle.epoch)||input.bundle.epoch<1||!Number.isSafeInteger(input.bundle.expiresAt)||input.bundle.expiresAt<0||!rotation&&input.bundle.expiresAt<=this.now()||input.bundle.expiresAt>Math.min(this.now()+300000,input.grantExpiresAt??Infinity))fail('continuation_restore_rejected');
    const keys=[input.bundle.read,input.bundle.control,input.bundle.final,input.bundle.handoff,input.bundle.renewal];if(!keys.every(secretValue)||new Set(keys).size!==5||[...this.connections.values()].some(c=>keys.some(k=>c.token&&timingSafeEqual(c.token,digest(k))||Object.values(c.roles??{}).some(v=>timingSafeEqual(v,digest(k))))))fail('continuation_restore_rejected');
    const c:Connection={id:input.id,name:input.name,proof:Buffer.from(input.ownerProofHash,'hex'),pendingUntil:0,state:'connected',admission:'closed',grant:{parent:structuredClone(input.parent),operations:[...input.operations],expiresAt:input.grantExpiresAt},roles:{read:digest(input.bundle.read),control:digest(input.bundle.control),final:digest(input.bundle.final)},token:digest(input.bundle.handoff),handoff:input.bundle.handoff,connectionUntil:input.bundle.expiresAt,continuationEpoch:input.bundle.epoch,receipts:new Map((input.operationJournal??[]).map(r=>[r.requestId,structuredClone(r.receipt)]))};
    const guard=()=>{if(this.disposed||c.state!=='connected'||c.admission!=='closed'||this.connections.has(c.id)||this.connections.size>=16||grantExpired(c.grant!.expiresAt,this.now())||!rotation&&c.connectionUntil!<=this.now())fail('continuation_restore_rejected')};
    try{guard();await this.provider.withParent(c.grant!.parent,guard,async()=>{await verify();guard();return undefined});guard();this.connections.set(c.id,c);if(!rotation)c.admission='open'}catch(e){c.state='revoked';this.wipe(c);throw e}
  })}
  continuationSnapshot(id:string){if(!this.continuation)fail('continuation_unavailable');const c=this.connections.get(id);if(!c||!c.grant)fail('connection_unavailable');return structuredClone({id:c.id,state:c.state,admission:c.admission??'closed',grant:c.grant,epoch:c.continuationEpoch!,accessExpiresAt:c.connectionUntil!})}
  quiesceContinuation(id:string,expectedEpoch:number){
    const c=this.connections.get(id);if(!this.continuation||this.disposed||!c||c.state!=='connected'||c.admission!=='open'||c.continuationEpoch!==expectedEpoch||!c.grant||grantExpired(c.grant.expiresAt,this.now()))fail('continuation_rotation_rejected');
    // Close synchronously: callers arriving while the operation queue drains are refused.
    c.admission='closed';return this.serial(async()=>{if(c.state!=='connected'||c.continuationEpoch!==expectedEpoch)fail('continuation_epoch_changed')});
  }
  stageContinuation(id:string,bundle:{read:string;control:string;final:string;handoff:string;renewal:string;expiresAt:number;epoch:number}){return this.serial(async()=>{if(!this.continuation||this.stages.size>=32)fail('continuation_unavailable');const c=this.connections.get(id);if(!c||c.state!=='connected'||c.admission!=='closed'||!c.grant||grantExpired(c.grant.expiresAt,this.now())||bundle.epoch!==(c.continuationEpoch??0)+1||!Number.isSafeInteger(bundle.expiresAt)||bundle.expiresAt<=this.now()||bundle.expiresAt>Math.min(this.now()+300000,c.grant.expiresAt??Infinity))fail('continuation_rotation_rejected');const keys=[bundle.read,bundle.control,bundle.final,bundle.handoff,bundle.renewal];if(!keys.every(secretValue)||new Set(keys).size!==5||[...this.connections.values()].some(v=>keys.some(k=>timingSafeEqual(v.proof,digest(k))||v.token&&timingSafeEqual(v.token,digest(k))||Object.values(v.roles??{}).some(x=>timingSafeEqual(x,digest(k))))))fail('continuation_credential_rejected');const token=randomUUID();this.stages.set(token,{connection:c,bundle:{...bundle},grant:JSON.stringify(c.grant),epoch:c.continuationEpoch!});return token})}
  activateContinuation(stage:string,expectedEpoch:number,saveEpoch:()=>Promise<void>,verify:()=>Promise<void>){return this.serial(async()=>{
    const p=this.stages.get(stage);if(!p)fail('continuation_stage_unavailable');this.stages.delete(stage);const c=p.connection;
    const guard=()=>{if(this.disposed||c.state!=='connected'||c.admission!=='closed'||this.connections.get(c.id)!==c||c.continuationEpoch!==expectedEpoch||p.epoch!==expectedEpoch||JSON.stringify(c.grant)!==p.grant||grantExpired(c.grant!.expiresAt,this.now())||p.bundle.expiresAt<=this.now())fail('continuation_epoch_changed')};
    try{
      guard();await this.provider.withParent(c.grant!.parent,guard,async()=>{guard();await saveEpoch();guard();return undefined});
      guard();await this.provider.withParent(c.grant!.parent,guard,async()=>{guard();await verify();guard();return undefined});guard();
      // No await between the final guard, key/epoch swap and reopening admission.
      c.token?.fill(0);Object.values(c.roles??{}).forEach(x=>x.fill(0));
      c.roles={read:digest(p.bundle.read),control:digest(p.bundle.control),final:digest(p.bundle.final)};c.token=digest(p.bundle.handoff);c.handoff=p.bundle.handoff;c.connectionUntil=p.bundle.expiresAt;c.continuationEpoch=p.bundle.epoch;c.admission='open';
    }catch(error){c.state='revoked';this.wipe(c);throw error}
  })}
  invalidateContinuation(id:string){if(!this.continuation)fail('continuation_unavailable');const c=this.connections.get(id);if(c){c.state='revoked';this.wipe(c)}return this.serial(async()=>{for(const [key,p]of this.stages)if(p.connection.id===id)this.stages.delete(key)})}
  tools(token: unknown) {
    const c = this.byToken(token), names = ['list_allowed_parents', 'get_operation'];
    this.purpose(c, 'read')();
    if (c.grant!.operations.includes('directory')) names.push('create_managed_workspace');
    return names.map(name => ({ name, description: name === 'create_managed_workspace' ? 'Create a NEW child; optional fixed empty local repository initialization and workspace registration. No clone/push/delete/command.' : 'Approved metadata only; no history/final text.', inputSchema: name === 'create_managed_workspace' ? { type: 'object', properties: { requestId: { type: 'string' }, parent: { type: 'string' }, name: { type: 'string' }, repo: { type: 'boolean' }, workspace: { type: 'boolean' } }, required: ['requestId', 'parent', 'name', 'repo', 'workspace'], additionalProperties: false } : name === 'get_operation' ? { type: 'object', properties: { requestId: { type: 'string' } }, required: ['requestId'], additionalProperties: false } : { type: 'object', properties: {}, additionalProperties: false } }));
  }
  async call(token: unknown, name: string, args: any) {
    // Refuse at submission too; a request made while closed must not wait and pass later.
    if(this.continuation)this.byToken(token);
    return this.serial(async () => {
      const c = this.byToken(token), g = c.grant!;
      if (name === 'list_allowed_parents') {
        strictPermissionObject(args, []);
        const read = this.purpose(c, 'read');
        return this.provider.withParent(g.parent, read, async () => ({ parents: [{ path: g.parent.path, operations: g.operations, expiresAt: g.expiresAt }], workspaces: [...c.receipts.values()].flatMap(r => r.workspace ? [r.workspace] : []) }));
      }
      if (name === 'get_operation') { this.purpose(c, 'read')(); strictPermissionObject(args, ['requestId']); if (!identifier(args.requestId)) fail('invalid_request_id'); const r = c.receipts.get(args.requestId); if (!r) fail('operation_unknown'); return structuredClone(r); }
      if (name !== 'create_managed_workspace') fail('tool_not_authorized');
      strictPermissionObject(args, ['requestId', 'parent', 'name', 'repo', 'workspace']);
      if (!identifier(args.requestId) || typeof args.repo !== 'boolean' || typeof args.workspace !== 'boolean' || canonicalParent(args.parent) !== g.parent.path || !g.operations.includes('directory') || args.repo && !g.operations.includes('repo') || args.workspace && !g.operations.includes('workspace')) fail('folder_scope_denied');
      const child = childName(args.name);
      const control = this.purpose(c, 'control');
      if (c.receipts.has(args.requestId)) fail('request_already_recorded'); if (c.receipts.size >= 128) fail('request_capacity');
      const receipt: Receipt = { state: this.operationJournal?'unknown':'failed', stage: this.operationJournal?'prepared':'parent' }; c.receipts.set(args.requestId, receipt);
      const journal=async()=>{if(this.operationJournal)await this.operationJournal(c.id,args.requestId,structuredClone(receipt))};
      try {
        await journal();return await this.provider.withParent(g.parent, control, async tx => {
          control(); receipt.stage = 'directory'; receipt.state = 'unknown'; await journal();control();const artifact = await tx.createDirectory(child);
          if (artifact.name !== child || artifact.path.toLowerCase() !== g.parent.path + '\\' + child.toLowerCase()) fail('provider_contract_failed'); receipt.artifact = { ...artifact }; receipt.state = 'partial';await journal();
          if (args.repo) { receipt.stage = 'git'; control();await journal();control();await tx.gitInit(artifact);await journal(); }
          if (args.workspace) { receipt.stage = 'workspace'; control();await journal();control();const w = await tx.registerWorkspace(artifact); if (!identifier(w.id) || w.path.toLowerCase() !== artifact.path.toLowerCase()) fail('provider_contract_failed'); receipt.workspace = { ...w };await journal(); }
          receipt.stage = 'complete'; receipt.state = 'completed';await journal();this.live(c); return structuredClone(receipt);
        });
      } catch { fail('folder_operation_incomplete'); }
    });
  }
  dispose() { this.disposed = true; this.connections.forEach(c => this.wipe(c)); this.connections.clear(); this.reviews.clear(); this.results.clear();this.stages.clear(); }
}

/** Management actions only; never request, claim, RPC or credentials. */
export async function folderOwnerAction(app: FolderMcp, route: string, body: any, owner: () => void, ownerExpiresAt?: number) {
  owner(); let result: any;
  if (route === 'status') { strictPermissionObject(body, []); result = app.view(); }
  else if (route === 'review') result = await app.review(body);
  else if (route === 'approve') result = await app.approve(body, owner, ownerExpiresAt);
  else if (route === 'cancel') { strictPermissionObject(body, ['reviewId']); result = await app.cancel(body.reviewId); }
  else if (route === 'result') { strictPermissionObject(body, ['requestId']); result = app.result(body.requestId); }
  else if (route === 'abandon') { strictPermissionObject(body, ['requestId']); result = await app.abandon(body.requestId, owner); }
  else if (route === 'revoke') result = await app.revoke(body, owner);
  else throw new PermissionFault('owner_route_unavailable');
  owner(); return result;
}

/** Private broker on the EXISTING owner listener. Not an HTTP MCP/OAuth endpoint.
 * Companion request/claim/call require literal loopback, no browser/proxy/queries.
 * Browser owner actions reuse HttpOnly verified session and exact origin. */
export function folderMcpHttp(app: FolderMcp, verify: (req: IncomingMessage) => boolean, ownerExpiry?: (req: IncomingMessage) => number | undefined) {
  const send = (res: ServerResponse, status: number, value: any) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = req.url ?? '';
    if (!url.startsWith('/local-owner/folder/')) return false;
    try {
      const count = (name: string) => req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name).length;
      if (req.method !== 'POST' || url.includes('?') || req.socket.localAddress !== '127.0.0.1' || req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== `127.0.0.1:${req.socket.localPort}` || req.headers['content-type'] !== 'application/json' || ['host', 'content-type'].some(n => count(n) !== 1) || Object.keys(req.headers).some(n => n === 'forwarded' || n === 'via' || n.startsWith('cf-') || n.startsWith('x-forwarded-') || n === 'x-real-ip')) fail('local_boundary_rejected');
      const route = url.slice('/local-owner/folder/'.length), companion = ['request', 'claim', 'rpc'].includes(route);
      if (companion ? !!req.headers.origin || !!req.headers['sec-fetch-site'] || !!req.headers.cookie : !verify(req)) fail('owner_or_companion_boundary_rejected');
      const b = await readJsonBody(req, 8192), owner = () => { if (!verify(req)) fail('owner_session_expired'); };
      let result: any;
      if (route === 'request') result = app.request(b);
      else if (route === 'claim') result = app.claim(b);
      else if (route === 'status') { strictPermissionObject(b, []); result = app.view(); }
      else if (route === 'review') { result = await app.review(b); owner(); }
      else if (route === 'approve') result = await app.approve(b, owner, ownerExpiry?.(req));
      else if (route === 'cancel') { strictPermissionObject(b, ['reviewId']); result = await app.cancel(b.reviewId); }
      else if (route === 'result') { strictPermissionObject(b, ['requestId']); result = app.result(b.requestId); }
      else if (route === 'abandon') { strictPermissionObject(b, ['requestId']); result = await app.abandon(b.requestId, owner); }
      else if (route === 'revoke') result = await app.revoke(b, owner);
      else if (route === 'rpc') {
        strictPermissionObject(b, ['method', 'name', 'arguments']);
        if (count('authorization') !== 1 || !/^Bearer [a-f0-9]{64}$/.test(String(req.headers.authorization))) fail('connection_unavailable');
        const token = String(req.headers.authorization).slice(7);
        if (b.method === 'tools/list' && b.name === null && b.arguments === null) result = { tools: app.tools(token) };
        else if (b.method === 'tools/call') { const value = await app.call(token, b.name, b.arguments); result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }; }
        else fail('method_not_supported');
      } else fail('route_unavailable');
      send(res, 200, result);
    } catch (e) { req.resume(); send(res, 409, { error: e instanceof PermissionFault ? e.code : 'folder_request_unavailable' }); }
    return true;
  };
}
