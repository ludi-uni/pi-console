import {projectRemoteResult} from './result.ts';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { REMOTE_CONNECTION, type AuditEvent, type PendingApproval, type RemoteGrant, type RemoteOperation, type RemoteRequest, type RemoteRole, type RemoteTransport, type TrustedArtifact } from './types.js';
import { RemoteDesktopStore } from './store.js';

const readonly = new Set<RemoteOperation>(['inspect', 'screenshot']);
const writes = new Set<RemoteOperation>(['file_send', 'caivi_click', 'caivi_input', 'caivi_drag']);
const roleFor = (operation: RemoteOperation): RemoteRole => operation === 'file_send' ? 'transfer' : 'gui';
const grantFor = (operation: RemoteOperation): RemoteGrant => operation === 'file_send' ? 'send' : writes.has(operation) ? 'operate' : 'read';
const fail = (message: string): never => { throw new Error(message); };
// Only these authenticated KNOWN refusals prove the guest applied no change and may
// retire this request's pending entry while staying KNOWN. Anything else (lost
// reply, UNKNOWN outcome, unauthenticated reply, malformed proof) keeps UNKNOWN and
// moves the entry to the uncertain/tombstone ledgers.
const knownNoEffectErrors = new Set(['unauthorized', 'target_mismatch', 'mutation_already_attempted']);
const exact = (value: unknown, keys: string[]) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === keys.length && keys.every(key => Object.hasOwn(value as object, key));
const pendingAfterOwnLatch = (fresh: { pending: Record<string, { requestId: string }> }, connection: string, role: RemoteRole, requestId: string) => fresh.pending[`${connection}:${role}`]?.requestId === requestId;
export type BrokerResponse = { ok: true; result: unknown; outcome: 'KNOWN' } | { ok: false; error: string; outcome: 'KNOWN' | 'UNKNOWN' };
export class RemoteDesktopBroker {
  // Per-invocation operator consent never outlives the original invoke: at most one
  // pending decision, 60 s (inside the 95 s SDK worker timeout), in-memory only.
  // Durable grants (store.grants) decide whether a write may run at all; a pending
  // approval, when used, only confirms this single dispatch.
  #pending: { id: string; operation: RemoteOperation; artifact?: { name: string; sha256: string; size: number }; requestedAt: string; expiresAt: string; revision: number; resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  #queue = Promise.resolve();
  constructor(private readonly options: { store: RemoteDesktopStore; transport: RemoteTransport; expectedTarget: (result: unknown) => boolean; trustedArtifacts?: Record<string, TrustedArtifact> | (() => Promise<Record<string, TrustedArtifact>>); targetRevision?: () => number | undefined; artifactRevision?: () => number; approvalTimeoutMs?: number; perRequestApproval?: boolean; now?: () => Date; audit?: (event: AuditEvent) => void; }) {}
  #audit(operation: RemoteOperation, role: RemoteRole, outcome: AuditEvent['outcome']) { this.options.audit?.({ connection: REMOTE_CONNECTION, operation, role, outcome, timestamp: (this.options.now ?? (() => new Date()))().toISOString() }); }
  #clock() { return (this.options.now ?? (() => new Date()))(); }
  pendingApproval(): PendingApproval | undefined { const p = this.#pending; if (!p) return undefined; if (this.#clock().getTime() >= Date.parse(p.expiresAt)) return undefined; const copy: PendingApproval = { approvalId: p.id, operation: p.operation, requestedAt: p.requestedAt, expiresAt: p.expiresAt, revision: p.revision }; if (p.artifact) copy.artifact = { ...p.artifact }; return copy; }
  perRequestApproval(): boolean { return this.options.perRequestApproval !== false; }
  resolveApproval(approvalId: string, approved: boolean): boolean { const p = this.#pending; if (!p || p.id !== approvalId || this.#clock().getTime() >= Date.parse(p.expiresAt)) return false; clearTimeout(p.timer); this.#pending = undefined; p.resolve(approved); return true; }
  async #awaitApproval(request: RemoteRequest, artifact: TrustedArtifact | undefined, state: { revision: number }, targetAtRequest: number | undefined, assertAuthority?: () => void): Promise<void> {
    if (this.#pending) fail('operator_grant_required');
    const now = this.#clock(); const timeoutMs = this.options.approvalTimeoutMs ?? 60000;
    const approved = await new Promise<boolean>(resolve => {
      const id = randomBytes(16).toString('hex');
      const p: { id: string; operation: RemoteOperation; artifact?: { name: string; sha256: string; size: number }; requestedAt: string; expiresAt: string; revision: number; resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> } = { id, operation: request.operation, requestedAt: now.toISOString(), expiresAt: new Date(now.getTime() + timeoutMs).toISOString(), revision: state.revision, resolve, timer: setTimeout(() => { if (this.#pending?.id === id) { this.#pending = undefined; resolve(false); } }, timeoutMs) };
      if (artifact) p.artifact = { name: artifact.name, sha256: artifact.sha256, size: artifact.size };
      this.#pending = p;
    });
    // A denial, expiry, revoked run, revoked grant, or mid-wait reconfiguration cannot dispatch.
    const fresh = await this.options.store.current();
    if (!approved || !fresh.connection || !fresh.enabled || fresh.revision !== state.revision || fresh.grants[grantFor(request.operation)] !== true) fail('operator_grant_required');
    if (request.operation !== 'file_send' && targetAtRequest !== undefined && this.options.targetRevision?.() !== targetAtRequest) fail('remote_target_changed');
    assertAuthority?.();
  }
  async #artifact(name: string): Promise<TrustedArtifact> { const candidate = (typeof this.options.trustedArtifacts === 'function' ? await this.options.trustedArtifacts() : this.options.trustedArtifacts)?.[name]; if (!candidate) fail('artifact_denied'); const artifact = candidate!; if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(artifact.name) || artifact.name !== name || !/^[a-f0-9]{64}$/i.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 0 || artifact.size > 16 * 1024 * 1024 || !path.isAbsolute(artifact.path)) fail('artifact_denied'); const status = await lstat(artifact.path); if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1 || status.size !== artifact.size || path.normalize(await realpath(artifact.path)) !== path.normalize(artifact.path)) fail('artifact_denied'); const handle = await open(artifact.path, 'r'); try { const before = await handle.stat(); if (!before.isFile() || before.size !== artifact.size || before.nlink !== 1) fail('artifact_denied'); const bytes = await handle.readFile(); const after = await handle.stat(); if (before.size !== after.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256.toLowerCase()) fail('artifact_denied'); } finally { await handle.close(); } return { name: artifact.name, path: artifact.path, sha256: artifact.sha256, size: artifact.size }; }
  invoke(request: RemoteRequest,assertAuthority?:()=>void): Promise<BrokerResponse> { const work = this.#queue.then(() => {assertAuthority?.();return this.#invoke(request,assertAuthority);}).catch(error=>({ok:false,error:error instanceof Error&&/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'remote_broker_unavailable',outcome:'KNOWN'} as BrokerResponse)).then(result=>{if(request&&['inspect','screenshot','file_send','caivi_click','caivi_input','caivi_drag'].includes(request.operation))this.#audit(request.operation,roleFor(request.operation),result.ok?'ok':result.outcome==='UNKNOWN'?'unknown':'denied');return result;}); this.#queue = work.then(() => undefined, () => undefined); return work; }
  async #invoke(request: RemoteRequest,assertAuthority?:()=>void): Promise<BrokerResponse> {
    if (!request || !exact(request, request.operation === 'file_send' ? ['connection', 'operation', 'artifact_name'] : ['connection', 'operation']) || request.connection !== REMOTE_CONNECTION || !['inspect', 'screenshot', 'file_send', 'caivi_click', 'caivi_input', 'caivi_drag'].includes(request.operation) || (request.operation !== 'file_send' && request.artifact_name !== undefined) || (request.operation === 'file_send' && typeof request.artifact_name !== 'string')) return {ok:false,error:'remote_request_invalid',outcome:'KNOWN'};
    const role = roleFor(request.operation); const grant = grantFor(request.operation); const state = await this.options.store.current();
    if (!state.connection || Date.parse(state.connection[role].expiresUtc) <= this.#clock().getTime()) { return {ok:false,error:'certificate_expired',outcome:'KNOWN'}; }
    // Connection-scoped durable grant, checked before any credential or approval step.
    if (state.grants[grant] !== true) return {ok:false,error:'remote_grant_denied',outcome:'KNOWN'};
    const configured = state.connection; let token: Buffer | undefined, requestId='',latched=false,dispatched=false;
    try {
      // Reads tolerate a latched write ledger (reobservation stays possible); writes are
      // refused while the role still has an unresolved pending or UNKNOWN entry.
      token = await this.options.store.token(request.connection, role, readonly.has(request.operation));
      // Snapshot the bound-target generation before any approval wait: a clear or
      // rebind during the human pause must prevent dispatch onto a changed window.
      const targetAtRequest = this.options.targetRevision?.();
      // Snapshot the artifact-registry generation too: an unregister landing after
      // the post-approval re-prove but before transport must still revoke the send.
      const artifactAtRequest = this.options.artifactRevision?.();
      let artifact = request.operation === 'file_send' ? await this.#artifact(request.artifact_name!) : undefined;
      if (writes.has(request.operation) && this.perRequestApproval()) { await this.#awaitApproval(request, artifact, state, targetAtRequest, assertAuthority); if (request.operation === 'file_send') artifact = await this.#artifact(request.artifact_name!); /* Reprove the bytes after the human wait: approval must not latch UNKNOWN for a file that changed. */ }
      const fresh=await this.options.store.current(); if(fresh.revision!==state.revision||!fresh.connection||!fresh.enabled||!fresh.roles[role].pinApproved||fresh.grants[grant]!==true||Date.parse(fresh.connection[role].expiresUtc)<=this.#clock().getTime())return{ok:false,error:'connection_changed',outcome:'KNOWN'};
      if(writes.has(request.operation)){
        requestId=randomBytes(16).toString('hex');
        // Awaiting the latch is an async window: a queued grant revoke or reconfigure
        // can land after the check above but before this write commits. Re-validate
        // immediately before dispatch — the store revision must have moved by exactly
        // our own latch, and the bound target must not have changed during approval.
        await this.options.store.latchPending(request.connection,role,request.operation,requestId);latched=true;
        const current=await this.options.store.current();
        if(!current.connection||!current.enabled||current.grants[grant]!==true||!current.roles[role].pinApproved||Date.parse(current.connection[role].expiresUtc)<=this.#clock().getTime()||current.revision!==state.revision+1||!pendingAfterOwnLatch(current,request.connection,role,requestId)||(targetAtRequest!==undefined&&this.options.targetRevision?.()!==targetAtRequest)||(request.operation==='file_send'&&artifactAtRequest!==undefined&&this.options.artifactRevision?.()!==artifactAtRequest)){
          // Proven not-dispatched: retire only this request's pending entry without
          // touching the UNKNOWN/tombstone ledgers.
          await this.options.store.resolvePending(request.connection,role,requestId).catch(()=>{});
          return{ok:false,error:'connection_changed',outcome:'KNOWN'};
        }
      }
      assertAuthority?.(); dispatched=true; const response=await this.options.transport({endpoint:configured[role],operation:request.operation,token,artifact});
      // Only an authenticated KNOWN-ok reply or an allowlisted authenticated KNOWN
      // no-effect refusal may retire this request's pending entry. Every other shape
      // abandons it into the uncertain/tombstone ledgers and reports UNKNOWN.
      const retire=async()=>{if(latched)await this.options.store.resolvePending(request.connection,role,requestId)};
      const unconfirmed=async(error:string):Promise<BrokerResponse>=>{if(latched)await this.options.store.abandonPending(request.connection,role,requestId,request.operation);return{ok:false,error,outcome:latched?'UNKNOWN':'KNOWN'};};
      if(!response||typeof response.ok!=='boolean'||!['KNOWN','UNKNOWN'].includes(response.outcome)||response.error!==undefined&&(typeof response.error!=='string'||!/^[a-z0-9_]{1,80}$/.test(response.error)))return unconfirmed('transport_proof_invalid');
      if(!response.ok){if(latched&&response.authenticated===true&&response.outcome==='KNOWN'&&typeof response.error==='string'&&knownNoEffectErrors.has(response.error)){await retire();return{ok:false,error:response.error,outcome:'KNOWN'};}return unconfirmed(response.error??'remote_operation_failed');}
      if(response.authenticated!==true||response.outcome!=='KNOWN')return unconfirmed('transport_proof_invalid');
      const rendered=JSON.stringify(response.result); if(typeof rendered!=='string'||rendered.includes(token.toString('utf8')))return unconfirmed('remote_result_secret_denied');
      if(request.operation==='file_send'&&(!artifact||!response.result||typeof response.result!=='object'||(response.result as any).sha256!==artifact.sha256||(response.result as any).bytes!==artifact.size))return unconfirmed('transfer_receipt_invalid');
      if(role==='gui'&&!(writes.has(request.operation)?this.options.expectedTarget((response.result as any)?.before)&&this.options.expectedTarget((response.result as any)?.after):this.options.expectedTarget(response.result)))return unconfirmed('target_proof_invalid');
      const safe=projectRemoteResult(request.operation,response.result);
      // Verified success: proof checks passed, so the ledger entry this request created
      // is retired and the role stays writable. Historical UNKNOWN/tombstones are kept.
      if(latched)await this.options.store.resolvePending(request.connection,role,requestId);
      return{ok:true,result:safe,outcome:'KNOWN'};
    } catch(error) { const code=error instanceof Error&&/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'remote_operation_failed'; if(latched&&!['remote_write_pending','remote_pending_mismatch'].includes(code)){if(dispatched)await this.options.store.abandonPending(request.connection,role,requestId,request.operation).catch(()=>{});else await this.options.store.resolvePending(request.connection,role,requestId).catch(()=>{});} return{ok:false,error:code,outcome:latched&&dispatched?'UNKNOWN':'KNOWN'}; } finally { token?.fill(0); }
  }
  async testConnection(connection: string) { if (connection !== REMOTE_CONNECTION) return { gui: 'unavailable', transfer: 'untested', result: {ok:false,error:'connection_unavailable',outcome:'KNOWN'} as BrokerResponse }; const result=await this.invoke({connection:REMOTE_CONNECTION,operation:'inspect'});return{gui:result.ok?'connected':'unavailable',transfer:'untested',result}; }
}
