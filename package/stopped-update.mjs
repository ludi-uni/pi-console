import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {open,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
// Origin: prepared deployment/stopped-events-update.mjs (2026-10-05); no runtime dependency on preparation checkout.
export const EXPECTED_TARGET=Object.freeze({
  dataDir:'C:/Users/leade/.pi/agent/pi-console',
  prefix:'C:/Users/leade/.pi/agent/pi-console/reviewed-releases/0.6.0',
  entry:'C:/Users/leade/.pi/agent/pi-console/reviewed-releases/0.6.0/node_modules/@ludi-uni/pi-console/server/index.ts'
});

export const EVENTS_ARCHIVE_SHA256='e77ea1b3a17ec134d9b4666b19705e87e3ddef33a9801f79317ae6d31cde66d6';
export const EVENTS_FILE_COUNT=139;
export const EXTERNAL_START_BASELINE_REQUIRED='EVENTS_STOPPED_UPDATE_BLOCKED_EXTERNAL_START_BASELINE_REQUIRED';
const norm=value=>resolve(String(value)).replaceAll('\\','/').toLowerCase();

export function assertPinnedTarget(target){
  for(const key of ['dataDir','prefix','entry']) assert.equal(norm(target?.[key]),norm(EXPECTED_TARGET[key]),`explicit ${key} must equal the reviewed Events target`);
  return Object.freeze({...EXPECTED_TARGET});
}

export async function sha256File(path){ return createHash('sha256').update(await readFile(path)).digest('hex'); }
export async function validateCandidate(adapter,candidate){
  assert.equal(await adapter.archiveHash(candidate.archive),EVENTS_ARCHIVE_SHA256,'candidate archive hash is not the reviewed Events archive');
  const manifest=await adapter.archiveManifest(candidate.archive);
  assert.equal(manifest?.files?.length,EVENTS_FILE_COUNT,'candidate must contain exactly 139 files');
  assert.equal(manifest?.sha256,EVENTS_ARCHIVE_SHA256,'candidate manifest hash is not the reviewed Events archive');
  const seen=new Set(); for(const file of manifest.files){const segments=typeof file?.path==='string'?file.path.split('/'):[];assert(typeof file?.path==='string'&&file.path!==''&&!file.path.startsWith('/')&&!file.path.includes('\\')&&!file.path.includes(':')&&!file.path.includes('\0')&&!segments.some(part=>part===''||part==='.'||part==='..'),'candidate manifest has an unsafe path');assert(/^[0-9a-f]{64}$/.test(file?.sha256),'candidate manifest has an invalid file hash');const key=file.path.toLowerCase();assert(!seen.has(key),'candidate manifest has duplicate paths');seen.add(key);}
  return manifest;
}

/** The manager's lock protocol, deliberately without stale-lock stealing. */
export async function acquireStoppedUpdateLock(dataDir,{openFile=open,remove=rm,pid=process.pid,now=Date.now}={}){
  const path=resolve(dataDir,'server.lock'),contents=JSON.stringify({pid,at:now()}); let handle,created=false;
  try { handle=await openFile(path,'wx'); created=true; await handle.writeFile(contents); }
  catch(error){ if(error?.code==='EEXIST') throw Error(`another pi-console manager or updater holds ${path}; refuse without stealing a lock`); if(created)throw Error(`updater lock initialization failed; incomplete lock retained at ${path}: ${error.message}`); throw error; }
  finally { await handle?.close(); }
  let retained=false;
  return Object.freeze({path,retain(){retained=true;},async release(){if(retained)return;let actual;try{actual=await readFile(path,'utf8')}catch(error){retained=true;throw Error(`updater lock cannot be verified for cleanup: ${error.message}`)}if(actual!==contents){retained=true;throw Error('updater lock ownership changed; retained without deleting a foreign lock')}await remove(path,{force:false});}});
}

function stopped(snapshot){
  assert(snapshot?.complete===true,'process coverage is incomplete or unknown');
  assert(snapshot.externalStartExclusion===true,'external direct starts are not excluded');
  assert(Array.isArray(snapshot.running)&&Array.isArray(snapshot.uncontrolled),'process coverage omitted running or uncontrolled process lists');
  assert.equal(snapshot.running.length,0,'a server, owned worker, background worker, or updater is still running');
  assert.equal(snapshot.uncontrolled.length,0,'an uncontrolled direct-start, control, legacy, or watchdog process remains');
}
function sameTarget(a,b,{softwareMayHaveChanged=false}={}){
  const keys=softwareMayHaveChanged?['dataDir','prefix']:['dataDir','prefix','entry'];
  return ['dataDir','prefix','entry'].every(key=>norm(a?.[key])===norm(b?.[key])) &&
    keys.every(key=>JSON.stringify(a?.filesystemIdentity?.[key])===JSON.stringify(b?.filesystemIdentity?.[key]));
}

/**
 * Adapter-only apply path. Production CLI cannot create an apply adapter. Complete
 * process observation AND exclusion of external starts must be supplied by a trusted
 * isolated/approved adapter contract, never by a user checkbox or an idle port.
 */
export function createStoppedEventsUpdateEngine(adapter,{lock=acquireStoppedUpdateLock,validateTarget=assertPinnedTarget}={}){
  return Object.freeze({async check(target){validateTarget(target); return {ok:false,code:EXTERNAL_START_BASELINE_REQUIRED,reason:'No complete external-start/process baseline is available; check is side-effect free.'};},async apply(target,candidate){
    validateTarget(target);
    const inspected=await adapter.inspectTarget(target); assert(['dataDir','prefix','entry'].every(key=>norm(inspected?.[key])===norm(target?.[key])),'target changed before lock acquisition');
    const held=await lock(target.dataDir); let keepLock=false,mayHaveModified=false,backup;
    try {
      const lockedTarget=await adapter.inspectTarget(target); assert(sameTarget(lockedTarget,inspected),'target changed after lock acquisition');
      stopped(await adapter.stoppedProcesses({phase:'final-before-backup',target:lockedTarget}));
      await validateCandidate(adapter,candidate);
      backup=await adapter.backupEntirePrefix({prefix:target.prefix,dataDir:target.dataDir});
      assert(backup?.outsidePrefix===true&&backup.outsideDataDir===true&&backup.manifestVerified===true,'full prefix backup outside prefix and stable dataDir is required');
      const preInstallTarget=await adapter.inspectTarget(target); assert(sameTarget(preInstallTarget,inspected),'target changed after backup');
      stopped(await adapter.stoppedProcesses({phase:'immediately-before-install',target:preInstallTarget}));
      await validateCandidate(adapter,candidate); // Last archive/manifest check before npm can mutate the prefix.
      mayHaveModified=true; // npm can have changed the prefix even when it throws.
      await adapter.installOffline({prefix:target.prefix,archive:candidate.archive,arguments:['--offline','--ignore-scripts','--omit=dev']});
      await adapter.verifyInstalled({prefix:target.prefix,fileCount:EVENTS_FILE_COUNT,archiveSha256:EVENTS_ARCHIVE_SHA256});
      await validateCandidate(adapter,candidate);
      const finalTarget=await adapter.inspectTarget(target,{softwareMayHaveChanged:true}); assert(sameTarget(finalTarget,inspected,{softwareMayHaveChanged:true}),'target changed after install');
      stopped(await adapter.stoppedProcesses({phase:'final-after-install',target:finalTarget}));
      const result={status:'updated',backup}; try{await adapter.report?.(result)}catch{} return result;
    } catch(error) {
      if(!mayHaveModified) throw error;
      let recoveryError;
      try { const recoveryTarget=await adapter.inspectTarget(target,{softwareMayHaveChanged:true}); assert(sameTarget(recoveryTarget,inspected,{softwareMayHaveChanged:true}),'target changed while update was running'); stopped(await adapter.stoppedProcesses({phase:'before-restore',target})); await adapter.restoreEntirePrefix({prefix:target.prefix,backup,excludeStableData:true,exclude:['data','auth','claims','receipts','state','token','lock']}); }
      catch(value){recoveryError=value; keepLock=true; held.retain();}
      const result={status:recoveryError?'recovery-blocked':'restored',backup,reason:error.message,recoveryError:recoveryError?.message}; try{await adapter.report?.(result)}catch{}
      if(recoveryError) throw Error(`update failed and restore was blocked or failed; lock retained for owner recovery: ${recoveryError.message}; original: ${error.message}`);
      throw error;
    } finally { if(!keepLock)await held.release(); }
  }});
}

