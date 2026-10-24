import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowsFolderProvider, windowsDirectoryPolicy, windowsTraversalPolicy, emptyRepositoryLayout } from '../server/windows-folder-provider.ts';
import type { WindowsFolderPort, WindowsHandle, WindowsHandleInfo } from '../server/windows-folder-provider.ts';
import { managedFolderProvider } from '../server/managed-workspace-registration.ts';
import { FolderMcp } from '../server/folder-mcp.ts';

function model() {
  let serial = 0, rejected = '@none', replaced = false, closeFailure = false, reparse = '@none', sensitive = '@none', denied = '@none';
  const live = new Set<object>(), events: any[] = [], files = new Map<string, string>(), registered: any[] = [], infos = new Map<object, WindowsHandleInfo>(), tampered = new Map<string, Partial<WindowsHandleInfo>>();
  const volume = '0000000000000001', guid = '11111111-1111-1111-1111-111111111111';
  const handle = (path: string, directory: boolean, isNew = false) => { const h = {}; live.add(h); infos.set(h, { volume, fileId: (++serial).toString(16).padStart(32, '0'), volumeGuid: guid, stablePath: '\\\\?\\Volume{' + guid + '}\\' + path, directory, reparse: false, reparseTag: 0, caseSensitive: false, created: isNew }); return h; };
  // Stable existing identities; newly opened handles still refer to the same modeled file.
  const identities = new Map<string, string>();
  const existing = (path: string) => { if (denied === path) throw Error('sharing'); const h = handle(path, true); const i = infos.get(h)!; if (!identities.has(path)) identities.set(path, i.fileId); i.fileId = identities.get(path)!; if (replaced && path === 'allowed') i.fileId = 'f'.repeat(32); if (reparse === path) { i.reparse = true; i.reparseTag = 0xa0000003; } if (sensitive === path) i.caseSensitive = true; return h; };
  const pathOf = (h: object) => infos.get(h)!.stablePath.split('}\\')[1];
  const port: WindowsFolderPort = {
    implementation: 'mock',
    openVolumeRoot(drive, policy) { events.push(['root', drive, policy]); return existing(''); },
    openDirectory(parent, name, policy) { events.push(['open', pathOf(parent), name, policy]); return existing([pathOf(parent), name].filter(Boolean).join('\\')); },
    info(h) { if (!live.has(h)) throw Error('closed'); return { ...infos.get(h)!, ...tampered.get(pathOf(h)) }; },
    assertLocalNtfs() {},
    createDirectory(parent, name, policy) { events.push(['create', pathOf(parent), name, policy]); const path = [pathOf(parent), name].filter(Boolean).join('\\'); if (rejected === path || [...files.keys()].some(p => p.toLowerCase() === path.toLowerCase())) throw Error('exists_or_io_failure'); files.set(path, '<directory>'); return handle(path, true, true); },
    createFile(parent, name, bytes, policy) { const path = pathOf(parent) + '\\' + name; events.push(['file', path, policy]); if (rejected === path || [...files.keys()].some(p => p.toLowerCase() === path.toLowerCase())) throw Error('file_exists_or_io_failure'); files.set(path, Buffer.from(bytes).toString('utf8')); return handle(path, false, true); },
    close(h) { events.push(['close', pathOf(h)]); if (closeFailure) { closeFailure = false; throw Error('close'); } live.delete(h); }
  };
  const provider = createWindowsFolderProvider(port, async (entry, guard) => { guard(); registered.push(entry); return { id: 'dummy-w', path: entry.displayPath }; });
  return { port, provider, events, files, registered, live, tamper: (p: string, changes: Partial<WindowsHandleInfo>) => tampered.set(p, changes), replace: () => { replaced = true; }, reparse: (p: string) => { reparse = p; }, sensitive: (p: string) => { sensitive = p; }, deny: (p: string) => { denied = p; }, fail: (p: string) => { rejected = p; }, failClose: () => { closeFailure = true; }, forceCleanup: () => live.clear() };
}
test('provider walks one component per pinned handle; returns volume+file identity and closes in reverse', async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Allowed'); assert.equal(pin.path, 'd:\\allowed'); assert.equal(m.live.size, 0);
  assert.deepEqual(m.events.filter(v => v[0] === 'open').map(v => v.slice(1, 3)), [['', 'allowed']]);
  assert(m.events.filter(v => v[0] === 'root').every(v => v.at(-1) === windowsTraversalPolicy));
  assert(m.events.filter(v => v[0] === 'open').every(v => v.at(-1) === windowsDirectoryPolicy));
  const closes = m.events.filter(v => v[0] === 'close').map(v => v[1]); assert.deepEqual(closes, ['allowed', '']);
});
test('real source orchestration creates child and fixed empty local repo using exclusive relative operations', async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Allowed');
  await m.provider.withParent(pin, () => {}, async tx => { const a = await tx.createDirectory('New'); await tx.gitInit(a); const w = await tx.registerWorkspace(a); assert.equal(w.path, 'd:\\allowed\\New'); });
  assert.equal(m.files.get('allowed\\New\\.git\\HEAD'), 'ref: refs/heads/main\n'); assert(m.files.get('allowed\\New\\.git\\config')!.includes('repositoryformatversion = 0'));
  assert.equal(m.registered.length, 1); assert(m.registered[0].stablePath.startsWith('\\\\?\\Volume{')); assert.equal(m.registered[0].displayPath, 'd:\\allowed\\New'); assert.equal(m.live.size, 0);
  assert(![...m.files.keys()].some(p => /hooks|remote|template/.test(p))); assert(emptyRepositoryLayout.files.every(f => !f.content.includes('url')));
});
for (const mode of ['replace', 'reparse', 'sensitive', 'sharing']) test('no create on ' + mode, async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Allowed');
  if (mode === 'replace') m.replace(); if (mode === 'reparse') m.reparse('allowed'); if (mode === 'sensitive') m.sensitive('allowed'); if (mode === 'sharing') m.deny('allowed');
  await assert.rejects(m.provider.withParent(pin, () => {}, tx => tx.createDirectory('X'))); assert.equal(m.files.size, 0); assert.equal(m.live.size, 0);
});
test('volume root reparse denied and released', async () => { const m = model(); m.reparse(''); await assert.rejects(m.provider.inspect('D:\\Allowed')); assert.equal(m.live.size, 0); });
test('artifact forgery, duplicate directory, duplicate init and use after lease are rejected', async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Allowed'); let late: (() => Promise<any>) | undefined;
  await m.provider.withParent(pin, () => {}, async tx => {
    await assert.rejects(tx.gitInit({ name: 'forged', path: 'd:\\allowed\\forged' })); const a = await tx.createDirectory('X');
    await assert.rejects(tx.createDirectory('X')); await tx.gitInit(a); await assert.rejects(tx.gitInit(a)); late = () => tx.registerWorkspace(a);
  }); await assert.rejects(late!()); assert.equal(m.registered.length, 0); assert.equal(m.live.size, 0);
});
test('expiry between repo steps prevents further writes and retains partial artifacts without deletion', async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Allowed'); let checks = 0;
  await assert.rejects(m.provider.withParent(pin, () => { if (++checks > 10) throw Error('expired'); }, async tx => { const a = await tx.createDirectory('Partial'); await tx.gitInit(a); }));
  assert(m.files.size > 0); assert.equal(m.registered.length, 0); assert.equal(m.live.size, 0);
});
test('repo file write failure closes every lease; no workspace registration or overwrite retry', async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Allowed'); m.fail('allowed\\Partial\\.git\\config');
  await assert.rejects(m.provider.withParent(pin, () => {}, async tx => { const a = await tx.createDirectory('Partial'); await tx.gitInit(a); await tx.registerWorkspace(a); }));
  assert(m.files.has('allowed\\Partial')); assert.equal(m.registered.length, 0); assert.equal(m.live.size, 0);
});
test('close failure poisons provider and closes remaining handles, requiring explicit recovery', async () => {
  const m = model(); m.failClose(); await assert.rejects(m.provider.inspect('D:\\Allowed')); const before = m.events.length;
  await assert.rejects(m.provider.inspect('D:\\Allowed')); assert.equal(m.events.length, before); m.forceCleanup();
});

