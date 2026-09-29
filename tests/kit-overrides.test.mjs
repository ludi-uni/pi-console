import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {backupKitOverrides,restoreKitOverrides} from '../package/kit-overrides.mjs';

const file=async path=>readFile(path,'utf8').catch(error=>{if(error.code==='ENOENT')return undefined;throw error});
async function fixture(root){
  const kitDir=join(root,'kit'),dataDir=join(root,'stable');
  for(const folder of ['routing','adapters/pi','lib'])await mkdir(join(kitDir,folder),{recursive:true});
  await writeFile(join(kitDir,'package.json'),JSON.stringify({version:'1.0.0'}));
  await writeFile(join(kitDir,'routing/routing.json'),JSON.stringify({version:1,backends:{first:{}},capabilities:{code:{primary:'first',fallback:[]}}}));
  await writeFile(join(kitDir,'lib/routing.mjs'),`import {readFileSync} from 'node:fs';import {join,dirname} from 'node:path';
export const mergeLocalRouting=(base,local)=>{if(local.version!==1)throw Error('invalid routing version');const caps={...base.capabilities};for(const [name,cap] of Object.entries(local.capabilities)){if(cap===null){if(!caps[name])throw Error('unknown capability');delete caps[name];continue}if(!base.backends[cap.primary])throw Error('missing backend');caps[name]=cap}return {...base,capabilities:caps}};
export const loadRouting=path=>{const base=JSON.parse(readFileSync(path));return base};`);
  await writeFile(join(kitDir,'lib/registry.mjs'),`export const validateRegistry=(data,routing)=>Object.keys(data.backends).filter(key=>!routing.backends[key]).map(key=>'unknown backend '+key);`);
  return {kitDir,dataDir};
}

test('kit overrides are backed up outside the replaceable package and restored only after preview',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-kit-overrides-'));
  try{
    const {kitDir,dataDir}=await fixture(root),routing=join(kitDir,'routing/routing.local.json'),models=join(kitDir,'adapters/pi/models.local.json');
    assert.equal((await backupKitOverrides({kitDir,dataDir})).status,'no-kit-local-overrides');
    const savedRouting=JSON.stringify({version:1,capabilities:{custom:{primary:'first',fallback:[]}}});
    const savedModels=JSON.stringify({version:1,backends:{first:{provider:'test',model:'tiny'}}});
    await writeFile(routing,savedRouting);await writeFile(models,savedModels);
    const saved=await backupKitOverrides({kitDir,dataDir});assert.deepEqual(saved.files,['routing','models']);
    assert.ok(saved.backup.startsWith(dataDir));
    await rm(routing);await rm(models);
    const preview=await restoreKitOverrides({kitDir,dataDir,backup:saved.backup});
    assert.equal(preview.status,'ready');assert.deepEqual(preview.restore,['routing','models']);
    assert.equal(await file(routing),undefined);assert.equal(await file(models),undefined);
    const applied=await restoreKitOverrides({kitDir,dataDir,backup:saved.backup,apply:true});
    assert.equal(applied.status,'restored');assert.equal(await file(routing),savedRouting);assert.equal(await file(models),savedModels);
    assert.equal((await restoreKitOverrides({kitDir,dataDir,backup:saved.backup,apply:true})).status,'already-present');
    await writeFile(routing,'user changed this file');
    const conflict=await restoreKitOverrides({kitDir,dataDir,backup:saved.backup,apply:true});
    assert.equal(conflict.status,'needs-review');assert.match(conflict.conflicts.join(' '),/already exists with different contents/);
    assert.equal(await file(routing),'user changed this file');
    await writeFile(join(saved.backup,'models.json'),'tampered');
    await assert.rejects(restoreKitOverrides({kitDir,dataDir,backup:saved.backup,apply:true}),/integrity check failed/);
  }finally{await rm(root,{recursive:true,force:true})}
});

test('changed kit routing needs explicit review and incompatible overrides cannot be restored',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-kit-overrides-change-'));
  try{
    const {kitDir,dataDir}=await fixture(root),routing=join(kitDir,'routing/routing.local.json'),base=join(kitDir,'routing/routing.json');
    await writeFile(routing,JSON.stringify({version:1,capabilities:{custom:{primary:'first',fallback:[]}}}));
    const saved=await backupKitOverrides({kitDir,dataDir});await rm(routing);
    await writeFile(base,JSON.stringify({version:1,backends:{first:{},second:{}},capabilities:{code:{primary:'first',fallback:[]}}}));
    const blocked=await restoreKitOverrides({kitDir,dataDir,backup:saved.backup,apply:true});
    assert.equal(blocked.status,'needs-review');assert.equal(blocked.baseChanged,true);assert.equal(await file(routing),undefined);
    const reviewed=await restoreKitOverrides({kitDir,dataDir,backup:saved.backup,apply:true,acceptBaseChanges:true});
    assert.equal(reviewed.status,'restored');assert.ok(await stat(routing));
    await rm(routing);
    await writeFile(base,JSON.stringify({version:1,backends:{second:{}},capabilities:{code:{primary:'second',fallback:[]}}}));
    const incompatible=await restoreKitOverrides({kitDir,dataDir,backup:saved.backup,apply:true,acceptBaseChanges:true});
    assert.equal(incompatible.status,'needs-review');assert.match(incompatible.conflicts.join(' '),/missing backend/);assert.equal(await file(routing),undefined);
    await assert.rejects(restoreKitOverrides({kitDir,dataDir,backup:kitDir}),/backup must be inside/);
    await assert.rejects(backupKitOverrides({kitDir,dataDir:join(kitDir,'data')}),/outside the replaceable kit/);
  }finally{await rm(root,{recursive:true,force:true})}
});
