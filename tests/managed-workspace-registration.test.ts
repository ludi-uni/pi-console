import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm, access, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import type { ManagedFolderEntry } from '../server/windows-folder-provider.ts';

const entry: ManagedFolderEntry = { displayPath: 'd:\\allowed\\New', name: 'New', stablePath: '\\\\?\\Volume{11111111-1111-1111-1111-111111111111}\\allowed\\New', volume: '0000000000000001', fileId: '1'.repeat(32) };
const old = { id: 'existing-row', name: 'Keep me', path: 'd:\\old', pinned: true, lastOpenedAt: '2000-01-01' };
async function fixture(work: (store: WorkspaceStore, file: string, root: string) => Promise<void>, initial = old) {
  assert(process.env.FOLDER_MCP_TASK_ROOT && process.env.FOLDER_MCP_LIFECYCLE, 'explicit owned Temp root and lifecycle record required');
  const parent = resolve(process.env.FOLDER_MCP_TASK_ROOT), root = await mkdtemp(join(parent, 'dummy-managed-registry-'));
  assert(root.startsWith(parent + '\\dummy-managed-registry-'));
  const lifecycle = process.env.FOLDER_MCP_LIFECYCLE;
  const record = async (value: any) => { if (lifecycle) await appendFile(lifecycle, JSON.stringify({ ...value, kind: 'dummy-managed-registry', root, owner: 'folder-mcp-phase2', repositoryFilesystemMockOnly: true }) + '\n'); };
  await record({ phase: 'created' });
  try {
    const file = join(root, 'registry.json'); await writeFile(file, JSON.stringify({ workspaces: [initial], quickPrompts: ['Keep prompt'] }));
    const store = new WorkspaceStore(file); await store.load(); await work(store, file, root);
  } finally {
    assert(resolve(root).startsWith(parent + '\\dummy-managed-registry-')); await rm(root, { recursive: true, force: true });
    assert.equal(await access(root).then(() => true, () => false), false); await record({ phase: 'closed', tempRemoved: true });
  }
}
test('managed registration appends one fresh row to actual dummy Console metadata, preserving old rows and prompts', async () => {
  await fixture(async (store, file) => {
    const w = await store.registerManagedNew(entry, () => {}); assert.notEqual(w.id, old.id); assert.equal(w.path, entry.stablePath);
    const saved = JSON.parse(await readFile(file, 'utf8')); assert.deepEqual(saved.workspaces[0], old); assert.deepEqual(saved.quickPrompts, ['Keep prompt']);
    const reload = new WorkspaceStore(file); await reload.load(); assert.equal(reload.list().length, 2);
    await assert.rejects(store.registerManagedNew({ ...entry, stablePath: entry.stablePath.toUpperCase() }, () => {})); assert.equal(store.list().length, 2);
  });
});
test('concurrent registration of one physical path commits once and rejects duplicate without reusing row id', async () => {
  await fixture(async store => { const results = await Promise.allSettled([store.registerManagedNew(entry, () => {}), store.registerManagedNew(entry, () => {})]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(store.list().length, 2); });
});
test('stale display-path row is rejected, never updated or reused', async () => {
  const stale = { ...old, path: entry.displayPath };
  await fixture(async (store, file) => { const before = await readFile(file, 'utf8'); await assert.rejects(store.registerManagedNew(entry, () => {})); assert.equal(await readFile(file, 'utf8'), before); assert.deepEqual(store.list(), [stale]); }, stale);
});
test('expiry immediately before atomic registry commit leaves original metadata and no temporary residue', async () => {
  await fixture(async (store, file, root) => { const before = await readFile(file, 'utf8'); let count = 0; await assert.rejects(store.registerManagedNew(entry, () => { if (++count === 4) throw Error('expired'); })); assert.equal(await readFile(file, 'utf8'), before); assert.deepEqual(store.list(), [old]); assert.deepEqual(await readdir(root), ['registry.json']); });
});
test('metadata IO failure cannot leave phantom workspace row or retry into overwrite', async () => {
  await fixture(async (_, file, root) => { await rm(file); await mkdir(file); const store = new WorkspaceStore(file); await assert.rejects(store.registerManagedNew(entry, () => {})); assert.deepEqual(store.list(), []); assert.deepEqual(await readdir(root), ['registry.json']); });
});
test('forged stable path, identity and child name rejected before any metadata effect', async () => {
  await fixture(async (store, file) => { const before = await readFile(file, 'utf8'); for (const bad of [{ ...entry, stablePath: 'd:\\allowed\\New' }, { ...entry, stablePath: entry.stablePath + '\\escape' }, { ...entry, volume: 'bad' }, { ...entry, name: 'other' }, { ...entry, displayPath: '\\\\server\\share' }]) await assert.rejects(store.registerManagedNew(bad, () => {})); assert.equal(await readFile(file, 'utf8'), before); assert.deepEqual(store.list(), [old]); });
});
