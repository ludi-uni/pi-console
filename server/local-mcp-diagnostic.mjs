import {AsyncLocalStorage} from 'node:async_hooks';

export const diagnosticStages=Object.freeze(['REQUEST_VALIDATE','TARGET_SELECT','STORE_RESOLVE','STORE_READ','IDENTITY_CHECK','UNPROTECT','BROKER_VERIFY','RESUME','RENEW','PROTECT','STORE_COMMIT','SCOPE_RPC','UNKNOWN']);
const allowed=new Set(diagnosticStages),context=new AsyncLocalStorage();
// These tags contain no caught-error properties. Each failure owns a fresh Error.
export const serverRenewalReasons=Object.freeze(['RECOVERY_WINDOW','RECEIPT_CHECK','PARENT_VALIDATE','RUNTIME_CONSISTENCY','PERSISTENCE','ACTIVATION','REPLAY_REJECTED','CAPACITY']);
export const renewalReasons=Object.freeze(['TRANSPORT_TIMEOUT','IO_FAILURE','HTTP_REJECTED','INVALID_REPLY','UNCLASSIFIED',...serverRenewalReasons]);
const renewalAllowed=new Set(renewalReasons),renewalTags=new WeakMap();
export function renewalReason(error){return object(error)?renewalTags.get(error)??null:null}
export function renewalError(reason){const error=Error('local_renewal_unavailable');renewalTags.set(error,renewalAllowed.has(reason)?reason:'UNCLASSIFIED');return error}
export function carryRenewal(error,replacement){const reason=renewalReason(error);if(reason&&object(replacement))renewalTags.set(replacement,reason);return replacement}
export function atRenewalSync(reason,work){try{return work()}catch(error){throw renewalError(renewalReason(error)??reason)}}
export async function atRenewal(reason,work){try{return await work()}catch(error){throw renewalError(renewalReason(error)??reason)}}
const object=e=>e!==null&&(typeof e==='object'||typeof e==='function');
/** Each RPC/startup owns its tags, including when the same Error is reused. */
export const diagnosticContext=work=>context.run(new WeakMap(),work);
export function diagnosticData(error){
 const tags=context.getStore(),stage=tags&&object(error)?tags.get(error):undefined;
 const safeStage=allowed.has(stage)?stage:'UNKNOWN';
 return{diagnosticVersion:1,stage:safeStage,...(safeStage==='RENEW'?{renewalReason:renewalReason(error)??'UNCLASSIFIED'}:{})};
}
export function stageError(stage,error){
 const tags=context.getStore();if(!tags)return error;
 const safe=object(error)?error:Error('local_mcp_boundary_failed');
 const previous=tags.get(safe);
 if(!allowed.has(previous)||previous==='UNKNOWN')tags.set(safe,allowed.has(stage)?stage:'UNKNOWN');
 return safe;
}
/** Preserve only an internal fixed tag when existing code sanitizes an error. */
export function carryDiagnostic(error,replacement){
 const {stage}=diagnosticData(error);return stage==='UNKNOWN'?replacement:stageError(stage,replacement);
}
export function atStageSync(stage,work){try{return work()}catch(error){throw stageError(stage,error)}}
export async function atStage(stage,work){try{return await work()}catch(error){throw stageError(stage,error)}}
function methods(provider,stages,plain=[]){
 const wrapped=Object.create(provider);
 for(const[name,stage]of Object.entries(stages))if(typeof provider[name]==='function')wrapped[name]=(...args)=>atStage(stage,()=>Reflect.apply(provider[name],provider,args));
 for(const name of plain)if(typeof provider[name]==='function')wrapped[name]=(...args)=>Reflect.apply(provider[name],provider,args);
 return wrapped;
}
export const diagnosticCodec=codec=>methods(codec,{currentSid:'IDENTITY_CHECK',unprotect:'UNPROTECT',protect:'PROTECT'});
export const diagnosticBackend=backend=>methods(backend,{peekOwner:'STORE_READ',read:'STORE_READ',begin:'STORE_COMMIT',compareAndSwap:'STORE_COMMIT'},['bindOwner','abort','close']);
export const startupDiagnosticLine=error=>'local_resume_diagnostic_v1 stage='+diagnosticData(error).stage+'\n';
