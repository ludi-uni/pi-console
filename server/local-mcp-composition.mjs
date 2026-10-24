import {LOCAL_RESUME_REQUEST_WAIT_MS} from '../package/local-resume-policy.mjs';
import {createLocalIssuer,exact,identifier,key,equal,hash,fail} from './local-mcp-identity.mjs';
import {createServerStore} from './local-mcp-state.mjs';
import {atRenewal,atRenewalSync,renewalError,carryRenewal} from './local-mcp-diagnostic.mjs';
const ACCESS=300000,RECOVERY=120000,DAY=86400000;
const copy=structuredClone;
/** Source opt-in only. No env/profile discovery, listener, OS calls or writes on construction when OFF. */
export async function createLocalMcpComposition(options={}){
 if(options.enabled!==true)return{status:()=>({enabled:false,reason:'disabled'}),request(){fail('local_mcp_disabled')},async dispose(){}};
 const {identity,provider,backend,codec,testOnly=false,secret,reserved=[],now=Date.now}=options;
 if(!identity||!provider||!['fake','handle-anchored'].includes(provider.kind)||provider.kind==='fake'&&!testOnly)fail('trusted_dependencies_required');
 const owner=await identity.current(),issuer=createLocalIssuer({secret,reserved}),{FolderMcp}=await import('./folder-mcp.ts');
 let app,context,disposed=false,serial=Promise.resolve();const pending=new Map(),reviews=new Map(),enrollments=new Map();
 const queue=work=>{const result=serial.then(()=>{if(disposed)fail('local_mcp_closed');return work()});serial=result.catch(()=>{});return result};
 const stop=()=>{disposed=true;app?.dispose()};
 const store=createServerStore({owner,codec,backend,testOnly,onFault:stop});
 const authority=async(check=()=>{})=>{if(disposed)fail('local_mcp_closed');try{await identity.assert(owner);check()}catch{stop();fail('local_mcp_authority_changed')}};
 const family=(d,id)=>{const f=d.families.find(f=>f.id===id);if(!f||f.state!=='approved'||f.approvalExpiresAt!==null&&f.approvalExpiresAt<=now()||now()<d.clockFloor)fail('local_family_unavailable');return f};
 const read=async()=>{await authority();return store.read()};
 let savedViews=[];
 const redact=d=>d.families.map(f=>({connectionId:f.id,name:f.name,state:f.state,parent:f.parent.path,operations:copy(f.operations),expiresAt:f.approvalExpiresAt,connectionExpiresAt:f.bundle?.expiresAt??0}));
 const transaction=async(change,{check=()=>{},allowCreate=false}={})=>{let views;const result=await store.transact(async d=>{const r=await change(d);views=redact(d);return r},{allowCreate,guard:()=>authority(check)});savedViews=views;return result};
 const handoff=f=>({connectionId:f.id,clientId:f.clientId,token:f.bundle.handoff,expiresAt:f.bundle.expiresAt,grantExpiresAt:f.approvalExpiresAt,continuation:{proof:f.clientProof,renewal:f.bundle.renewal,epoch:f.bundle.epoch,expiresAt:f.bundle.expiresAt}});
 const authenticate=(d,input)=>{if(!exact(input,['connectionId','clientId','proof'])||!identifier(input.clientId)||!key(input.proof))fail('client_unverified');const f=family(d,input.connectionId);if(f.clientId!==input.clientId||!equal(input.proof,f.clientProof))fail('client_unverified');return f};
 app=new FolderMcp(provider,{now,secret:issuer.issue,continuation:true,pendingWaitMs:LOCAL_RESUME_REQUEST_WAIT_MS,
  onInitial:async(id,initial)=>{
   const p=pending.get(id),r=context?.review;if(!p||!r||r.connectionId!==id)fail('explicit_enrollment_required');
   const bundle={...initial,renewal:issuer.issue()},clientProof=issuer.issue(),snapshot=app.continuationSnapshot(id);
   await transaction(d=>{if(d.requests.some(x=>x.id===r.requestId)||d.families.some(x=>x.id===id))fail('request_already_recorded');d.clockFloor=Math.max(d.clockFloor,now());d.families.push({id,name:p.name,clientId:p.clientId,ownerProofHash:p.ownerProofHash,parent:snapshot.grant.parent,operations:snapshot.grant.operations,approvedAt:r.approvedAt,period:r.period,approvalExpiresAt:snapshot.grant.expiresAt,state:'approved',bundle,clientProof,usedRenewals:[],renewalReceipt:null,journal:[]});d.requests.push({id:r.requestId,action:'approve',target:id,fingerprint:r.fingerprint});},{allowCreate:true,check:context.check});
  },
  onOperation:async(id,requestId,receipt)=>{await transaction(d=>{const f=family(d,id),prior=f.journal.find(r=>r.requestId===requestId);if(prior)prior.receipt=copy(receipt);else f.journal.push({requestId,receipt:copy(receipt)})})}
 });
 const load=async()=>{const d=await read(),result={restored:[],closed:[]};savedViews=redact(d);if(!d.revision)return result;
  for(const f of d.families)issuer.reserve(f.bundle?[f.bundle.read,f.bundle.control,f.bundle.final,f.bundle.handoff,f.bundle.renewal,f.clientProof]:[],[f.ownerProofHash,...f.usedRenewals]);
  if(now()<d.clockFloor){stop();fail('clock_rollback')}
  result.closed=d.families.filter(f=>f.state==='approved'&&f.approvalExpiresAt!==null&&f.approvalExpiresAt<=now()).map(f=>f.id);return result;
 };
 let restoration;try{restoration=await load()}catch(e){await store.dispose();stop();throw e}
 const view=()=>{const runtime=app.view(),ids=new Set(runtime.connections.map(c=>c.connectionId));return{...runtime,connections:[...runtime.connections.map(c=>({...c,runtimeBound:c.state==='connected'})),...savedViews.filter(c=>!ids.has(c.connectionId)).map(c=>({...c,state:c.state==='revoked'?'revoked':c.expiresAt!==null&&c.expiresAt<=now()?'expired':'approved',runtimeBound:false}))],storagePaths:options.storagePaths??null}};
 const grantKey=f=>JSON.stringify([f.parent,f.operations,f.approvalExpiresAt,f.bundle.epoch]);
 const inputFor=f=>({id:f.id,name:f.name,ownerProofHash:f.ownerProofHash,parent:f.parent,operations:f.operations,grantExpiresAt:f.approvalExpiresAt,operationJournal:f.journal,bundle:f.bundle});
 const verifyTarget=(f,auth)=>async()=>{const current=authenticate(await read(),auth);if(grantKey(current)!==grantKey(f))fail('restore_changed')};
 const pinTarget=async(f,auth)=>{const guard=()=>{if(disposed||f.approvalExpiresAt!==null&&f.approvalExpiresAt<=now())fail('local_family_unavailable')};guard();await provider.withParent(f.parent,guard,async()=>{await verifyTarget(f,auth)();guard();return undefined});guard()};
 const snapshot=id=>{try{return app.continuationSnapshot(id)}catch{return null}};
 const checkSnapshot=(f,s)=>{if(s&&(s.state!=='connected'||s.admission!=='open'||s.epoch!==f.bundle.epoch||JSON.stringify(s.grant)!==JSON.stringify({parent:f.parent,operations:f.operations,expiresAt:f.approvalExpiresAt})))fail('runtime_not_bound')};
 const restored=id=>{if(!restoration.restored.includes(id))restoration.restored.push(id)};
 const bind=async(f,auth)=>{await pinTarget(f,auth);const s=snapshot(f.id);checkSnapshot(f,s);if(!s){await app.restoreContinuation(inputFor(f),verifyTarget(f,auth));restored(f.id)}};
 const api={
  status:()=>({enabled:!disposed,mode:'local-dpapi',restoration:copy(restoration),productionApplied:false}),
  request(body){if(disposed)fail('local_mcp_closed');const recoverable=exact(body,['name','clientId','requestId','proof']);if(!recoverable&&!exact(body,['name','clientId'])||!identifier(body.clientId)||recoverable&&(!identifier(body.requestId)||!key(body.proof)))fail('invalid_client_request');
   const id=recoverable?JSON.stringify([body.clientId,body.requestId]):null,prior=id&&enrollments.get(id);
   if(prior){if(prior.name!==body.name||!equal(prior.proofHash,hash(body.proof)))fail('enrollment_request_mismatch');if(prior.cancelled)return{state:'cancelled',connectionId:prior.reply.connectionId};if(prior.reply.expiresAt<=now())fail('enrollment_expired');return copy(prior.reply)}
   const stored=new Set(savedViews.map(c=>c.connectionId));if(savedViews.length+app.view().connections.filter(c=>!stored.has(c.connectionId)&&c.state==='pending').length>=16)fail('connection_request_rejected');
   if(recoverable&&enrollments.size>=256)fail('enrollment_capacity');if(recoverable)issuer.reserve([body.proof]);const r=app.request({name:body.name});pending.set(r.connectionId,{name:body.name,clientId:body.clientId,ownerProofHash:hash(r.proof)});if(id)enrollments.set(id,{name:body.name,proofHash:hash(body.proof),reply:copy(r),cancelled:false});return r},
  review(body,check){return queue(async()=>{check();if(!exact(body,['connectionId','parent','operations','period'])||!pending.has(body.connectionId)||![7,31,'none'].includes(body.period))fail('invalid_review');const approvedAt=now(),r=await app.review({connectionId:body.connectionId,parent:body.parent,operations:body.operations,expiresAt:body.period==='none'?null:approvedAt+body.period*DAY,...(body.period==='none'?{noExpiry:true}:{})});check();const review={...r,approvedAt,period:body.period,fingerprint:hash(JSON.stringify(r))};reviews.set(r.reviewId,review);return copy(r)})},
  approve(body,check,ownerExpiresAt){return queue(async()=>{check();if(!Number.isSafeInteger(ownerExpiresAt)||ownerExpiresAt<=now())fail('authenticated_owner_expiry_required');const review=reviews.get(body?.reviewId);if(!review)fail('review_unavailable');const d=await read();if(d.requests.some(r=>r.id===body.requestId))fail('request_already_recorded');if(d.requests.length>=256||d.families.length>=16)fail('request_capacity');const liveOwner=()=>{check();if(ownerExpiresAt<=now())fail('authenticated_owner_expiry_required')};context={review,check:liveOwner};try{const result=await app.approve(body,liveOwner,ownerExpiresAt);liveOwner();return result}finally{context=undefined;reviews.delete(body?.reviewId)}})},
  cancel(reviewId,check){return queue(async()=>{check();const result=await app.cancel(reviewId);reviews.delete(reviewId);return result})},
  claim(body){return queue(async()=>{
   const result=app.claim(body);if(result.state!=='connected')return result;
   const f=family(await read(),body.connectionId);
   // Protected reads can cross the original initial-handoff deadline.
   app.claim(body);return{state:'connected',...handoff(f)};
  })},
  cancelPending(body){return queue(async()=>{if(!exact(body,['connectionId','clientId','proof','requestId'])||!identifier(body.requestId))fail('invalid_pending_cancel');const p=pending.get(body.connectionId);if(!p||p.clientId!==body.clientId||!key(body.proof)||!equal(hash(body.proof),p.ownerProofHash))fail('client_unverified');if(p.cancelled)return{state:'cancelled',ownerGrantRevoked:false};if((await read()).families.some(f=>f.id===body.connectionId))return{state:'already_approved',ownerGrantRevoked:false};await app.revoke({connectionId:body.connectionId,requestId:body.requestId},()=>{});p.cancelled=true;for(const r of enrollments.values())if(r.reply.connectionId===body.connectionId)r.cancelled=true;for(const[id,r]of reviews)if(r.connectionId===body.connectionId)reviews.delete(id);return{state:'cancelled',ownerGrantRevoked:false}})},
  resume(input){return queue(async()=>{const f=authenticate(await read(),input);checkSnapshot(f,snapshot(f.id));if(f.bundle.expiresAt<=now()){await pinTarget(f,input);return{state:'credential_expired',connectionId:f.id}}await bind(f,input);return handoff(f)})},
  renew(input){return queue(async()=>{
   if(!exact(input,['connectionId','clientId','proof','renewal','requestId'])||!key(input.renewal)||!identifier(input.requestId))fail('renewal_invalid');
   const auth={connectionId:input.connectionId,clientId:input.clientId,proof:input.proof},f=authenticate(await read(),auth),fingerprint=hash(JSON.stringify({connectionId:input.connectionId,clientId:input.clientId,proof:hash(input.proof),renewal:hash(input.renewal)})),receipt=f.renewalReceipt;
   // No diagnostic tags before authenticate() above has succeeded.
   if(receipt?.id===input.requestId){
    if(receipt.fingerprint!==fingerprint)throw carryRenewal(renewalError('RECEIPT_CHECK'),Error('renewal_receipt_unavailable'));
    if(receipt.recoverUntil<=now())throw carryRenewal(renewalError('RECOVERY_WINDOW'),Error('renewal_receipt_unavailable'));
    if(receipt.epoch!==f.bundle.epoch)throw carryRenewal(renewalError('RECEIPT_CHECK'),Error('renewal_receipt_unavailable'));
    await atRenewal('RUNTIME_CONSISTENCY',()=>bind(f,auth));return handoff(f);
   }
   if(!equal(input.renewal,f.bundle.renewal)){
    if(f.usedRenewals.includes(hash(input.renewal))){await atRenewal('RUNTIME_CONSISTENCY',()=>app.invalidateContinuation(f.id));await atRenewal('PERSISTENCE',()=>transaction(d=>{const r=family(d,f.id);r.state='revoked';r.bundle=null;r.clientProof=null;r.renewalReceipt=null}))}
    throw carryRenewal(renewalError('REPLAY_REJECTED'),Error('renewal_unrecognized'));
   }
   if(f.usedRenewals.length>=32768)throw carryRenewal(renewalError('CAPACITY'),Error('renewal_capacity'));
   await atRenewal('PARENT_VALIDATE',()=>pinTarget(f,auth));const s=snapshot(f.id);atRenewalSync('RUNTIME_CONSISTENCY',()=>checkSnapshot(f,s));
   if(s)await atRenewal('RUNTIME_CONSISTENCY',()=>app.quiesceContinuation(f.id,f.bundle.epoch));else await atRenewal('RUNTIME_CONSISTENCY',()=>app.prepareRotationContinuation(inputFor(f),verifyTarget(f,auth)));try{
    const next=atRenewalSync('ACTIVATION',()=>issuer.bundle(f.bundle.epoch+1,Math.min(now()+ACCESS,f.approvalExpiresAt??Infinity))),stage=await atRenewal('ACTIVATION',()=>app.stageContinuation(f.id,next));
    await atRenewal('ACTIVATION',()=>app.activateContinuation(stage,f.bundle.epoch,()=>atRenewal('PERSISTENCE',()=>transaction(d=>{const r=authenticate(d,auth);if(r.bundle.epoch!==f.bundle.epoch||r.usedRenewals.length>=32768)fail('epoch_changed');r.usedRenewals.push(hash(r.bundle.renewal));r.bundle=next;r.renewalReceipt={id:input.requestId,fingerprint,epoch:next.epoch,recoverUntil:now()+RECOVERY};d.clockFloor=now()})),()=>atRenewal('PERSISTENCE',async()=>{const r=authenticate(await read(),auth);if(r.bundle.epoch!==next.epoch)fail('epoch_changed')})));
    restored(f.id);return await atRenewal('PERSISTENCE',async()=>handoff(family(await read(),f.id)));
   }catch(error){try{await app.invalidateContinuation(f.id)}catch(cleanup){throw carryRenewal(error,cleanup)}throw carryRenewal(error,Error('rotation_unavailable'))}
  })},
  revoke(body,check){if(!exact(body,['connectionId','requestId'])||!identifier(body.requestId)||!identifier(body.connectionId))fail('invalid_revoke');check();
   return queue(async()=>{const d=await read(),prior=d.requests.find(r=>r.id===body.requestId),fingerprint=hash(JSON.stringify({connectionId:body.connectionId,requestId:body.requestId}));if(prior){if(prior.action!=='revoke'||prior.fingerprint!==fingerprint)fail('request_mismatch');return{state:'committed',requestId:body.requestId}}
    if(!d.families.length||body.connectionId!=='all'&&!d.families.some(f=>f.id===body.connectionId))fail('family_missing');if(d.requests.length>=256)fail('request_capacity');
    const ids=body.connectionId==='all'?app.view().connections.map(c=>c.connectionId):[body.connectionId];await Promise.all(ids.map(id=>app.invalidateContinuation(id)));
    await transaction(s=>{const targets=body.connectionId==='all'?s.families:s.families.filter(f=>f.id===body.connectionId);if(!targets.length&&body.connectionId!=='all')fail('family_missing');for(const f of targets){f.state='revoked';f.bundle=null;f.clientProof=null;f.renewalReceipt=null} s.requests.push({id:body.requestId,action:'revoke',target:body.connectionId,fingerprint})},{check});return{state:'committed',requestId:body.requestId};})
  },
  result(requestId,check){return queue(async()=>{check();if(!identifier(requestId))fail('invalid_request_id');const r=(await read()).requests.find(r=>r.id===requestId);return{state:r?'committed':'unknown',requestId,action:r?.action??null,current:view()}})},
  view,tools:token=>app.tools(token),async call(token,name,args){app.tools(token);const d=await read(),f=d.families.find(f=>f.state==='approved'&&equal(f.bundle?.handoff,token));if(!f||now()<d.clockFloor){stop();fail('runtime_binding_unavailable')}return app.call(token,name,args)},
  async dispose(){stop();await serial;await store.dispose()},
 };
 return api;
}
