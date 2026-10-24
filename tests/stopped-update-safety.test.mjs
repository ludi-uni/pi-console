import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {backupStoppedPrefix,restoreStoppedPrefix} from '../package/stopped-update-prefix.mjs';
import {acquireStoppedUpdateLock} from '../package/stopped-update.mjs';
test('runtime/auth nested inside npm software is refused and untouched',async t=>{
  const sandbox=await mkdtemp(join(tmpdir(),'pi-stopped-safety-'));t.after(()=>rm(sandbox,{recursive:true,force:true}));
  const prefix=join(sandbox,'prefix'),dataDir=join(sandbox,'stable'),backupRoot=join(sandbox,'backups');
  await mkdir(join(prefix,'node_modules','console','auth'),{recursive:true});await mkdir(dataDir);
  const p=join(prefix,'node_modules','console','auth','dummy');await writeFile(p,'dummy-stable-auth');
  await assert.rejects(backupStoppedPrefix({sandbox,prefix,dataDir,backupRoot,id:'backup'}),/stable\/runtime/);
  assert.equal(await readFile(p,'utf8'),'dummy-stable-auth');
});
test('new stable state in partial software prevents quarantine/restore',async t=>{
  const sandbox=await mkdtemp(join(tmpdir(),'pi-stopped-safety-'));t.after(()=>rm(sandbox,{recursive:true,force:true}));
  const prefix=join(sandbox,'prefix'),dataDir=join(sandbox,'stable'),backupRoot=join(sandbox,'backups');
  await mkdir(prefix);await mkdir(dataDir);await writeFile(join(prefix,'software.js'),'old');
  const args={sandbox,prefix,dataDir,backupRoot};const backup=await backupStoppedPrefix({...args,id:'backup'});
  await writeFile(join(prefix,'software.js'),'partial');await writeFile(join(prefix,'server-state.json'),'dummy-new-state');
  await assert.rejects(restoreStoppedPrefix({...args,backup}),/stable\/runtime/);
  assert.equal(await readFile(join(prefix,'software.js'),'utf8'),'partial');assert.equal(await readFile(join(prefix,'server-state.json'),'utf8'),'dummy-new-state');
});
test('permission/auth/receipt state accidentally inside software is never backed up or restored',async t=>{
  const sandbox=await mkdtemp(join(tmpdir(),'pi-stopped-permission-safety-'));t.after(()=>rm(sandbox,{recursive:true,force:true}));
  const prefix=join(sandbox,'prefix'),dataDir=join(sandbox,'stable'),backupRoot=join(sandbox,'backups');
  await mkdir(prefix);await mkdir(dataDir);await writeFile(join(prefix,'software.js'),'old');
  const args={sandbox,prefix,dataDir,backupRoot};const backup=await backupStoppedPrefix({...args,id:'clean'});
  for(const name of ['readonly-mcp.key','readonly-mcp-scope.json','workspace-permissions.json','workspace-permissions.json.lock','dots-permission-receipts','prompt-receipts','control-mcp']){
    const file=join(prefix,name);await writeFile(file,'dummy-stable-never-copy');
    await assert.rejects(backupStoppedPrefix({...args,id:'blocked'}),/stable\/runtime/);
    await assert.rejects(restoreStoppedPrefix({...args,backup}),/stable\/runtime/);
    assert.equal(await readFile(file,'utf8'),'dummy-stable-never-copy');
    assert.equal(await readFile(join(prefix,'software.js'),'utf8'),'old');
    await rm(file);
  }
});
test('lock initialization failure retains partial evidence without theft',async()=>{
  let removed=false,closed=false;
  await assert.rejects(acquireStoppedUpdateLock('dummy',{openFile:async()=>({writeFile:async()=>{throw Error('dummy disk failure');},close:async()=>{closed=true;}}),remove:async()=>{removed=true;}}),/incomplete lock retained/);
  assert.equal(removed,false);assert.equal(closed,true);
});
