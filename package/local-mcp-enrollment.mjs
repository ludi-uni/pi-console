import{randomBytes}from'node:crypto';
import{ProtectedJsonStore,validTime}from'../server/local-mcp-state.mjs';
import{exact,identifier,key,fail}from'../server/local-mcp-identity.mjs';
import{LOCAL_RESUME_REQUEST_WAIT_MS}from'./local-resume-policy.mjs';
import{CONFIRMATION_WAIT_MS}from'./connection-expiry.mjs';
const purpose='PiConsole.LocalMcp.Enrollment.v1';
export const unknownLocalEnrollmentInspection=()=>({state:'unknown',requestExpiresAt:null,initialClaimMaterial:'unknown'});
export function validEnrollmentBroker(b){if(!exact(b,['origin','pid','startedAt','generation']))return false;try{const u=new URL(b.origin);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!!u.port&&u.origin===b.origin&&Number.isSafeInteger(b.pid)&&b.pid>0&&typeof b.startedAt==='string'&&b.startedAt.length<=100&&/^[0-9a-f]{32}$/.test(b.generation)}catch{return false}}
function validate(d,owner){if(!exact(d,['schema','purpose','revision','owner','clients'])||d.schema!==1||d.purpose!==purpose||JSON.stringify(d.owner)!==JSON.stringify(owner)||!Number.isSafeInteger(d.revision)||d.revision<0||!Array.isArray(d.clients)||d.clients.length>16)fail('enrollment_state_invalid');const ids=new Set();for(const c of d.clients){if(!exact(c,['clientId','requestId','proof','broker','createdAt','expiresAt','state'])||!identifier(c.clientId)||ids.has(c.clientId)||!identifier(c.requestId)||!key(c.proof)||!validEnrollmentBroker(c.broker)||!validTime(c.createdAt)||![CONFIRMATION_WAIT_MS,LOCAL_RESUME_REQUEST_WAIT_MS].some(ms=>c.expiresAt===c.createdAt+ms)||!['pending','cancelling','closed'].includes(c.state))fail('enrollment_record_invalid');ids.add(c.clientId)}return d}
/** Separate SID-bound pre-approval purpose. It carries no folder grant or approved owner identity. */
export function createLocalEnrollmentState({now=Date.now,secret=()=>randomBytes(32).toString('hex'),...options}){
 const store=new ProtectedJsonStore({...options,purpose,validate,initial:owner=>({schema:1,purpose,revision:0,owner,clients:[]})});
 const get=async clientId=>{if(!identifier(clientId))fail('invalid_client');return(await store.read()).clients.find(c=>c.clientId===clientId)??null};
 return{get,
 /** The enrollment proof is NOT the server-issued initial claim or approved continuation. */
 async inspect(clientId){try{if(!identifier(clientId)||key(clientId))fail('invalid_client');const started=now();if(!validTime(started))fail('clock_unknown');const c=await get(clientId),t=now();if(!validTime(t))fail('clock_unknown');if(!c)return{state:'missing',requestExpiresAt:null,initialClaimMaterial:'absent'};return{state:c.state==='closed'||c.state==='cancelling'?c.state:t<started||t<c.createdAt?'clock_rollback':c.expiresAt<=t?'expired':'pending',requestExpiresAt:c.expiresAt,initialClaimMaterial:'unknown'}}catch{return unknownLocalEnrollmentInspection()}},
 async begin(clientId,requestId,broker,verify){if(!identifier(clientId)||!identifier(requestId)||!validEnrollmentBroker(broker))fail('enrollment_request_invalid');await verify();const old=await get(clientId);if(old){if(old.requestId===requestId){if(old.state==='closed'||old.expiresAt<=now()||now()<old.createdAt||JSON.stringify(old.broker)!==JSON.stringify(broker))fail('enrollment_reapproval_required');return old}if(old.state!=='closed')fail('enrollment_pending_reconciliation_required')}
  return store.transact(d=>{const current=d.clients.find(c=>c.clientId===clientId);if(current&&JSON.stringify(current)!==JSON.stringify(old))fail('enrollment_changed');const proof=secret();if(!key(proof))fail('enrollment_entropy_unavailable');const createdAt=now(),entry={clientId,requestId,proof,broker,createdAt,expiresAt:createdAt+LOCAL_RESUME_REQUEST_WAIT_MS,state:'pending'};if(current)Object.assign(current,entry);else d.clients.push(entry);return entry},{allowCreate:true,guard:verify});},
 async cancelling(clientId,verify){await store.transact(d=>{const c=d.clients.find(c=>c.clientId===clientId);if(!c)fail('enrollment_unavailable');c.state='cancelling'},{guard:verify})},
 async close(clientId,verify){const c=await get(clientId);if(!c||c.state==='closed')return;await store.transact(d=>{d.clients.find(c=>c.clientId===clientId).state='closed'},{guard:verify})},
 dispose:()=>store.dispose()};
}
