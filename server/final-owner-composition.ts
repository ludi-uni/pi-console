import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {WorkspaceStore} from './runtime/workspaces.ts';
import {RuntimeManager} from './runtime/manager.ts';
import {WorkspacePermissions,PermissionFault,strictPermissionObject,canonicalPermissionPath} from './workspace-permissions.ts';
import {pathKey} from './runtime/workspaces.ts';
import {permissionOwnerRequest} from './dots-permissions-api.ts';
import {readJsonBody} from './body.ts';
import {ResultsReadService} from './results-read.ts';
import {createFinalAnswerMcp} from './final-answer-mcp.ts';
import type {ResultTarget} from '../shared/results-read.ts';
import type {PermissionSnapshot} from '../shared/workspace-permissions.ts';
import type {FinalOwnerView,FinalOwnerReview} from '../shared/final-owner.ts';
export interface FinalOwnerConfig {enabled?:boolean;accessMode?:'local'|'access'|'unknown';authentication?:{mode:'shared_secret';key:string};legacyCredentialKeys?:readonly string[];now?:()=>number;ownerRequest?:(req:IncomingMessage)=>boolean}
const validKey=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const deny=(code:string):never=>{throw new PermissionFault(code);};
const tuple=(t:ResultTarget)=>JSON.stringify([t.instance,t.revision,t.workspaceId,t.sessionId,t.generation,t.runId]);
/** Shared normal-server/fixture composition. No config/key discovery, no OS identity claim.
 * Runtime producer is opt-in only when the same final-only authenticated local configuration is valid. */
