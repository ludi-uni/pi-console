import {randomUUID} from 'node:crypto';
import type {ExternalMcpReason,ExternalMcpStatus,IsolationBinding,IsolationInspection} from '../shared/external-mcp.ts';
import {isolationChecks} from '../shared/external-mcp.ts';
import type {IsolationAdapter,RestrictedAgentHandle} from './isolation-adapter.ts';
export class ExternalMcpFault extends Error {constructor(readonly reason:ExternalMcpReason){super(reason);}}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const same=(a:IsolationBinding,b:IsolationBinding)=>a.installationId===b.installationId&&a.instanceId===b.instanceId&&a.policyGeneration===b.policyGeneration;
export type McpAdmission = Readonly<{revision:number;expiresAt:number}>;
/** Ephemeral explicit consent plus independently supplied setup/OS evidence. Never persisted ready. */
export class ExternalMcpGate {
  private revision=0;private enabled=false;private reason:ExternalMcpReason;private proof?:IsolationInspection;private unsubscribe?:()=>void;private watching=false;private disposed=false;
  readonly binding:Readonly<IsolationBinding>;
  constructor(binding:IsolationBinding,private readonly adapter?:IsolationAdapter,private readonly now=Date.now){
    this.binding=Object.freeze({...binding});this.reason=adapter?'recheck_required':'adapter_unavailable';
    if(!Object.values(this.binding).every(id))throw Error('invalid_isolation_binding');
    if(adapter){try{this.unsubscribe=adapter.onInvalidated(()=>this.invalidate('recheck_required'));this.watching=typeof this.unsubscribe==='function';if(!this.watching)this.invalidate('verification_failed');}catch{this.invalidate('verification_failed');}}
  }
  private invalidate(reason:ExternalMcpReason){this.revision++;this.enabled=false;this.reason=reason;this.proof=undefined;}
  private expire(){if(this.proof&&(this.now()>=this.proof.verification.expiresAt||this.now()<this.proof.verification.checkedAt))this.invalidate('verification_stale');}
  status():ExternalMcpStatus {this.expire();return {enabled:this.enabled,readiness:this.reason==='ready'?'ready':this.reason==='adapter_unavailable'||this.reason==='adapter_unsupported'?'unavailable':this.reason==='setup_required'||this.reason==='setup_denied'?'setup_required':'recheck_required',reason:this.reason,revision:this.revision,adapterAvailable:!!this.adapter&&!this.disposed,checkedAt:this.proof?.verification.checkedAt??null,expiresAt:this.proof?.verification.expiresAt??null};}
  private validate(value:unknown):IsolationInspection {
    const fail=(r:ExternalMcpReason):never=>{throw new ExternalMcpFault(r);};
    if(!object(value))return fail('verification_unknown');if(value.supported===false)return fail('adapter_unsupported');
    if(value.supported!==true||!object(value.setup)||!object(value.verification))return fail('verification_unknown');
    const s=value.setup,v=value.verification;
    if(s.decision==='denied')return fail('setup_denied');if(s.decision==='missing')return fail('setup_required');
    if(s.decision!=='approved'||s.administratorApproved!==true||!id(s.receiptId))return fail('setup_required');
    if(s.installationId!==this.binding.installationId||s.policyGeneration!==this.binding.policyGeneration||!object(v.binding)||!same(v.binding as IsolationBinding,this.binding))return fail('binding_mismatch');
    if(v.outcome==='failed')return fail('verification_failed');if(v.outcome!=='verified')return fail('verification_unknown');
    const now=this.now();if(!Number.isSafeInteger(v.checkedAt)||!Number.isSafeInteger(v.expiresAt)||v.checkedAt>now||now-v.checkedAt>5000||v.expiresAt<=now||v.expiresAt>v.checkedAt+60000)return fail('verification_stale');
    if(!object(v.checks)||!isolationChecks.every(k=>v.checks[k]===true))return fail('protection_unverified');
    // Copy selected evidence only; mutable adapter objects cannot mutate accepted authority.
    return {supported:true,setup:{decision:'approved',receiptId:s.receiptId,installationId:s.installationId,policyGeneration:s.policyGeneration,administratorApproved:true},verification:{outcome:'verified',binding:{...this.binding},checkedAt:v.checkedAt,expiresAt:v.expiresAt,checks:Object.fromEntries(isolationChecks.map(k=>[k,true])) as IsolationInspection['verification']['checks']}};
  }
  private async inspect(){
    if(!this.adapter||this.disposed)throw new ExternalMcpFault('adapter_unavailable');if(!this.watching)throw new ExternalMcpFault('verification_failed');
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{return this.validate(await Promise.race([Promise.resolve().then(()=>this.adapter!.inspect(this.binding,controller.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ExternalMcpFault('verification_unknown'));},2000);})]));}
    catch(e){throw e instanceof ExternalMcpFault?e:new ExternalMcpFault('verification_failed');}finally{clearTimeout(timer);}
  }
  async update(expectedRevision:number,enable:boolean){
    this.expire();if(expectedRevision!==this.revision)throw new ExternalMcpFault('authority_changed');
    this.invalidate(this.adapter?'recheck_required':'adapter_unavailable');const operation=this.revision;
    try{const proof=await this.inspect();if(operation!==this.revision)throw new ExternalMcpFault('authority_changed');this.proof=proof;this.reason='ready';this.enabled=enable;this.revision++;return this.status();}
    catch(e){if(operation===this.revision)this.invalidate(e instanceof ExternalMcpFault?e.reason:'verification_failed');throw e;}
  }
  disable(expectedRevision:number){this.expire();if(expectedRevision!==this.revision)throw new ExternalMcpFault('authority_changed');this.invalidate('disabled');return this.status();}
  async admit():Promise<McpAdmission>{
    const initial=this.status();if(!initial.enabled||initial.reason!=='ready')throw new ExternalMcpFault(initial.reason==='ready'?'disabled':initial.reason);
    const revision=this.revision,lease=this.proof!;
    try{const current=await this.inspect();if(current.setup.receiptId!==lease.setup.receiptId)throw new ExternalMcpFault('recheck_required');const expiresAt=Math.min(lease.verification.expiresAt,current.verification.expiresAt);this.assert({revision,expiresAt});return Object.freeze({revision,expiresAt});}
    catch(e){if(revision===this.revision)this.invalidate(e instanceof ExternalMcpFault?e.reason:'verification_failed');throw e;}
  }
  assert(ticket:McpAdmission){this.expire();if(!this.enabled||this.reason!=='ready'||ticket.revision!==this.revision||this.now()>=ticket.expiresAt)throw new ExternalMcpFault('authority_changed');}
  /** Future restricted connection only. Not wired to ordinary local Console spawn. */
  connection(){
    const owned=new Map<string,RestrictedAgentHandle>();let uncertain=0;
    return {
      start:async(target:{workspaceId:string;sessionId:string;generation:string})=>{
        if(!target||Object.keys(target).length!==3||Object.keys(target).some(k=>!['workspaceId','sessionId','generation'].includes(k))||!Object.values(target).every(id))throw Error('invalid_agent_target');const ticket=await this.admit();
        let handle:RestrictedAgentHandle;try{handle=await this.adapter!.launch({binding:this.binding,admissionId:randomUUID(),...target,protocolVersion:1},()=>this.assert(ticket));}catch{uncertain++;this.invalidate('verification_failed');throw new ExternalMcpFault('verification_failed');}
        if(!id(handle?.id)||!same(handle.binding??{} as IsolationBinding,this.binding)||owned.has(handle.id)){uncertain++;throw new ExternalMcpFault('authority_changed');}
        owned.set(handle.id,handle); // Keep exact owned handle for explicit stop even after revocation.
        try{this.assert(ticket);}catch(e){uncertain++;throw e;}return handle;
      },
      stop:async(handleId:string)=>{const h=owned.get(handleId);if(!h)throw Error('unknown_agent_handle');await this.adapter!.stop(h);owned.delete(handleId);},
      diagnostics:()=>({owned:owned.size,handles:[...owned.keys()],uncertain}),
    };
  }
  dispose(){this.disposed=true;this.invalidate('adapter_unavailable');this.watching=false;const unsubscribe=this.unsubscribe;this.unsubscribe=undefined;try{unsubscribe?.();}catch{/* Authority is already permanently closed. */}}
}
