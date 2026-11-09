import {createHash} from 'node:crypto';
import {appendFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {join, normalize} from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import type {ArtifactView, ApprovedTarget, RemoteTransport, TrustedArtifact} from './types.js';
import type {RemoteDesktopStore} from './store.js';

const fail = (message: string): never => { throw new Error(message); };
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_STAGED = 64;
// Canonical base64 (RFC 4648, no whitespace) covering complete quartets; padding
// only in the final group. Prevents duplicate encodings of the same bytes.
const isCanonicalBase64 = (value: unknown): value is string => typeof value === 'string' && value.length >= 4 && value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
const isName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value) && !value.includes('..') && !value.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value.split('.')[0]);
const isHash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

// Operators stage candidate files either through the browser file picker upload
// (stageUpload, bounded JSON base64) or by copying them into
// approved-artifacts/staging (documented path; Explorer paste). The API never
// accepts an arbitrary host path: only names physically present in the owned
// staging directory can be registered, and registration re-reads the bytes to
// pin the SHA-256/size into the manifest.
export function createRemoteArtifactRegistry(directory: string, codec: { protect(data: Buffer, entropy: Buffer): Promise<Buffer>; unprotect(data: Buffer, entropy: Buffer): Promise<Buffer> }) {
  const root = join(directory, 'approved-artifacts');
  const staging = join(root, 'staging');
  const manifest = join(root, 'manifest.json');
  const entropy = Buffer.from('pi-console/remote-approved-artifacts/v1');
  const inside = (parent: string, name: string) => normalize(join(parent, name)) === join(parent, name);
  // Manifests are only trusted sealed. A plaintext (or otherwise unsealable)
  // manifest.json — e.g. written by a pre-registry install or by hand — is never
  // silently adopted: every read fails closed until the operator explicitly runs
  // the recover action, which re-verifies each entry's on-disk bytes before
  // re-sealing. The unreadable original file is preserved, never rewritten here.
  let manifestUntrusted = false;
  // Monotonic manifest generation. The broker snapshots it before latching a send
  // and re-checks immediately before transport, so an unregister (or re-register)
  // landing in the latch window revokes the dispatch instead of racing it.
  let generation = 0;
  async function readManifest(): Promise<{ artifacts: { name: string; bytes: number; sha256: string; registeredAt: string }[] }> {
    if (manifestUntrusted) fail('artifact_manifest_untrusted');
    try {
      const sealed = await readFile(manifest);
      const raw = await codec.unprotect(sealed, entropy);
      try { const parsed = JSON.parse(raw.toString('utf8')); if (!parsed || !Array.isArray(parsed.artifacts) || parsed.artifacts.length > 64) return { artifacts: [] }; for (const a of parsed.artifacts) if (!a || !isName(a.name) || !isHash(a.sha256) || !Number.isSafeInteger(a.bytes) || a.bytes < 0 || a.bytes > MAX_BYTES || typeof a.registeredAt !== 'string') return { artifacts: [] }; return parsed; }
      finally { raw.fill(0); }
    } catch (error: any) { if (error?.code === 'ENOENT') return { artifacts: [] }; manifestUntrusted = true; throw new Error('artifact_manifest_untrusted'); }
  }
  // Re-adopt a manifest the previous unprotect rejected, but only after parsing
  // it strictly and re-verifying each entry's file bytes/hash on disk. Skips
  // entries whose pinned bytes no longer verify; the sealed rewrite is atomic.
  async function recoverManifest() {
    let text: string;
    try { text = (await readFile(manifest)).toString('utf8'); } catch (error: any) { if (error?.code === 'ENOENT') { manifestUntrusted = false; return { recovered: 0 }; } throw error; }
    let parsed: unknown; try { parsed = JSON.parse(text); } catch { fail('artifact_denied'); }
    const entries = (parsed as any)?.artifacts;
    if (!Array.isArray(entries) || entries.length > 64) fail('artifact_denied');
    const kept: { name: string; bytes: number; sha256: string; registeredAt: string }[] = [];
    for (const entry of entries) {
      if (!entry || !isName(entry.name) || !inside(root, entry.name) || !isHash(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_BYTES || typeof entry.registeredAt !== 'string') continue;
      try { await verifyFile(join(root, entry.name), { sha256: entry.sha256, size: entry.bytes }); kept.push({ name: entry.name, bytes: entry.bytes, sha256: entry.sha256.toLowerCase(), registeredAt: entry.registeredAt }); } catch {}
    }
    await writeManifest({ artifacts: kept });
    manifestUntrusted = false;
    return { recovered: kept.length };
  }
  async function writeManifest(next: { artifacts: { name: string; bytes: number; sha256: string; registeredAt: string }[] }) {
    const sealed = await codec.protect(Buffer.from(JSON.stringify(next), 'utf8'), entropy);
    try { const temp = join(root, `.manifest.${randomUUID()}.tmp`); try { await writeFile(temp, sealed, { mode: 0o600, flag: 'wx' }); await rename(temp, manifest); } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; } }
    finally { sealed.fill(0); }
    generation += 1;
  }
  async function list(): Promise<ArtifactView[]> { const m = await readManifest(); return m.artifacts.map(a => ({ name: a.name, sha256: a.sha256.toLowerCase(), size: a.bytes })); }
  // Guarded against both valid-name aliases and manifest-path escapes (e.g.
  // '.manifest.*.tmp', 'manifest.json' casing variants are rejected because
  // isName allows no leading dot and names must start with alphanumerics). An
  // untrusted manifest contributes no names — the staged list still works and
  // registration keeps failing closed until the operator recovers it.
  const collision = async () => { let m = { artifacts: [] as { name: string }[] }; try { m = await readManifest(); } catch {} return new Set([...m.artifacts.map(a => a.name), 'manifest.json']); };
  async function verifyFile(path: string, expected: { sha256: string; size: number }) {
    const status = await lstat(path); if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1 || status.size !== expected.size || normalize(await realpath(path)) !== normalize(path)) fail('artifact_denied');
    const handle = await open(path, 'r'); try { const before = await handle.stat(); if (!before.isFile() || before.size !== expected.size || before.nlink !== 1) fail('artifact_denied'); const bytes = await handle.readFile(); const after = await handle.stat(); if (before.size !== after.size || createHash('sha256').update(bytes).digest('hex') !== expected.sha256.toLowerCase()) fail('artifact_denied'); } finally { await handle.close(); }
  }
  return {
    stagingDirectory: staging,
    revision: () => generation,
    list,
    async staged() { let names: string[] = []; try { names = await readdir(staging); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; } const out: { name: string; size: number }[] = []; for (const name of names.sort()) { if (!isName(name) || !inside(staging, name)) continue; try { const s = await lstat(join(staging, name)); if (s.isFile() && !s.isSymbolicLink() && s.size <= MAX_BYTES) out.push({ name, size: s.size }); } catch {} } return out; },
    // Stage one operator-picked file: exclusive-create only (never overwrites a
    // staged or registered name), bounded count/size. Bytes stay out of logs and
    // are scrubbed after the write; only name/size/SHA-256 are returned.
    async stageUpload(name: string, base64: string) {
      if (!isName(name) || !inside(staging, name) || !isCanonicalBase64(base64) || base64.length > ((MAX_BYTES + 2) / 3) * 4) fail('artifact_denied');
      const bytes = Buffer.from(base64, 'base64');
      try {
        if (bytes.length > MAX_BYTES) fail('artifact_denied');
        const names = await readdir(staging).catch((error: any) => { if (error?.code === 'ENOENT') return [] as string[]; throw error; });
        if (names.includes(name) || names.length >= MAX_STAGED || (await collision()).has(name)) fail('artifact_name_taken');
        await mkdir(staging, { recursive: true });
        const target = join(staging, name);
        await writeFile(target, bytes, { flag: 'wx', mode: 0o600 }).catch((error: any) => fail(error?.code === 'EEXIST' ? 'artifact_name_taken' : 'artifact_denied'));
        const status = await lstat(target);
        if (!status.isFile() || status.isSymbolicLink() || status.size !== bytes.length || normalize(await realpath(target)) !== normalize(target)) { await rm(target, { force: true }).catch(() => undefined); fail('artifact_denied'); }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        return { name, size: bytes.length, sha256 };
      } finally { bytes.fill(0); }
    },
    // Remove one staged (not yet registered) file after the same name checks;
    // directories and links are never unlinked.
    async unstage(name: string) {
      if (!isName(name) || !inside(staging, name)) fail('invalid_arguments');
      const target = join(staging, name);
      const status = await lstat(target).catch(() => undefined);
      if (!status?.isFile() || status.isSymbolicLink() || normalize(await realpath(target)) !== normalize(target)) fail('artifact_denied');
      await rm(target, { force: false });
      return this.staged();
    },
    async register(name: string) {
      if (!isName(name) || !inside(staging, name)) fail('artifact_denied');
      const stagedPath = join(staging, name);
      const status = await lstat(stagedPath).catch(() => undefined); if (!status) fail('artifact_denied');
      if (!status!.isFile() || status!.isSymbolicLink() || status!.size > MAX_BYTES || normalize(await realpath(stagedPath)) !== normalize(stagedPath)) fail('artifact_denied');
      const bytes = await readFile(stagedPath); const sha256 = createHash('sha256').update(bytes).digest('hex');
      const finalPath = join(root, name);
      try { await lstat(finalPath); fail('artifact_name_taken'); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
      await rename(stagedPath, finalPath);
      const m = await readManifest();
      if (m.artifacts.some(a => a.name === name)) { await rename(finalPath, stagedPath).catch(() => {}); fail('artifact_name_taken'); }
      m.artifacts.push({ name, bytes: bytes.length, sha256, registeredAt: new Date().toISOString() });
      await writeManifest(m);
      return list();
    },
    async unregister(name: string) { if (!isName(name)) fail('invalid_arguments'); const m = await readManifest(); const next = m.artifacts.filter(a => a.name !== name); if (next.length === m.artifacts.length) fail('artifact_denied'); await writeManifest({ artifacts: next }); return list(); },
    // Explicit operator step after artifact_manifest_untrusted: re-validates each
    // legacy entry's on-disk bytes before sealing; never auto-runs at boot.
    async recover(confirmed: boolean) { if (confirmed !== true) fail('operator_confirmation_required'); return recoverManifest(); },
    async trusted(): Promise<Record<string, TrustedArtifact>> { const m = await readManifest(); const trusted: Record<string, TrustedArtifact> = {}; for (const a of m.artifacts) trusted[a.name] = { name: a.name, path: join(root, a.name), size: a.bytes, sha256: a.sha256.toLowerCase() }; return trusted; },
  };
}

