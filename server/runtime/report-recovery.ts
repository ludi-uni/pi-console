import {createHash,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {dirname,join} from 'node:path';

export type ReportRecovery={version:1;workspaceId:string;workspacePath:string;sessionId:string;sessionPath:string;runId:string;request:string;report:string;reportError:string;reportDispatchAttempted:boolean;startedAt:string;status:'pending'|'handled';handledAt?:string};

/** Console-owned report recovery only; never writes Pi sessions, kit state, or workspace metadata. */
export class ReportRecoveryStore {
  constructor(private readonly directory:string){}
  private file(sessionId:string){return join(this.directory,`${createHash('sha256').update(sessionId).digest('hex')}.json`)}
  async read(sessionId:string):Promise<ReportRecovery|undefined>{
    let raw:string;
    try{raw=await fs.readFile(this.file(sessionId),'utf8')}catch(error:any){if(error.code==='ENOENT')return;throw error}
    let value:any;
    try{value=JSON.parse(raw)}catch{throw new Error('invalid report recovery state; inspect the stored file before continuing')}
    if(value?.version!==1||value.sessionId!==sessionId||!['workspaceId','workspacePath','sessionPath','sessionId','runId','request','report','reportError','startedAt'].every(key=>typeof value[key]==='string')||
      !value.workspaceId||!value.runId||!value.workspacePath||!value.sessionPath||!['pending','handled'].includes(value.status)||typeof value.reportDispatchAttempted!=='boolean'||value.report.length>16000||value.request.length>20000||value.reportError.length>2000)
      throw new Error('invalid report recovery state; inspect the stored file before continuing');
    return value as ReportRecovery;
  }
  async save(value:ReportRecovery):Promise<void>{
    const file=this.file(value.sessionId);await fs.mkdir(dirname(file),{recursive:true,mode:0o700});
    const temp=`${file}.${randomUUID()}.tmp`;
    try{
      const handle=await fs.open(temp,'wx',0o600);
      try{await handle.writeFile(JSON.stringify(value),'utf8');await handle.sync()}finally{await handle.close()}
      await fs.rename(temp,file);
    }finally{await fs.rm(temp,{force:true}).catch(()=>{})}
  }
  async remove(sessionId:string):Promise<void>{await fs.rm(this.file(sessionId),{force:true})}
  async hasPendingWorkspace(workspaceId:string):Promise<boolean>{
    let names:string[];
    try{names=await fs.readdir(this.directory)}catch(error:any){if(error.code==='ENOENT')return false;throw error}
    for(const name of names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name))){
      let value:any;
      try{value=JSON.parse(await fs.readFile(join(this.directory,name),'utf8'))}catch{throw new Error('invalid report recovery state; inspect the stored file before continuing')}
      if(typeof value?.sessionId!=='string'||this.file(value.sessionId)!==join(this.directory,name))throw new Error('invalid report recovery state; inspect the stored file before continuing');
      const record=await this.read(value.sessionId);
      if(record?.workspaceId===workspaceId&&record.status==='pending')return true;
    }
    return false;
  }
}
