import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteArtifactRegistry, createRemoteTargetRegistry } from '../server/remote-desktop/artifacts.ts';
import { RemoteDesktopStore } from '../server/remote-desktop/store.js';
import type { ConnectionMetadata, TokenCodec } from '../server/remote-desktop/types.js';

const codec: TokenCodec = { scope: 'CurrentUser', mode: 'test', async protect(v) { return Buffer.from(v.map(x => x ^ 0xa5)); }, async unprotect(v) { return Buffer.from(v.map(x => x ^ 0xa5)); } };
const metadata = (): ConnectionMetadata => ({ connection: 'caivi-vm', hostName: 'AI-DESKTOP-01', gui: { address: '192.168.56.10', port: 47831, pinSha256: 'a'.repeat(64), expiresUtc: '2027-01-01T00:00:00.000Z', generation: 'gen-20261030T104225Z-38f5e157' }, transfer: { address: '192.168.56.10', port: 47832, pinSha256: 'b'.repeat(64), expiresUtc: '2027-01-01T00:00:00.000Z', generation: 'gen-20261030T104225Z-38f5e158' } });
async function dir() { return mkdtemp(join(tmpdir(), 'rd-reg-')); }

test('artifact registry only admits staged names and pins verified hash+size', async () => {
  const d = await dir(); try {
    const reg = createRemoteArtifactRegistry(d, codec);
    const staging = join(d, 'approved-artifacts', 'staging');
    await mkdir(staging, { recursive: true });
    await assert.rejects(reg.register('../outside.txt'), /artifact_denied/);
    await assert.rejects(reg.register('C:\\evil.txt'), /artifact_denied/);
    await assert.rejects(reg.register('missing.txt'), /artifact_denied/);
    const bytes = Buffer.from('staged-bytes');
    await writeFile(join(staging, 'report.zip'), bytes);
    await reg.register('report.zip');
    const list = await reg.list();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual(list, [{ name: 'report.zip', sha256, size: bytes.length }]);
    const trusted = await reg.trusted();
    assert.equal(trusted['report.zip'].sha256, sha256);
    assert.equal(trusted['report.zip'].size, bytes.length);
    // Manifest is sealed (not plaintext) on disk.
    const raw = await readFile(join(d, 'approved-artifacts', 'manifest.json'));
    assert(!raw.toString('utf8').includes('report.zip'));
    // Registered file moved out of staging.
    await assert.rejects(reg.register('report.zip'), /artifact_denied/);
    await assert.rejects(reg.register('report.zip'), /artifact_denied/);
    await reg.unregister('report.zip');
    assert.deepEqual(await reg.list(), []);
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('artifact registration rejects a duplicate registered name', async () => {
  const d = await dir(); try {
    const reg = createRemoteArtifactRegistry(d, codec);
    const staging = join(d, 'approved-artifacts', 'staging');
    await mkdir(staging, { recursive: true });
    const bytes = Buffer.from('v1');
    await writeFile(join(staging, 'a.txt'), bytes);
    await reg.register('a.txt');
    // Re-staging the same name is refused, not overwritten.
    await writeFile(join(staging, 'a.txt'), Buffer.from('v2-changed'));
    await assert.rejects(reg.register('a.txt'), /artifact_name_taken/);
    const trusted = await reg.trusted();
    assert.equal(trusted['a.txt'].sha256, createHash('sha256').update(bytes).digest('hex'));
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('picker upload stages bytes without overwriting; unstage removes only staged files', async () => {
  const d = await dir(); try {
    const reg = createRemoteArtifactRegistry(d, codec);
    const staged = await reg.stageUpload('notes.txt', Buffer.from('picker-bytes').toString('base64'));
    assert.equal(staged.name, 'notes.txt');
    assert.equal(staged.size, 12);
    assert.equal(staged.sha256, createHash('sha256').update('picker-bytes').digest('hex'));
    assert.deepEqual(await reg.staged(), [{ name: 'notes.txt', size: 12 }]);
    // Second upload of the same staged name is refused, never overwritten.
    await assert.rejects(reg.stageUpload('notes.txt', Buffer.from('other').toString('base64')), /artifact_name_taken/);
    // Path-shaped and reserved names never reach the filesystem.
    for (const bad of ['../escape.txt', 'a/b.txt', '..x', 'CON.txt', '.hidden', 'name..txt']) await assert.rejects(reg.stageUpload(bad, 'AAAA'), /artifact_denied/);
    await assert.rejects(reg.stageUpload('ok.txt', 'not base64!!'), /artifact_denied/);
    await assert.rejects(reg.stageUpload('ok.txt', 'A'), /artifact_denied/); // not a complete base64 quartet
    // A symlink planted at the staging name is never followed or overwritten.
    let linked = true;
    await symlink(join(d, 'approved-artifacts'), join(d, 'approved-artifacts', 'staging', 'link.txt'), 'junction').catch(() => { linked = false; });
    if (linked) await assert.rejects(reg.stageUpload('link.txt', 'AAAA'), /artifact_name_taken|artifact_denied/);
    // Unstage removes only the staged file; registered files are untouched.
    await reg.unstage('notes.txt');
    assert.deepEqual(await reg.staged(), []);
    await assert.rejects(reg.unstage('notes.txt'), /artifact_denied/);
    await reg.stageUpload('notes.txt', Buffer.from('picker-bytes').toString('base64'));
    await reg.register('notes.txt');
    await assert.rejects(reg.unstage('notes.txt'), /artifact_denied/); // moved to registered, staging path gone
    await assert.rejects(reg.unstage('../approved-artifacts'), /invalid_arguments/);
    // Uploads can never overwrite an already-registered name.
    await assert.rejects(reg.stageUpload('notes.txt', Buffer.from('v2').toString('base64')), /artifact_name_taken/);
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('legacy plaintext manifest fails closed until explicit recover re-verifies bytes', async () => {
  const d = await dir(); try {
    const root = join(d, 'approved-artifacts');
    const staging = join(root, 'staging');
    await mkdir(staging, { recursive: true });
    const bytes = Buffer.from('legacy-bytes');
    await writeFile(join(root, 'legacy.txt'), bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    // A pre-registry plaintext manifest must never be silently trusted.
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ artifacts: [{ name: 'legacy.txt', bytes: bytes.length, sha256, registeredAt: '2026-10-01T00:00:00.000Z' }] }));
    const reg = createRemoteArtifactRegistry(d, codec);
    await assert.rejects(reg.list(), /artifact_manifest_untrusted/);
    await assert.rejects(reg.trusted(), /artifact_manifest_untrusted/);
    await assert.rejects(reg.register('legacy.txt'), /artifact_denied/); // not staged anyway
    await assert.rejects(reg.recover(false), /operator_confirmation_required/);
    const result = await reg.recover(true);
    assert.equal(result.recovered, 1);
    assert.deepEqual(await reg.list(), [{ name: 'legacy.txt', sha256, size: bytes.length }]);
    // The sealed manifest no longer contains plaintext names on disk.
    const raw = await readFile(join(root, 'manifest.json'));
    assert(!raw.toString('utf8').includes('legacy.txt'));
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('recover skips entries whose on-disk bytes no longer verify', async () => {
  const d = await dir(); try {
    const root = join(d, 'approved-artifacts');
    await mkdir(join(root, 'staging'), { recursive: true });
    const bytes = Buffer.from('good');
    await writeFile(join(root, 'good.txt'), bytes);
    await writeFile(join(root, 'tampered.txt'), Buffer.from('different'));
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ artifacts: [
      { name: 'good.txt', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), registeredAt: '2026-10-01T00:00:00.000Z' },
      { name: 'tampered.txt', bytes: 9, sha256: 'a'.repeat(64), registeredAt: '2026-10-01T00:00:00.000Z' },
      { name: '../outside', bytes: 1, sha256: 'b'.repeat(64), registeredAt: '2026-10-01T00:00:00.000Z' },
    ] }));
    const reg = createRemoteArtifactRegistry(d, codec);
    await assert.rejects(reg.list(), /artifact_manifest_untrusted/);
    const result = await reg.recover(true);
    assert.equal(result.recovered, 1);
    assert.deepEqual((await reg.list()).map(a => a.name), ['good.txt']);
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('target registry binds only a live verified identity, never client-supplied values', async () => {
  const d = await dir(); try {
    const file = join(d, 'approved-target.json');
    const store = new RemoteDesktopStore({ file: join(d, 'state.json'), codec });
    await store.configure(metadata());
    await store.approvePin('caivi-vm', 'gui', metadata().gui.pinSha256);
    const token = Buffer.from(randomBytes(32).toString('base64'), 'ascii');
    await store.setToken('caivi-vm', 'gui', token); token.fill(0);
    await store.setEnabled('caivi-vm', true);
    let calls = 0;
    const good = { identity: { pid: 42, hwnd: 9001, hash: 'F'.repeat(64), session: 7 }, uia: 'idle', inspect: {} };
    const target = createRemoteTargetRegistry({ store, transport: async () => { calls++; return { ok: true, outcome: 'KNOWN', authenticated: true, result: good }; }, file });
    // Probe refused until the read grant is on.
    await assert.rejects(target.probe(), /remote_target_probe_refused/);
    assert.equal(calls, 0);
    await store.setGrants('caivi-vm', { read: true });
    await target.probe();
    assert.equal(calls, 1);
    assert.deepEqual(await target.status(), { bound: true });
    // Persisted to disk, and matches() accepts the same identity only.
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(onDisk.hwnd, 9001);
    assert.equal(target.matches(good), true);
    assert.equal(target.matches({ identity: { ...good.identity, hwnd: 1234 } }), false);
    assert.equal(target.matches({}), false);
    await target.clear();
    assert.deepEqual(await target.status(), { bound: false });
    assert.equal(target.matches(good), false);
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('probe rebinds bump the generation; clear invalidates an approval snapshot', async () => {
  const d = await dir(); try {
    const file = join(d, 'approved-target.json');
    const store = new RemoteDesktopStore({ file: join(d, 'state.json'), codec });
    await store.configure(metadata());
    await store.approvePin('caivi-vm', 'gui', metadata().gui.pinSha256);
    await store.setToken('caivi-vm', 'gui', Buffer.from(randomBytes(32).toString('base64'), 'ascii'));
    await store.setEnabled('caivi-vm', true);
    await store.setGrants('caivi-vm', { read: true });
    const target = createRemoteTargetRegistry({ store, transport: async () => ({ ok: true, outcome: 'KNOWN', authenticated: true, result: { identity: { pid: 1, hwnd: 2, hash: 'A'.repeat(64), session: 3 } } }), file });
    const before = target.revision();
    await target.probe();
    const bound = target.revision();
    assert(bound > before);
    // Rebind bumps again so a pending approval snapshotted at `bound` is refused.
    await target.probe();
    const rebound = target.revision();
    assert(rebound > bound);
    await target.clear();
    assert(target.revision() > rebound);
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('probe refuses to bind when the store revision or grant changed mid-transport', async () => {
  const d = await dir(); try {
    const file = join(d, 'approved-target.json');
    const store = new RemoteDesktopStore({ file: join(d, 'state.json'), codec });
    await store.configure(metadata());
    await store.approvePin('caivi-vm', 'gui', metadata().gui.pinSha256);
    await store.setToken('caivi-vm', 'gui', Buffer.from(randomBytes(32).toString('base64'), 'ascii'));
    await store.setEnabled('caivi-vm', true);
    await store.setGrants('caivi-vm', { read: true });
    // Revoke the read grant inside the transport call — the probe must not bind.
    const target = createRemoteTargetRegistry({ store, transport: async () => { await store.setGrants('caivi-vm', { read: false }); return { ok: true, outcome: 'KNOWN', authenticated: true, result: { identity: { pid: 1, hwnd: 2, hash: 'A'.repeat(64), session: 3 } } }; }, file });
    await assert.rejects(target.probe(), /connection_changed/);
    assert.equal(target.matches({ identity: { pid: 1, hwnd: 2, hash: 'A'.repeat(64), session: 3 } }), false);
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('target probe stays available while a write ledger is latched', async () => {
  const d = await dir(); try {
    const file = join(d, 'approved-target.json');
    const store = new RemoteDesktopStore({ file: join(d, 'state.json'), codec });
    await store.configure(metadata());
    await store.approvePin('caivi-vm', 'gui', metadata().gui.pinSha256);
    const token = Buffer.from(randomBytes(32).toString('base64'), 'ascii');
    await store.setToken('caivi-vm', 'gui', token); token.fill(0);
    await store.setEnabled('caivi-vm', true);
    await store.setGrants('caivi-vm', { read: true });
    let calls = 0;
    const target = createRemoteTargetRegistry({ store, transport: async () => { calls++; return { ok: true, outcome: 'KNOWN', authenticated: true, result: { identity: { pid: 1, hwnd: 2, hash: 'A'.repeat(64), session: 3 } } }; }, file });
    await store.latchPending('caivi-vm', 'gui', 'caivi_click', 'a'.repeat(32));
    await target.probe();
    assert.equal(calls, 1);
    assert.deepEqual(await target.status(), { bound: true });
  } finally { await rm(d, { recursive: true, force: true }); }
});
