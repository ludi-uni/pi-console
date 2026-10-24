import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {request} from 'node:http';
import {win32} from 'node:path';
import {assertPinnedTarget,EXTERNAL_START_BASELINE_REQUIRED} from './stopped-update.mjs';
import {inspectStoppedTarget} from './stopped-update-prefix.mjs';
const exec=promisify(execFile);
const inventoryScript=fileURLToPath(new URL('../scripts/stopped-update-inventory.ps1',import.meta.url));
export async function windowsStoppedInventory(target){
  if(process.platform!=='win32')return {observed:false,complete:false,code:'WINDOWS_INVENTORY_UNAVAILABLE'};
  const root=process.env.SystemRoot;
  if(!root||!win32.isAbsolute(root))throw Error('OS_INVENTORY_UNAVAILABLE: SystemRoot is not an absolute Windows directory');
  let stdout;
  try{({stdout}=await exec(win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-File',inventoryScript,'-ExpectedStartup',win32.join(target.prefix,'node_modules','@ludi-uni','pi-console','package','startup.mjs'),'-DiagnosticPid',String(process.pid)],{
    windowsHide:true,timeout:20000,maxBuffer:262144,
    env:{SystemRoot:root,WINDIR:root}, // No live credentials, profile environment, .env or PATH inheritance.
  }));}catch{throw Error('OS_INVENTORY_DENIED_OR_FAILED: diagnostic stopped; no alternate route attempted');}
  let value;try{value=JSON.parse(stdout.trim());}catch{throw Error('OS_INVENTORY_INVALID: diagnostic stopped');}
  if(value.observed!==true)throw Error('OS_INVENTORY_DENIED_OR_FAILED: diagnostic stopped');
  return value;
}
/** Optional public identity only; caller must supply an explicit approved loopback port.
 * No configured/default port, secret header, environment loader or shutdown call. */
export function publicManagementIdentity(port){
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('invalid explicit identity port');
  return new Promise(resolve=>{
    let finished=false;const done=value=>{if(finished)return;finished=true;clearTimeout(timer);req.destroy();resolve(value);};
    const req=request({hostname:'127.0.0.1',port,path:'/api/manage/identity',method:'GET',headers:{host:`127.0.0.1:${port}`}},res=>{
      let body='',size=0;res.on('data',chunk=>{size+=chunk.length;if(size>65536)return done({observed:false,code:'IDENTITY_TOO_LARGE'});body+=chunk.toString();});
      res.on('end',()=>{try{const v=JSON.parse(body);if(res.statusCode!==200||v.service!=='pi-console')return done({observed:false,code:'IDENTITY_UNVERIFIED'});
        done({observed:true,service:'pi-console',pid:Number.isInteger(v.pid)?v.pid:null,port:Number.isInteger(v.port)?v.port:null,startedAt:typeof v.startedAt==='string'&&/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(v.startedAt)?v.startedAt:null,ownershipVerified:false});
      }catch{done({observed:false,code:'IDENTITY_INVALID'});}});res.on('error',()=>done({observed:false,code:'IDENTITY_UNREACHABLE'}));
    });
    const timer=setTimeout(()=>done({observed:false,code:'IDENTITY_TIMEOUT'}),1500);
    req.on('error',()=>done({observed:false,code:'IDENTITY_UNREACHABLE'}));req.end();
  });
}
export async function diagnoseStoppedUpdate(target,{inventory=windowsStoppedInventory,inspect=inspectStoppedTarget,identityPort,identity=publicManagementIdentity}={}){
  assertPinnedTarget(target);
  const os=await inventory(target);
  // Metadata only: no directory listing, state/token/scope/key or file bytes.
  // A failed/denied target inspection aborts; there is no privileged fallback.
  const canonicalTarget=await inspect(target);
  assertPinnedTarget(canonicalTarget);
  // OS snapshots never prove future exclusion of direct starts, indirect wrappers or other users.
  const blockers=['DIRECT_STARTS_NOT_EXCLUDED','INDIRECT_TASK_SERVICE_WRAPPERS_UNPROVEN','RUNTIME_DATA_DIR_AND_WORKER_OWNERSHIP_UNPROVEN'];
  if(os.complete!==true||os.observed!==true||os.unreadableProcessMetadata>0)blockers.push('PROCESS_OBSERVATION_INCOMPLETE');
  if(os.running?.length)blockers.push('CONSOLE_OR_RELATED_PROCESS_CANDIDATES_REMAIN');
  if(os.startup?.some(s=>s.kind==='reviewed-managed-startup'))blockers.push('MANAGED_STARTUP_PRESENT_POLICY_UNREAD');
  if(os.startup?.some(s=>s.kind!=='reviewed-managed-startup'))blockers.push('OTHER_STARTUP_ENTRIES_UNCLASSIFIED');
  const management=identityPort===undefined?{observed:false,code:'IDENTITY_NOT_REQUESTED'}:await identity(identityPort);
  if(management.observed)blockers.push('PUBLIC_MANAGEMENT_LISTENER_REMAINS');
  return {ok:false,code:EXTERNAL_START_BASELINE_REQUIRED,complete:false,target,canonicalTarget,os,management,blockers,
    ownerActions:[
      '本人の既存操作でConsoleと所属worker・guard/tunnelを通常終了する（ブラウザー/Pi終了だけではdetached serverは終了しない）。',
      'Startup・Pi hook再登録・直接起動・task/service/wrapper・別npm更新の起動元を管理者と特定し、保守中の再実行を避ける。今回は変更しない。',
      '観測不能process/間接wrapper/管理外起動を排他できる別途承認済みadapter契約が必要。自己申告/checkboxではapplyを解除しない。',
      '対象prefix/entryのcanonical identityとstable領域の分離、検証済みsoftware backup、139files/hashの照合を別途受入する。',
    ]};
}
