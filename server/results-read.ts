import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, realpath, open } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ResultFeature, ResultGrant, ResultProjection, ResultRuntime, ResultTarget } from '../shared/results-read.ts';
import { resultFeatures, resultTargetKeys } from '../shared/results-read.ts';
import { WorkspacePermissions, canonicalPermissionPath, strictPermissionObject } from './workspace-permissions.ts';
import { pathKey } from './runtime/workspaces.ts';

export class ResultReadFault extends Error { constructor(readonly code: string) { super(code); } }
const deny = (code: string): never => { throw new ResultReadFault(code); };
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const terminal = new Set(['completed','failed','cancelled','interrupted']);
const active = new Set(['queued','running','waiting','blocked']);
const kinds=new Set(['run','orchestrator','task','agent','tool','decision']);
const sources=new Set(['pi','pi-subagents','orchestrator']);
const statusValue=(v:string)=>terminal.has(v)||active.has(v)?v:'unknown';
const trusted = { trust: 'untrusted_data' as const, instructions: false as const };
const integer = (v: number, max: number) => { if (!Number.isSafeInteger(v) || v < 0 || v > max) deny('invalid_arguments'); return v; };
const stamp = (s: Awaited<ReturnType<typeof lstat>>) => JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.birthtimeMs,s.nlink]);
const rootStamp = (s: Awaited<ReturnType<typeof lstat>>) => JSON.stringify([s.dev,s.ino,s.birthtimeMs]);
const credential = /(^|[\/\\])(?:\.env(?:\..*)?|.*\.(?:key|pem|pfx|p12)|(?:credentials?|secrets?|tokens?|auth|readonly-mcp-scope|workspace-permissions)\.(?:json|ya?ml)|(?:control-mcp|prompt-receipts|dots-permission-receipts)|\.git|\.pi)(?:[\/\\]|$)/i;
const safeName = (s: string) => typeof s === 'string' && s.length > 0 && s.length <= 200 && !/[\/\\\x00-\x1f]/.test(s);
const binding = (t: ResultTarget) => JSON.stringify(resultTargetKeys.map(k => t[k]));
const textTypes = new Set(['text/plain','text/markdown','text/csv','application/json']);
const binaryTypes = new Set(['application/octet-stream','application/pdf','image/png','image/jpeg','image/webp']);
interface Artifact { id: string; target: ResultTarget; relativePath: string; name: string; mime: string; kind: 'generated' | 'attached'; size: number; sha256: string; version: string; stamp: string; rootStamp: string }

/** No endpoint registration. Host-side explicit disclosure grants default to OFF.
 * Existing WorkspacePermissions supplies instance/revision/session/generation and
 * a serialized revocation fence; feature grants additionally bind the exact run.
 */