test('failed init cannot be caught and then registered; duplicate registration also rejected', async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Allowed'); m.fail('allowed\\Partial\\.git\\config');
  await m.provider.withParent(pin, () => {}, async tx => { const a = await tx.createDirectory('Partial'); await assert.rejects(tx.gitInit(a)); await assert.rejects(tx.registerWorkspace(a)); });
  await m.provider.withParent(pin, () => {}, async tx => { const a = await tx.createDirectory('Plain'); await tx.registerWorkspace(a); await assert.rejects(tx.registerWorkspace(a)); });
  assert.equal(m.registered.length, 1); assert.equal(m.live.size, 0);
});

test('FolderMcp uses source provider/registration assembly with separated metadata-only grants and receipts', async () => {
  const m = model(), rows: any[] = []; let issues = 0;
  const provider = managedFolderProvider(m.port, { managedRegistryDirectory: () => 'D:\\State', async registerManagedNew(entry, guard) { guard(); rows.push(entry); return { id: 'dummy-workspace', name: entry.name, path: entry.stablePath, pinned: false, lastOpenedAt: 'dummy' }; } });
  const app = new FolderMcp(provider, { secret: () => (++issues).toString(16).padStart(64, '0') });
  try {
    const pair = app.request({ name: 'Dummy generic client' });
    const review = await app.review({ connectionId: pair.connectionId, parent: 'D:\\Allowed', operations: ['list', 'directory', 'repo', 'workspace'], expiresAt: Date.now() + 60000 });
    await app.approve({ reviewId: review.reviewId, requestId: review.requestId, confirmed: true }, () => {});
    const claim = app.claim({ connectionId: pair.connectionId, proof: pair.proof }); assert.equal(claim.state, 'connected'); const token = (claim as any).token;
    const args = { requestId: 'operation-one', parent: 'D:\\Allowed', name: 'Repo', repo: true, workspace: true };
    const result = await app.call(token, 'create_managed_workspace', args); assert('state' in result); assert.equal(result.state, 'completed');
    await assert.rejects(app.call(token, 'create_managed_workspace', args)); assert.equal(rows.length, 1);
    const listing = await app.call(token, 'list_allowed_parents', {}); assert('workspaces' in listing); assert.equal(listing.workspaces.length, 1); assert(!('history' in listing));
    assert.deepEqual(await app.call(token, 'get_operation', { requestId: args.requestId }), result);
    await assert.rejects(app.call(token, 'final_answer', {}));
    await app.revoke({ connectionId: 'all', requestId: 'revoke-one' }, () => {}); await assert.rejects(app.call(token, 'list_allowed_parents', {}));
    assert.equal(m.live.size, 0); assert.equal(rows.length, 1); assert.equal(m.files.get('allowed\\Repo\\.git\\HEAD'), 'ref: refs/heads/main\n');
  } finally { app.dispose(); }
});

