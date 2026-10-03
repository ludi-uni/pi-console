import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { readWorkspaceText, expandWindowsFilePath } from '../server/runtime/workspace-text.ts';
import { openWorkspaceMedia } from '../server/runtime/workspace-media.ts';

test('Windows preview aliases are case-insensitive, bounded and never evaluated as shell expressions', () => {
  const env = { Temp: 'C:\\Temp Folder', USERPROFILE: 'C:\\Users\\demo', LITERAL: '%TEMP%', BAD: 'bad\0path', LARGE: 'x'.repeat(4097) };
  for (const path of ['%TEMP%\\note.txt', '$env:temp\\note.txt', '${env:TeMp}\\note.txt']) {
    assert.equal(expandWindowsFilePath(path, env), 'C:\\Temp Folder\\note.txt');
  }
  assert.equal(expandWindowsFilePath('~/note.txt', env), 'C:\\Users\\demo/note.txt');
  assert.equal(expandWindowsFilePath('~\\note.txt', env), 'C:\\Users\\demo\\note.txt');
  assert.equal(expandWindowsFilePath('%LITERAL%/note.txt', env), '%TEMP%/note.txt');
  assert.equal(expandWindowsFilePath('docs/note.txt', env), 'docs/note.txt');
  assert.equal(expandWindowsFilePath('$(Get-Content secret)/note.txt', env), '$(Get-Content secret)/note.txt');
  for (const path of ['%MISSING%/note.txt', '$env:MISSING/note.txt', '${env:MISSING}/note.txt']) {
    assert.throws(() => expandWindowsFilePath(path, env), /environment variable is unavailable/);
  }
  for (const path of ['%BAD%/note.txt', '%LARGE%/note.txt']) assert.throws(() => expandWindowsFilePath(path, env), /invalid file path/);
});

test('Windows aliases work for text and media without bypassing workspace or path restrictions', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-alias-'));
  const key = 'PI_CONSOLE_TEST_PREVIEW_PATH', previous = process.env[key];
  try {
    const workspace = join(root, 'workspace'); await mkdir(workspace);
    await writeFile(join(workspace, 'note.txt'), 'alias preview');
    await writeFile(join(root, 'secret.txt'), 'outside');
    await writeFile(join(workspace, 'image.png'), Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]));
    const store = new WorkspaceStore(join(root, 'store.json')), registered = await store.add(workspace);
    process.env[key] = workspace;
    for (const path of [`%${key.toLowerCase()}%/note.txt`, `$env:${key}/note.txt`, `\${env:${key}}/note.txt`]) {
      assert.equal((await readWorkspaceText(store, registered.id, path)).content, 'alias preview');
    }
    const media = await openWorkspaceMedia(store, registered.id, `%${key}%/image.png`);
    try { assert.equal(media.format, 'image'); assert.equal(media.path, 'image.png'); } finally { await media.handle.close(); }
    await assert.rejects(readWorkspaceText(store, registered.id, `%${key}%/../secret.txt`), /outside the workspace/);
    for (const target of [root, 'C:relative', '\\\\server\\share', '\\\\?\\C:\\private']) {
      process.env[key] = target;
      await assert.rejects(readWorkspaceText(store, registered.id, `%${key}%/secret.txt`), /outside the workspace|invalid file path/);
    }
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    await rm(root, { recursive: true, force: true });
  }
});

for (const stage of ['before open', 'after open']) {
  test(`text preview rejects a directory junction swap ${stage} before reading and closes its handle`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'pi-console-preview-swap-'));
    let closed = false, reads = 0;
    try {
      const workspace = join(root, 'workspace'), docs = join(workspace, 'docs'), outside = join(root, 'outside');
      await mkdir(docs, { recursive: true }); await mkdir(outside);
      await writeFile(join(docs, 'note.md'), 'inside'); await writeFile(join(outside, 'note.md'), 'outside private data');
      const store = new WorkspaceStore(join(root, 'store.json')), registered = await store.add(workspace);
      const target = await fs.realpath(join(docs, 'note.md')), nativeOpen = fs.open;
      t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const swap = async () => { await fs.rename(docs, join(workspace, 'docs-original')); await symlink(outside, docs, 'junction'); };
        if (args[0] === target && stage === 'before open') await swap();
        const handle = await nativeOpen(...args);
        if (args[0] === target) {
          if (stage === 'after open') {
            // Windows may lock the open file's parent. Model a changed canonical
            // resolution to exercise the post-open guard on every platform.
            const realpath = fs.realpath;
            t.mock.method(fs, 'realpath', async (path: Parameters<typeof fs.realpath>[0]) => path === target ? join(outside, 'note.md') : realpath(path));
          }
          const close = handle.close.bind(handle), read = handle.read.bind(handle);
          t.mock.method(handle, 'close', async () => { closed = true; return close(); });
          t.mock.method(handle, 'read', (...values: any[]) => { reads++; return (read as any)(...values); });
        }
        return handle;
      });
      await assert.rejects(readWorkspaceText(store, registered.id, 'docs/note.md'), /file changed while opening/);
      assert.equal(reads, 0, 'no outside bytes are read'); assert.equal(closed, true);
    } finally { t.mock.restoreAll(); await rm(root, { recursive: true, force: true }); }
  });
}

