import path from'node:path';
import{randomUUID}from'node:crypto';
import{createLocalIdentity,hash}from'./local-mcp-identity.mjs';
import{createWindowsProtection}from'./local-mcp-windows.mjs';
import{createLocalFileBackend}from'./local-mcp-file-backend.mjs';
import{createLocalMcpComposition}from'./local-mcp-composition.mjs';
import{createLocalMcpHttp}from'./local-mcp-http.mjs';
/** Called by trusted owner-broker composition. No environment/profile migration or listener. */
export function createLocalMcpInstallation(options={}){
 let service,opening,closed=false;
 const get=async()=>{
  if(options.enabled!==true||closed)return undefined;
  if(service)return service;if(opening)return opening;
  opening=(async()=>{if(!options.dataDir||!path.isAbsolute(options.dataDir)||!options.provider)throw Error('local_resume_installation_incomplete');
   const backend=options.backend??createLocalFileBackend({directory:path.join(options.dataDir,'local-mcp-resume'),createOnCommit:true});
   const codec=options.codec??createWindowsProtection({authorized:options.authorizedOS===true}),existing=options.identity?null:await backend.peekOwner(),installationId=existing?.installationId??randomUUID();
   const sid=options.identity?null:codec.currentSid();
   const identity=options.identity??createLocalIdentity({readSid:()=>sid,readInstallationId:async()=>installationId,readRegisteredOwner:async sid=>{if(typeof options.readOwnerBinding!=='function')throw Error('registered_owner_binding_required');return hash(JSON.stringify({sid,registeredOwner:await options.readOwnerBinding()}))}});
   try{const app=await createLocalMcpComposition({enabled:true,identity,codec,backend,provider:options.provider,testOnly:options.testOnly===true,storagePaths:{server:path.join(options.dataDir,'local-mcp-resume/state.dpapi'),client:path.join(options.dataDir,'local-mcp-client-state/state.dpapi')},secret:options.secret,reserved:typeof options.reserved==='function'?await options.reserved():options.reserved,now:options.now});if(closed){await app.dispose();throw Error('installation_closed')}service=app;return app}catch(e){await backend.close?.();throw e}})();
  return opening;
 };
 return{status:()=>({enabled:options.enabled===true&&!closed,loaded:!!service}),get,
  ownerBroker:context=>createLocalMcpHttp({service:get,...context}),
  async revokeOwner(requestId,check){const app=await get();if(app)await app.revoke({connectionId:'all',requestId},check)},
  async dispose(){closed=true;await opening?.catch(()=>{});await service?.dispose()}
 };
}
