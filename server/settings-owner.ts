import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isVerifiedAccessPrincipal, type VerifiedAccessPrincipal, type AccessConfig } from './access.ts';
import { PermissionFault, strictPermissionObject } from './workspace-permissions.ts';

export interface OwnerBinding { subject: string; issuer: string; audience: string }
export interface OwnerRecord { version: 1; owner: OwnerBinding | null; requestId: string; state: 'registered' | 'revoked' }
export interface OwnerStore { read(): Promise<unknown>; write(value: OwnerRecord): Promise<void> }
const id = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v) && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
function fault(code: string): never { throw new PermissionFault(code); }
const binding = (p: VerifiedAccessPrincipal): OwnerBinding => ({ subject: p.subject, issuer: p.issuer, audience: p.audience });
const same = (a: OwnerBinding | null, b: OwnerBinding) => !!a && a.subject === b.subject && a.issuer === b.issuer && a.audience === b.audience;
/** Non-secret owner metadata only. Never read JWTs, legacy credential profiles or env. */
export function ownerFileStore(file: string): OwnerStore {
  return {
    async read() { try { if ((await lstat(file)).isSymbolicLink()) fault('owner_store_unavailable'); return JSON.parse(await readFile(file, 'utf8')); } catch (e: any) { if (e.code === 'ENOENT') return undefined; throw new PermissionFault('owner_store_unavailable'); } },
    async write(value) { await mkdir(dirname(file), { recursive: true }); const temp = file + '.' + randomUUID() + '.tmp'; await writeFile(temp, JSON.stringify(value), { flag: 'wx' }); await rename(temp, file); }
  };
}
export class SettingsOwner {
  private record?: OwnerRecord;
  private intents = new Map<string, { owner: OwnerBinding; expiresAt: number; state: 'pending' | 'cancelled' }>();
  private tail: Promise<unknown> = Promise.resolve();
  private available = false;
  constructor(private store: OwnerStore, private access: AccessConfig | undefined, private now = Date.now) {}
  async load() {
    try {
      const v = await this.store.read() as any;
      if (v !== undefined) {
        strictPermissionObject(v, ['version', 'owner', 'requestId', 'state']);
        if (v.version !== 1 || !id(v.requestId) || !['registered', 'revoked'].includes(v.state) || (v.state === 'revoked') !== (v.owner === null)) fault('owner_store_unavailable');
        if (v.owner !== null) { strictPermissionObject(v.owner, ['subject', 'issuer', 'audience']); if (Object.values(v.owner).some(x => typeof x !== 'string' || !x || x.length > 512)) fault('owner_store_unavailable'); }
        this.record = v as unknown as OwnerRecord;
      }
      this.available = true;
    } catch { this.available = false; }
  }
  fresh(p: VerifiedAccessPrincipal | undefined): p is VerifiedAccessPrincipal { return this.available && !!this.access && isVerifiedAccessPrincipal(p) && p.issuer === this.access.issuer && p.audience === this.access.audience && p.expiresAt > this.now(); }
  owns(p: VerifiedAccessPrincipal | undefined) { return this.fresh(p) && same(this.record?.owner ?? null, p); }
  // Only continuity of a previously explicit transport lease, never new browser authority.
  retainsApprovedIdentity(p: VerifiedAccessPrincipal | undefined) { return this.available && !!this.access && isVerifiedAccessPrincipal(p) && p.issuer===this.access.issuer && p.audience===this.access.audience && same(this.record?.owner??null,p); }
  status(p?: VerifiedAccessPrincipal) { return { available: this.available, accessConfigured: !!this.access, authenticatedOwner: this.owns(p), setupComplete: this.available && !!this.record?.owner }; }
  localView() { return { ...this.status(), owner: this.record?.owner ?? null, recordRequestId: this.record?.requestId, recordState: this.record?.state, intents: [...this.intents].filter(([, v]) => v.state === 'pending' && v.expiresAt > this.now()).map(([requestId, v]) => ({ requestId, ...v })) }; }
  request(p: VerifiedAccessPrincipal | undefined, body: any) {
    strictPermissionObject(body, ['requestId']); if (!this.fresh(p) || !id(body.requestId)) fault('verified_access_required');
    if (this.record?.owner) fault('owner_already_registered');
    const existing = this.intents.get(body.requestId);
    if (existing) { if (!same(existing.owner, p)) fault('owner_request_unavailable'); return this.result(p, body.requestId); }
    // Expired requests stay as tombstones so they cannot be silently restarted.
    if (this.intents.size >= 64) fault('owner_request_capacity');
    this.intents.set(body.requestId, { owner: binding(p), expiresAt: Math.min(p.expiresAt, this.now() + 120000), state: 'pending' }); return this.result(p, body.requestId);
  }
  result(p: VerifiedAccessPrincipal | undefined, requestId: unknown) {
    if (!this.fresh(p) || !id(requestId)) fault('verified_access_required');
    if (this.record?.requestId === requestId && (this.record.state === 'revoked' || same(this.record.owner, p))) return { state: this.record.state, requestId, ...this.status(p) };
    const v = this.intents.get(requestId); if (!v || !same(v.owner, p)) return { state: 'unknown', requestId, ...this.status(p) };
    return { state: v.expiresAt <= this.now() ? 'expired' : v.state, requestId, expiresAt: v.expiresAt, subject: p.subject, ...this.status(p) };
  }
  cancel(p: VerifiedAccessPrincipal | undefined, body: any) {
    strictPermissionObject(body, ['requestId']); const result = this.result(p, body.requestId);
    if (result.state === 'unknown') {
      if (!this.fresh(p) || this.intents.size >= 64) fault('owner_request_capacity');
      this.intents.set(body.requestId, { owner: binding(p), expiresAt: this.now() + 120000, state: 'cancelled' });
    } else if (result.state === 'pending') this.intents.get(body.requestId)!.state = 'cancelled';
    return this.result(p, body.requestId);
  }
  private serial<T>(work: () => Promise<T>): Promise<T> { const next = this.tail.then(work); this.tail = next.catch(() => {}); return next; }
  approve(body: any, trustedLocalOwner: () => void) {
    return this.serial(async () => {
      strictPermissionObject(body, ['requestId', 'confirmed']); trustedLocalOwner();
      const v = this.intents.get(body.requestId);
      if (!this.available || this.record?.owner || !v || v.state !== 'pending' || v.expiresAt <= this.now() || body.confirmed !== true) fault('owner_registration_unavailable');
      const record: OwnerRecord = { version: 1, owner: { ...v.owner }, requestId: body.requestId, state: 'registered' };
      // A write uncertainty closes management until a fresh load reconciles the disk record.
      this.available = false;
      try { trustedLocalOwner(); await this.store.write(record); trustedLocalOwner(); this.record = record; this.available = true; this.intents.clear(); return { state: 'registered', requestId: body.requestId }; }
      catch { fault('owner_registration_result_unknown'); }
    });
  }
  revoke(body: any, owner: () => void, revokeConnections: () => Promise<unknown>) {
    return this.serial(async () => {
      strictPermissionObject(body, ['requestId', 'confirmed']); owner();
      if (!this.available || !this.record?.owner || !id(body.requestId) || body.confirmed !== true || this.record.requestId === body.requestId) fault('owner_registration_unavailable');
      const record: OwnerRecord = { version: 1, owner: null, requestId: body.requestId, state: 'revoked' };
      this.available = false;
      // Remove live grants even if the subsequent metadata write fails.
      try { await revokeConnections(); await this.store.write(record); this.record = record; this.intents.clear(); this.available = true; return { state: 'revoked', requestId: body.requestId }; }
      catch { fault('owner_registration_result_unknown'); }
    });
  }
}
