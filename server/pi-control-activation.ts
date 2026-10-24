import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import type {PermissionInventory,PermissionSnapshot,WorkspacePermission} from '../shared/workspace-permissions.ts';
import type {LocalControlTarget} from '../shared/trusted-local-mcp.ts';
import {PermissionFault,strictPermissionObject} from './workspace-permissions.ts';
import {CONFIRMATION_WAIT_MS,MAX_CONNECTION_MS} from '../package/connection-expiry.mjs';
import type {PiConnectionPreparation} from './pi-connection-preparation.ts';
type Credentials={read:string;control:string;final:string;expiresAt:number};
export interface PiControlService {
 port:number;
 approve(target:LocalControlTarget,expiresAt:number,requestId:string,owner:()=>void):Promise<void>;
 live(target:LocalControlTarget):Promise<boolean>;
 call(name:string,args:any):Promise<any>;
 revoke(requestId:string,owner:()=>void):Promise<void>;
 close():Promise<void>;
 publish?():void;
 currentExpiry?():number;
}
export interface PiControlOptions {
 instance:string;now?:()=>number;secret?:()=>string;reserved?:readonly string[];
 snapshot():Promise<PermissionSnapshot>;inventory():Promise<PermissionInventory[]>;
 replace(revision:number,workspaces:WorkspacePermission[],check:()=>void):Promise<PermissionSnapshot>;
 start(credentials:Credentials):Promise<PiControlService>;
 preparation?:PiConnectionPreparation;
}
type Connection={id:string;name:string;proof:Buffer;pendingUntil:number;state:string;token?:Buffer;handoff?:string;target?:LocalControlTarget;expiresAt?:number;service?:PiControlService;timer?:ReturnType<typeof setTimeout>;confirmedAt?:number};
type Review={reviewId:string;requestId:string;connectionId:string;actor:string;target:LocalControlTarget;path:string;expiresAt:number;reviewUntil:number;beforeRevision:number;workspaces:WorkspacePermission[];baseChanged:boolean;previousWorkspace:WorkspacePermission|null;finalPublicationWillBeRevoked:boolean};
const identifier=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const secret=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const digest=(v:string)=>createHash('sha256').update(v).digest();
const same=(a:any,b:any)=>a&&b&&['instance','revision','workspaceId','sessionId','generation'].every(k=>a[k]===b[k]);
function fail(code:string):never{throw new PermissionFault(code)}
/** Explicit owner transaction, built on WorkspacePermissions and exact LocalMcpGrants.
 * Private proof/token handoff is never part of owner views or MCP tool results. */
