import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,rename,rm,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
export interface FinalBinding { runtimeInstance:string; workspaceId:string; sessionId:string; generation:string; runId:string }
export interface SavedFinalAnswer { storage:'saved'|'saving'|'missing'|'unknown'|'binding_changed'|'too_large'; deliveryConfirmed:boolean; foregroundStatus:string; text?:string; sha256?:string; sourceEntryId?:string; binding:FinalBinding }
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
/** Private opt-in journal. Never scans a directory or accepts an RPC path. */
export class FinalAnswerJournal {
  private docs=new Map<string,SavedFinalAnswer>();private seals=new Map<string,string>();
  private tail=Promise.resolve();private pending=0;private unavailable=false;
  constructor(private readonly dir:string,private readonly owner:Omit<FinalBinding,'runId'>){}
  begin(runId:string){if(this.docs.size>=256)return;this.docs.set(runId,{binding:{...this.owner,runId},storage:'missing',deliveryConfirmed:false,foregroundStatus:'running'});}
  ack(runId:string){const d=this.docs.get(runId);if(d){d.deliveryConfirmed=true;this.persist(d);}}
  terminal(runId:string,status:string){const d=this.docs.get(runId);if(d){d.foregroundStatus=status;this.persist(d);}}
  evidence(raw:Record<string,any>){const d=this.docs.get(raw.runId);if(!d||raw.sessionId!==this.owner.sessionId)return;
    if(raw.state==='saved'&&typeof raw.text==='string'&&Buffer.byteLength(raw.text)<=65536&&raw.sha256===hash(raw.text)&&typeof raw.sourceEntryId==='string'){
      if(d.text!==undefined&&(d.text!==raw.text||d.sourceEntryId!==raw.sourceEntryId)){d.storage='binding_changed';delete d.text;delete d.sha256;}
      else {d.storage='saved';d.text=raw.text;d.sha256=raw.sha256;d.sourceEntryId=raw.sourceEntryId;}
    }else {d.storage=['saving','missing','binding_changed','too_large'].includes(raw.state)?raw.state:'unknown';delete d.text;delete d.sha256;}
    this.persist(d);
  }
  private file(runId:string){return join(this.dir,hash(JSON.stringify({...this.owner,runId}))+'.json');}
  private persist(d:SavedFinalAnswer){const snapshot=JSON.stringify(d);this.pending++;
    this.tail=this.tail.then(async()=>{const temp=this.file(d.binding.runId)+'.'+randomUUID()+'.tmp';try{
      await mkdir(this.dir,{recursive:true});const h=await open(temp,'wx',0o600);try{await h.writeFile(snapshot);await h.sync();}finally{await h.close();}await rename(temp,this.file(d.binding.runId));this.seals.set(d.binding.runId,hash(snapshot));
    }catch{this.unavailable=true;}finally{await rm(temp,{force:true}).catch(()=>{});this.pending--;}});
  }
  flush(){return this.tail;}
  async read(runId:string):Promise<SavedFinalAnswer>{const empty=(storage:SavedFinalAnswer['storage']):SavedFinalAnswer=>({binding:{...this.owner,runId},storage,deliveryConfirmed:false,foregroundStatus:'unknown'});
    if(!this.docs.has(runId))return empty('missing');if(this.pending)return empty('saving');if(this.unavailable)return empty('unknown');
    const file=this.file(runId);let h;
    try{const before=await lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>128*1024||await realpath(file)!==file)return empty('binding_changed');
      h=await open(file,'r');const opened=await h.stat(),text=await h.readFile('utf8'),after=await h.stat(),pathAfter=await lstat(file);
      const stamp=(s:typeof before)=>JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs]);if(stamp(before)!==stamp(opened)||stamp(opened)!==stamp(after)||stamp(after)!==stamp(pathAfter)||hash(text)!==this.seals.get(runId))return empty('binding_changed');
      const d=JSON.parse(text) as SavedFinalAnswer;if(JSON.stringify(d.binding)!==JSON.stringify({...this.owner,runId})||d.text!==undefined&&d.sha256!==hash(d.text))return empty('binding_changed');return d;
    }catch{return empty('unknown');}finally{await h?.close();}
  }
}
