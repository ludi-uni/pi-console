import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { readWorkspaceText } from '../server/runtime/workspace-text.ts';

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
