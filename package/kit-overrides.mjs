import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {copyFile,lstat,mkdir,mkdtemp,readFile,rm,writeFile,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {consoleDataDir} from './data-directory.mjs';

const files={routing:'routing/routing.local.json',models:'adapters/pi/models.local.json'};
const sha=content=>createHash('sha256').update(content).digest('hex');
const inside=(parent,path)=>{const part=relative(parent,path);return !part||part==='.'||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)};
const regular=async path=>{try{const info=await lstat(path);if(!info.isFile())throw new Error(`Not a regular file: ${path}`);return true}catch(error){if(error.code==='ENOENT')return false;throw error}};
const stablePaths=(kitDir,dataDir)=>{
  if(!isAbsolute(kitDir)||!isAbsolute(dataDir))throw new Error('kit and data directories must be absolute');
  kitDir=resolve(kitDir);dataDir=resolve(dataDir);
  if(inside(kitDir,dataDir))throw new Error('backup data directory must be outside the replaceable kit');
  return {kitDir,dataDir,backups:join(dataDir,'kit-override-backups')};
};
const kitVersion=async kitDir=>{try{return JSON.parse(await readFile(join(kitDir,'package.json'),'utf8')).version??'unknown'}catch(error){if(error.code==='ENOENT')return 'unknown';throw error}};

