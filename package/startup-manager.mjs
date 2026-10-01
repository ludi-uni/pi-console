import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const marker='Pi Console managed startup v1';
const shortcutName='Pi Console.lnk';
const packageRoot=fileURLToPath(new URL('../',import.meta.url));
const startupEntry=fileURLToPath(new URL('./startup.mjs',import.meta.url));
const quote=value=>`'${value.replaceAll("'","''")}'`;
const configPath=agentDir=>join(agentDir,'pi-console','startup.json');
export function agentDirectory(env=process.env){return env.PI_CODING_AGENT_DIR || join(homedir(),'.pi','agent')}
async function ps(script){
  const encoded=Buffer.from(`$ErrorActionPreference='Stop'; ${script}`,'utf16le').toString('base64');
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,timeout:12000,maxBuffer:65536});
  return stdout.trim();
}
async function startupPath(dir){
  if(dir!==undefined){if(!isAbsolute(dir))throw new Error('startup directory must be absolute');return resolve(dir)}
  const path=await ps("[Environment]::GetFolderPath('Startup')");
  if(!isAbsolute(path))throw new Error('Windows Startup folder is unavailable');
  return path;
}
async function policy(agentDir){
  try{const data=JSON.parse(await fs.readFile(configPath(agentDir),'utf8'));if(typeof data.enabled!=='boolean')throw new Error('invalid startup policy');return data.enabled}
  catch(error){if(error.code==='ENOENT')return true;throw error}
}
async function savePolicy(agentDir,enabled){
  const path=configPath(agentDir);await fs.mkdir(dirname(path),{recursive:true});
  const temp=`${path}.${process.pid}.tmp`;
  try{await fs.writeFile(temp,JSON.stringify({enabled}));await fs.rename(temp,path)}finally{await fs.rm(temp,{force:true}).catch(()=>{})}
}
async function shortcutState(path){
  if(!await fs.stat(path).then(()=>true,()=>false))return 'missing';
  const script=`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${quote(path)}); if($s.Description -eq ${quote(marker)} -and $s.Arguments.Contains(${quote(startupEntry)})){Write-Output 'owned'}else{Write-Output 'foreign'}`;
  return (await ps(script))==='owned'?'owned':'foreign';
}
async function installShortcut(path){
  const current=await shortcutState(path);
  if(current==='foreign')throw new Error('An unrelated Startup entry already uses Pi Console.lnk');
  await fs.mkdir(dirname(path),{recursive:true});
  const argumentsText=`--import tsx "${startupEntry}"`;
  await ps(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${quote(path)}); $s.TargetPath=${quote(process.execPath)}; $s.Arguments=${quote(argumentsText)}; $s.WorkingDirectory=${quote(packageRoot)}; $s.Description=${quote(marker)}; $s.WindowStyle=7; $s.Save()`);
  if(await shortcutState(path)!=='owned')throw new Error('Startup shortcut verification failed');
}
export async function startupStatus({agentDir=agentDirectory(),startupDir}={}){
  if(process.platform!=='win32')return {supported:false,enabled:false,installed:false};
  const enabled=await policy(agentDir);
  const state=await shortcutState(join(await startupPath(startupDir),shortcutName));
  return {supported:true,enabled,installed:state==='owned',conflict:state==='foreign'};
}
export async function setStartup(enabled,{agentDir=agentDirectory(),startupDir}={}){
  if(process.platform!=='win32')throw new Error('Windows Startup is unavailable on this host');
  if(typeof enabled!=='boolean')throw new Error('enabled must be a boolean');
  const path=join(await startupPath(startupDir),shortcutName);
  if(enabled){await installShortcut(path);await savePolicy(agentDir,true)}
  else {await savePolicy(agentDir,false);if(await shortcutState(path)==='owned')await fs.rm(path)}
  return startupStatus({agentDir,startupDir});
}
/** Pi has no package-install hook. Register on the first trusted interactive Pi session after installation. */
export async function ensureStartupOnPiSession(options={}){
  if(process.platform!=='win32')return;
  const agentDir=options.agentDir || agentDirectory();
  if(!await policy(agentDir))return;
  const path=join(await startupPath(options.startupDir),shortcutName);
  await installShortcut(path);
  // A Settings request in another process may have disabled startup while the shortcut was written.
  if(!await policy(agentDir)&&await shortcutState(path)==='owned')await fs.rm(path);
}