// The approved target binds every GUI operation to one verified window identity.
// Identity fields are only ever produced by a live authenticated inspect response;
// the management API accepts no pid/hwnd/hash/session values from any client.
export function createRemoteTargetRegistry({ store, transport, file, candidateTtlMs = 120000, now }: { store: RemoteDesktopStore; transport: RemoteTransport; file: string; candidateTtlMs?: number; now?: () => Date }) {
  let expected: ApprovedTarget | undefined;
  let candidate: { target: ApprovedTarget; expires: number } | undefined;
  // Monotonic bind generation. The broker snapshots it when a GUI write's approval
  // starts and re-checks it before dispatch, so a clear or rebind that happens while
  // an approval is pending can never send an approved operation at a changed target.
  let generation = 0;
  const clock = () => (now ?? (() => new Date()))();
  const identity = (value: unknown): ApprovedTarget | undefined => { const t = (value as any)?.identity; return t && typeof t === 'object' && Number.isInteger(t.pid) && t.pid > 0 && Number.isInteger(t.hwnd) && t.hwnd !== 0 && isHash(t.hash) && (Number.isInteger(t.session) || typeof t.session === 'string') ? { pid: t.pid, hwnd: t.hwnd, hash: String(t.hash).toUpperCase(), session: t.session } : undefined; };
  function parse(raw: unknown): ApprovedTarget | undefined { const t = raw as any; return t && Number.isInteger(t.pid) && t.pid > 0 && Number.isInteger(t.hwnd) && t.hwnd !== 0 && isHash(t.hash) && (Number.isInteger(t.session) || typeof t.session === 'string' && (t.session as string).length <= 128) ? { pid: t.pid, hwnd: t.hwnd, hash: String(t.hash).toUpperCase(), session: t.session } : undefined; }
  const ready = { ready: Promise.resolve() };
  ready.ready = (async () => { try { const saved = JSON.parse(await readFile(file, 'utf8')); if (saved && typeof saved === 'object' && Number.isSafeInteger((saved as any).generation) && (saved as any).generation >= 0) generation = (saved as any).generation; expected = parse(saved); } catch {} })();
  return {
    async expected() { await ready.ready; return expected; },
    matches(result: unknown) { const t = identity(result); return !!expected && !!t && t.pid === expected.pid && t.hwnd === expected.hwnd && t.hash === expected.hash && t.session === expected.session; },
    // One probe inspect both proves the operator's bind intent and captures the
    // candidate identity. Registration is the immediate second step of the same call:
    // the probe already ran, so a second client action cannot swap in a new window.
    async probe() {
      await ready.ready;
      const state = await store.current();
      // The probe is a read: it stays available while a write ledger is latched, just
      // like reobservation. Only writes are gated by pending/UNKNOWN entries.
      if (!state.connection || !state.enabled || !state.grants.read || !state.roles.gui.pinApproved || !state.roles.gui.token) fail('remote_target_probe_refused');
      const connection = state.connection!;
      if (Date.parse(connection.gui.expiresUtc) <= clock().getTime()) fail('certificate_expired');
      const token = await store.token('caivi-vm', 'gui', true);
      try {
        const response = await transport({ endpoint: connection.gui, operation: 'inspect', token });
        // The transport awaited the guest. Before binding whatever window it
        // answered, re-verify that the same configured generation, read grant and
        // unexpired certificate still hold — a mid-probe revoke must not bind.
        const fresh = await store.current();
        if (!response || response.ok !== true || response.outcome !== 'KNOWN' || response.authenticated !== true || !response.result) fail('remote_target_probe_failed');
        if (!fresh.connection || !fresh.enabled || fresh.revision !== state.revision || fresh.grants.read !== true || JSON.stringify(fresh.connection.gui) !== JSON.stringify(connection.gui) || Date.parse(fresh.connection.gui.expiresUtc) <= clock().getTime()) fail('connection_changed');
        const proof = identity(response.result)!;
        if (!proof) fail('remote_target_probe_failed');
        candidate = { target: proof, expires: clock().getTime() + candidateTtlMs };
        generation += 1;
        await writeFile(file, JSON.stringify({ ...proof, generation }), { encoding: 'utf8', mode: 0o600 });
        expected = proof;
        return { bound: true, generation: connection.gui.generation };
      } finally { token.fill(0); }
    },
    async status() { await ready.ready; return { bound: !!expected }; },
    revision() { return generation; },
    async clear() { await ready.ready; expected = undefined; candidate = undefined; generation += 1; await rm(file, { force: true }); },
  };
}