export class ResultsReadService {
  private readonly key = randomBytes(32);
  private readonly artifacts = new Map<string, Artifact>();
  private readonly grants: ResultGrant[];
  private readonly secrets: string[];
  private readonly now: () => number;
  constructor(private readonly permissions: WorkspacePermissions, private readonly runtime: ResultRuntime,
    private readonly options: { enabled?: boolean; grants?: ResultGrant[]; knownSecrets?: string[]; now?: () => number; finalCredential?:{epoch:string;active:()=>boolean} } = {}) {
    this.grants = structuredClone(options.grants ?? []); this.secrets = [...(options.knownSecrets ?? [])]; this.now = options.now ?? Date.now;
    if (this.grants.length > 256 || this.secrets.length > 32 || this.secrets.some(s => s.length < 8 || s.length > 4096) ||
      this.grants.some(g => !Array.isArray(g.features) || !g.features.length || g.features.some(f => !resultFeatures.includes(f)) || !Number.isFinite(g.expiresAt))) deny('invalid_configuration');
  }
  protectsKnownSecret(secret:string) { return this.secrets.includes(secret); }
  private feature(t: ResultTarget, f: ResultFeature) {
    strictPermissionObject(t,[...resultTargetKeys]);
    if (!resultTargetKeys.filter(k=>k!=='revision').every(k=>typeof t[k]==='string' && (t[k] as string).length>0 && (t[k] as string).length<=200) || !Number.isSafeInteger(t.revision)) deny('invalid_arguments');
    if (this.secrets.some(s=>resultTargetKeys.some(k=>typeof t[k]==='string'&&(t[k] as string).includes(s)))) deny('target_known_secret');
    if (!this.options.enabled) deny('feature_disabled');
    if(f==='final_answer'&&this.options.finalCredential){if(!this.options.finalCredential.active())deny('credential_inactive');return;}
    if (!this.grants.some(g => binding(g.target) === binding(t) && g.features.includes(f) && g.expiresAt > this.now())) deny('content_scope_denied');
  }
  private projection(t: ResultTarget) {
    const p = this.runtime.readOnlyResultProjection(t.workspaceId,t.sessionId);
    if (!p || p.generation !== t.generation || !p.nodes.some(n=>n.id===t.runId&&['run','orchestrator'].includes(n.kind))) deny('target_unavailable');
    return structuredClone(p!);
  }
  private async admitted<T>(t: ResultTarget, f: ResultFeature, work: (p: ResultProjection, path: string) => Promise<T> | T) {
    this.feature(t,f);
    return this.permissions.admit(t.instance,t.revision,t,'read',async w => {
      const ws=this.runtime.workspaces.get(t.workspaceId);
      if (pathKey(ws.path)!==pathKey(w.path)) deny('target_unavailable');
      await canonicalPermissionPath(w.path); this.projection(t);
    },async w => {
      const p=this.projection(t), out=await work(p,w.path);
      this.feature(t,f); this.projection(t); await canonicalPermissionPath(w.path);
      const current=this.projection(t); this.feature(t,f); // Last synchronous release fence after all I/O.
      if(f==='final_answer'&&(out as any)?.readable===true){
        if(current.nodes.find(n=>n.id===t.runId)?.status!=='completed')deny('final_answer_changed');
        const members=this.members(current,t),relatedChildrenActive=current.nodes.some(n=>n.id!==t.runId&&members.has(n.id)&&active.has(n.status));
        return {...out,snapshotLive:current.live===true,relatedChildrenActive,overallState:current.live&&relatedChildrenActive?'running':'unknown'};
      }
      return out;
    },f==='final_answer'&&this.options.finalCredential?{...this.options.finalCredential,runId:t.runId,now:this.now}:undefined);
  }
  private redact(s: string) { for (const secret of this.secrets) s=s.split(secret).join('[REDACTED]'); return s; }
  private bounded(s: unknown, max=8192) {
    const redacted=this.redact(typeof s==='string'?s:'');const bytes=Buffer.from(redacted);
    // Decode only a complete UTF-8 prefix (no invented replacement character).
    let end=Math.min(bytes.length,max);while(end>0&&end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
    return {text:bytes.subarray(0,end).toString('utf8'),truncated:end<bytes.length};
  }
  private historyTexts(events: ResultProjection['events']) {
    const raw=events.map(e=>e.type==='MessageDelta'&&e.payload.channel==='thinking'?'':e.payload.text??e.payload.delta??(e.payload.chatTool as {output?:unknown}|undefined)?.output??e.payload.summary);
    const strings=raw.map(s=>typeof s==='string'?s:'');
    if(strings.reduce((n,s)=>n+s.length,0)>512*1024)return strings.map(()=>({text:'',truncated:true,redacted:false,redactionWithheld:false}));
    // Mask matches across delta/page boundaries, and withhold a possible trailing
    // prefix until its continuation is known. Cursors may replay safely; no secret
    // prefix is released just because the current page ends there.
    const joined=strings.join(''),masked=new Uint8Array(joined.length),pending=new Uint8Array(joined.length);
    for(const secret of this.secrets){let at=joined.indexOf(secret);while(at>=0){masked.fill(1,at,at+secret.length);at=joined.indexOf(secret,at+1);}
      for(let n=1;n<secret.length&&n<=joined.length;n++)if(joined.endsWith(secret.slice(0,n))){masked.fill(1,joined.length-n);pending.fill(1,joined.length-n);}}
    let offset=0;return strings.map(s=>{let text='',inside=false,redacted=false,redactionWithheld=false;for(let i=0;i<s.length;i++){redactionWithheld ||= !!pending[offset+i];if(masked[offset+i]){redacted=true;if(!inside)text+='[REDACTED]';inside=true;}else{inside=false;text+=s[i];}}offset+=s.length;return {...this.bounded(text),redacted,redactionWithheld};});
  }
  private members(p: ResultProjection,t: ResultTarget) {
    const ids=new Set([t.runId]);
    for(let pass=0;pass<p.nodes.length;pass++) {let added=false;for(const n of p.nodes) if(n.parentId&&ids.has(n.parentId)&&n.correlation!=='unknown'&&!ids.has(n.id)){ids.add(n.id);added=true;}if(!added)break;}
    return ids;
  }
  private sign(s: string) { return createHmac('sha256',this.key).update(s).digest('hex'); }
  private cursor(t: ResultTarget,after: number,purpose='history',version?:string) {const s=Buffer.from(JSON.stringify({binding:binding(t),after,purpose,version})).toString('base64url');return `${s}.${this.sign(s)}`;}
  private after(t: ResultTarget,cursor?: string,purpose='history',version?:string) {
    if(cursor===undefined)return 0;if(typeof cursor!=='string'||cursor.length>4096)deny('cursor_invalid');
    const [s,mac,extra]=cursor.split('.');if(extra||!mac||!/^[a-f0-9]{64}$/.test(mac)||!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(this.sign(s),'hex')))deny('cursor_invalid');
    let value;try{value=JSON.parse(Buffer.from(s,'base64url').toString());}catch{deny('cursor_invalid');}
    if(value.binding!==binding(t)||value.purpose!==purpose||value.version!==version)deny('cursor_stale');return integer(value.after,Number.MAX_SAFE_INTEGER);
  }
  history(t: ResultTarget, args: {cursor?: string; limit?: number}={}) {
    return this.admitted(t,'history',p=>{
      const limit=integer(args.limit??50,100);if(!limit)deny('invalid_arguments');const after=this.after(t,args.cursor);
      if(!Number.isSafeInteger(p.seq)||p.seq<after)deny('cursor_stale');
      let gap=false,previous=p.events[0]?.seq ?? p.seq+1;
      for(const e of p.events){if(e.seq!==previous||e.generation!==t.generation)gap=true;previous=e.seq+1;}
      const earliest=p.events[0]?.seq ?? p.seq+1;
      if(after<earliest-1||previous-1!==p.seq)gap=true;
      const members=this.members(p,t);
      const scoped=p.events.filter(e=>e.workspaceId===t.workspaceId&&e.sessionId===t.sessionId&&e.generation===t.generation&&
        (['ExecutionNodeUpdated','DecisionRequired','DecisionResolved'].includes(e.type)?members.has(e.entityId):e.runId===t.runId||!!e.parentId&&members.has(e.parentId)));
      const texts=this.historyTexts(scoped),selected=scoped.map((e,i)=>({e,text:texts[i]})).filter(({e})=>e.seq>after);
      const page=selected.slice(0,limit);let clipped=false,missing=false;
      const items=page.map(({e,text:output})=>{
        // Whitelist output only: no arguments, thinking, attachment payload or path extraction.
        const tool=e.payload.chatTool as {output?: unknown;outputTruncated?: unknown}|undefined;
        const bodyUnavailable=['ToolProgress','ToolCompleted','ToolFailed'].includes(e.type)&&typeof tool?.output!=='string';
        missing ||= bodyUnavailable;
        const truncated=output.truncated||tool?.outputTruncated===true;clipped ||= truncated;
        const candidateRole=p.messageRoles?.[e.entityId]??e.payload.role;
        const role=['user','assistant'].includes(String(candidateRole))?candidateRole:'unknown';
        return {sequence:e.seq,type:e.type,role,status:statusValue(e.status??'unknown'),toolName:typeof e.payload.toolName==='string'?this.bounded(e.payload.toolName,200).text:null,text:output.text,truncated,bodyUnavailable,redacted:output.redacted,redactionWithheld:output.redactionWithheld,...trusted};
      });
      const withheld=page.find(item=>item.text.redactionWithheld);
      const more=selected.length>page.length;const next=withheld?withheld.e.seq-1:more?page.at(-1)!.e.seq:p.seq;
      return {...trusted,items,nextCursor:this.cursor(t,next),sequence:next,highWaterSequence:p.seq,paging:more,gap,
        truncation:clipped||p.truncated,storage:p.historyState,redactionPending:!!withheld,source:p.live?'live':'cached',
        readable:p.historyState==='available'&&!gap&&!clipped&&!p.truncated&&!missing&&!withheld,bodyUnavailable:missing,
        completionConfirmed:false}; // Reading content never proves aggregate completion.
    });
  }
  finalAnswer(t: ResultTarget,args:{cursor?:string;limit?:number}={}) {
    return this.admitted(t,'final_answer',async(p)=>{
      const saved=await this.runtime.readOnlyFinalAnswer?.(t.workspaceId,t.sessionId,t.generation,t.runId);
      const valid=saved&&saved.binding.workspaceId===t.workspaceId&&saved.binding.sessionId===t.sessionId&&saved.binding.generation===t.generation&&saved.binding.runId===t.runId;
      const ready=valid&&p.nodes.find(n=>n.id===t.runId)?.status==='completed'&&saved.storage==='saved'&&saved.deliveryConfirmed&&saved.foregroundStatus==='completed'&&typeof saved.text==='string'&&saved.sha256===hash(saved.text);
      if(!ready)return {...trusted,storage:valid?saved.storage:'unknown',deliveryConfirmed:valid&&saved.deliveryConfirmed===true,foregroundStatus:valid?statusValue(saved.foregroundStatus):'unknown',foregroundFinalConfirmed:false,aggregateCompletionConfirmed:false,text:null,readable:false,nextCursor:null};
      const members=this.members(p,t),relatedChildrenActive=p.nodes.some(n=>n.id!==t.runId&&members.has(n.id)&&active.has(n.status));
      const text=this.redact(saved.text!),bytes=Buffer.from(text),version=hash(bytes),start=this.after(t,args.cursor,'final_answer',version),limit=integer(args.limit??4096,8192);
      if(!limit||start>bytes.length)deny('invalid_arguments');let end=Math.min(start+limit,bytes.length);while(end>start&&end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
      if(end===start&&end<bytes.length)deny('limit_too_small');
      return {...trusted,storage:'saved',deliveryConfirmed:true,foregroundStatus:'completed',foregroundFinalConfirmed:true,aggregateCompletionConfirmed:false,relatedChildrenActive,aggregateCoverage:'incomplete',snapshotLive:p.live===true,overallState:p.live&&relatedChildrenActive?'running':'unknown',readable:true,
        text:bytes.subarray(start,end).toString('utf8'),byteOffset:start,bytes:end-start,totalBytes:bytes.length,sha256:version,version,redacted:text!==saved.text,
        nextCursor:end<bytes.length?this.cursor(t,end,'final_answer',version):null,eof:end===bytes.length,source:'sdk_persisted_message_and_settled',runtimeInstance:saved.binding.runtimeInstance};
    });
  }
  aggregate(t: ResultTarget) {
    return this.admitted(t,'aggregate',p=>{
      const members=this.members(p,t),nodes=p.nodes.filter(n=>members.has(n.id)),root=nodes.find(n=>n.id===t.runId)!;
      const parents=new Map(nodes.map(n=>[n.id,n.parentId]));let cyclic=false;
      for(const n of nodes){const seen=new Set<string>();let current:string|undefined=n.id;while(current&&members.has(current)){if(seen.has(current)){cyclic=true;break;}seen.add(current);current=parents.get(current);}}
      const fresh=Number.isFinite(p.observedAt)&&p.observedAt<=this.now()&&this.now()-p.observedAt<=30000;
      const complete=p.live&&fresh&&!cyclic&&!p.truncated&&Number.isSafeInteger(p.seq)&&p.seq>=0&&['pi','subagents','orchestrator','queue','background'].every(k=>p.coverage[k as keyof typeof p.coverage]==='complete')&&
        nodes.every(n=>kinds.has(n.kind)&&sources.has(n.sourceKind))&&new Set(p.nodes.map(n=>n.id)).size===p.nodes.length&&!p.nodes.some(n=>!members.has(n.id)&&active.has(n.status)&&n.correlation==='unknown')&&!nodes.some(n=>!terminal.has(n.status)&&!active.has(n.status));
      if(this.secrets.some(s=>nodes.some(n=>n.id.includes(s)||n.parentId?.includes(s))))deny('projection_known_secret');
      const activeNodes=nodes.filter(n=>active.has(n.status));
      const allTerminal=nodes.every(n=>terminal.has(n.status));
      const state=!p.live||!fresh?'unknown':activeNodes.some(n=>['waiting','blocked'].includes(n.status))?'waiting':activeNodes.length?'running':!complete?'unknown':nodes.some(n=>['failed','interrupted'].includes(n.status))?'failed':nodes.some(n=>n.status==='cancelled')?'cancelled':'completed';
      return {...trusted,foreground:{state:statusValue(root.status),terminal:terminal.has(root.status)},aggregate:state,
        completionConfirmed:complete&&allTerminal,incomplete:!complete,coverage:Object.fromEntries(['pi','subagents','orchestrator','queue','background'].map(k=>{const v=p.coverage[k as keyof typeof p.coverage];return [k,['complete','incomplete','unknown'].includes(v)?v:'unknown'];})),source:p.live?'live':'cached',fresh,
        nodes:nodes.map(n=>({id:n.id,parentId:n.parentId??null,kind:kinds.has(n.kind)?n.kind:'unknown',source:sources.has(n.sourceKind)?n.sourceKind:'unknown',status:statusValue(n.status)})),
        unboundWorkObserved:p.nodes.some(n=>!members.has(n.id)&&active.has(n.status)),wholeOSIdleConfirmed:false};
    });
  }
  metadata(t: ResultTarget) {
    return this.admitted(t,'metadata',(p,path)=>{
      const ws=this.runtime.workspaces.get(t.workspaceId),run=p.nodes.find(n=>n.id===t.runId)!;
      if(this.secrets.some(s=>path.includes(s)))deny('metadata_known_secret');
      const pair=(provider:unknown,model:unknown)=>typeof provider==='string'&&typeof model==='string'&&provider.length>0&&model.length>0&&provider.length<=200&&model.length<=200&&this.redact(provider)===provider&&this.redact(model)===model?{provider,model}:null;
      const savedModel=pair(p.metadata.savedModel?.provider,p.metadata.savedModel?.model),runModel=pair(run.provider,run.model);
      return {...trusted,source:p.live?'live':'cached',modelSource:'observed_projection_only',workspaceId:t.workspaceId,sessionId:t.sessionId,runId:t.runId,workspaceName:this.bounded(ws.name,400).text||null,canonicalPath:path,
        sessionName:p.metadata.sessionName?this.bounded(p.metadata.sessionName,400).text:null,
        savedModel,runModel,
        unknownFields:['savedModel','runModel'].filter(k=>k==='savedModel'?!savedModel:!runModel)};
    });
  }
  private async fileBytes(root: string, rel: string, expected?: Artifact) {
    if(typeof rel!=='string'||!rel||isAbsolute(rel)||rel.includes('\\')||rel.includes(':')||rel.split('/').some(s=>!s||s==='.'||s==='..')||credential.test(rel))deny('artifact_path_denied');
    const rootInfo=await lstat(root);const file=resolve(root,rel),within=relative(root,file);
    if(within.startsWith('..'+sep)||isAbsolute(within)||pathKey(await realpath(root))!==pathKey(root)||rootInfo.isSymbolicLink())deny('artifact_path_denied');
    const check=async()=>{
      let parent=root;for(const part of rel.split('/')){parent=resolve(parent,part);const st=await lstat(parent);if(st.isSymbolicLink()||pathKey(await realpath(parent))!==pathKey(parent))deny('artifact_link_denied');}
      const s=await lstat(file);if(!s.isFile()||s.nlink!==1||s.size>8*1024*1024)deny('artifact_size_or_link_denied');return s;
    };
    const before=await check();if(expected&&(stamp(before)!==expected.stamp||rootStamp(rootInfo)!==expected.rootStamp))deny('artifact_changed');
    const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try {
      const opened=await handle.stat();if(stamp(opened)!==stamp(before))deny('artifact_changed');
      const bytes=Buffer.alloc(opened.size);let pos=0;
      while(pos<bytes.length){const r=await handle.read(bytes,pos,Math.min(65536,bytes.length-pos),pos);if(!r.bytesRead)deny('artifact_changed');pos+=r.bytesRead;}
      if(stamp(await handle.stat())!==stamp(before)||stamp(await check())!==stamp(before)||rootStamp(await lstat(root))!==rootStamp(rootInfo))deny('artifact_changed');
      const digest=hash(bytes);if(expected&&digest!==expected.sha256)deny('artifact_changed');
      if(this.secrets.some(s=>bytes.includes(Buffer.from(s))))deny('artifact_known_secret');
      return {bytes,sha256:digest,stamp:stamp(before),rootStamp:rootStamp(rootInfo)};
    }finally{await handle.close();}
  }
  /** Trusted producer declaration only; never exposed as an MCP tool or inferred
   * from model text/URLs. Registration reads only the exact declared file. */
  registerArtifact(t: ResultTarget, declaration: {relativePath:string; name:string; mime:string; kind:'generated'|'attached'}) {
    return this.admitted(t,'artifacts',async(_p,path)=>{
      if(!safeName(declaration.name)||!['generated','attached'].includes(declaration.kind)||!textTypes.has(declaration.mime)&&!binaryTypes.has(declaration.mime)||this.artifacts.size>=1024)deny('artifact_declaration_denied');
      if(credential.test(declaration.name))deny('artifact_path_denied');
      const inspected=await this.fileBytes(path,declaration.relativePath);
      const a:Artifact={id:randomUUID(),target:structuredClone(t),relativePath:declaration.relativePath,name:this.redact(declaration.name),mime:declaration.mime,kind:declaration.kind,
        size:inspected.bytes.length,sha256:inspected.sha256,version:inspected.sha256,stamp:inspected.stamp,rootStamp:inspected.rootStamp};
      this.artifacts.set(a.id,a);return this.artifactMetadata(a);
    });
  }
  private artifactMetadata(a: Artifact) {return {...trusted,artifactId:a.id,runId:a.target.runId,name:a.name,mime:a.mime,size:a.size,sha256:a.sha256,version:a.version,kind:a.kind};}
  listArtifacts(t: ResultTarget,offset=0,limit=50) {
    return this.admitted(t,'artifacts',async(_p,path)=>{
      integer(offset,1024);integer(limit,100);if(!limit)deny('invalid_arguments');
      const all=[...this.artifacts.values()].filter(a=>binding(a.target)===binding(t)),page=all.slice(offset,offset+limit);
      for(const a of page)await this.fileBytes(path,a.relativePath,a);
      return {...trusted,artifacts:page.map(a=>this.artifactMetadata(a)),nextOffset:offset+limit<all.length?offset+limit:null,discovery:'explicit_producer_declarations_only'};
    });
  }
  readArtifact(t: ResultTarget, artifactId: string, version: string, offset=0,limit=32768) {
    return this.admitted(t,'artifacts',async(_p,path)=>{
      integer(offset,8*1024*1024);integer(limit,32768);if(!limit)deny('invalid_arguments');
      const a=this.artifacts.get(artifactId);if(!a||binding(a.target)!==binding(t)||a.version!==version)deny('artifact_unavailable');
      const inspected=await this.fileBytes(path,a!.relativePath,a);if(offset>a!.size)deny('invalid_arguments');
      const chunk=inspected.bytes.subarray(offset,offset+limit);
      return {...this.artifactMetadata(a!),encoding:'base64',data:chunk.toString('base64'),offset,bytes:chunk.length,nextOffset:offset+chunk.length<a!.size?offset+chunk.length:null,
        eof:offset+chunk.length===a!.size,chunkSha256:hash(chunk),transfer:'bounded_inline_base64',textEncoding:textTypes.has(a!.mime)?'utf-8':'binary'};
    });
  }
}
