import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createStoppedEventsUpdateEngine,acquireStoppedUpdateLock,EVENTS_ARCHIVE_SHA256,EXPECTED_TARGET,assertPinnedTarget,validateCandidate} from '../package/stopped-update.mjs';
import {backupStoppedPrefix,restoreStoppedPrefix,inspectStoppedTarget} from '../package/stopped-update-prefix.mjs';
import {diagnoseStoppedUpdate,publicManagementIdentity} from '../package/stopped-update-diagnostics.mjs';
import {runStoppedUpdateCli} from '../scripts/stopped-update.mjs';
const missing=async p=>access(p).then(()=>false,e=>{if(e.code==='ENOENT')return true;throw e;});
const manifest={sha256:EVENTS_ARCHIVE_SHA256,files:Array.from({length:139},(_,i)=>({path:`package/file-${i}.js`,sha256:'a'.repeat(64)}))};
async function fixture(t,{nested=false}={}){
  const sandbox=await mkdtemp(join(tmpdir(),'pi-stopped-update-'));t.after(()=>rm(sandbox,{recursive:true,force:true}));
  const dataDir=join(sandbox,'stable'),prefix=nested?join(dataDir,'reviewed-releases','test'):join(sandbox,'prefix'),entry=join(prefix,'server','index.ts'),backupRoot=join(sandbox,'backups');
  await mkdir(join(prefix,'server'),{recursive:true});await mkdir(join(prefix,'node_modules','dependency','empty'),{recursive:true});await mkdir(dataDir,{recursive:true});
  await writeFile(entry,'old-entry');await writeFile(join(prefix,'node_modules','dependency','index.js'),'old-dependency');
  const stable=['.env','server-token','server-state.json','claims','receipt','queue','report'];for(const p of stable)await writeFile(join(dataDir,p),`dummy-stable-${p}`);
  const target={dataDir,prefix,entry},reports=[];let installed=0,restored=0;
  const adapter={
    inspectTarget:(_target,options)=>inspectStoppedTarget(target,options),stoppedProcesses:async()=>({complete:true,externalStartExclusion:true,running:[],uncontrolled:[]}),
    archiveHash:async()=>EVENTS_ARCHIVE_SHA256,archiveManifest:async()=>structuredClone(manifest),
    backupEntirePrefix:()=>backupStoppedPrefix({sandbox,prefix,dataDir,backupRoot,id:'backup'}),
    installOffline:async()=>{installed++;await writeFile(entry,'new-entry');await writeFile(join(prefix,'new-residue.js'),'partial');},
    verifyInstalled:async()=>{},
    restoreEntirePrefix:async({backup})=>{restored++;await restoreStoppedPrefix({sandbox,prefix,dataDir,backupRoot,backup});},
    report:async r=>reports.push(r),
  };
  const engine=()=>createStoppedEventsUpdateEngine(adapter,{validateTarget:()=>target});
  return {sandbox,dataDir,prefix,entry,backupRoot,target,adapter,engine,reports,stable,get installed(){return installed;},get restored(){return restored;}};
}
async function stablePreserved(f){for(const p of f.stable)assert.equal(await readFile(join(f.dataDir,p),'utf8'),`dummy-stable-${p}`);}
const candidate={archive:'dummy-reviewed-archive.tgz'};
test('reviewed target pin rejects substitutions',()=>{assert.deepEqual(assertPinnedTarget(EXPECTED_TARGET),EXPECTED_TARGET);assert.throws(()=>assertPinnedTarget({...EXPECTED_TARGET,prefix:'D:/wrong'}));});
test('successful isolated update backs up full software/dependencies and stays stopped',async t=>{const f=await fixture(t);const r=await f.engine().apply(f.target,candidate);assert.equal(r.status,'updated');assert.equal(await readFile(join(r.backup.path,'node_modules','dependency','index.js'),'utf8'),'old-dependency');assert.equal(await missing(join(r.backup.path,'node_modules','dependency','empty')),false);assert.equal(f.restored,0);assert.equal(await missing(join(f.dataDir,'server.lock')),true);await stablePreserved(f);});
for(const [name,snapshot] of [
  ['incomplete observation',{complete:false,externalStartExclusion:true,running:[],uncontrolled:[]}],
  ['external exclusion unavailable',{complete:true,externalStartExclusion:false,running:[],uncontrolled:[]}],
  ['remaining worker',{complete:true,externalStartExclusion:true,running:[{pid:123}],uncontrolled:[]}],
  ['direct-start remains',{complete:true,externalStartExclusion:true,running:[],uncontrolled:[{pid:123}]}],
  ['coverage lists omitted',{complete:true,externalStartExclusion:true}],
])test(`${name} refuses before backup/install`,async t=>{const f=await fixture(t);f.adapter.stoppedProcesses=async()=>snapshot;await assert.rejects(f.engine().apply(f.target,candidate));assert.equal(f.installed,0);assert.equal(await missing(f.backupRoot),true);await stablePreserved(f);});
test('target replacement after lock rejected even with same paths',async t=>{const f=await fixture(t);const original=f.adapter.inspectTarget;let n=0;f.adapter.inspectTarget=async()=>{const v=await original();if(++n===2)v.filesystemIdentity.prefix.ino='replacement';return v;};await assert.rejects(f.engine().apply(f.target,candidate),/target changed after lock/);assert.equal(f.installed,0);});
test('target path change after backup refuses install',async t=>{const f=await fixture(t);const original=f.adapter.inspectTarget;let n=0;f.adapter.inspectTarget=async()=>{const v=await original();if(++n===3)v.entry=join(f.prefix,'different');return v;};await assert.rejects(f.engine().apply(f.target,candidate),/target changed after backup/);assert.equal(f.installed,0);});
test('two updates serialize with manager wx protocol',async t=>{const f=await fixture(t);let ready,release;const r=new Promise(v=>ready=v),wait=new Promise(v=>release=v);const original=f.adapter.backupEntirePrefix;f.adapter.backupEntirePrefix=async()=>{ready();await wait;return original();};const first=f.engine().apply(f.target,candidate);await r;await assert.rejects(f.engine().apply(f.target,candidate),/without stealing/);const record=JSON.parse(await readFile(join(f.dataDir,'server.lock'),'utf8'));assert.equal(record.pid,process.pid);assert(Number.isInteger(record.at));release();await first;});
test('existing manager/stale/unreadable lock never stolen',async t=>{const f=await fixture(t);const p=join(f.dataDir,'server.lock');for(const value of ['{"pid":999999,"at":1}','']){await writeFile(p,value);await assert.rejects(acquireStoppedUpdateLock(f.dataDir),/without stealing/);assert.equal(await readFile(p,'utf8'),value);}});
test('foreign lock replacement is retained',async t=>{const f=await fixture(t);const held=await acquireStoppedUpdateLock(f.dataDir);await writeFile(held.path,'foreign');await assert.rejects(held.release(),/ownership changed/);assert.equal(await readFile(held.path,'utf8'),'foreign');});
test('archive hash mismatch refuses backup and install',async t=>{const f=await fixture(t);f.adapter.archiveHash=async()=> '0'.repeat(64);await assert.rejects(f.engine().apply(f.target,candidate),/archive hash/);assert.equal(f.installed,0);assert.equal(await missing(f.backupRoot),true);});
test('unsafe/duplicate manifests and wrong count refused',async()=>{for(const files of [[...manifest.files.slice(1)],manifest.files.map((v,i)=>i===0?{...v,path:'../escape'}:v),manifest.files.map((v,i)=>i===0?{...v,path:manifest.files[1].path}:v)]){await assert.rejects(validateCandidate({archiveHash:async()=>EVENTS_ARCHIVE_SHA256,archiveManifest:async()=>({...manifest,files})},candidate));}});
test('backup failure prevents any software modification',async t=>{const f=await fixture(t);f.adapter.backupEntirePrefix=async()=>{throw Error('backup failure');};await assert.rejects(f.engine().apply(f.target,candidate),/backup failure/);assert.equal(f.installed,0);assert.equal(await readFile(f.entry,'utf8'),'old-entry');});
test('partial install failure restores software only and keeps failed-prefix evidence',async t=>{const f=await fixture(t);const install=f.adapter.installOffline;f.adapter.installOffline=async args=>{await install(args);throw Error('partial install');};await assert.rejects(f.engine().apply(f.target,candidate),/partial install/);assert.equal(f.restored,1);assert.equal(await readFile(f.entry,'utf8'),'old-entry');assert.equal(await missing(join(f.prefix,'new-residue.js')),true);assert.equal(await readFile(join(f.backupRoot,'backup-failed','new-residue.js'),'utf8'),'partial');assert.equal(f.reports[0].status,'restored');await stablePreserved(f);});
test('atomic entry replacement is expected software change, not target substitution',async t=>{
  const f=await fixture(t);
  f.adapter.installOffline=async()=>{await writeFile(f.entry+'.next','replacement');await rename(f.entry+'.next',f.entry);};
  const result=await f.engine().apply(f.target,candidate);
  assert.equal(result.status,'updated');assert.equal(f.restored,0);
  assert.equal(await readFile(f.entry,'utf8'),'replacement');await stablePreserved(f);
});
test('missing entry after partial install restores software without restoring stable state',async t=>{
  const f=await fixture(t);
  f.adapter.installOffline=async()=>{await rm(f.entry);throw Error('partial install removed entry');};
  await assert.rejects(f.engine().apply(f.target,candidate),/partial install removed entry/);
  assert.equal(f.restored,1);assert.equal(await readFile(f.entry,'utf8'),'old-entry');
  assert.equal(await missing(join(f.dataDir,'server.lock')),true);await stablePreserved(f);
});
test('entry replacement before install is rejected',async t=>{
  const f=await fixture(t),backup=f.adapter.backupEntirePrefix;
  f.adapter.backupEntirePrefix=async()=>{const result=await backup();await writeFile(f.entry+'.next','foreign');await rename(f.entry+'.next',f.entry);return result;};
  await assert.rejects(f.engine().apply(f.target,candidate),/target changed after backup/);
  assert.equal(f.installed,0);await stablePreserved(f);
});
test('entry redirect after partial install blocks restoration and retains lock',async t=>{
  const f=await fixture(t);const foreignDir=join(f.sandbox,'foreign-server'),foreign=join(foreignDir,'index.ts');
  await mkdir(foreignDir);await writeFile(foreign,'foreign');
  f.adapter.installOffline=async()=>{await rename(join(f.prefix,'server'),join(f.prefix,'server-before'));await symlink(foreignDir,join(f.prefix,'server'),'junction');throw Error('partial install redirected entry');};
  await assert.rejects(f.engine().apply(f.target,candidate),/lock retained/);
  assert.equal(f.restored,0);assert.equal(await readFile(foreign,'utf8'),'foreign');
  assert.equal(await missing(join(f.dataDir,'server.lock')),false);await stablePreserved(f);
});
test('prefix inside stable reviewed-releases is isolated for backup and restore',async t=>{const f=await fixture(t,{nested:true});f.adapter.verifyInstalled=async()=>{throw Error('verification failure');};await assert.rejects(f.engine().apply(f.target,candidate),/verification failure/);assert.equal(await readFile(f.entry,'utf8'),'old-entry');await stablePreserved(f);});
test('runtime appears before restore: no overwrite; lock and evidence retained',async t=>{const f=await fixture(t);f.adapter.verifyInstalled=async()=>{throw Error('bad install');};const observe=f.adapter.stoppedProcesses;f.adapter.stoppedProcesses=async({phase})=>phase==='before-restore'?{complete:true,externalStartExclusion:true,running:[],uncontrolled:[{pid:1}]}:observe();await assert.rejects(f.engine().apply(f.target,candidate),/lock retained/);assert.equal(f.restored,0);assert.equal(await readFile(f.entry,'utf8'),'new-entry');assert.equal(await missing(join(f.dataDir,'server.lock')),false);assert.equal(await missing(join(f.backupRoot,'backup')),false);await stablePreserved(f);});
test('target substitution before recovery refuses software overwrite',async t=>{const f=await fixture(t);f.adapter.verifyInstalled=async()=>{throw Error('bad install');};const inspect=f.adapter.inspectTarget;let n=0;f.adapter.inspectTarget=async()=>{const v=await inspect();if(++n===4)v.filesystemIdentity.prefix.ino='replacement';return v;};await assert.rejects(f.engine().apply(f.target,candidate),/lock retained/);assert.equal(f.restored,0);});
test('restore failure retains manager lock, prefix and backup',async t=>{const f=await fixture(t);f.adapter.verifyInstalled=async()=>{throw Error('bad install');};f.adapter.restoreEntirePrefix=async()=>{throw Error('restore failure');};await assert.rejects(f.engine().apply(f.target,candidate),/restore failure/);assert.equal(await missing(join(f.dataDir,'server.lock')),false);await stablePreserved(f);});
test('corrupted backup refuses recovery and keeps failed software untouched',async t=>{const f=await fixture(t);f.adapter.verifyInstalled=async()=>{await writeFile(join(f.backupRoot,'backup','server','index.ts'),'tampered');throw Error('bad install');};await assert.rejects(f.engine().apply(f.target,candidate),/backup hash mismatch/);assert.equal(await readFile(f.entry,'utf8'),'new-entry');assert.equal(await missing(join(f.dataDir,'server.lock')),false);});
test('backup refuses nested stable region before reading or moving it',async t=>{const f=await fixture(t);await writeFile(join(f.prefix,'.env'),'dummy-do-not-read');await assert.rejects(f.engine().apply(f.target,candidate),/stable\/runtime material/);assert.equal(f.installed,0);});
test('backup must be outside stable data even if software prefix nested',async t=>{const f=await fixture(t,{nested:true});await assert.rejects(backupStoppedPrefix({...f,backupRoot:join(f.dataDir,'backups'),id:'test'}),/disjoint/);});
test('existing backup is never merged/overwritten',async t=>{const f=await fixture(t);await mkdir(join(f.backupRoot,'backup'),{recursive:true});await assert.rejects(f.engine().apply(f.target,candidate),{code:'EEXIST'});assert.equal(f.installed,0);});
test('read-only diagnostic never upgrades complete based on inventory or checkbox',async()=>{const r=await diagnoseStoppedUpdate(EXPECTED_TARGET,{inventory:async()=>({observed:true,complete:true,running:[],startup:[]}),inspect:async()=>({...EXPECTED_TARGET,filesystemIdentity:{}})});assert.equal(r.complete,false);assert.equal(r.ok,false);assert(r.blockers.includes('DIRECT_STARTS_NOT_EXCLUDED'));assert(r.ownerActions.length);});
test('canonical inspection is included in diagnostic without claiming runtime ownership',async()=>{
  let inspected=0;const filesystemIdentity={dataDir:{ino:'stable'},prefix:{ino:'software'},entry:{ino:'entry'}};
  const result=await diagnoseStoppedUpdate(EXPECTED_TARGET,{inventory:async()=>({observed:true,complete:true,running:[],startup:[]}),inspect:async()=>{inspected++;return {...EXPECTED_TARGET,filesystemIdentity};}});
  assert.equal(inspected,1);assert.deepEqual(result.canonicalTarget.filesystemIdentity,filesystemIdentity);
  assert.equal(result.ok,false);assert.equal(result.complete,false);
  assert(result.blockers.includes('RUNTIME_DATA_DIR_AND_WORKER_OWNERSHIP_UNPROVEN'));
});
test('canonical inspection refusal aborts without identity or another inspection',async()=>{
  let inspections=0,identities=0;
  await assert.rejects(diagnoseStoppedUpdate(EXPECTED_TARGET,{inventory:async()=>({observed:true}),inspect:async()=>{inspections++;throw Error('dummy target denied');},identityPort:12345,identity:async()=>{identities++;}}),/dummy target denied/);
  assert.equal(inspections,1);assert.equal(identities,0);
});
test('diagnostic refusal does not try identity/fallback',async()=>{let calls=0;await assert.rejects(diagnoseStoppedUpdate(EXPECTED_TARGET,{inventory:async()=>{throw Error('denied');},identityPort:12345,identity:async()=>{calls++;}}),/denied/);assert.equal(calls,0);});
test('apply CLI refuses before diagnostic, secrets, lock or network',async()=>{let calls=0;const code=await runStoppedUpdateCli(['--apply'],{io:{error:()=>{}},diagnose:async()=>{calls++;}});assert.equal(code,2);assert.equal(calls,0);});
test('check CLI runs diagnostic; force/mock and substituted target refused',async()=>{let calls=0;const io={log:()=>{},error:()=>{}};const diagnose=async()=>{calls++;return {ok:false};};assert.equal(await runStoppedUpdateCli(['--check'],{io,diagnose}),2);assert.equal(calls,1);for(const argv of [['--check','--force','true'],['--apply','--mock','true'],['--check','--prefix','D:/wrong']])await assert.rejects(runStoppedUpdateCli(argv,{io,diagnose}));assert.equal(calls,1);});
test('public management identity uses only isolated dynamic loopback and redacts fields',async t=>{const server=createServer((req,res)=>{assert.equal(req.method,'GET');assert.equal(req.url,'/api/manage/identity');assert.equal(req.headers['x-pi-console-manage-proof'],undefined);res.end(JSON.stringify({service:'pi-console',pid:123,port:456,startedAt:'2026-10-07T00:00:00.000Z',proof:'dummy-private',nonce:'dummy-private',url:'dummy-private'}));});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const port=server.address().port;assert(![31717,31718,31719].includes(port));const r=await publicManagementIdentity(port);assert.equal(r.observed,true);assert.equal(r.ownershipVerified,false);assert.equal(JSON.stringify(r).includes('dummy-private'),false);});