export class PiControlActivation {
 private connections=new Map<string,Connection>();private reviews=new Map<string,Review>();private outcomes=new Map<string,any>();
 private active?:Connection;private pending:Promise<unknown>=Promise.resolve();private closed=false;
 private now:()=>number;private makeSecret:()=>string;
 constructor(private options:PiControlOptions){this.now=options.now??Date.now;this.makeSecret=options.secret??(()=>randomBytes(32).toString('hex'))}
 private serial<T>(work:()=>Promise<T>):Promise<T>{const p=this.pending.then(()=>{if(this.closed)fail('pi_control_unavailable');return work()});this.pending=p.catch(()=>{});return p}
 private issue(){const key=this.makeSecret();if(!secret(key)||(this.options.reserved??[]).includes(key)||[...this.connections.values()].some(c=>timingSafeEqual(c.proof,digest(key))||c.token&&timingSafeEqual(c.token,digest(key))))fail('control_entropy_unavailable');return key}
 private wipe(c:Connection){c.token?.fill(0);c.proof.fill(0);c.handoff=undefined;c.confirmedAt=undefined;clearTimeout(c.timer)}
 private async end(c:Connection,state:string){this.wipe(c);c.state=state;if(this.active===c)this.active=undefined;await c.service?.close();c.service=undefined}
 private async live(c:Connection){let valid=false;if(!this.closed&&c===this.active&&c.state==='connected'&&c.target&&c.service&&c.expiresAt!>this.now()){try{valid=await c.service.live(c.target);const effective=c.service.currentExpiry?.();if(effective!==undefined){if(!Number.isSafeInteger(effective)||effective<=this.now())valid=false;else if(effective<c.expiresAt!){c.expiresAt=effective;clearTimeout(c.timer);c.timer=setTimeout(()=>{void this.serial(()=>this.end(c,'expired')).catch(()=>{})},Math.max(1,effective-this.now()));c.timer.unref()}}}catch(e){if(e instanceof PermissionFault&&['permission_busy','local_grant_busy'].includes(e.code))fail('pi_control_busy_retry_read')}}if(!valid){if(c===this.active)await this.end(c,'expired');fail('pi_control_unavailable')}}
 request(body:any){strictPermissionObject(body,['name']);if(this.closed||typeof body.name!=='string'||!/^[A-Za-z0-9 ._-]{1,60}$/.test(body.name)||this.connections.size>=16)fail('pi_control_request_rejected');const id=randomUUID(),proof=this.issue();this.connections.set(id,{id,name:body.name,proof:digest(proof),pendingUntil:this.now()+CONFIRMATION_WAIT_MS,state:'pending'});return{connectionId:id,proof,expiresAt:this.now()+CONFIRMATION_WAIT_MS}}
 async claim(body:any){strictPermissionObject(body,['connectionId','proof']);const c=this.connections.get(body.connectionId);if(!c||!secret(body.proof)||!timingSafeEqual(c.proof,digest(body.proof)))fail('pi_control_unavailable');if(c.state==='pending'&&c.pendingUntil>this.now())return{state:'pending'};await this.live(c);return{state:'connected',connectionId:c.id,token:c.handoff,expiresAt:c.expiresAt,target:c.target}}
 async view(){if(this.active){try{await this.live(this.active)}catch(e){if(e instanceof PermissionFault&&e.code==='pi_control_busy_retry_read')throw e}}
  return{enabled:!!this.active,port:this.active?.service?.port??null,instance:this.options.instance,snapshot:await this.options.snapshot(),inventory:await this.options.inventory(),candidates:this.options.preparation?await this.options.preparation.candidates():undefined,preparationAvailable:!!this.options.preparation,connections:[...this.connections.values()].map(c=>({connectionId:c.id,name:c.name,state:c.state==='pending'&&c.pendingUntil<=this.now()?'expired':c.state,expiresAt:c.expiresAt??c.pendingUntil,target:c.target??null,confirmedAt:c.confirmedAt??null})),operations:['submit_instruction','start_execution','cancel_instruction','stop_execution','get_request'],disclosure:'One explicitly selected Pi session. No final/history text, orchestration or arbitrary tool commands.'}}
 prepare(body:any,actor:string,owner:()=>void){return this.serial(async()=>{owner();if(this.active)fail('pi_control_already_active');if(!this.options.preparation)fail('preparation_unavailable');return this.options.preparation.prepare(body,actor,owner)})}
 async preparationResult(body:any,actor:string,owner:()=>void){strictPermissionObject(body,['requestId']);if(!this.options.preparation)fail('preparation_unavailable');return this.options.preparation.result(body.requestId,actor,owner)}
 async review(body:any,actor:string,owner:()=>void){return this.serial(async()=>{owner();strictPermissionObject(body,['connectionId','workspaceId','sessionId','generation','durationMinutes']);if(this.active)fail('pi_control_already_active');const c=this.connections.get(body.connectionId),n=body.durationMinutes;if(!c||c.state!=='pending'||c.pendingUntil<=this.now()||!Number.isSafeInteger(n)||n<1||n*60000>MAX_CONNECTION_MS)fail('invalid_pi_control_review');
  const snapshot=await this.options.snapshot(),inventory=await this.options.inventory();owner();const w=inventory.find(w=>w.id===body.workspaceId&&w.eligible),s=w?.sessions.find(s=>s.id===body.sessionId&&s.generation===body.generation);if(!w||!s)fail('pi_target_unavailable');
  const selected:WorkspacePermission={id:w.id,path:w.path,scope:'control',sessions:[{id:s.id,generation:s.generation}]},previous=snapshot.workspaces.find(x=>x.id===w.id)??null;
  const baseChanged=JSON.stringify(previous)!==JSON.stringify(selected);const workspaces=snapshot.workspaces.filter(x=>x.id!==w.id);workspaces.push(selected);
  for(const [id,r] of this.reviews)if(r.connectionId===c.id){this.reviews.delete(id);this.outcomes.set(r.requestId,{state:'cancelled',requestId:r.requestId})}
  if(this.outcomes.size+this.reviews.size>=64)fail('pi_review_capacity');
  const r:Review={reviewId:randomUUID(),requestId:randomUUID(),connectionId:c.id,actor,target:{instance:this.options.instance,revision:snapshot.revision+(baseChanged?1:0),workspaceId:w.id,sessionId:s.id,generation:s.generation},path:w.path,expiresAt:this.now()+n*60000,reviewUntil:Math.min(c.pendingUntil,this.now()+CONFIRMATION_WAIT_MS),beforeRevision:snapshot.revision,workspaces,baseChanged,previousWorkspace:previous,finalPublicationWillBeRevoked:baseChanged&&!!snapshot.finalPublication};this.reviews.set(r.reviewId,r);return this.reviewView(r)})}
 private reviewView(r:Review){const {actor,workspaces,...visible}=r;return structuredClone(visible)}
 async approve(body:any,actor:string,owner:()=>void){return this.serial(async()=>{owner();strictPermissionObject(body,['reviewId','requestId','confirmed']);if(this.outcomes.has(body.requestId))fail('request_already_recorded');const r=this.reviews.get(body.reviewId),c=r&&this.connections.get(r.connectionId);if(!r||!c||r.actor!==actor||body.requestId!==r.requestId||body.confirmed!==true||r.reviewUntil<=this.now()||r.expiresAt<=this.now()||c.state!=='pending'||this.active)fail('pi_review_unavailable');
  const check=async()=>{owner();if(this.closed||r.reviewUntil<=this.now()||r.expiresAt<=this.now())fail('pi_review_expired');const w=(await this.options.inventory()).find(w=>w.id===r.target.workspaceId&&w.eligible);if(!w||w.path!==r.path||!w.sessions.some(s=>s.id===r.target.sessionId&&s.generation===r.target.generation))fail('pi_target_unavailable')};
  await check();const initial=await this.options.snapshot();if(initial.revision!==r.beforeRevision)fail('pi_scope_stale');
  const keys=[this.issue(),this.issue(),this.issue(),this.issue()];if(new Set(keys).size!==4||keys.some(k=>timingSafeEqual(c.proof,digest(k)))||[...this.connections.values()].some(v=>keys.some(k=>v.token&&timingSafeEqual(v.token,digest(k)))))fail('control_entropy_unavailable');
  const outcome:any={state:'committing',requestId:r.requestId,connectionId:c.id,baseSaved:false,listenerStarted:false,grantSaved:false};this.outcomes.set(r.requestId,outcome);this.reviews.delete(r.reviewId);let service:PiControlService|undefined;
  try{await check();service=await this.options.start({read:keys[0],control:keys[1],final:keys[2],expiresAt:r.expiresAt});outcome.listenerStarted=true;await check();
   if(r.baseChanged){await this.options.replace(r.beforeRevision,r.workspaces,owner);outcome.baseSaved=true}
   const updated=await this.options.snapshot();if(updated.revision!==r.target.revision)fail('pi_scope_stale');await check();await service.approve(r.target,r.expiresAt,r.requestId,owner);outcome.grantSaved=true;
   await check();if(!await service.live(r.target))fail('pi_grant_unavailable');owner();service.publish?.();c.service=service;c.target=r.target;c.expiresAt=r.expiresAt;c.token=digest(keys[3]);c.handoff=keys[3];c.state='connected';this.active=c;outcome.state='committed';
   c.timer=setTimeout(()=>{void this.serial(()=>this.end(c,'expired')).catch(()=>{})},Math.max(1,r.expiresAt-this.now()));c.timer.unref();return structuredClone(outcome);
  }catch{c.state='failed';this.wipe(c);await service?.close().catch(()=>{});outcome.state=outcome.baseSaved?'partial':'failed';outcome.listenerClosed=true;throw new PermissionFault('pi_activation_failed_reconcile')}
 })}
 async result(requestId:string){if(!identifier(requestId))fail('invalid_request_id');return structuredClone(this.outcomes.get(requestId)??{state:'unknown',requestId})}
 cancel(body:any,actor:string,owner:()=>void){return this.serial(async()=>{owner();strictPermissionObject(body,['reviewId']);const r=this.reviews.get(body.reviewId);if(!r||r.actor!==actor)fail('pi_review_unavailable');this.reviews.delete(r.reviewId);this.outcomes.set(r.requestId,{state:'cancelled',requestId:r.requestId});return{state:'cancelled'}})}
 revoke(body:any,_actor:string,owner:()=>void){return this.serial(async()=>{owner();strictPermissionObject(body,['requestId']);if(!identifier(body.requestId)||this.outcomes.has(body.requestId))fail('request_already_recorded');const c=this.active,result={state:'revoked',requestId:body.requestId,receiptSaved:true};this.outcomes.set(body.requestId,{state:'revoking',requestId:body.requestId});if(c){this.wipe(c);c.state='revoked';this.active=undefined;try{await c.service?.revoke(body.requestId,owner)}catch{result.receiptSaved=false}finally{await c.service?.close();c.service=undefined}}this.outcomes.set(body.requestId,result);return result})}
 async rpc(token:unknown,name:string,args:any){if(!secret(token))fail('pi_control_unavailable');const d=digest(token),c=[...this.connections.values()].find(c=>c.token&&timingSafeEqual(c.token,d));d.fill(0);if(!c)fail('pi_control_unavailable');await this.live(c);const serialized=JSON.stringify(args);if(!serialized||serialized.includes(token)||[...serialized.matchAll(/(?=([a-f0-9]{64}))/g)].some(m=>timingSafeEqual(c.proof,digest(m[1]))))fail('pi_credential_in_arguments');const t=c.target!,service=c.service!;
  const target=(keys:string[])=>{strictPermissionObject(args,keys);if(args.serverId!==t.instance||args.workspaceId!==t.workspaceId||Object.hasOwn(args,'sessionId')&&args.sessionId!==t.sessionId||Object.hasOwn(args,'generation')&&args.generation!==t.generation)fail('pi_target_mismatch')};
  let result:any;if(name==='get_control_status'){strictPermissionObject(args,[]);result={serverId:t.instance,revision:t.revision,controlAvailable:true,workspaces:[{workspaceId:t.workspaceId,scope:'control',sessions:[{sessionId:t.sessionId,generation:t.generation}]}],expiresAt:c.expiresAt,historyFinalGranted:false}}
  else if(name==='list_control_sessions'){target(['serverId','workspaceId']);const state=await service.call('control_state',t);if(state.generation!==t.generation)fail('pi_target_unavailable');result={serverId:t.instance,workspaceId:t.workspaceId,sessions:[{sessionId:t.sessionId,generation:state.generation,busy:state.busy,activeRunId:state.activeRunId,approvalRequired:state.approvalRequired,backgroundActive:state.backgroundActive,queuePending:state.queuePending,kitOwnsSession:state.kitOwnsSession}]}}
  else{const base=['serverId','workspaceId','sessionId','generation'];let a:any={...t};
   if(name==='submit_instruction'){target([...base,'requestId','message','mode']);if(args.mode!=='pi')fail('pi_mode_only');a={...a,requestId:args.requestId,message:args.message}}
   else if(name==='start_execution'){target([...base,'instructionId']);a={...a,requestId:args.instructionId}}
   else if(name==='stop_execution'){target([...base,'requestId','runId']);a={...a,requestId:args.requestId,runId:args.runId}}
   else if(['get_request','cancel_instruction'].includes(name)){target([...base,'requestId']);a={...a,requestId:args.requestId}}
   else fail('pi_tool_not_authorized');result=await service.call(name,a);if(name==='submit_instruction')result={...result,instructionId:args.requestId};
  }
  await this.live(c);if(JSON.stringify(result).includes(token))fail('pi_response_unavailable');if(['get_control_status','list_control_sessions'].includes(name))c.confirmedAt=this.now();return result;
 }
 async dispose(){this.closed=true;await this.pending.catch(()=>{});for(const c of this.connections.values()){this.wipe(c);await c.service?.close();c.service=undefined;c.state='revoked'}this.active=undefined;this.reviews.clear()}
 async stopAll(){return this.serial(async()=>{for(const c of this.connections.values())await this.end(c,'revoked');for(const r of this.reviews.values())this.outcomes.set(r.requestId,{state:'cancelled',requestId:r.requestId});this.reviews.clear()})}
}
