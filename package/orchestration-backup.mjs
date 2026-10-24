import {createHash} from 'node:crypto';
import {createReadStream,constants} from 'node:fs';
import {copyFile,lstat,mkdir,mkdtemp,readdir,readFile,realpath,rename,rm,stat,writeFile} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as sqlite from 'node:sqlite';
const {backup:sqliteBackup,DatabaseSync}=sqlite;

// Point-in-time backup of the orchestration SQLite store plus the console-owned JSON
// snapshots/journals. This is BACKUP evidence only: it never switches the live store,
// never restores run owners into execution, and never touches user settings or secrets.
// Assumes trusted local filesystem ancestors: hashes detect corruption, not hostile bundles.
const KIND='orchestration-db-backup';
const CORE_TABLES=['decisions','runs','tasks','trace'];
const CLIENTS_DIR=join('.orchestration','activity','clients');

const exists=async path=>lstat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error});
const inside=(parent,path)=>{const part=relative(parent,path);return !part||part==='.'||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)};
const shaFile=async path=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')};
const requireAbsolute=(name,value)=>{if(typeof value!=='string'||!isAbsolute(value))throw new Error(`${name} must be an absolute path`);return resolve(value)};
const realOr=async(name,path)=>realpath(path).catch(()=>{throw new Error(`${name} does not exist: ${path}`)});
const noLinks=async path=>{
  for(let current=resolve(path);;current=dirname(current)){
    if((await lstat(current)).isSymbolicLink())throw new Error(`refusing symlinked path: ${current}`);
    if(dirname(current)===current)break;
  }
};
const verifyFile=async(path,entry)=>{
  await noLinks(path);
  const info=await lstat(path);
  if(!info.isFile()||info.size!==entry.bytes)throw new Error('backup file size or type mismatch');
  if(await shaFile(path)!==entry.sha256)throw new Error('backup file hash mismatch');
};
const listTables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
const tableCounts=db=>Object.fromEntries(listTables(db).map(name=>[name,db.prepare(`SELECT count(*) AS n FROM "${name.replace(/"/g,'""')}"`).get().n]));
const integrity=db=>{const rows=db.prepare('PRAGMA integrity_check').all();return rows.length===1&&rows[0].integrity_check==='ok'?'ok':rows.map(row=>row.integrity_check).join('; ')};
const requireCore=(tables,where)=>{const missing=CORE_TABLES.filter(name=>!tables.includes(name));if(missing.length)throw new Error(`${where} database is missing required orchestration tables: ${missing.join(', ')}`)};

/** Resolve a candidate output directory through the real parent so symlinked boundaries cannot escape checks. */
const resolveNewDir=async(name,value)=>{
  const requested=requireAbsolute(name,value);
  if(await exists(requested))throw new Error(`${name} already exists: ${requested}`);
  await noLinks(dirname(requested));
  const parent=await realpath(dirname(requested)).catch(()=>{throw new Error(`${name} parent directory does not exist: ${dirname(requested)}`)});
  return join(parent,basename(requested));
};

/** Collect only validated *.json files under an explicitly provided root. Symlinks and escapes are refused outright. */
const collectJson=async(rootReal)=>{
  const out=[];
  if(!await exists(rootReal))return out;
  await noLinks(rootReal);
  const walk=async dir=>{
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const path=join(dir,entry.name);
      if(entry.isSymbolicLink())throw new Error(`refusing symlinked auxiliary entry: ${path}`);
      if(entry.isDirectory()){await walk(path);continue}
      if(!entry.isFile()||!/^pi-web-[A-Za-z0-9_.-]+\.json$/.test(entry.name))continue;
      const real=await realOr('auxiliary file',path);
      if(!inside(rootReal,real))throw new Error(`auxiliary file escapes its root: ${path}`);
      out.push({real,rel:relative(rootReal,real)});
    }
  };
  await walk(rootReal);
  return out;
};
const safeRel=rel=>{const parts=rel.split(/[\\/]+/);if(parts.some(part=>!part||part==='.'||part==='..'))throw new Error(`unsafe auxiliary path: ${rel}`);return parts};

