import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareUpgrade} from '../package/prepare-upgrade.mjs';

const item=(id,path)=>({id,path,name:id,pinned:false,lastOpenedAt:'2025-01-01T00:00:00.000Z'});
const save=(path,data)=>writeFile(path,JSON.stringify(data));

test('pre-upgrade snapshots both registries, previews missing registrations, and merges only missing data on explicit apply',async()=>{
  const root=await mkdtemp(join(tmpdir(),'console-upgrade-')),legacyDir=join(root,'installed','.pi-console'),dataDir=join(root,'stable');
  try{
    await mkdir(legacyDir,{recursive:true});await mkdir(dataDir);
    const stable={workspaces:[item('stable','C:\\A')],quickPrompts:['Keep stable prompt']};
    const legacy={workspaces:[item('old-a','C:\\A'),item('old-b','C:\\B')],quickPrompts:['Keep stable prompt']};
    await save(join(dataDir,'workspaces.json'),stable);await save(join(legacyDir,'workspaces.json'),legacy);
    await save(join(legacyDir,'session-retention.json'),{enabled:true,days:14});
    const preview=await prepareUpgrade({legacyDir,dataDir});
    assert.equal(preview.status,'preview');assert.equal(preview.missing,1);
    assert.deepEqual(JSON.parse(await readFile(join(dataDir,'workspaces.json'),'utf8')),stable);
    assert.deepEqual(JSON.parse(await readFile(join(preview.backup,'legacy-workspaces.json'),'utf8')),legacy);
    assert.deepEqual(JSON.parse(await readFile(join(preview.backup,'stable-workspaces.json'),'utf8')),stable);
    const applied=await prepareUpgrade({legacyDir,dataDir,apply:true});
    assert.equal(applied.status,'applied');
    const result=JSON.parse(await readFile(join(dataDir,'workspaces.json'),'utf8'));
    assert.deepEqual(result.workspaces,[stable.workspaces[0],legacy.workspaces[1]]);
    assert.deepEqual(result.quickPrompts,stable.quickPrompts);
    assert.deepEqual(JSON.parse(await readFile(join(dataDir,'session-retention.json'),'utf8')),{enabled:true,days:14});
  }finally{await rm(root,{recursive:true,force:true})}
});

test('pre-upgrade retains differing stable prompts and retention settings and refuses automatic merge',async()=>{
  const root=await mkdtemp(join(tmpdir(),'console-upgrade-')),legacyDir=join(root,'installed','.pi-console'),dataDir=join(root,'stable');
  try{
    await mkdir(legacyDir,{recursive:true});await mkdir(dataDir);
    const stable={workspaces:[item('same','C:\\A')],quickPrompts:['stable']};
    const old={workspaces:[item('same','C:\\DIFFERENT'),item('missing','C:\\B')],quickPrompts:['old']};
    await save(join(dataDir,'workspaces.json'),stable);await save(join(legacyDir,'workspaces.json'),old);
    await save(join(dataDir,'session-retention.json'),{enabled:false,days:7});
    await save(join(legacyDir,'session-retention.json'),{enabled:true,days:30});
    const result=await prepareUpgrade({legacyDir,dataDir,apply:true});
    assert.equal(result.status,'needs-review');assert.equal(result.missing,1);assert.equal(result.conflicts.length,3);
    assert.deepEqual(JSON.parse(await readFile(join(dataDir,'workspaces.json'),'utf8')),stable);
    assert.deepEqual(JSON.parse(await readFile(join(dataDir,'session-retention.json'),'utf8')),{enabled:false,days:7});
    assert.deepEqual(JSON.parse(await readFile(join(result.backup,'legacy-workspaces.json'),'utf8')),old);
  }finally{await rm(root,{recursive:true,force:true})}
});

test('pre-upgrade rejects a backup location inside the replaceable package',async()=>{
  const root=await mkdtemp(join(tmpdir(),'console-upgrade-'));
  try{
    await assert.rejects(prepareUpgrade({legacyDir:join(root,'package','.pi-console'),dataDir:join(root,'package','backups')}),/outside the replaceable package/);
  }finally{await rm(root,{recursive:true,force:true})}
});

test('pre-upgrade supports the old array registry without inventing metadata',async()=>{
  const root=await mkdtemp(join(tmpdir(),'console-upgrade-')),legacyDir=join(root,'installed','.pi-console'),dataDir=join(root,'stable');
  try{
    await mkdir(legacyDir,{recursive:true});await save(join(legacyDir,'workspaces.json'),[item('legacy','C:\\Old')]);
    const result=await prepareUpgrade({legacyDir,dataDir,apply:true});
    assert.equal(result.status,'applied');assert.equal(result.missing,1);
    assert.deepEqual(JSON.parse(await readFile(join(dataDir,'workspaces.json'),'utf8')),[item('legacy','C:\\Old')]);
  }finally{await rm(root,{recursive:true,force:true})}
});

test('pre-upgrade keeps malformed legacy data in a backup and refuses to write stable data',async()=>{
  const root=await mkdtemp(join(tmpdir(),'console-upgrade-')),legacyDir=join(root,'installed','.pi-console'),dataDir=join(root,'stable');
  try{
    await mkdir(legacyDir,{recursive:true});await writeFile(join(legacyDir,'workspaces.json'),'{broken');
    await assert.rejects(prepareUpgrade({legacyDir,dataDir,apply:true}),SyntaxError);
    const backups=(await readdir(dataDir)).filter(name=>name.startsWith('pre-upgrade-'));
    assert.equal(backups.length,1);
    assert.equal(await readFile(join(dataDir,backups[0],'legacy-workspaces.json'),'utf8'),'{broken');
    await assert.rejects(readFile(join(dataDir,'workspaces.json'),'utf8'),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true})}
});
