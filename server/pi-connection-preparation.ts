import {canonicalPermissionPath,PermissionFault,strictPermissionObject} from './workspace-permissions.ts';
import {pathKey} from './runtime/workspaces.ts';

type Workspace={id:string;name?:string;path:string};
type Listing={sessions:{id:string}[];unavailable?:boolean;truncated?:boolean;ambiguousSessionIds:string[]};
type Observation={observation:string;generation?:string;truncated?:boolean}|undefined;
export interface PreparationOptions {
 list():Workspace[];sessions(workspaceId:string):Promise<Listing>;
 observation(workspaceId:string,sessionId:string):Observation;
 open(workspaceId:string,sessionId:string):Promise<void>;
 create(workspaceId:string):Promise<string>;
 canonical?:(path:string)=>Promise<string>;
}
export type PreparationSession={id:string;generation?:string;state:string;preparable:boolean};
export type PreparationWorkspace={id:string;name:string;path:string;status:string;preparable:boolean;sessions:PreparationSession[]};
const identifier=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);
function fail(code:string):never{throw new PermissionFault(code)}
/** Owner-only explicit worker preparation. No credential, scope, prompt or queue-resume API. */
export class PiConnectionPreparation {
 private records=new Map<string,{actor:string;value:any}>();
 private pending:Promise<unknown>=Promise.resolve();
 constructor(private options:PreparationOptions){}
 async candidates(){
  const registered=this.options.list(),shown=registered.slice(0,1000),canonical=this.options.canonical??canonicalPermissionPath;
  const paths=await Promise.all(registered.map(w=>typeof w.path==='string'?canonical(w.path).catch(()=>null):null));
  const items=await Promise.all(shown.map(async(w,index):Promise<PreparationWorkspace>=>{
   const actual=paths[index],base={id:w.id,name:typeof w.name==='string'?w.name:w.id,path:actual??w.path,sessions:[]as PreparationSession[]};
   if(!identifier(w.id)||!actual)return{...base,status:'path_unavailable',preparable:false};
   if(registered.filter(v=>v.id===w.id).length!==1||paths.filter(v=>v&&pathKey(v)===pathKey(actual)).length!==1)return{...base,status:'duplicate_workspace',preparable:false};
   if(index>=100)return{...base,status:'listing_limit',preparable:false};
   let listing:Listing;try{listing=await this.options.sessions(w.id)}catch{return{...base,status:'sessions_unavailable',preparable:false}}
   if(listing.unavailable||listing.truncated)return{...base,status:'sessions_unavailable',preparable:false};
   if(listing.ambiguousSessionIds.length||listing.sessions.some(s=>!identifier(s.id)||listing.sessions.filter(v=>v.id===s.id).length!==1))return{...base,status:'sessions_ambiguous',preparable:false};
   const sessions=listing.sessions.slice(0,64).map(s=>{const o=this.options.observation(w.id,s.id),observed=o?.observation==='observed'&&identifier(o.generation)&&!o.truncated;
    return{id:s.id,...(observed?{generation:o!.generation}:{}),state:observed?'observed':o?.observation==='observed'?'unconfirmed':o?.observation??'unobserved',preparable:!observed&&o?.observation!=='observed'&&!['starting','closing'].includes(o?.observation??'')};});
   const status=sessions.some(s=>s.state==='observed')?'ready':sessions.length?sessions.some(s=>s.preparable)?'session_unobserved':'session_unconfirmed':'sessions_missing';
   return{...base,sessions,status,preparable:true};
  }));
  return{items,total:registered.length,truncated:registered.length>shown.length||registered.length>100};
 }
 private serial<T>(work:()=>Promise<T>){const p=this.pending.then(work);this.pending=p.catch(()=>{});return p}
 async prepare(body:any,actor:string,owner:()=>void){return this.serial(async()=>{
  owner();strictPermissionObject(body,['requestId','workspaceId','expectedPath','sessionId','confirmed']);
  if(!identifier(body.requestId)||!identifier(body.workspaceId)||typeof body.expectedPath!=='string'||!(body.sessionId===null||identifier(body.sessionId))||body.confirmed!==true)fail('explicit_preparation_required');
  if(this.records.has(body.requestId))fail('request_already_recorded');if(this.records.size>=64)fail('preparation_capacity');
  const candidate=(await this.candidates()).items.find(w=>w.id===body.workspaceId);owner();
  if(!candidate?.preparable||candidate.path!==body.expectedPath)fail('preparation_target_changed');
  const session=candidate.sessions.find(s=>s.id===body.sessionId);
  if(body.sessionId===null?candidate.sessions.length!==0:!session||!session.preparable&&session.state!=='observed')fail('preparation_target_changed');
  const value:any={requestId:body.requestId,state:'preparing',workspaceId:candidate.id,sessionId:body.sessionId,created:body.sessionId===null,workerMayBeRunning:false};
  this.records.set(body.requestId,{actor,value});let dispatched=false;
  try{
   owner();let id=body.sessionId;
   if(session?.state!=='observed'){dispatched=true;value.workerMayBeRunning=true;id=id===null?await this.options.create(candidate.id):(await this.options.open(candidate.id,id),id);}
   value.sessionId=id;owner();
   const fresh=(await this.candidates()).items.find(w=>w.id===candidate.id),observed=fresh?.sessions.find(s=>s.id===id);owner();
   if(fresh?.path!==candidate.path||observed?.state!=='observed'||!observed.generation)fail('preparation_unconfirmed');
   value.state='prepared';value.generation=observed.generation;return structuredClone(value);
  }catch{value.state=dispatched?'uncertain':'failed';throw new PermissionFault('preparation_failed_reconcile')}
 })}
 async result(requestId:string,actor:string,owner:()=>void){owner();if(!identifier(requestId))fail('invalid_request_id');const r=this.records.get(requestId);return structuredClone(r?.actor===actor?r.value:{requestId,state:'unknown'})}
}