/**
 * Back up the whole orchestration SQLite store into a NEW bundle directory.
 * The source is opened read-only and copied with the SQLite backup API (a committed,
 * WAL-consistent snapshot) — no file copy, no VACUUM, no checkpoint of the source.
 */
export async function backupOrchestrationStore({source,output,kitRoot,historyDir}){
  if(typeof sqliteBackup!=='function')throw new Error('node:sqlite backup() export is unavailable (requires Node.js >= 23.8); refusing unsafe file-copy fallback');
  const sourceRequested=requireAbsolute('--source',source);
  const outputPath=await resolveNewDir('--output',output);
  const sourcePath=await realOr('--source',sourceRequested);
  await noLinks(sourceRequested);
  if(!(await lstat(sourcePath)).isFile())throw new Error(`--source is not a regular file: ${sourcePath}`);
  if(sourcePath===outputPath)throw new Error('--output must differ from --source');
  // The bundle must survive replacement of the kit and cleanup of the history mirror.
  if(inside(dirname(sourcePath),outputPath))throw new Error('--output must be outside the source database directory');
  let kitReal,historyReal;
  if(kitRoot!==undefined){
    kitReal=await realOr('--kit-root',requireAbsolute('--kit-root',kitRoot));
    await noLinks(kitRoot);
    if(inside(kitReal,outputPath))throw new Error('--output must be outside the replaceable kit root');
  }
  if(historyDir!==undefined){
    historyReal=await realOr('--history-dir',requireAbsolute('--history-dir',historyDir));
    await noLinks(historyDir);
    if(inside(historyReal,outputPath))throw new Error('--output must be outside the history mirror directory');
  }
  const sourceStat=await stat(sourcePath);
  let db;
  try{db=new DatabaseSync(sourcePath,{readOnly:true})}
  catch(error){throw new Error('Cannot open source read-only. For a WAL database, use the original accessible DB/WAL/SHM set; do not delete WAL files or use immutable mode. No checkpoint or repair was attempted.',{cause:error})}
  let temp,sourceTables;
  const cleanup=async()=>{try{db.close()}catch{/* already closed */}if(temp)await rm(temp,{recursive:true,force:true}).catch(()=>{})};
  try{
    // Read schema/counts/integrity from one stable read transaction when supported;
    // these are informational — a live writer may commit after this snapshot.
    let inTx=false;
    try{db.exec('BEGIN');inTx=true}catch{/* proceed without a snapshot transaction */}
    try{
      requireCore(listTables(db),'source');
      sourceTables=tableCounts(db);
      const check=integrity(db);
      if(check!=='ok')throw new Error(`source integrity_check failed: ${check}`);
    }finally{if(inTx)try{db.exec('ROLLBACK')}catch{/* already closed */}}
    temp=await mkdtemp(join(dirname(outputPath),'.orchestration-backup-'));
    await sqliteBackup(db,join(temp,'state.db'));
  }catch(error){await cleanup();throw error}
  try{db.close()}catch{/* already closed */}
  try{
    // Verify the backup copy itself before publishing; all manifest counts describe the destination.
    const copy=new DatabaseSync(join(temp,'state.db'),{readOnly:true});
    let destCheck,destTables;
    try{
      destCheck=integrity(copy);
      if(destCheck!=='ok')throw new Error(`backup copy failed integrity_check: ${destCheck}`);
      requireCore(listTables(copy),'backup copy');
      destTables=tableCounts(copy);
    }finally{copy.close()}
    const auxiliary=[];
    for(const [origin,rootReal] of [['kit-clients',kitReal?join(kitReal,CLIENTS_DIR):undefined],['history',historyReal]]){
      if(!rootReal)continue;
      for(const file of await collectJson(rootReal)){
        const parts=safeRel(file.rel),dest=join(temp,'auxiliary',origin,...parts);
        await mkdir(dirname(dest),{recursive:true});
        await copyFile(file.real,dest,constants.COPYFILE_EXCL);
        auxiliary.push({file:`auxiliary/${origin}/${parts.join('/')}`,sha256:await shaFile(dest),bytes:(await stat(dest)).size});
      }
    }
    const manifest={
      version:1,kind:KIND,createdAt:new Date().toISOString(),pointInTime:true,
      notes:[
        'Point-in-time committed snapshot taken by the SQLite backup API.',
        'Live writers may have committed after the snapshot; stop Pi Console and Pi orchestration before a final migration.',
        'Backup evidence only: restoring it never activates it as the live store.',
      ],
      source:{path:sourcePath,sizeBytes:sourceStat.size,modifiedAt:sourceStat.mtime.toISOString(),kitRoot:kitReal??null,historyDir:historyReal??null,tablesSnapshot:sourceTables},
      database:{file:'state.db',sha256:await shaFile(join(temp,'state.db')),bytes:(await stat(join(temp,'state.db'))).size,integrityCheck:destCheck,coreTables:CORE_TABLES,tables:destTables},
      auxiliary,
    };
    await writeFile(join(temp,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  }catch(error){await cleanup();throw error}
  // Publish atomically: reserve the destination exclusively, then move the completed
  // sibling bundle into it. If anything fails, only our own temp dir is removed.
  try{await mkdir(outputPath)}
  catch(error){
    await cleanup();
    if(error.code==='EEXIST')throw new Error(`--output already exists: ${outputPath}`);
    throw error;
  }
  try{
    for(const name of await readdir(temp))await rename(join(temp,name),join(outputPath,name));
  }catch(error){await rm(outputPath,{recursive:true,force:true}).catch(()=>{});throw error}
  finally{await rm(temp,{recursive:true,force:true}).catch(()=>{})}
  const manifest=JSON.parse(await readFile(join(outputPath,'manifest.json'),'utf8'));
  return {status:'backed-up',bundle:outputPath,createdAt:manifest.createdAt,database:{sha256:manifest.database.sha256,bytes:manifest.database.bytes,tables:manifest.database.tables},auxiliary:manifest.auxiliary.length};
}

const loadManifest=async bundlePath=>{
  const manifest=JSON.parse(await readFile(join(bundlePath,'manifest.json'),'utf8'));
  if(manifest?.version!==1||manifest?.kind!==KIND)throw new Error('invalid backup manifest');
  const db=manifest.database;
  if(!db||db.file!=='state.db'||typeof db.sha256!=='string'||!/^[a-f0-9]{64}$/.test(db.sha256)||!Number.isSafeInteger(db.bytes)||db.bytes<0||db.integrityCheck!=='ok'||!db.tables||typeof db.tables!=='object'||Array.isArray(db.tables))throw new Error('invalid backup manifest database section');
  if(!Array.isArray(manifest.auxiliary))throw new Error('invalid backup manifest auxiliary section');
  const seen=new Set();
  for(const entry of manifest.auxiliary){
    if(!entry||typeof entry.file!=='string'||!/^auxiliary\/(kit-clients|history)\/.+\.json$/.test(entry.file)||/[\\:]/.test(entry.file)||entry.file.split('/').some(part=>!part||part==='.'||part==='..')||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)throw new Error(`invalid backup manifest auxiliary entry: ${entry?.file}`);
    const key=process.platform==='win32'?entry.file.toLowerCase():entry.file;
    if(seen.has(key))throw new Error('duplicate auxiliary manifest path');
    seen.add(key);
  }
  return manifest;
};

/** Verify the schema set and every table row count of a DB against the manifest (same file — safe to assert). */
const checkDb=(path,tables)=>{
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    const names=listTables(db);
    for(const table of CORE_TABLES)if(!names.includes(table))throw new Error(`database is missing core table: ${table}`);
    const check=integrity(db);
    if(check!=='ok')throw new Error(`database failed integrity_check: ${check}`);
    if(JSON.stringify(names)!==JSON.stringify(Object.keys(tables).sort()))throw new Error('database tables differ from the manifest');
    const counts=tableCounts(db);
    for(const name of names)if(counts[name]!==tables[name])throw new Error(`database row count mismatch for ${name}`);
  }finally{db.close()}
};

/**
 * Verify a bundle (manifest hashes, schema, counts, integrity) and copy it into a NEW
 * directory, reopening the restored DB read-only. Never overwrites an existing path,
 * never updates configuration, and never activates the restored store.
 */
export async function verifyRestore({bundle,output}){
  const bundlePath=await realOr('--bundle',requireAbsolute('--bundle',bundle));
  await noLinks(bundle);
  if(!(await lstat(bundlePath)).isDirectory())throw new Error(`--bundle is not a directory: ${bundlePath}`);
  const outputPath=await resolveNewDir('--output',output);
  if(inside(bundlePath,outputPath))throw new Error('--output must be outside the backup bundle');
  await noLinks(join(bundlePath,'manifest.json'));
  const manifest=await loadManifest(bundlePath);
  const dbFile=join(bundlePath,'state.db');
  const dbStat=await lstat(dbFile).catch(()=>{throw new Error('backup database is missing')});
  if(!dbStat.isFile())throw new Error('backup database is not a regular file');
  await verifyFile(dbFile,manifest.database);
  checkDb(dbFile,manifest.database.tables);
  for(const entry of manifest.auxiliary){
    const file=join(bundlePath,...entry.file.split('/'));
    if(!inside(bundlePath,resolve(file)))throw new Error(`auxiliary path escapes the bundle: ${entry.file}`);
    const info=await lstat(file).catch(()=>{throw new Error(`missing auxiliary backup file: ${entry.file}`)});
    if(!info.isFile())throw new Error(`auxiliary backup entry is not a regular file: ${entry.file}`);
    await verifyFile(file,entry);
  }
  try{await mkdir(outputPath)}
  catch(error){if(error.code==='EEXIST')throw new Error(`--output already exists: ${outputPath}`);throw error}
  try{
    await copyFile(dbFile,join(outputPath,'state.db'),constants.COPYFILE_EXCL);
    for(const entry of manifest.auxiliary){
      const dest=join(outputPath,...entry.file.split('/'));
      await mkdir(dirname(dest),{recursive:true});
      await copyFile(join(bundlePath,...entry.file.split('/')),dest,constants.COPYFILE_EXCL);
    }
    await verifyFile(join(outputPath,'state.db'),manifest.database);
    for(const entry of manifest.auxiliary)await verifyFile(join(outputPath,...entry.file.split('/')),entry);
    checkDb(join(outputPath,'state.db'),manifest.database.tables);
  }catch(error){await rm(outputPath,{recursive:true,force:true}).catch(()=>{});throw error}
  return {status:'verified',restoredDir:outputPath,tables:manifest.database.tables,auxiliary:manifest.auxiliary.length};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [action,...args]=process.argv.slice(2);
    if(!['backup','restore-check'].includes(action))
      throw new Error('Usage: node package/orchestration-backup.mjs backup --source ABS_DB --output ABS_NEW_DIR [--kit-root ABS_DIR] [--history-dir ABS_DIR]\n       node package/orchestration-backup.mjs restore-check --bundle ABS_DIR --output ABS_NEW_DIR');
    const flags=['--source','--output','--kit-root','--history-dir','--bundle'];
    const seenFlags=new Set();
    for(let i=0;i<args.length;i++){
      if(flags.includes(args[i])){if(seenFlags.has(args[i]))throw new Error(`duplicate argument: ${args[i]}`);seenFlags.add(args[i]);const value=args[++i];if(!isAbsolute(value||''))throw new Error(`${args[i-1]} requires an absolute path`)}
      else throw new Error(`unknown argument: ${args[i]}`);
    }
    const value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1]};
    let result;
    if(action==='backup'){
      if(value('--bundle')!==undefined)throw new Error('backup does not accept --bundle');
      result=await backupOrchestrationStore({source:value('--source'),output:value('--output'),kitRoot:value('--kit-root'),historyDir:value('--history-dir')});
    }else{
      if(value('--source')!==undefined||value('--kit-root')!==undefined||value('--history-dir')!==undefined)throw new Error('restore-check accepts only --bundle and --output');
      result=await verifyRestore({bundle:value('--bundle'),output:value('--output')});
    }
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(error.message);process.exitCode=1}
}