test('text preview bounds reads even if the file grows after the size check', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-preview-grow-'));
  let closed = false, largestRead = 0;
  try {
    const store = new WorkspaceStore(join(root, 'store.json')), registered = await store.add(root);
    const file = join(root, 'note.md'); await writeFile(file, 'small');
    const target = await fs.realpath(file), nativeOpen = fs.open;
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const handle = await nativeOpen(...args);
      if (args[0] === target) {
        const read = handle.read.bind(handle), close = handle.close.bind(handle);
        t.mock.method(handle, 'close', async () => { closed = true; return close(); });
        t.mock.method(handle, 'read', async (buffer: Buffer, offset: number, length: number, position: number) => {
          largestRead = Math.max(largestRead, length);
          await fs.appendFile(file, 'x'.repeat(256 * 1024));
          return read(buffer, offset, length, position);
        });
      }
      return handle;
    });
    await assert.rejects(readWorkspaceText(store, registered.id, 'note.md'), /exceeds 256 KiB|file changed/);
    assert.equal(largestRead, 256 * 1024 + 1); assert.equal(closed, true);
  } finally { t.mock.restoreAll(); await rm(root, { recursive: true, force: true }); }
});

test('workspace preview accepts supported UTF-8 source and text but rejects unsafe files', async () => {
  const root=await mkdtemp(join(tmpdir(),'pi-console-files-'));
  try {
    const workspace=join(root,'workspace');await mkdir(workspace);
    await mkdir(join(workspace,'docs'));
    const md=join(workspace,'docs','hello.md');await writeFile(md,'# Hello\nこんにちは');
    await writeFile(join(workspace,'note.txt'),'Plain text');
    await writeFile(join(workspace,'main.ts'),'const answer = 42;\n');
    await writeFile(join(workspace,'source.py'),'print("hello")\n');
    await writeFile(join(workspace,'fake.exe'),'not executable');
    await writeFile(join(workspace,'.env'),'SECRET=private');
    await writeFile(join(workspace,'control.js'),'code\u0001binary');
    await writeFile(join(workspace,'binary.txt'),Buffer.from([0xff,0xfe]));
    await writeFile(join(workspace,'nul.txt'),'hello\0world');
    await writeFile(join(workspace,'large.md'),'x'.repeat(256*1024+1));
    const outside=join(root,'secret.md');await writeFile(outside,'private');
    await symlink(root,join(workspace,'outside'),'junction');
    const store=new WorkspaceStore(join(root,'store.json'));
    const registered=await store.add(workspace);
    assert.deepEqual(await readWorkspaceText(store,registered.id,'docs/hello.md'),{path:join('docs','hello.md'),content:'# Hello\nこんにちは',format:'markdown'});
    assert.equal((await readWorkspaceText(store,registered.id,join(workspace,'note.txt'))).content,'Plain text');
    assert.deepEqual(await readWorkspaceText(store,registered.id,'main.ts'),{path:'main.ts',content:'const answer = 42;\n',format:'code'});
    assert.equal((await readWorkspaceText(store,registered.id,'source.py')).format,'code');
    await assert.rejects(readWorkspaceText(store,'missing','docs/hello.md'),/workspace not found/);
    for(const path of ['../secret.md',outside,'outside/secret.md'])await assert.rejects(readWorkspaceText(store,registered.id,path),/outside the workspace/);
    for(const path of ['binary.txt','nul.txt','control.js','large.md','fake.exe','.env'])await assert.rejects(readWorkspaceText(store,registered.id,path));
    await assert.rejects(readWorkspaceText(store,registered.id,'../store.json'),/outside the workspace/);
    await assert.rejects(readWorkspaceText(store,registered.id,'\0bad.md'),/invalid file path/);
    if(process.platform==='win32')for(const path of ['C:secret.md','\\\\server\\share\\secret.md','\\\\?\\C:\\secret.md'])await assert.rejects(readWorkspaceText(store,registered.id,path),/invalid file path/);
  } finally {await rm(root,{recursive:true,force:true});}
});
