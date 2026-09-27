import {randomUUID} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {consoleDataDir} from './data-directory.mjs';

const names=['workspaces.json','session-retention.json'];
const exists=async path=>stat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error});
const registry=async path=>{
  if(!await exists(path))return undefined;
  const data=JSON.parse(await readFile(path,'utf8'));
  const workspaces=Array.isArray(data)?data:data?.workspaces;
  if(!Array.isArray(workspaces)||workspaces.some(item=>!item||typeof item.id!=='string'||typeof item.path!=='string'))throw new Error(`Invalid workspace registry: ${path}`);
  return {data,workspaces};
};
const key=path=>resolve(path).replace(/[\\/]+$/,'').toLowerCase();
async function writeAtomic(path,content){
  await mkdir(dirname(path),{recursive:true});const temp=`${path}.${randomUUID()}.tmp`;
  try{await writeFile(temp,content,{flag:'wx'});await rename(temp,path)}finally{await rm(temp,{force:true})}
}

/** Back up both locations before merging; never replace existing workspace records or settings. */
export async function prepareUpgrade({legacyDir,dataDir,apply=false}){
  if(!isAbsolute(legacyDir)||!isAbsolute(dataDir))throw new Error('legacy and data directories must be absolute');
  legacyDir=resolve(legacyDir);dataDir=resolve(dataDir);
  const insidePackage=relative(dirname(legacyDir),dataDir);
  if(!insidePackage||insidePackage==='.'||insidePackage!=='..'&&!insidePackage.startsWith('..'+sep)&&!isAbsolute(insidePackage))throw new Error('data directory must be outside the replaceable package');
  const legacyFiles=await Promise.all(names.map(name=>exists(join(legacyDir,name))));
  if(!legacyFiles.some(Boolean))return {status:'no-legacy-data',backup:undefined,missing:0,conflicts:[]};
  await mkdir(dataDir,{recursive:true});
  const backup=await mkdtemp(join(dataDir,'pre-upgrade-'));
  for(const [i,name] of names.entries()){
    if(legacyFiles[i])await copyFile(join(legacyDir,name),join(backup,`legacy-${name}`));
    if(await exists(join(dataDir,name)))await copyFile(join(dataDir,name),join(backup,`stable-${name}`));
  }
  // Read the snapshots so changes to the live registries during comparison do not corrupt the plan.
  const old=await registry(join(backup,'legacy-workspaces.json'));
  const current=await registry(join(backup,'stable-workspaces.json'));
  const stable=current?.workspaces??[], incoming=old?.workspaces??[];
  const ids=new Map(stable.map(item=>[item.id,item]));
  const paths=new Set(stable.map(item=>key(item.path)));
  const missing=[],conflicts=[];
  for(const item of incoming){
    const sameId=ids.get(item.id);
    if(sameId&&key(sameId.path)!==key(item.path)){conflicts.push(`Workspace ID ${item.id} has different paths`);continue}
    if(sameId||paths.has(key(item.path)))continue;
    if(missing.some(candidate=>candidate.id===item.id||key(candidate.path)===key(item.path))){conflicts.push(`Duplicate legacy workspace ${item.id}`);continue}
    missing.push(item);
  }
  if(old&&current&&JSON.stringify(old.data.quickPrompts)!==JSON.stringify(current.data.quickPrompts))conflicts.push('Quick prompts differ (stable values retained; compare backups)');
  const legacyRetention=await exists(join(backup,'legacy-session-retention.json'));
  const stableRetention=await exists(join(backup,'stable-session-retention.json'));
  if(legacyRetention&&stableRetention&&await readFile(join(backup,'legacy-session-retention.json'),'utf8')!==await readFile(join(backup,'stable-session-retention.json'),'utf8'))conflicts.push('Retention settings differ (stable values retained; compare backups)');
  // Refuse to apply a stale plan if the live stable files changed after the snapshots.
  if(apply&&!conflicts.length){
    for(const name of names){
      const snapshot=join(backup,`stable-${name}`), live=join(dataDir,name);
      const wasPresent=await exists(snapshot);
      if(wasPresent!==await exists(live)||wasPresent&&await readFile(snapshot,'utf8')!==await readFile(live,'utf8')){
        conflicts.push(`${name} changed during preparation; retry after stopping Pi Console`);
        break;
      }
    }
  }
  // Even when conflicts exist, report them without changing either registry; backups remain available.
  if(apply&&!conflicts.length){
    if(old&&(missing.length||!current)){
      const merged=current?Array.isArray(current.data)?{workspaces:[...stable,...missing]}:{...current.data,workspaces:[...stable,...missing]}:old.data;
      await writeAtomic(join(dataDir,'workspaces.json'),JSON.stringify(merged,null,2));
    }
    if(legacyRetention&&!stableRetention)await copyFile(join(backup,'legacy-session-retention.json'),join(dataDir,'session-retention.json'),constants.COPYFILE_EXCL);
  }
  return {status:conflicts.length?'needs-review':apply?'applied':'preview',backup,missing:missing.length,conflicts};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),apply=args.includes('--apply');
    for(let i=0;i<args.length;i++){
      if(args[i]==='--apply')continue;
      if((args[i]==='--legacy'||args[i]==='--data-dir')&&isAbsolute(args[i+1]||'')){i++;continue}
      throw new Error('Usage: node package/prepare-upgrade.mjs [--legacy ABSOLUTE_DIR] [--data-dir ABSOLUTE_DIR] [--apply]');
    }
    const value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1]};
    const agentDir=process.env.PI_CODING_AGENT_DIR||join(homedir(),'.pi','agent');
    const legacyDir=value('--legacy')||join(agentDir,'npm','node_modules','@ludi-uni','pi-console','.pi-console');
    const dataDir=value('--data-dir')||consoleDataDir();
    const result=await prepareUpgrade({legacyDir,dataDir,apply});
    console.log(JSON.stringify(result,null,2));
    if(result.conflicts.length)process.exitCode=2;
  }catch(error){console.error(error.message);process.exitCode=1}
}