export function createFinalOwnerComposition(workspaces:WorkspaceStore,permissions:WorkspacePermissions,paths:{sessionsRoot?:string;reportRecoveryDir?:string;queueDir?:string;journalDir?:string},config:FinalOwnerConfig={}){
  const requested=config.enabled===true,accessMode=config.accessMode??'unknown',key=config.authentication?.key;
  const reason=!requested?'final_only_disabled':!(accessMode==='local'||accessMode==='access'&&config.ownerRequest)?'access_owner_blocked':!config.authentication||config.authentication.mode!=='shared_secret'||!validKey(key)?'dedicated_read_authentication_required':!config.legacyCredentialKeys||config.legacyCredentialKeys.length>31||config.legacyCredentialKeys.some(k=>!validKey(k))?'credential_separation_unknown':config.legacyCredentialKeys.includes(key)?'credential_not_dedicated':!paths.journalDir?'journal_unconfigured':null;
  const enabled=reason===null,epoch=randomUUID(),now=config.now??Date.now;
  const knownSecrets=enabled?[key!,...config.legacyCredentialKeys!]:[];
  const safeTarget=(t:ResultTarget)=>!Object.values(t).some(v=>typeof v==='string'&&knownSecrets.some(s=>v.includes(s)));
  const runtime=new RuntimeManager(workspaces,paths.sessionsRoot,paths.reportRecoveryDir,paths.queueDir,enabled?paths.journalDir:undefined);
  let disposed=false;const active=()=>enabled&&!disposed;
  const service=new ResultsReadService(permissions,runtime,{enabled,knownSecrets,now,finalCredential:{epoch,active}});
  const adapter=createFinalAnswerMcp(service,enabled?{enabled:true,authentication:{mode:'shared_secret',key:key!},catalogTarget:async()=>{const s=await permissions.snapshot(),g=s.finalPublication;return g&&activePublication(s)&&await eligible(g.target,s)?g.target:null;}}:{});
  const reviews=new Map<string,FinalOwnerReview&{deadline:number;epoch:string}>();
  const saving=new Set<string>();
  const activePublication=(s:PermissionSnapshot)=>{const g=s.finalPublication;return !!(active()&&g&&g.credentialEpoch===epoch&&g.target.instance===permissions.instance&&g.target.revision===s.revision&&g.expiresAt>now()&&s.workspaces.some(w=>w.id===g.target.workspaceId&&w.sessions.some(x=>x.id===g.target.sessionId&&x.generation===g.target.generation)));};
  async function eligible(t:ResultTarget,s:PermissionSnapshot){
    if(t.instance!==permissions.instance||t.revision!==s.revision)return false;
    const w=s.workspaces.find(w=>w.id===t.workspaceId&&w.sessions.some(x=>x.id===t.sessionId&&x.generation===t.generation));if(!w)return false;
    const registered=runtime.workspaces.list();if(registered.filter(x=>x.id===w.id).length!==1||registered.filter(x=>pathKey(x.path)===pathKey(w.path)).length!==1)return false;
    if(pathKey(runtime.workspaces.get(w.id).path)!==pathKey(w.path))return false;await canonicalPermissionPath(w.path);
    const p=runtime.readOnlyResultProjection(w.id,t.sessionId);if(!p||!p.live||p.truncated||p.generation!==t.generation||!Number.isFinite(p.observedAt)||now()-p.observedAt>30000||p.observedAt>now()+1000||p.nodes.filter(n=>n.id===t.runId).length!==1)return false;
    if(!p.nodes.some(n=>n.id===t.runId&&n.kind==='run'&&n.sourceKind==='pi'&&n.status==='completed'))return false;
    if(!safeTarget(t))return false;
    const saved=await runtime.readOnlyFinalAnswer(w.id,t.sessionId,t.generation,t.runId);
    if(!saved||saved.storage!=='saved'||!saved.deliveryConfirmed||saved.foregroundStatus!=='completed'||saved.binding.workspaceId!==w.id||saved.binding.sessionId!==t.sessionId||saved.binding.generation!==t.generation||saved.binding.runId!==t.runId)return false;
    const current=runtime.readOnlyResultProjection(w.id,t.sessionId);return !!(current?.live&&current.generation===t.generation&&!current.truncated&&current.nodes.filter(n=>n.id===t.runId).length===1&&current.nodes.some(n=>n.id===t.runId&&n.status==='completed'));
  }
  async function view():Promise<FinalOwnerView>{
    if(!active())return {available:false,reason:disposed?'credential_inactive':reason,choices:[],publication:null};
    const s=await permissions.snapshot(),choices:FinalOwnerView['choices']=[];
    for(const w of s.workspaces)for(const session of w.sessions){const p=runtime.readOnlyResultProjection(w.id,session.id);if(!p||p.nodes.length>128)continue;
      for(const n of p.nodes.filter(n=>n.kind==='run'&&n.sourceKind==='pi'&&n.status==='completed')){if(choices.length>=64)return deny('inventory_truncated');const t={instance:permissions.instance,revision:s.revision,workspaceId:w.id,sessionId:session.id,generation:session.generation,runId:n.id};if(await eligible(t,s))choices.push({target:t});}}
    const g=s.finalPublication;
    return {available:true,reason:null,instance:permissions.instance,revision:s.revision,choices,publication:g&&safeTarget(g.target)&&s.workspaces.some(w=>w.id===g.target.workspaceId&&w.sessions.some(x=>x.id===g.target.sessionId&&x.generation===g.target.generation))?{target:g.target,expiresAt:g.expiresAt,active:activePublication(s)&&await eligible(g.target,s)}:null};
  }
  async function owner(req:IncomingMessage,res:ServerResponse){
    if(!req.url?.startsWith('/api/workspace-permissions/final/'))return false;
    const send=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
    try{
      if(accessMode!=='local'&&!(accessMode==='access'&&config.ownerRequest)){send(403,{error:'access_owner_blocked'});return true;}
      if(!(config.ownerRequest?config.ownerRequest(req):permissionOwnerRequest(req))){send(403,{error:'local_owner_required'});return true;}
      const body=await readJsonBody(req,16384),route=req.url.slice('/api/workspace-permissions/final/'.length);
      if(route==='session'){strictPermissionObject(body,[]);send(200,await view());return true;}
      if(!active())return deny('final_only_unavailable');
      if(route==='review'){
        strictPermissionObject(body,['instance','revision','target','expiresAt']);const s=await permissions.snapshot();if(body.instance!==permissions.instance||body.revision!==s.revision)return deny('permission_stale');
        if(body.target!==null){strictPermissionObject(body.target,['instance','revision','workspaceId','sessionId','generation','runId']);if(!await eligible(body.target as ResultTarget,s))return deny('target_unavailable');if(!Number.isSafeInteger(body.expiresAt)||body.expiresAt<=now()||body.expiresAt>now()+24*60*60*1000)return deny('expiry_invalid');}
        else if(body.expiresAt!==null)return deny('invalid_arguments');
        for(const [id,r]of reviews)if(r.deadline<=now())reviews.delete(id);if(reviews.size>=16)return deny('review_capacity');
        const current=await view();if(current.revision!==s.revision)return deny('permission_stale');
        const r={reviewId:randomUUID(),requestId:randomUUID(),target:body.target,expiresAt:body.expiresAt,previous:current.publication,instance:permissions.instance,revision:s.revision,epoch,deadline:now()+60000};reviews.set(r.reviewId,r);
        const {epoch:_,deadline:__,...publicReview}=r;send(200,publicReview);return true;
      }
      if(route==='cancel'){strictPermissionObject(body,['reviewId','requestId']);const r=reviews.get(body.reviewId);if(r&&r.requestId===body.requestId)reviews.delete(body.reviewId);send(200,{cancelled:!!r});return true;}
      if(route==='save'){
        strictPermissionObject(body,['reviewId','requestId','confirmed']);const r=reviews.get(body.reviewId);
        if(!r||r.requestId!==body.requestId||body.confirmed!==true||r.deadline<=now()||r.epoch!==epoch)return deny('owner_confirmation_required');reviews.delete(r.reviewId);
        saving.add(r.requestId);try{await permissions.saveFinal(r.instance,r.revision,r.requestId,epoch,r.target?{target:r.target,feature:'final_answer',expiresAt:r.expiresAt!}:null,async s=>{
          if(!active()||r.deadline<=now())return deny('credential_inactive');if(r.target&&(!await eligible(r.target,s)||r.expiresAt!<=now()))return deny('target_unavailable');
          // Synchronous release check after eligibility I/O; no worker invocation.
          if(!active()||r.deadline<=now()||r.target&&(r.expiresAt!<=now()||runtime.readOnlyResultProjection(r.target.workspaceId,r.target.sessionId)?.generation!==r.target.generation))return deny('review_stale');
        });}finally{saving.delete(r.requestId);}
        send(200,await view());return true;
      }
      if(route==='result'){
        strictPermissionObject(body,['requestId']);if(!uuid(body.requestId))return deny('invalid_arguments');const s=await permissions.snapshot(),r=s.finalRequests?.find(r=>r.requestId===body.requestId);
        send(200,{state:!r?(saving.has(body.requestId)?'pending':'unknown'):r.instance===permissions.instance&&r.credentialEpoch===epoch?'committed':'committed_inactive',revision:r?.revision??null,current:await view()});return true;
      }
      send(404,{error:'not_found'});
    }catch(e){send(409,{error:e instanceof PermissionFault?e.code:'owner_unavailable'});}return true;
  }
  return {runtime,claimsDots:requested,owner,view,service,
    async handle(req:IncomingMessage,res:ServerResponse){if(req.url?.startsWith('/api/workspace-permissions/final/'))return owner(req,res);if(requested)return adapter.handle(req,res);return false;},
    dispose(){disposed=true;reviews.clear();adapter.dispose();},
  };
}
