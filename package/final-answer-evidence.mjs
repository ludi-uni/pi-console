// Passive evidence only. No model, session creation, commands, discovery or grants.
import {createHash} from 'node:crypto';
import {lstatSync,realpathSync,openSync,fstatSync,readFileSync,closeSync} from 'node:fs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export class FinalAnswerEvidence {
  start(runId,manager){this.reset();if(!/^[a-f0-9-]{36}$/.test(runId??''))return;this.binding={runId,sessionId:manager.getSessionId(),file:manager.getSessionFile(),cwd:manager.getCwd(),leaf:manager.getLeafId()};}
  reset(){this.binding=undefined;this.candidate=undefined;this.reason=undefined;}
  observe(event){if(!this.binding||event.type!=='message_end'||event.message?.role!=='assistant')return;
    const m=event.message;this.candidate=undefined;this.reason=undefined;
    if(m.stopReason!=='stop'||!Array.isArray(m.content)||m.content.some(b=>b.type==='toolCall'))return;
    const text=m.content.filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text).join('');
    if(text&&Buffer.byteLength(text)<=65536)this.candidate={text,messageHash:hash(JSON.stringify(m))};else if(Buffer.byteLength(text)>65536)this.reason='too_large';
  }
  finish(manager){
    const b=this.binding,c=this.candidate,reason=this.reason;this.reset();if(!b)return undefined;
    const denied=state=>({type:'console_final_answer_saved',runId:b.runId,sessionId:b.sessionId,state});
    if(!c)return denied(reason??'missing');let fd;
    try {
      if(manager.getSessionId()!==b.sessionId||manager.getSessionFile()!==b.file||!b.file||realpathSync(b.file)!==b.file)return denied('binding_changed');
      const st=lstatSync(b.file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>8*1024*1024)return denied('unknown');
      fd=openSync(b.file,'r');const before=fstatSync(fd);const raw=readFileSync(fd,'utf8'),after=fstatSync(fd),pathAfter=lstatSync(b.file);
      const stamp=s=>JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs]);
      if(stamp(st)!==stamp(before)||stamp(before)!==stamp(after)||stamp(after)!==stamp(pathAfter)||realpathSync(b.file)!==b.file)return denied('binding_changed');
      if(!raw.endsWith('\n'))return denied('saving');
      const rows=raw.trimEnd().split('\n').map(s=>JSON.parse(s));if(rows.length>10000)return denied('unknown');
      if(rows[0]?.type!=='session'||rows[0].id!==b.sessionId||rows[0].cwd!==b.cwd)return denied('binding_changed');
      const entries=new Map();for(const entry of rows.slice(1)){if(entries.has(entry.id))return denied('unknown');entries.set(entry.id,entry);}
      let id=manager.getLeafId(),found,seen=new Set();
      while(id!==b.leaf){if(!id||seen.has(id)||!entries.has(id))return denied('binding_changed');seen.add(id);const e=entries.get(id);
        // Latest assistant on the new branch must be the qualified candidate;
        // later user/tool/compaction work is not silently treated as its final.
        if(!found&&e.type==='message'){if(e.message?.role!=='assistant'||hash(JSON.stringify(e.message))!==c.messageHash)return denied('missing');found=e;}
        if(['compaction','branch_summary','context_edit'].includes(e.type))return denied('binding_changed');id=e.parentId;
      }
      if(!found)return denied('missing');
      return {type:'console_final_answer_saved',runId:b.runId,sessionId:b.sessionId,state:'saved',text:c.text,sha256:hash(c.text),sourceEntryId:found.id};
    }catch{return denied('unknown');}finally{if(fd!==undefined)closeSync(fd);}
  }
}