/** Snapshot replaceable kit-local files outside the npm package before a kit upgrade. */
export async function backupKitOverrides({kitDir,dataDir}){
  const paths=stablePaths(kitDir,dataDir),basePath=join(paths.kitDir,'routing/routing.json');
  const base=await readFile(basePath);
  const present=Object.fromEntries(await Promise.all(Object.entries(files).map(async([kind,name])=>[kind,await regular(join(paths.kitDir,name))])));
  if(!Object.values(present).some(Boolean))return {status:'no-kit-local-overrides',backup:undefined,files:[]};
  await mkdir(paths.backups,{recursive:true});
  const backup=await mkdtemp(join(paths.backups,'snapshot-'));
  const manifest={version:1,kitVersion:await kitVersion(paths.kitDir),baseSha256:sha(base),files:{}};
  try{
    for(const [kind,name] of Object.entries(files))if(present[kind]){
      const from=join(paths.kitDir,name),to=join(backup,kind+'.json');
      await copyFile(from,to,constants.COPYFILE_EXCL);
      const source=await readFile(from),copy=await readFile(to);
      if(sha(source)!==sha(copy))throw new Error(`${name} changed while backing up; stop the kit and retry`);
      manifest.files[kind]=sha(copy);
    }
    await writeFile(join(backup,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    return {status:'backed-up',backup,files:Object.keys(manifest.files),kitVersion:manifest.kitVersion};
  }catch(error){await rm(backup,{recursive:true,force:true});throw error}
}

/** Preview by default; restore only missing, compatible files from a verified snapshot. */
export async function restoreKitOverrides({kitDir,dataDir,backup,apply=false,acceptBaseChanges=false}){
  const paths=stablePaths(kitDir,dataDir);
  if(!isAbsolute(backup))throw new Error('backup directory must be absolute');
  const backupPath=resolve(backup),root=await realpath(paths.backups),actual=await realpath(backupPath);
  if(!inside(root,actual)||actual===root)throw new Error('backup must be inside the stable kit-override-backups directory');
  const manifest=JSON.parse(await readFile(join(actual,'manifest.json'),'utf8'));
  if(manifest.version!==1||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files)||Object.keys(manifest.files).some(kind=>!Object.hasOwn(files,kind))||!Object.keys(manifest.files).length)throw new Error('invalid kit override backup manifest');
  const base=await readFile(join(paths.kitDir,'routing/routing.json'));
  const baseChanged=sha(base)!==manifest.baseSha256;
  const contents={},conflicts=[];const restore=[];
  for(const [kind,expected] of Object.entries(manifest.files)){
    if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw new Error(`invalid backup hash for ${kind}`);
    const file=join(actual,kind+'.json');if(!await regular(file))throw new Error(`missing backup file: ${kind}`);
    const content=await readFile(file);if(sha(content)!==expected)throw new Error(`backup integrity check failed for ${kind}`);
    contents[kind]=content;
    const target=join(paths.kitDir,files[kind]);
    if(await regular(target)){if(sha(await readFile(target))!==expected)conflicts.push(`${files[kind]} already exists with different contents`)}
    else restore.push(kind);
  }
  if(restore.length){
    try{
      const routingModule=await import(pathToFileURL(join(paths.kitDir,'lib/routing.mjs')).href);
      const effective=contents.routing?routingModule.mergeLocalRouting(JSON.parse(base),JSON.parse(contents.routing)):routingModule.loadRouting(join(paths.kitDir,'routing/routing.json'));
      if(contents.models){const registryModule=await import(pathToFileURL(join(paths.kitDir,'lib/registry.mjs')).href);const errors=registryModule.validateRegistry(JSON.parse(contents.models),effective,'models.local.json');if(errors.length)conflicts.push(...errors)}
    }catch(error){conflicts.push(`new kit rejected the saved overrides: ${error.message}`)}
  }
  if(baseChanged&&!acceptBaseChanges)conflicts.push('kit base routing changed; compare the old and new routing.json before using --accept-base-changes');
  const plan={status:conflicts.length?'needs-review':restore.length?'ready':'already-present',backup:actual,kitVersion:await kitVersion(paths.kitDir),savedKitVersion:manifest.kitVersion,baseChanged,restore,conflicts};
  if(!apply||conflicts.length||!restore.length)return plan;
  // Recheck every target immediately before writing. COPYFILE_EXCL refuses replacement even in a race.
  for(const kind of restore)if(await regular(join(paths.kitDir,files[kind])))throw new Error(`${files[kind]} appeared during review; no files restored`);
  for(const kind of restore){
    const target=join(paths.kitDir,files[kind]);await mkdir(dirname(target),{recursive:true});
    await copyFile(join(actual,kind+'.json'),target,constants.COPYFILE_EXCL);
  }
  return {...plan,status:'restored'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [action,...args]=process.argv.slice(2);
    if(!['backup','restore'].includes(action))throw new Error('Usage: node package/kit-overrides.mjs backup|restore [--kit ABSOLUTE_DIR] [--data-dir ABSOLUTE_DIR] [--backup ABSOLUTE_DIR] [--apply] [--accept-base-changes]');
    const flags=['--kit','--data-dir','--backup'],switches=['--apply','--accept-base-changes'];
    for(let i=0;i<args.length;i++)if(flags.includes(args[i])){if(!isAbsolute(args[++i]||''))throw new Error('path flags require absolute paths')}else if(!switches.includes(args[i]))throw new Error(`unknown argument: ${args[i]}`);
    if(action==='backup'&&(args.includes('--apply')||args.includes('--accept-base-changes')||args.includes('--backup')))throw new Error('backup does not accept restore options');
    const value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1]};
    const agentDir=process.env.PI_CODING_AGENT_DIR||join(homedir(),'.pi','agent');
    const kitDir=value('--kit')||process.env.PI_CONSOLE_KIT_ROOT||join(agentDir,'npm','node_modules','@ludi-uni','ludi-agent-kit');
    const dataDir=value('--data-dir')||consoleDataDir();
    const result=action==='backup'?await backupKitOverrides({kitDir,dataDir}):await restoreKitOverrides({kitDir,dataDir,backup:value('--backup')||'',apply:args.includes('--apply'),acceptBaseChanges:args.includes('--accept-base-changes')});
    console.log(JSON.stringify(result,null,2));if(result.conflicts?.length)process.exitCode=2;
  }catch(error){console.error(error.message);process.exitCode=1}
}
