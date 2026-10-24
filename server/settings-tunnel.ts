import {CONFIRMATION_WAIT_MS, TRANSPORT_MINUTES, LONG_TRANSPORT_MINUTES, LEASE_TIMER_CHUNK_MS} from '../package/connection-expiry.mjs';
import type { SettingsOwner } from './settings-owner.ts';
import type { VerifiedAccessPrincipal } from './access.ts';
import { PermissionFault, strictPermissionObject } from './workspace-permissions.ts';
import { ownerGuiBinding, type OwnerGuiView } from '../package/owner-gui-dialog.mjs';
import type { ManagedOwnerIdentity } from '../package/server-manager.mjs';

export interface TunnelView extends OwnerGuiView { leaseUntil: number }
export interface TunnelOptions {
  available: boolean;
  generation(): ManagedOwnerIdentity;
  verifyIdentity(expected: Readonly<ManagedOwnerIdentity>): Promise<ManagedOwnerIdentity>;
  verifyConnection?(view: Readonly<TunnelView>): Promise<boolean>;
  launch(view: Readonly<TunnelView>, options: {signal: AbortSignal; onState(state: string): void}): Promise<{stopped: boolean}>;
}
type Entry={view:Readonly<TunnelView>;p:VerifiedAccessPrincipal;state:string;abort:AbortController;ended:boolean;durationMinutes?:number;longTransport?:boolean;started?:boolean;reused?:boolean;stop?:string;inputTimer?:ReturnType<typeof setTimeout>;leaseTimer?:ReturnType<typeof setTimeout>};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const same=(a:ManagedOwnerIdentity,b:ManagedOwnerIdentity)=>a.pid===b.pid&&a.startedAt===b.startedAt&&a.port===b.port&&a.generation===b.generation;
const nativeStates=['input-open','starting','tunnel-ready','cancelled','expired','unavailable','noninteractive','conflict','input-busy','daemon-unattributed','stopped','stop-unconfirmed'];
const doneStates=['cancelled','expired','input-not-visible','unavailable','noninteractive','conflict','input-busy','daemon-unattributed','stopped','stop-unconfirmed'];
function fail(code:string):never {throw new PermissionFault(code)}

