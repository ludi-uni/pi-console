import type { VerifiedAccessPrincipal } from './access.ts';
import { isVerifiedAccessPrincipal } from './access.ts';
import type { SettingsOwner } from './settings-owner.ts';
import { PermissionFault, strictPermissionObject } from './workspace-permissions.ts';
import { ownerGuiBinding, type OwnerGuiDialog, type OwnerGuiView } from '../package/owner-gui-dialog.mjs';
import type { ManagedOwnerIdentity } from '../package/server-manager.mjs';

export interface OwnerGuiOptions {
  available: boolean;
  generation(): ManagedOwnerIdentity;
  verifyIdentity(expected: Readonly<ManagedOwnerIdentity>): Promise<ManagedOwnerIdentity>;
  dialog: OwnerGuiDialog;
}
type State = 'pending' | 'registered' | 'cancelled' | 'expired' | 'unavailable' | 'noninteractive' | 'conflict' | 'unknown';
type Entry = { view: Readonly<OwnerGuiView>; state: State; phase: 'waiting' | 'committing' | 'done'; abort: AbortController; timer?: ReturnType<typeof setTimeout> };
const identityFields = ['pid', 'startedAt', 'port', 'generation'] as const;
const sameIdentity = (a: ManagedOwnerIdentity, b: ManagedOwnerIdentity) => identityFields.every(k => a[k] === b[k]);
const samePrincipal = (view: OwnerGuiView, p: VerifiedAccessPrincipal) => view.subject === p.subject && view.issuer === p.issuer && view.audience === p.audience;
function fail(code: string): never { throw new PermissionFault(code); }

