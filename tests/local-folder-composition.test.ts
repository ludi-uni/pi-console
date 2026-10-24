import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadLocalFolderMcp } from '../server/local-folder-composition.ts';
const bytes = Buffer.from('inert dummy bytes; never native code');
const runtime = { platform: 'win32', arch: 'x64', node: 'v24.22.1', napi: 10, modules: 137 };
const sourceSha256 = '17400635999615e1bc5fe3d0b9cdaaf85d171e55de79eadd090f5495fcea652e';
const descriptor = () => ({ enabled: true, contract: 2, fixtureProbes: false, sourceSha256, binarySha256: createHash('sha256').update(bytes).digest('hex'), runtime });
function fixture(config: any = descriptor(), changes: any = {}) {
  let loads = 0, reads = 0, openings = 0, issues = 0, registrations = 0;
  const binding: any = { candidateOnly: true, policyVersion: 2 };
  for (const m of ['openVolumeRoot','openDirectory','createDirectory','createFile','info','assertLocalNtfs','close','audit','closeAll']) binding[m] = () => { openings++; throw Error('no filesystem operation expected'); };
  const store: any = { managedRegistryDirectory: () => 'D:\\State', registerManagedNew: async () => { registrations++; throw Error('no registration expected'); } };
  const options: any = { runtime, read: async (p: string) => { reads++; return p.endsWith('.json') ? Buffer.from(JSON.stringify(config)) : bytes; }, load: () => { loads++; return binding; }, folderOptions: { now: () => 1000, secret: () => (++issues).toString(16).padStart(64, '0') }, ...changes };
  return { store, options, binding, counts: () => ({ loads, reads, openings, issues, registrations }) };
}
test('disabled descriptor does not read/load a binary or generate a credential', async () => {
  const f = fixture({ enabled: false }), x = await loadLocalFolderMcp(f.store, f.options);
  assert.equal(x.state, 'disabled'); assert.deepEqual(f.counts(), { loads: 0, reads: 1, openings: 0, issues: 0, registrations: 0 });
});
test('missing default descriptor stays unavailable without native loading', async () => {
  const f = fixture(undefined, { read: async () => { throw Object.assign(Error('dummy'), { code: 'ENOENT' }); } });
  assert.equal((await loadLocalFolderMcp(f.store, f.options)).state, 'disabled'); assert.equal(f.counts().loads, 0);
});
test('explicit matching configuration connects candidate, but issues no grant or credential', async () => {
  const f = fixture(), x = await loadLocalFolderMcp(f.store, f.options);
  assert.equal(x.state, 'candidate'); assert.deepEqual(f.counts(), { loads: 1, reads: 2, openings: 0, issues: 0, registrations: 0 });
  const pair = x.folders.request({ name: 'any standard MCP client' });
  assert.equal(x.folders.claim({ connectionId: pair.connectionId, proof: pair.proof }).state, 'pending');
  assert.equal(f.counts().issues, 1); assert.equal(f.counts().registrations, 0);
});
test('metadata rejects arbitrary paths, extra fields and invalid shape before loading', async () => {
  for (const d of [{...descriptor(), path:'C:\\untrusted.node'}, {...descriptor(), enabled:'true'}, {...descriptor(), contract:1}, {...descriptor(), fixtureProbes:true}, {...descriptor(), sourceSha256:'0'.repeat(64)}, {enabled:false, path:'x'}]) {
    const f = fixture(d); await assert.rejects(loadLocalFolderMcp(f.store,f.options), /folder_binding_configuration_invalid/); assert.equal(f.counts().loads,0);
  }
});
test('runtime is exact Windows x64 Node/ABI contract; no native load on mismatch', async () => {
  for (const change of [{platform:'linux'}, {arch:'arm64'}, {node:'v24.19.0'}, {modules:136}, {napi:7}]) {
    const f=fixture(descriptor(), {runtime:{...runtime,...change}}); await assert.rejects(loadLocalFolderMcp(f.store,f.options),/folder_binding_runtime_mismatch/); assert.equal(f.counts().loads,0);
  }
});
test('binary content is pinned by SHA256 before invoking loader', async () => {
  const f=fixture({...descriptor(),binarySha256:'0'.repeat(64)}); await assert.rejects(loadLocalFolderMcp(f.store,f.options),/folder_binding_hash_mismatch/); assert.equal(f.counts().loads,0);
});
test('malformed/oversize configuration is rejected without leaking read error text', async () => {
  for(const value of [Buffer.from('{'), Buffer.alloc(5000), Buffer.from('null')]) {
    const f=fixture(undefined,{read:async()=>value}); await assert.rejects(loadLocalFolderMcp(f.store,f.options),/folder_binding_configuration_invalid/); assert.equal(f.counts().loads,0);
  }
  const f=fixture(undefined,{read:async()=>{throw Error('dummy-private-detail');}}); await assert.rejects(loadLocalFolderMcp(f.store,f.options),/^Error: folder_binding_configuration_unreadable$/);
});
test('fixture-probe DLL exports and unknown binding exports are refused without invoking them', async () => {
  for(const name of ['configureFixture','tryWriter','tryRename','setJunction','removeJunction','unexpected']) {
    const f=fixture(); f.binding[name]=()=>{throw Error('must not call');}; await assert.rejects(loadLocalFolderMcp(f.store,f.options),/folder_binding_contract_invalid/); assert.equal(f.counts().openings,0);
  }
});
test('incomplete/old/incorrect binding is refused before any OS operation', async () => {
  for(const alteration of [(b:any)=>delete b.close, (b:any)=>b.policyVersion=1, (b:any)=>b.candidateOnly=false]) {
    const f=fixture(); alteration(f.binding); await assert.rejects(loadLocalFolderMcp(f.store,f.options),/folder_binding_contract_invalid/); assert.equal(f.counts().openings,0);
  }
});
test('native loader failures are fixed-code failures without raw paths or error details', async () => {
  const f=fixture(undefined,{load:()=>{throw Error('dummy-private-detail');}}); await assert.rejects(loadLocalFolderMcp(f.store,f.options),/^Error: folder_binding_load_failed$/);
});
test('metadata cannot choose runtime requirements; lower or extra runtime descriptors refuse', async () => {
  for(const r of [{...runtime,napi:7},{...runtime,modules:136},{...runtime,node:'v24.19.0'},{...runtime,extra:true}]) {
    const f=fixture({...descriptor(),runtime:r}); await assert.rejects(loadLocalFolderMcp(f.store,f.options),/folder_binding_configuration_invalid/); assert.equal(f.counts().loads,0);
  }
});
test('fixed loader paths are package paths and contain no caller input', async () => {
  const paths: string[]=[]; const f=fixture(undefined,{read:async(p:string)=>{paths.push(p);return p.endsWith('.json')?Buffer.from(JSON.stringify(descriptor())):bytes;},load:(p:string)=>{paths.push(p);return f.binding;}});
  await loadLocalFolderMcp(f.store,f.options);
  assert.equal(paths.length,3); assert(paths[0].endsWith('package/native/windows-folder.provider.json') || paths[0].endsWith('package\\native\\windows-folder.provider.json'));
  assert.equal(paths[1],paths[2]); assert(paths[1].endsWith('windows-folder.node'));
});
test('explicit composition reaches guarded registration only after dummy owner approval', async () => {
  const f=fixture(), live=new Map<object,any>(), ids=new Map<string,string>(); let sequence=0; const rows:any[]=[];
  const guid='11111111-1111-1111-1111-111111111111';
  function open(p:string,directory=true,created=false) { const key=p.toLowerCase(); if(!ids.has(key))ids.set(key,(++sequence).toString(16).padStart(32,'0')); const h={}; live.set(h,{volume:'0'.repeat(15)+'1',fileId:ids.get(key),volumeGuid:guid,stablePath:'\\\\?\\Volume{'+guid+'}\\'+p,directory,created,reparse:false,reparseTag:0,caseSensitive:false}); return h; }
  f.binding.openVolumeRoot=()=>open('');
  const suffix=(h:object)=>live.get(h).stablePath.split('}\\')[1];
  f.binding.openDirectory=(h:object,name:string)=>open([suffix(h),name].filter(Boolean).join('\\'));
  f.binding.createDirectory=(h:object,name:string)=>open(suffix(h)+'\\'+name,true,true);
  f.binding.createFile=(h:object,name:string)=>open(suffix(h)+'\\'+name,false,true);
  f.binding.info=(h:object)=>({...live.get(h)}); f.binding.assertLocalNtfs=()=>{};
  f.binding.close=(h:object)=>assert(live.delete(h));
  f.store.registerManagedNew=async(entry:any,guard:()=>void)=>{guard();assert(live.size>0);rows.push(entry);return{id:'dummy-workspace',path:entry.stablePath};};
  const {folders}=await loadLocalFolderMcp(f.store,f.options), pair=folders.request({name:'Generic stdio client'});
  const review=await folders.review({connectionId:pair.connectionId,parent:'D:\\Allowed',operations:['list','directory','repo','workspace'],expiresAt:50000});
  assert.equal(rows.length,0);assert.equal(f.counts().issues,1);
  await folders.approve({reviewId:review.reviewId,requestId:review.requestId,confirmed:true},()=>{});
  const claim:any=folders.claim({connectionId:pair.connectionId,proof:pair.proof}); assert.equal(f.counts().issues,5);
  await folders.call(claim.token,'create_managed_workspace',{requestId:'dummy-integrated-create',parent:'D:\\Allowed',name:'Repo',repo:true,workspace:true});
  assert.equal(rows.length,1);assert.equal(rows[0].displayPath,'d:\\allowed\\Repo');assert.equal(live.size,0);
  await assert.rejects(folders.call(claim.token,'create_managed_workspace',{requestId:'dummy-integrated-create',parent:'D:\\Allowed',name:'Repo',repo:true,workspace:true}));assert.equal(rows.length,1);
  await folders.revoke({connectionId:'all',requestId:'dummy-integrated-revoke'},()=>{});await assert.rejects(folders.call(claim.token,'list_allowed_parents',{}));folders.dispose();
});
test('empty/oversize/unreadable binary refuses before loading and errors stay fixed-code', async () => {
  for(const value of [Buffer.alloc(0),Buffer.alloc(16*1024*1024+1)]) {const f=fixture(undefined,{read:async(p:string)=>p.endsWith('.json')?Buffer.from(JSON.stringify(descriptor())):value});await assert.rejects(loadLocalFolderMcp(f.store,f.options),/folder_binding_hash_mismatch/);assert.equal(f.counts().loads,0);}
  const f=fixture(undefined,{read:async(p:string)=>{if(p.endsWith('.json'))return Buffer.from(JSON.stringify(descriptor()));throw Error('dummy-private-detail');}});await assert.rejects(loadLocalFolderMcp(f.store,f.options),/^Error: folder_binding_binary_unreadable$/);assert.equal(f.counts().loads,0);
});