/** Browser intent/status only; no key, command, process selector or arbitrary transport binding. */
export class SettingsTunnel {
  private entries=new Map<string,Entry>();
  private active?:Entry;
  private tasks=new Set<Promise<void>>();
  private closed=false;
  private lastLaunch=-Infinity;
  constructor(private owners:SettingsOwner,private options?:TunnelOptions,private now=Date.now){}
  available(){return !this.closed&&this.options?.available===true}
  private owner(p:VerifiedAccessPrincipal|undefined):asserts p is VerifiedAccessPrincipal {if(!this.owners.owns(p))fail('registered_owner_required')}
  private stop(e:Entry,state:string){if(e.ended||e.stop)return;e.stop=state;e.state='stopping';clearTimeout(e.inputTimer);clearTimeout(e.leaseTimer);e.abort.abort()}
  private check(e:Entry){
    if(e.stop||e.ended)return false;
    const input=!e.started;
    if(!(e.longTransport&&!input?this.owners.retainsApprovedIdentity(e.p):this.owners.owns(e.p))||!this.options||!same(e.view,this.options.generation())){this.stop(e,'unavailable');return false}
    if(this.now()>=e.view.leaseUntil||(['pending','input-open'].includes(e.state)&&this.now()>=e.view.expiresAt)){this.stop(e,'expired');return false}
    return true;
  }
  private armLease(e:Entry){clearTimeout(e.leaseTimer);e.leaseTimer=setTimeout(()=>{if(this.now()>=e.view.leaseUntil)this.stop(e,'expired');else if(!e.ended&&!e.stop)this.armLease(e)},Math.max(1,Math.min(LEASE_TIMER_CHUNK_MS,e.view.leaseUntil-this.now())));e.leaseTimer.unref()}
  private async run(e:Entry){
    let stopped=false,launched=false;
    try{
      if(!this.check(e))return;
      const {pid,startedAt,port,generation}=e.view;
      const actual=await this.options!.verifyIdentity(Object.freeze({pid,startedAt,port,generation}));
      if(!this.check(e)||!same(e.view,actual)){this.stop(e,'unavailable');return}
      launched=true;
      const result=await this.options!.launch(e.view,{signal:e.abort.signal,onState:state=>{
        if(!this.check(e))return;
        if(!nativeStates.includes(state)){this.stop(e,'unavailable');return}
        if(state==='starting'||state==='tunnel-ready'){e.started=true;clearTimeout(e.inputTimer);}
        e.state=state;
      }});
      stopped=result.stopped;
    }catch{e.stop??='unavailable'}
    finally{
      // Never free the single slot when the native daemon's stop was not confirmed.
      clearTimeout(e.inputTimer);clearTimeout(e.leaseTimer);
      if(stopped||!launched){e.ended=true;e.state=e.stop??(doneStates.includes(e.state)?e.state:'stopped');if(this.active===e)this.active=undefined}
      else {e.state='stop-unconfirmed';e.ended=true}
    }
  }
  request(p:VerifiedAccessPrincipal|undefined,body:any){
    strictPermissionObject(body,Object.hasOwn(body ?? {},'durationMinutes')?['requestId','confirmed','durationMinutes']:['requestId','confirmed']);this.owner(p);
    const durationMinutes=Object.hasOwn(body,'durationMinutes')?body.durationMinutes:60;
    if(!Number.isSafeInteger(durationMinutes)||!TRANSPORT_MINUTES.includes(durationMinutes))fail('finite_tunnel_duration_required');
    if(!id(body.requestId)||body.confirmed!==true)fail('explicit_tunnel_request_required');
    const old=this.entries.get(body.requestId);if(old)return this.result(p,body.requestId);
    const requestId=body.requestId;
    if(!this.available())fail('tunnel_gui_unavailable');
    if(this.active)fail('tunnel_already_active');
    if(this.entries.size>=64)fail('tunnel_request_capacity');
    if(this.now()-this.lastLaunch<1000)fail('tunnel_rate_limited');
    const tuple={requestId:body.requestId,subject:p.subject,issuer:p.issuer,audience:p.audience,expiresAt:Math.min(p.expiresAt,this.now()+CONFIRMATION_WAIT_MS),...this.options!.generation()};
    const longTransport=durationMinutes===LONG_TRANSPORT_MINUTES;
    const view=Object.freeze({...tuple,bindingDigest:ownerGuiBinding(tuple),leaseUntil:longTransport?this.now()+durationMinutes*60000:Math.min(p.expiresAt,this.now()+durationMinutes*60000)});
    const e:Entry={view,p,state:'pending',durationMinutes,longTransport,abort:new AbortController(),ended:false};this.entries.set(requestId,e);this.active=e;this.lastLaunch=this.now();
    e.inputTimer=setTimeout(()=>{if(['pending','input-open'].includes(e.state))this.stop(e,'expired')},Math.max(1,view.expiresAt-this.now()));e.inputTimer.unref();
    this.armLease(e);
    const task=Promise.resolve().then(()=>this.run(e));this.tasks.add(task);void task.finally(()=>this.tasks.delete(task));
    return this.result(p,requestId);
  }
  async reuse(p:VerifiedAccessPrincipal|undefined,body:any){
    strictPermissionObject(body,['requestId','confirmed']);this.owner(p);
    if(!id(body.requestId)||body.confirmed!==true)fail('explicit_tunnel_request_required');
    const e=this.entries.get(body.requestId);
    if(!e||e!==this.active||e.ended||e.stop)fail('tunnel_connection_unverified');
    if(e.view.subject!==p.subject||e.view.issuer!==p.issuer||e.view.audience!==p.audience)fail('tunnel_request_unavailable');
    const valid=()=>!this.closed&&!e.ended&&!e.stop&&this.active===e&&this.owners.owns(p)&&(e.longTransport?this.owners.retainsApprovedIdentity(e.p):this.owners.owns(e.p))&&!!this.options&&same(e.view,this.options.generation())&&this.now()<e.view.leaseUntil&&e.state==='tunnel-ready';
    if(!valid()||!this.options?.verifyConnection)fail('tunnel_connection_unverified');
    let verified=false;
    try{const {pid,startedAt,port,generation}=e.view;const actual=await this.options.verifyIdentity(Object.freeze({pid,startedAt,port,generation}));
      if(valid()&&same(e.view,actual))verified=await this.options.verifyConnection(e.view);
    }catch{}
    this.owner(p);
    if(!verified||!valid()){e.reused=false;fail('tunnel_connection_unverified')}
    e.reused=true;
    const result=this.result(p,body.requestId);
    if(result.state!=='tunnel-ready'||!result.reused)fail('tunnel_connection_unverified');
    return result;
  }
  result(p:VerifiedAccessPrincipal|undefined,requestId:unknown){
    this.owner(p);if(!id(requestId))fail('tunnel_request_unavailable');const e=this.entries.get(requestId);
    if(!e)return{requestId,state:'unknown',appConnectionVerified:false};
    if(e.view.subject!==p.subject||e.view.issuer!==p.issuer||e.view.audience!==p.audience)fail('tunnel_request_unavailable');
    this.check(e);
    return{requestId,state:e.state,finished:e.ended&&this.active!==e,expiresAt:e.view.expiresAt,leaseUntil:e.view.leaseUntil,durationMinutes:e.durationMinutes,app:'pi-console-echo-test',appConnectionVerified:false,credentialSaved:false,reused:e.reused===true&&!e.ended&&!e.stop&&e.state==='tunnel-ready'};
  }
  status(p:VerifiedAccessPrincipal|undefined){this.owner(p);return{available:this.available(),active:this.active?this.result(p,this.active.view.requestId):null,appConnectionVerified:false}}
  cancel(p:VerifiedAccessPrincipal|undefined,body:any){
    strictPermissionObject(body,body&&Object.prototype.hasOwnProperty.call(body,'notVisible')?['requestId','notVisible']:['requestId']);this.owner(p);
    if(!id(body.requestId)||(body.notVisible!==undefined&&body.notVisible!==true))fail('tunnel_request_unavailable');
    const e=this.entries.get(body.requestId);
    if(e){this.result(p,body.requestId);this.stop(e,body.notVisible?'input-not-visible':'cancelled')}
    else {
      if(this.entries.size>=64)fail('tunnel_request_capacity');
      const tuple={requestId:body.requestId,subject:p.subject,issuer:p.issuer,audience:p.audience,expiresAt:this.now(),...(this.options?.generation()??{pid:1,startedAt:'2026-10-12T00:00:00Z',port:1,generation:'0'.repeat(32)})};
      this.entries.set(body.requestId,{view:{...tuple,bindingDigest:ownerGuiBinding(tuple),leaseUntil:this.now()},p,state:'cancelled',abort:new AbortController(),ended:true});
    }
    return this.result(p,body.requestId);
  }
  async idle(){await Promise.all([...this.tasks])}
  async stopAll(){for(const e of this.entries.values())this.stop(e,'cancelled');await this.idle()}
  async dispose(){this.closed=true;await this.stopAll()}
}
