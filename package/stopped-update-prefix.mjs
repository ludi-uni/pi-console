// Origin: prepared deployment/prefix-backup.mjs; narrowed to software-only stopped updates.
import assert from 'node:assert/strict';
import {cp,mkdir,readdir,rename,realpath,lstat,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,join,dirname,sep,isAbsolute,parse} from 'node:path';
const norm=p=>process.platform==='win32'?resolve(p).toLowerCase():resolve(p);
const within=(root,p)=>{const r=relative(norm(root),norm(p));return r===''||(!r.startsWith(`..${sep}`)&&r!=='..'&&!isAbsolute(r));};
const stableNames=['.env','.pi-console','data','auth','scope','claims','receipt','receipts','queue','report','reports','server-state.json','server-token','server.lock','readonly-mcp.key','readonly-mcp-scope.json','workspace-permissions.json','workspace-permissions.json.lock','dots-permission-receipts','prompt-receipts','control-mcp'];
async function noRedirect(path){
  assert(isAbsolute(path),'absolute path required'); let cursor=parse(resolve(path)).root;
  for(const part of resolve(path).slice(cursor.length).split(sep).filter(Boolean)){
    cursor=join(cursor,part); let s;try{s=await lstat(cursor)}catch(e){if(e.code==='ENOENT')break;throw e;}
    assert(!s.isSymbolicLink(),'linked path ancestor is not permitted');
    assert.equal(norm(await realpath(cursor)),norm(cursor),'redirected path ancestor is not permitted');
  }
  return resolve(path);
}
export async function inspectStoppedTarget(target,{softwareMayHaveChanged=false}={}){
  const filesystemIdentity={};const canonical={};
  for(const key of ['dataDir','prefix','entry']){
    await noRedirect(target[key]);
    let s;
    try { canonical[key]=await realpath(target[key]); s=await lstat(canonical[key],{bigint:true}); }
    catch(error){
      // An install can replace or remove software files. The stable directory and
      // prefix objects must still exist unchanged; only the entry may be absent.
      if(key!=='entry'||!softwareMayHaveChanged||error.code!=='ENOENT')throw error;
      canonical[key]=resolve(target[key]);filesystemIdentity[key]=null;continue;
    }
    assert(key==='entry'?s.isFile():s.isDirectory(),`invalid ${key} kind`);
    filesystemIdentity[key]={dev:String(s.dev),ino:String(s.ino),birthtimeNs:String(s.birthtimeNs)};
  }
  assert(within(canonical.prefix,canonical.entry),'entry must be inside software prefix');
  assert(!within(canonical.prefix,canonical.dataDir),'stable data must not be inside prefix');
  if(within(canonical.dataDir,canonical.prefix))assert(relative(canonical.dataDir,canonical.prefix).split(sep)[0]==='reviewed-releases','nested prefix must be a distinct reviewed-releases software subtree');
  return {...canonical,filesystemIdentity};
}
async function manifest(root,software=false){
  const files=[],directories=[];
  async function visit(dir){for(const name of (await readdir(dir)).sort()){
    if(software)assert(!stableNames.includes(name.toLowerCase()),'stable/runtime material or ambiguous reserved name found in software prefix; refuse to read or back up');
    const p=join(dir,name),s=await lstat(p); assert(!s.isSymbolicLink(),'linked software/backup entry is not permitted');
    if(s.isDirectory()){directories.push(relative(root,p).replaceAll('\\','/'));await visit(p);}
    else {assert(s.isFile(),'unsupported prefix entry');files.push({path:relative(root,p).replaceAll('\\','/'),sha256:createHash('sha256').update(await readFile(p)).digest('hex')});}
  }}
  await visit(root); return {directories,files};
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function boundaries({sandbox,prefix,dataDir,backupRoot}){
  for(const p of [sandbox,prefix,dataDir,backupRoot])await noRedirect(p);
  assert([prefix,dataDir,backupRoot].every(p=>within(sandbox,p)&&norm(p)!==norm(sandbox)),'path escapes dedicated sandbox');
  assert(!within(prefix,backupRoot)&&!within(dataDir,backupRoot)&&!within(backupRoot,prefix)&&!within(backupRoot,dataDir),'backup must be disjoint from software and stable data');
  assert(!within(prefix,dataDir),'stable data must not be inside software');
  if(within(dataDir,prefix))assert(relative(dataDir,prefix).split(sep)[0]==='reviewed-releases','nested software must be explicitly separated');
}
export async function backupStoppedPrefix({sandbox,prefix,dataDir,backupRoot,id}){
  assert(/^[a-zA-Z0-9-]+$/.test(id),'safe backup id required');
  await boundaries({sandbox,prefix,dataDir,backupRoot});
  const destination=join(backupRoot,id),manifestPath=join(backupRoot,`${id}.manifest.json`);
  await noRedirect(destination);await noRedirect(manifestPath);
  const before=await manifest(prefix,true);await mkdir(backupRoot,{recursive:true});
  await mkdir(destination); // exclusive: do not merge a previous backup, including an empty directory.
  for(const name of await readdir(prefix))await cp(join(prefix,name),join(destination,name),{recursive:true,force:false,errorOnExist:true});
  assert(same(before,await manifest(destination))&&same(before,await manifest(prefix,true)),'backup hash mismatch');
  await writeFile(manifestPath,JSON.stringify(before)+'\n',{flag:'wx'});
  return {id,path:destination,manifestPath,outsidePrefix:true,outsideDataDir:true,manifestVerified:true};
}
export async function restoreStoppedPrefix({sandbox,prefix,dataDir,backupRoot,backup}){
  await boundaries({sandbox,prefix,dataDir,backupRoot});
  assert(/^[a-zA-Z0-9-]+$/.test(backup.id)&&norm(backup.path)===norm(join(backupRoot,backup.id))&&norm(backup.manifestPath)===norm(join(backupRoot,`${backup.id}.manifest.json`)),'backup identity changed');
  await noRedirect(backup.path);await noRedirect(backup.manifestPath);
  const expected=JSON.parse(await readFile(backup.manifestPath,'utf8'));
  assert(same(expected,await manifest(backup.path,true)),'backup hash mismatch');
  const quarantine=join(backupRoot,`${backup.id}-failed`);await noRedirect(quarantine);
  try{await lstat(quarantine);throw Error('failed-prefix evidence already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
  // Inspect before moving: never move or restore stable state carried into software.
  await manifest(prefix,true);
  await rename(prefix,quarantine);
  try{await cp(backup.path,prefix,{recursive:true,force:false,errorOnExist:true});assert(same(expected,await manifest(prefix,true)),'restore hash mismatch');return {quarantine};}
  catch(e){throw Error(`restore failed; backup and failed-prefix evidence retained: ${e.message}`);}
}