for (const [name, change] of Object.entries({ nonDirectory: { directory: false }, anyReparseTag: { reparseTag: 1 }, createdOnOpen: { created: true }, wrongPhysicalPath: { stablePath: '\\\\?\\Volume{11111111-1111-1111-1111-111111111111}\\outside' }, wrongVolume: { volume: '2'.repeat(16) } })) test('reject unverifiable native contract: ' + name, async () => {
  const m = model(); m.tamper('allowed', change); await assert.rejects(m.provider.inspect('D:\\Allowed')); assert.equal(m.live.size, 0); assert.equal(m.files.size, 0);
});
test('post-create handle change rejects all later writes and registry effects', async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Allowed');
  await m.provider.withParent(pin, () => {}, async tx => { const a = await tx.createDirectory('New'); m.tamper('allowed', { reparseTag: 1 }); await assert.rejects(tx.gitInit(a)); await assert.rejects(tx.registerWorkspace(a)); });
  assert.equal(m.files.size, 1); assert.equal(m.registered.length, 0); assert.equal(m.live.size, 0);
});
test('case collision across separate operations never overwrites existing modeled directory', async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Allowed');
  await m.provider.withParent(pin, () => {}, tx => tx.createDirectory('New'));
  await assert.rejects(m.provider.withParent(pin, () => {}, tx => tx.createDirectory('new'))); assert.equal(m.files.size, 1); assert.equal(m.live.size, 0);
});
test('unsupported volume proof denies before any child acquisition or creation', async () => {
  const m = model(); m.port.assertLocalNtfs = () => { throw Error('unprovable volume'); };
  await assert.rejects(m.provider.inspect('D:\\Allowed')); assert.equal(m.events.filter(e => e[0] === 'open').length, 0); assert.equal(m.live.size, 0);
});
