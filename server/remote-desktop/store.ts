import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { REMOTE_CONNECTION, type ConnectionMetadata, type EndpointMetadata, type RemoteGrant, type RemoteRole, type TokenCodec } from './types.js';

type Ciphertext = string;
type RoleState = { token: Ciphertext | null; pinApproved: boolean };
type Latch = { operation: string; at: string };
type PendingEntry = Latch & { requestId: string; revision: number };
type Grants = Record<RemoteGrant, boolean>;
type Persisted = { schema: 1 | 2; revision: number; connection: ConnectionMetadata | null; enabled: boolean; operatorGranted: boolean; grants: Grants; roles: Record<RemoteRole, RoleState>; pending: Record<string, PendingEntry>; uncertain: Record<string, Latch>; tombstones: Record<string, Latch>; };
export type RemoteDesktopView = Omit<Persisted, 'roles' | 'pending'> & { roles: Record<RemoteRole, { tokenRegistered: boolean; pinApproved: boolean; error: 'uncertain' | null; pending: { operation: string; at: string }[] }> };
export type PrivateDirectory = (directory: string) => Promise<void>;

const roles: RemoteRole[] = ['gui', 'transfer'];
export const grantNames: RemoteGrant[] = ['read', 'operate', 'send'];
const fail = (message: string): never => { throw new Error(message); };
const exact = (value: unknown, keys: string[]) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === keys.length && keys.every(key => Object.hasOwn(value as object, key));
const isHash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const isUtc = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function privateIpv4(value: string) { const octets = value.split('.').map(Number); return octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31); }
function endpoint(value: unknown, role?: RemoteRole): asserts value is EndpointMetadata {
  if (!exact(value, ['address', 'port', 'pinSha256', 'expiresUtc', 'generation']) || typeof (value as EndpointMetadata).address !== 'string' || !/^[A-Za-z0-9.-]{1,253}$/.test((value as EndpointMetadata).address) || !Number.isInteger((value as EndpointMetadata).port) || (value as EndpointMetadata).port < 1 || (value as EndpointMetadata).port > 65535 || !isHash((value as EndpointMetadata).pinSha256) || !isUtc((value as EndpointMetadata).expiresUtc) || typeof (value as EndpointMetadata).generation !== 'string' || !/^gen-\d{8}T\d{6}Z-[a-f0-9]{8}$/i.test((value as EndpointMetadata).generation)) fail('endpoint_invalid');
  if (!privateIpv4((value as EndpointMetadata).address) || role && (value as EndpointMetadata).port !== (role === 'gui' ? 47831 : 47832)) fail('endpoint_invalid');
}
function metadata(value: unknown): asserts value is ConnectionMetadata {
  if (!exact(value, ['connection', 'hostName', 'gui', 'transfer']) || (value as ConnectionMetadata).connection !== REMOTE_CONNECTION || (value as ConnectionMetadata).hostName !== 'AI-DESKTOP-01') fail('connection_invalid'); endpoint((value as ConnectionMetadata).gui, 'gui'); endpoint((value as ConnectionMetadata).transfer, 'transfer'); if ((value as ConnectionMetadata).gui.pinSha256.toLowerCase() === (value as ConnectionMetadata).transfer.pinSha256.toLowerCase()) fail('endpoint_pin_reused');
}
const noGrants = (): Grants => ({ read: false, operate: false, send: false });
const initial = (): Persisted => ({ schema: 2, revision: 0, connection: null, enabled: false, operatorGranted: false, grants: noGrants(), roles: { gui: { token: null, pinApproved: false }, transfer: { token: null, pinApproved: false } }, pending: {}, uncertain: {}, tombstones: {} });
const ledgerKey = /^[a-z0-9-]+:(gui|transfer)$/;
function isLatch(value: unknown): value is Latch { return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Latch).operation === 'string' && isUtc((value as Latch).at); }
// Migration: schema-1 installs predate grants; they adopt the file with zero new grants
// and legacy per-role uncertain latches become pending entries that only an
// authenticated KNOWN-ok proof can retire. Tombstones are never cleared.
function migrate(value: Persisted) { value.schema = 2; if (!value.grants || typeof value.grants !== 'object') value.grants = noGrants(); for (const grant of grantNames) if (typeof value.grants[grant] !== 'boolean') value.grants[grant] = false; if (!value.pending || typeof value.pending !== 'object' || Array.isArray(value.pending)) value.pending = {}; for (const key of Object.keys(value.uncertain)) if (!value.pending[key]) { const latch = value.uncertain[key]; value.pending[key] = { operation: latch.operation, at: latch.at, requestId: 'legacy', revision: -1 }; } }
function validate(value: unknown): asserts value is Persisted {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('remote_store_invalid');
  const state = value as Persisted;
  if (state.schema === 1) migrate(state);
  if (!exact(state, ['schema', 'revision', 'connection', 'enabled', 'operatorGranted', 'grants', 'roles', 'pending', 'uncertain', 'tombstones']) || state.schema !== 2 || !Number.isSafeInteger(state.revision) || state.revision < 0 || typeof state.enabled !== 'boolean' || typeof state.operatorGranted !== 'boolean') fail('remote_store_invalid');
  if (state.connection !== null) metadata(state.connection);
  if (!exact(state.grants, grantNames) || grantNames.some(grant => typeof state.grants[grant] !== 'boolean')) fail('remote_grants_invalid');
  if (!exact(state.roles, roles)) fail('remote_roles_invalid');
  for (const role of roles) { const v = state.roles[role]; if (!exact(v, ['token', 'pinApproved']) || (v.token !== null && (typeof v.token !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.token))) || typeof v.pinApproved !== 'boolean') fail('remote_role_invalid'); }
  if (!state.pending || typeof state.pending !== 'object' || Array.isArray(state.pending) || Object.keys(state.pending).length > 64) fail('remote_ledger_invalid');
  for (const [key, v] of Object.entries(state.pending)) if (!ledgerKey.test(key) || !exact(v, ['operation', 'at', 'requestId', 'revision']) || !isLatch(v) || typeof v.requestId !== 'string' || v.requestId.length > 64 || !Number.isSafeInteger(v.revision) || v.revision < -1) fail('remote_ledger_invalid');
  for (const collection of [state.uncertain, state.tombstones]) { if (!collection || typeof collection !== 'object' || Array.isArray(collection) || Object.keys(collection).length > 64) fail('remote_ledger_invalid'); for (const [key, v] of Object.entries(collection)) if (!ledgerKey.test(key) || !exact(v, ['operation', 'at']) || !isLatch(v)) fail('remote_ledger_invalid'); }
}
function pendingFor(state: Persisted, role: RemoteRole) { return Object.entries(state.pending).filter(([key]) => key.endsWith(`:${role}`)).map(([, v]) => ({ operation: v.operation, at: v.at })); }
function publicView(state: Persisted): RemoteDesktopView { const clone = structuredClone(state) as unknown as RemoteDesktopView & { pending?: unknown }; delete clone.pending; clone.roles = { gui: { tokenRegistered: state.roles.gui.token !== null, pinApproved: state.roles.gui.pinApproved, error: state.uncertain[`${REMOTE_CONNECTION}:gui`] ? 'uncertain' : null, pending: pendingFor(state, 'gui') }, transfer: { tokenRegistered: state.roles.transfer.token !== null, pinApproved: state.roles.transfer.pinApproved, error: state.uncertain[`${REMOTE_CONNECTION}:transfer`] ? 'uncertain' : null, pending: pendingFor(state, 'transfer') } }; return clone; }
export class RemoteDesktopStore {
  #queue = Promise.resolve(); #state: Persisted | null = null;
  constructor(private readonly options: { file: string; codec: TokenCodec; ensurePrivateDirectory?: PrivateDirectory; now?: () => Date }) { if (!path.isAbsolute(options.file) || options.codec.scope !== 'CurrentUser') fail('remote_store_options_invalid'); }
  #entropy(role: RemoteRole) { return Buffer.from(JSON.stringify({ purpose: 'PiConsole.RemoteDesktop.Token.v1', connection: REMOTE_CONNECTION, role })); }
  async load(): Promise<RemoteDesktopView> { if (this.#state) return publicView(this.#state); try { const text = await fs.readFile(this.options.file, 'utf8'); const parsed = JSON.parse(text); validate(parsed); if (parsed.schema !== 2) fail('remote_store_invalid'); this.#state = parsed; } catch (error: any) { if (error?.code === 'ENOENT') this.#state = initial(); else throw error; } return publicView(this.#state!); }
  view() { return this.load(); }
  async #mutate(change: (state: Persisted) => void | Promise<void>): Promise<RemoteDesktopView> { const task = this.#queue.then(async () => { await this.load(); const next = structuredClone(this.#state!); await change(next); next.revision++; validate(next); await this.#write(next); this.#state = next; return publicView(next); }); this.#queue = task.then(() => undefined, () => undefined); return task; }
  async #write(state: Persisted) { const directory = path.dirname(this.options.file); if (this.options.ensurePrivateDirectory) await this.options.ensurePrivateDirectory(directory); else await fs.mkdir(directory, { recursive: true, mode: 0o700 }); const temp = path.join(directory, `.${path.basename(this.options.file)}.${randomUUID()}.tmp`); try { await fs.writeFile(temp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); await fs.rename(temp, this.options.file); } catch (error) { await fs.rm(temp, { force: true }).catch(() => undefined); throw error; } }
  configure(connection: ConnectionMetadata) { metadata(connection); return this.#mutate(state => { for (const role of roles) { if (state.connection && JSON.stringify(state.connection[role]) !== JSON.stringify(connection[role])) state.roles[role].token = null; } state.connection = structuredClone(connection); state.enabled = false; state.operatorGranted = false; state.grants = noGrants(); for (const role of roles) state.roles[role].pinApproved = false; }); }
  edit(connection: ConnectionMetadata) { return this.configure(connection); }
  delete(connection: string) { return this.#mutate(state => { if (connection !== REMOTE_CONNECTION) fail('connection_unavailable'); state.connection = null; state.enabled = false; state.operatorGranted = false; state.grants = noGrants(); for (const role of roles) state.roles[role] = { token: null, pinApproved: false }; }); }
  approvePin(connection: string, role: RemoteRole, pinSha256: string) { return this.#mutate(state => { if (connection !== REMOTE_CONNECTION || !state.connection || !roles.includes(role) || !isHash(pinSha256) || state.connection[role].pinSha256.toLowerCase() !== pinSha256.toLowerCase()) fail('pin_approval_denied'); state.roles[role].pinApproved = true; }); }
  setToken(connection: string, role: RemoteRole, token: Buffer) { if (connection !== REMOTE_CONNECTION || !roles.includes(role) || !Buffer.isBuffer(token) || !/^[A-Za-z0-9+/]{43}=$/.test(token.toString('ascii')) || token.length !== 44 || Buffer.from(token.toString('ascii'), 'base64').toString('base64') !== token.toString('ascii')) fail('token_invalid'); return this.#mutate(async state => { let sealed: Buffer | undefined, other: Buffer | undefined; try { const otherRole = role === 'gui' ? 'transfer' : 'gui'; if (state.roles[otherRole].token) { const cipher = Buffer.from(state.roles[otherRole].token, 'base64'); try { other = await this.options.codec.unprotect(cipher, this.#entropy(otherRole)); } finally { cipher.fill(0); } if (other.equals(token)) fail('token_reused'); } sealed = await this.options.codec.protect(token, this.#entropy(role)); state.roles[role].token = sealed.toString('base64'); } finally { sealed?.fill(0); other?.fill(0); } }); }
  setEnabled(connection: string, enabled: boolean) { return this.#mutate(state => { if (connection !== REMOTE_CONNECTION || typeof enabled !== 'boolean' || !state.connection) fail('connection_unavailable'); state.enabled = enabled; if (!enabled) state.operatorGranted = false; }); }
  disable(connection: string) { return this.setEnabled(connection, false); }
  grantOperator(connection: string, granted: boolean) { return this.#mutate(state => { if (connection !== REMOTE_CONNECTION || typeof granted !== 'boolean' || !state.connection) fail('connection_unavailable'); state.operatorGranted = granted; }); }
  // Connection-scoped capability grants. Granting 'operate' requires 'read': the fixed
  // guest operations need the same GUI token, pin and approved target as inspection.
  setGrants(connection: string, grants: Partial<Grants>) { return this.#mutate(state => { if (connection !== REMOTE_CONNECTION || !state.connection || !grants || typeof grants !== 'object' || Array.isArray(grants) || Object.keys(grants).some(key => !grantNames.includes(key as RemoteGrant)) || Object.values(grants).some(value => typeof value !== 'boolean')) fail('remote_grants_invalid'); const next = { ...state.grants, ...grants as Grants }; if (next.operate && !next.read) fail('remote_grant_requires_read'); state.grants = next; }); }
  // Dispatched writes are journaled per-request BEFORE transport. The entry exists so a
  // lost reply is never silently resent; only an authenticated KNOWN-ok proof may retire
  // it, and only the exact entry this request created.
  latchPending(connection: string, role: RemoteRole, operation: string, requestId: string) { if (!/^[a-f0-9]{32}$/.test(requestId)) fail('remote_request_invalid'); return this.#mutate(state => { if (connection !== REMOTE_CONNECTION || !roles.includes(role)) fail('connection_unavailable'); const key = `${connection}:${role}`; if (state.pending[key]) fail('remote_write_pending'); const entry: PendingEntry = { operation, at: (this.options.now ?? (() => new Date()))().toISOString(), requestId, revision: state.revision }; state.pending[key] = entry; }); }
  resolvePending(connection: string, role: RemoteRole, requestId: string) { return this.#mutate(state => { const entry = state.pending[`${connection}:${role}`]; if (!entry || entry.requestId !== requestId) fail('remote_pending_mismatch'); delete state.pending[`${connection}:${role}`]; }); }
  abandonPending(connection: string, role: RemoteRole, requestId: string, operation: string) { return this.#mutate(state => { const key = `${connection}:${role}`; const entry = state.pending[key]; if (!entry || entry.requestId !== requestId) return; const latch = { operation, at: entry.at }; delete state.pending[key]; state.uncertain[key] = latch; state.tombstones[key] = latch; }); }
  latchUnknown(connection: string, role: RemoteRole, operation: string) { return this.#mutate(state => { if (connection !== REMOTE_CONNECTION || !roles.includes(role)) fail('connection_unavailable'); const key = `${connection}:${role}`; const latch = { operation, at: (this.options.now ?? (() => new Date()))().toISOString() }; state.uncertain[key] = latch; state.tombstones[key] = latch; }); }
  async token(connection: string, role: RemoteRole, allowLedger = false): Promise<Buffer> { await this.load(); const state = this.#state!, saved = state.roles[role]?.token; const key = `${connection}:${role}`; if (connection !== REMOTE_CONNECTION || !state.connection || !state.enabled || !roles.includes(role) || !state.roles[role].pinApproved || typeof saved !== 'string' || !allowLedger && (state.pending[key] || state.uncertain[key])) fail('remote_authorization_denied'); const sealed = Buffer.from(saved!, 'base64'); try { return await this.options.codec.unprotect(sealed, this.#entropy(role)); } finally { sealed.fill(0); } }
  async current(): Promise<Persisted> { await this.load(); return structuredClone(this.#state!); }
  getConnection() { return this.current(); }
  getToken(connection: string, role: RemoteRole) { return this.token(connection, role); }
  remove(connection: string) { return this.delete(connection); }
}
export { endpoint as validateEndpoint };