/** Internal human-intent adapter. A browser can request/cancel/query, never approve. */
export class OwnerGuiEnrollment {
  private entries = new Map<string, Entry>();
  private active?: Entry;
  private tasks = new Set<Promise<void>>();
  private prompts: number[] = [];
  private subjects = new Map<string, number>();
  private closed = false;
  constructor(private owners: SettingsOwner, private options?: OwnerGuiOptions, private now = Date.now) {}
  available() { return !this.closed && this.options?.available === true; }
  manages(requestId: unknown) { return typeof requestId === 'string' && this.entries.has(requestId); }
  private stop(e: Entry, state: State) {
    if (e.phase !== 'waiting') return;
    e.state = state; e.phase = 'done'; clearTimeout(e.timer); e.abort.abort();
    // Retain the active slot until the owned dialog transport actually finishes.
    try { this.owners.cancel(this.principalFor(e), { requestId: e.view.requestId }); } catch { /* fail closed */ }
  }
  private principals = new WeakMap<Entry, VerifiedAccessPrincipal>();
  private principalFor(e: Entry) { return this.principals.get(e); }
  private check(e: Entry) {
    if (e.phase === 'done' || e.abort.signal.aborted || this.closed) fail('owner_gui_cancelled');
    if (this.now() >= e.view.expiresAt) fail('owner_gui_expired');
    const p = this.principalFor(e);
    if (!isVerifiedAccessPrincipal(p) || !samePrincipal(e.view, p) || p.expiresAt < e.view.expiresAt) fail('verified_access_required');
    if (!this.options || !sameIdentity(e.view, this.options.generation())) fail('owner_gui_generation_changed');
  }
  private async identity(e: Entry) {
    this.check(e);
    const { pid, startedAt, port, generation } = e.view;
    const actual = await this.options!.verifyIdentity(Object.freeze({ pid, startedAt, port, generation }));
    this.check(e);
    if (!sameIdentity(e.view, actual)) fail('owner_gui_generation_changed');
  }
  private async run(e: Entry) {
    try {
      await this.identity(e);
      const answer = await this.options!.dialog(e.view, { signal: e.abort.signal });
      this.check(e);
      if (!answer || answer.bindingDigest !== e.view.bindingDigest) fail('owner_gui_binding_rejected');
      if (answer.decision !== 'approved') {
        this.stop(e, answer.decision === 'cancelled' ? 'cancelled' : answer.decision === 'noninteractive' ? 'noninteractive' : 'unavailable'); return;
      }
      await this.identity(e);
      e.phase = 'committing'; clearTimeout(e.timer);
      await this.owners.approve({ requestId: e.view.requestId, confirmed: true }, () => this.check(e));
      e.state = 'registered'; e.phase = 'done';
    } catch {
      if (e.phase === 'committing') { e.state = 'unknown'; e.phase = 'done'; }
      else if (e.phase === 'waiting') this.stop(e, this.now() >= e.view.expiresAt ? 'expired' : 'unavailable');
    } finally {
      clearTimeout(e.timer); if (this.active === e) this.active = undefined;
    }
  }
  request(p: VerifiedAccessPrincipal | undefined, body: any) {
    strictPermissionObject(body, ['requestId', 'confirmed']);
    if (!this.owners.fresh(p) || body.confirmed !== true || typeof body.requestId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(body.requestId)) fail('verified_explicit_owner_request_required');
    const old = this.entries.get(body.requestId);
    if (old) {
      if (!samePrincipal(old.view, p)) fail('owner_request_unavailable');
      if (old.state !== 'pending' && old.state !== 'registered' && old.state !== 'unknown') fail('owner_request_already_finished');
      return this.result(p, body.requestId);
    }
    if (this.owners.status(p).setupComplete) fail('owner_already_registered');
    if (this.owners.result(p, body.requestId).state !== 'unknown') fail('owner_request_already_finished');
    if (!this.available()) fail('owner_gui_unavailable');
    if (this.entries.size >= 32) fail('owner_request_capacity');
    const tuple = { requestId: body.requestId, subject: p.subject, issuer: p.issuer, audience: p.audience, expiresAt: Math.min(p.expiresAt, this.now() + 120000), ...this.options!.generation() };
    const view = Object.freeze({ ...tuple, bindingDigest: ownerGuiBinding(tuple) });
    const e: Entry = { view, state: 'pending', phase: 'waiting', abort: new AbortController() };
    this.principals.set(e, p); this.entries.set(body.requestId, e);
    if (this.active) { this.stop(this.active, 'conflict'); e.state = 'conflict'; e.phase = 'done'; fail('owner_gui_concurrent_request'); }
    this.prompts = this.prompts.filter(t => t > this.now() - 600000);
    const subjectKey = JSON.stringify([p.subject, p.issuer, p.audience]);
    if (this.prompts.length >= 3 || (this.subjects.get(subjectKey) ?? -Infinity) > this.now() - 60000) { e.state = 'unavailable'; e.phase = 'done'; fail('owner_gui_rate_limited'); }
    this.owners.request(p, { requestId: body.requestId });
    this.prompts.push(this.now()); this.subjects.set(subjectKey, this.now()); this.active = e;
    e.timer = setTimeout(() => this.stop(e, 'expired'), Math.max(1, view.expiresAt - this.now())); e.timer.unref();
    const task = Promise.resolve().then(() => this.run(e)); this.tasks.add(task); void task.finally(() => this.tasks.delete(task));
    return this.result(p, body.requestId);
  }
  result(p: VerifiedAccessPrincipal | undefined, requestId: unknown) {
    if (!this.owners.fresh(p) || typeof requestId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(requestId)) fail('verified_access_required');
    const e = this.entries.get(requestId);
    if (!e) return this.owners.result(p, requestId);
    if (!samePrincipal(e.view, p)) fail('owner_request_unavailable');
    if (e.phase === 'waiting' && this.now() >= e.view.expiresAt) this.stop(e, 'expired');
    if (e.phase === 'waiting' && !sameIdentity(e.view, this.options!.generation())) this.stop(e, 'unavailable');
    const recorded = this.owners.result(p, requestId);
    return { ...recorded, ...e.view, state: recorded.state === 'registered' || recorded.state === 'revoked' ? recorded.state : e.state, committing: e.phase === 'committing', guiAvailable: this.available() };
  }
  cancel(p: VerifiedAccessPrincipal | undefined, body: any) {
    strictPermissionObject(body, ['requestId']); const receipt = this.result(p, body.requestId);
    const e = this.entries.get(body.requestId);
    if (e) this.stop(e, 'cancelled');
    else this.owners.cancel(p, body);
    return e ? this.result(p, body.requestId) : receipt;
  }
  async idle() { await Promise.all([...this.tasks]); }
  async dispose() { this.closed = true; for (const e of this.entries.values()) this.stop(e, 'cancelled'); await this.idle(); }
}
