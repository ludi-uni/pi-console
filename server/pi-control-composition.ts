import type {RuntimeManager} from './runtime/manager.ts';
import type {WorkspacePermissions} from './workspace-permissions.ts';
import type {PromptReceipts} from './runtime/prompt-receipts.ts';
import type {LocalMcpOwnerConfig} from './local-mcp-owner.ts';
import {createTrustedLocalMcp,startTrustedLocalListener} from './trusted-local-mcp.ts';
import {PiControlActivation} from './pi-control-activation.ts';
import {PiConnectionPreparation} from './pi-connection-preparation.ts';
/** No listener, credentials, persistence or work starts on construction. */
export function createPiControlComposition(options:{runtime:RuntimeManager;permissions:WorkspacePermissions;receipts:PromptReceipts;grantFile:string;owner:LocalMcpOwnerConfig;legacyKeys:readonly string[];consolePort:number;current:()=>ReturnType<typeof createTrustedLocalMcp>;inactive:()=>ReturnType<typeof createTrustedLocalMcp>;installed:(app:ReturnType<typeof createTrustedLocalMcp>)=>void;now?:()=>number;secret?:()=>string;startListener?:typeof startTrustedLocalListener}) {
 const {permissions,runtime}=options;
 const preparation=new PiConnectionPreparation({list:()=>runtime.workspaces.list(),sessions:id=>runtime.readOnlySessions(id),observation:(wid,sid)=>runtime.readOnlyObservation(wid,sid),open:async(wid,sid)=>{await runtime.open(wid,sid)},create:async wid=>(await runtime.create(wid)).session.id});
 // Test injection is trusted installed-code only, never HTTP/env/profile controlled.
 return new PiControlActivation({instance:permissions.instance,preparation,now:options.now,secret:options.secret,reserved:options.legacyKeys,snapshot:()=>permissions.snapshot(),inventory:()=>options.current().permissionApi.inventory(),replace:(revision,scopes,owner)=>permissions.replace(permissions.instance,revision,scopes,()=>options.current().permissionApi.inventory(),owner),
  async start(credentials){
   const app=createTrustedLocalMcp(runtime,permissions,options.receipts,{grantFile:options.grantFile,now:options.now},{enabled:true,credentials,owner:options.owner,legacyCredentialKeys:options.legacyKeys});
   let server:Awaited<ReturnType<typeof startTrustedLocalListener>>;try{server=await (options.startListener??startTrustedLocalListener)(app,31719,options.consolePort)}catch{app.dispose();throw Error('pi_listener_unavailable')}
   let closed=false,installed=false,effectiveExpiry=credentials.expiresAt;
   const close=async()=>{if(closed)return;closed=true;app.dispose();server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));if(installed&&options.current()===app)options.installed(options.inactive())};
   return{port:31719,currentExpiry:()=>effectiveExpiry,publish(){if(!installed){options.installed(app);installed=true}},approve:(target,expiresAt,requestId,owner)=>app.approveExactControl(target,expiresAt,requestId,owner),async live(target){const v=await app.view();effectiveExpiry=Math.min(credentials.expiresAt,v.grant?.expiresAt??0);return !closed&&v.status.enabled&&!!v.grant?.active&&(['instance','revision','workspaceId','sessionId','generation']as const).every(k=>v.grant!.target[k]===target[k])},
    call:async(name,args)=>{if(name==='control_state'){const state=runtime.controlState(args.workspaceId,args.sessionId);if(state.generation!==args.generation)throw Error('pi_target_unavailable');return state}return app.callReviewedControl(name,args)},revoke:(id,owner)=>app.revokeExactControl(id,owner),close};
  }
 });
}
