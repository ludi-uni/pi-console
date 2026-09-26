import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { listDirectories, createDirectory } from '../server/runtime/directories.ts';

test('absent or empty path returns safe roots (home, cwd, drive roots)', async () => {
  for (const result of [await listDirectories(), await listDirectories('   ')]) {
    assert.equal(result.path, undefined);
    assert.equal(result.parent, undefined);
    const paths = result.entries.map(e => e.path);
    assert.ok(paths.includes(homedir()));
    assert.ok(paths.includes(process.cwd()));
    assert.ok(result.entries.some(e => /^[A-Z]:\\$/i.test(e.path)));
  }
});

test('specified path returns canonical dir, parent, and immediate child directories only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-dirs-'));
  mkdirSync(join(root, 'alpha'));
  mkdirSync(join(root, 'beta'));
  writeFileSync(join(root, 'note.txt'), 'x');
  mkdirSync(join(root, 'alpha', 'nested'));
  const result = await listDirectories(root);
  assert.equal(result.path, realpathSync(root));
  assert.equal(result.parent, realpathSync(tmpdir()));
  assert.deepEqual(result.entries.map(e => e.name), ['alpha', 'beta']);
  assert.ok(result.entries.every(e => e.path.startsWith(result.path!)));
});

test('drive root has no parent', async () => {
  const root = `${process.cwd().slice(0, 2)}\\`;
  const result = await listDirectories(root);
  assert.equal(result.path, root);
  assert.equal(result.parent, undefined);
  assert.ok(result.entries.length > 0);
});

test('canonicalization collapses redundant segments', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-dirs-'));
  mkdirSync(join(root, 'alpha'));
  const result = await listDirectories(`${root}\\.\\alpha`);
  assert.equal(result.path, realpathSync(join(root, 'alpha')));
});

test('missing path rejects', async () => {
  await assert.rejects(listDirectories(join(tmpdir(), 'pi-console-does-not-exist-xyz')));
});

test('relative, UNC and device paths are rejected', async () => {
  for (const bad of ['.', 'src', '../up', 'relative\\path', '\\\\server\\share', '\\\\?\\C:\\x', '\\\\.\\C:', 'C:drive-relative', '/posix/path']) {
    await assert.rejects(listDirectories(bad), /drive-letter path required|drive-letter root/);
  }
});

test('directory junction resolves as a child entry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-dirs-'));
  mkdirSync(join(root, 'real'));
  try { symlinkSync(join(root, 'real'), join(root, 'link'), 'junction'); } catch { return; }
  const result = await listDirectories(root);
  assert.deepEqual(result.entries.map(e => e.name), ['link', 'real']);
});

test('scanning and results are bounded; truncation flagged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-dirs-'));
  for (let i = 0; i < 260; i++) mkdirSync(join(root, `d${String(i).padStart(3, '0')}`));
  const result = await listDirectories(root);
  assert.equal(result.entries.length, 200);
  assert.equal(result.truncated, true);
});

test('create folder under a canonical local parent, then navigate to it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-create-'));
  try {
    const created = await createDirectory(root, 'new project');
    assert.equal(created.path, realpathSync(join(root, 'new project')));
    assert.equal((await listDirectories(root)).entries.find(entry => entry.name === 'new project')?.path, created.path);
    await assert.rejects(createDirectory(root, 'new project'), { code: 'EEXIST' });
    assert.ok(existsSync(created.path));
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});

test('create rejects path traversal, reserved names and non-local parents without writing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-create-'));
  try {
    for (const name of ['.', '..', '../escape', 'nested\\escape', 'C:drive', 'name/child', 'CON', 'con.txt', 'LPT1.log', 'trailing.', 'trailing ', '', 'bad|name', '  ']) {
      await assert.rejects(createDirectory(root, name), /invalid folder name or parent/);
    }
    for (const parent of ['.', '\\\\server\\share', 'C:drive-relative', '']) {
      await assert.rejects(createDirectory(parent, 'safe'), /invalid folder name or parent/);
    }
    assert.deepEqual((await listDirectories(root)).entries, []);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});

test('root listing deduplicates paths and stays bounded', async () => {
  const entries = (await listDirectories()).entries;
  const keys = entries.map(e => e.path.toLowerCase());
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(entries.length <= 30);
  assert.ok(existsSync(entries[0].path));
});
