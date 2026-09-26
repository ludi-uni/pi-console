import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { RuntimeManager } from './manager.ts';
import { listSessions } from './workspaces.ts';

export type RetentionPolicy = { enabled:boolean; days:number };
export const defaultRetention:RetentionPolicy = { enabled:false, days:30 };
export function validateRetention(value:unknown):RetentionPolicy {
  if (!value || typeof value!=='object') throw new Error('invalid retention settings');
  const {enabled,days}=value as Record<string,unknown>;
  if (typeof enabled!=='boolean'||!Number.isSafeInteger(days)||typeof days!=='number'||days<1||days>3650) throw new Error('retention days must be an integer from 1 to 3650');
  return {enabled,days};
}
export async function sendToRecycleBin(file:string):Promise<void> {
  if(process.platform!=='win32') throw new Error('Windows Recycle Bin is unavailable on this host');
  // Pass the path as encoded data, never as executable PowerShell input.
  const pathData=Buffer.from(file,'utf16le').toString('base64');
  const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName Microsoft.VisualBasic; $p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${pathData}')); if($p.StartsWith('\\')){throw 'Network paths have no reliable Windows Recycle Bin'}; $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($p)); if($drive.DriveType -ne [IO.DriveType]::Fixed -or -not $drive.IsReady){throw 'Only local fixed drives with a Recycle Bin are supported'}; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`;
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  await new Promise<void>((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let errors='';const timer=setTimeout(()=>child.kill(),30000);
    child.stderr.on('data',(chunk:Buffer)=>{errors=(errors+chunk.toString()).slice(-1000)});
    child.on('error',error=>{clearTimeout(timer);reject(error)});
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(`Recycle Bin operation failed (${code}): ${errors.slice(-300)}`))});
  });
  if(await fs.lstat(file).then(()=>true,(e:NodeJS.ErrnoException)=>e.code!=='ENOENT')) throw new Error('Recycle Bin did not move the session file');
}
export class SessionRecycling {
  private policy:RetentionPolicy={...defaultRetention};
  private saving:Promise<unknown>=Promise.resolve();
  private sweeping=false;
  private timer?:ReturnType<typeof setInterval>;
  private lastRun?:{at:string;moved:number;errors:number};
  constructor(private readonly file:string,private readonly runtime:RuntimeManager,private readonly move:(path:string)=>Promise<void>=sendToRecycleBin) {}
  async load(){try{this.policy=validateRetention(JSON.parse(await fs.readFile(this.file,'utf8')))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
  settings(){return {...this.policy,lastRun:this.lastRun}}
  async update(value:unknown){const policy=validateRetention(value);const save=this.saving.then(async()=>{await fs.mkdir(dirname(this.file),{recursive:true});const temp=`${this.file}.${randomUUID()}.tmp`;try{await fs.writeFile(temp,JSON.stringify(policy));await fs.rename(temp,this.file);this.policy=policy}finally{await fs.rm(temp,{force:true}).catch(()=>{})}});this.saving=save.catch(()=>{});await save;if(policy.enabled)void this.sweep().catch(error=>console.error('Session recycling:',error));return this.settings()}
  start(){if(this.policy.enabled)void this.sweep().catch(error=>console.error('Session recycling:',error));this.timer=setInterval(()=>{if(this.policy.enabled)void this.sweep().catch(error=>console.error('Session recycling:',error))},60*60*1000);this.timer.unref?.()}
  stop(){if(this.timer)clearInterval(this.timer)}
  async recycle(workspaceId:string,sessionId:string){await this.runtime.recycleSession(workspaceId,sessionId,this.move);return {ok:true}}
  async sweep(now=Date.now()){
    if(this.sweeping||!this.policy.enabled)return;
    this.sweeping=true;let moved=0,errors=0,attempted=0;const days=this.policy.days,cutoff=now-days*86400000;
    try{
      const seen=new Set<string>();
      for(const workspace of this.runtime.workspaces.list()){
        if(attempted>=50||!this.policy.enabled||this.policy.days!==days)break;
        if(!await fs.stat(workspace.path).then(s=>s.isDirectory(),()=>false))continue;
        for(const session of await listSessions(workspace,this.runtime.sessionRoot)){
          if(attempted>=50||!this.policy.enabled||this.policy.days!==days)break;
          if(!session.updatedAt||new Date(session.updatedAt).getTime()>=cutoff||seen.has(session.filePath))continue;
          seen.add(session.filePath);attempted++;
          try{await this.runtime.recycleSession(workspace.id,session.id,this.move,cutoff);moved++}catch(error){if(!['session is active or awaiting input','session is open in Pi Console'].includes((error as Error).message)) {errors++;console.error('Session recycling skipped:',(error as Error).message)}}
        }
      }
    }finally{this.lastRun={at:new Date().toISOString(),moved,errors};this.sweeping=false}
    return this.lastRun;
  }
}
