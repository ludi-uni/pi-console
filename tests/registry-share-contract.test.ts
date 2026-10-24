import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowsFolderProvider, windowsDirectoryPolicy } from '../server/windows-folder-provider.ts';
import type { WindowsFolderPort, WindowsHandleInfo } from '../server/windows-folder-provider.ts';

// A policy/identity model, NOT an emulation or proof of Windows rename semantics.
function model(registry = 'D:\\Data\\State', alias = true) {
  const guid = '11111111-1111-1111-1111-111111111111';
  let sequence = 0;
  const identities = new Map<string, string>(), live = new Map<object, any>(), rows: any[] = [], created: string[] = [];
  const changes = new Map<string, Partial<WindowsHandleInfo>>();
  const acquire = (drive: string, path: string, policy: any, fresh = false, directory = true) => {
    const g = drive === 'c:' && !alias ? '22222222-2222-2222-2222-222222222222' : guid;
    const key = g + ':' + path.toLowerCase();
    if (!identities.has(key)) identities.set(key, (++sequence).toString(16).padStart(32, '0'));
    const h = {}; live.set(h, { drive, path, policy, info: { volume: g.startsWith('1') ? '0'.repeat(15) + '1' : '0'.repeat(15) + '2', fileId: identities.get(key), volumeGuid: g, stablePath: '\\\\?\\Volume{' + g + '}\\' + path, directory, reparse: false, reparseTag: 0, caseSensitive: false, created: fresh } }); return h;
  };
  const port: WindowsFolderPort = {
    implementation: 'mock',
    openVolumeRoot(drive, policy) { return acquire(drive, '', policy); },
    openDirectory(parent, name, policy) { const p = live.get(parent)!; return acquire(p.drive, [p.path, name].filter(Boolean).join('\\'), policy); },
    info(h) { const p = live.get(h)!; return { ...p.info, ...changes.get(p.path.toLowerCase()) }; },
    assertLocalNtfs() {},
    createDirectory(parent, name, policy) { const p = live.get(parent)!; const path = p.path + '\\' + name; created.push(path); return acquire(p.drive, path, policy, true); },
    createFile(parent, name, bytes, policy) { const p = live.get(parent)!; return acquire(p.drive, p.path + '\\' + name, policy, true, false); },
    close(h) { assert(live.delete(h)); }
  };
  const provider = createWindowsFolderProvider(port, async (entry, guard) => {
    guard();
    // Common ancestors must remain traversal handles; selected parent/children stay pinned.
    for (const h of live.values()) {
      if (h.path === '' || h.path.toLowerCase() === 'data') {
        assert.equal(h.policy.shareWrite, true, 'common ancestor must not deny registry write sharing');
        assert.equal(h.policy.shareDelete, true, 'common ancestor must not deny registry rename sharing');
      }
      if (h.path.toLowerCase().startsWith('data\\allowed')) {
        assert.equal(h.policy, windowsDirectoryPolicy);
        assert.equal(h.policy.shareWrite, false); assert.equal(h.policy.shareDelete, false);
      }
    }
    rows.push(entry); return { id: 'dummy-registration', path: entry.displayPath };
  }, registry);
  return { provider, port, live, rows, created, changes };
}

test('registry sibling contract: common ancestor traversal and selected parent pin coexist through guarded commit', async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Data\\Allowed');
  await m.provider.withParent(pin, () => {}, async tx => { const a = await tx.createDirectory('New'); await tx.gitInit(a); await tx.registerWorkspace(a); });
  assert.equal(m.rows.length, 1); assert.equal(m.live.size, 0);
});
for (const registry of ['D:\\Data\\Allowed', 'D:\\Data\\Allowed\\State', 'C:\\DATA\\ALLOWED\\State']) {
  test('registry inside selected parent is refused before creating children: ' + registry, async () => {
    const m = model(registry);
    await assert.rejects(m.provider.inspect('D:\\Data\\Allowed'), (error: any) => error.code === 'registry_inside_allowed_parent');
    assert.equal(m.created.length, 0); assert.equal(m.live.size, 0); assert.equal(m.rows.length, 0);
  });
}
test('same path components on a different physical volume do not count as registry overlap', async () => {
  const m = model('C:\\Data\\Allowed\\State', false), pin = await m.provider.inspect('D:\\Data\\Allowed');
  await m.provider.withParent(pin, () => {}, async tx => { const a = await tx.createDirectory('New'); await tx.registerWorkspace(a); });
  assert.equal(m.rows.length, 1); assert.equal(m.live.size, 0);
});
test('a changed traversed ancestor still prevents later writes and registration', async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Data\\Allowed');
  await m.provider.withParent(pin, () => {}, async tx => {
    await tx.createDirectory('Partial'); m.changes.set('data', { reparse: true, reparseTag: 0xa0000003 });
    await assert.rejects(tx.createDirectory('Denied')); assert.equal(m.rows.length, 0);
  });
  assert.equal(m.created.length, 1); assert.equal(m.live.size, 0);
});
test('registry proof changing into a reparse point prevents metadata commit', async () => {
  const m = model(), pin = await m.provider.inspect('D:\\Data\\Allowed');
  await m.provider.withParent(pin, () => {}, async tx => {
    const a = await tx.createDirectory('Partial'); m.changes.set('data\\state', { reparse: true, reparseTag: 0xa0000003 });
    await assert.rejects(tx.registerWorkspace(a)); assert.equal(m.rows.length, 0);
  });
  assert.equal(m.created.length, 1); assert.equal(m.live.size, 0);
});
test('native assembly without registry placement is refused before opening handles', () => {
  const m = model();
  assert.throws(() => createWindowsFolderProvider({ ...m.port, implementation: 'native' }, async () => ({ id: 'dummy', path: 'dummy' })), (error: any) => error.code === 'registry_placement_unverified');
  assert.equal(m.live.size, 0); assert.equal(m.created.length, 0);
});

 test('default Console dot-prefixed registry metadata is accepted without authorizing dot parent paths', async () => {
 const x=model('D:\\Users\\dummy\\.pi\\agent\\pi-console');
 const parent=await x.provider.inspect('D:\\Data\\Allowed');
 assert.equal(parent.path,'d:\\data\\allowed');
 await assert.rejects(x.provider.inspect('D:\\Users\\dummy\\.pi'));
 });
 test('internal registry parsing still refuses traversal, UNC/device and invalid components', () => {
 for(const p of ['D:\\State\\.','D:\\State\\..','D:\\State\\x.','D:\\State\\.pi:stream','D:\\State\\.pi\\NUL','D:\\State\\.pi\\a b','\\\\server\\share','\\\\?\\D:\\State'])assert.throws(()=>model(p));
 });
