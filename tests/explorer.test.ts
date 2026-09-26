import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { openWorkspaceInExplorer } from '../server/runtime/explorer.ts';

test('Explorer opens only a registered, existing local workspace on Windows', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-explorer-'));
  try {
    const store = new WorkspaceStore(join(root, 'workspaces.json'));
    const workspace = await store.add(root);
    const opened: string[] = [];
    const options = { platform: 'win32' as const, launch: async (path: string) => { opened.push(path); } };
    await openWorkspaceInExplorer(store, workspace.id, options);
    assert.deepEqual(opened, [workspace.path]);
    await assert.rejects(openWorkspaceInExplorer(store, '../outside', options), /workspace not found/);
    await assert.rejects(openWorkspaceInExplorer(store, workspace.path, options), /workspace not found/);
    await assert.rejects(openWorkspaceInExplorer(store, '', options), /workspace ID required/);
    (store as any).items.push({ ...workspace, id: 'network', path: '\\\\server\\share' });
    await assert.rejects(openWorkspaceInExplorer(store, 'network', options), /local Windows directory/);
    assert.equal(opened.length, 1);
    await assert.rejects(openWorkspaceInExplorer(store, workspace.id, { ...options, launch: async () => { throw new Error('Explorer unavailable'); } }), /Explorer unavailable/);
    await assert.rejects(openWorkspaceInExplorer(store, workspace.id, { ...options, platform: 'linux' }), /only available on the Windows host/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
