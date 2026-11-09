import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
/** Console injects an in-process, request-only IPC function. No credentials or management API. */
export default async function remoteDesktop(pi){
 const invoke=globalThis[Symbol.for('pi-console.remote-desktop.invoke')];
 if(typeof invoke!=='function')return;
 const root=process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT;
 const require=createRequire(root+'/package.json');const {Type}=await import(pathToFileURL(require.resolve('typebox')).href);
 const descriptions={
  inspect:'Read the operator-approved caivi-vm CAIVI window state (UIA tree). Requires the read grant. No host fallback; no automatic retry.',
  screenshot:'Capture one PNG screenshot of the operator-approved caivi-vm CAIVI window. Requires the read grant. No host fallback; no automatic retry.',
  file_send:'Send one operator-registered artifact to the caivi-vm guest inbox. Requires the send grant; artifact_name must be registered in Settings. May be limited by the guest one-shot journal.',
  caivi_click:'Run the single fixed guest-configured click operation on caivi-vm. Requires the operate grant (plus read). The host cannot choose click position; the guest may refuse repeats via its one-shot journal. No automatic retry.',
  caivi_input:'Run the single fixed guest-configured text-input operation on caivi-vm. Requires the operate grant (plus read). The host cannot choose the typed text; the guest may refuse repeats via its one-shot journal. No automatic retry.',
  caivi_drag:'Run the single fixed guest-configured drag operation on caivi-vm. Requires the operate grant (plus read). The host cannot choose drag coordinates; the guest may refuse repeats via its one-shot journal. No automatic retry.',
 };
 const names={remote_gui_inspect:'inspect',remote_gui_screenshot:'screenshot',remote_file_send:'file_send',remote_caivi_click:'caivi_click',remote_caivi_input:'caivi_input',remote_caivi_drag:'caivi_drag'};
 pi.on('session_start',()=>{
  if(Object.keys(names).some(name=>pi.getAllTools().some(t=>t.name===name)))throw Error('remote_tool_name_conflict');
 for(const [name,operation]of Object.entries(names)){
  pi.registerTool({name,label:name,description:descriptions[operation],parameters:Type.Object({connection:Type.Literal('caivi-vm'),...(operation==='file_send'?{artifact_name:Type.String({pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'})}:{})},{additionalProperties:false}),executionMode:'sequential',execute:async(_id,args,signal)=>{
   try{const r=await invoke({connection:args.connection,operation,...(operation==='file_send'?{artifact_name:args.artifact_name}:{})},signal);
    if(!r.ok)return{isError:true,content:[{type:'text',text:JSON.stringify(r)}]};
    if(operation==='screenshot')return{content:[{type:'image',mimeType:'image/png',data:r.result.png_base64}],details:{outcome:r.outcome}};
    return{content:[{type:'text',text:JSON.stringify(r.result)}],details:{outcome:r.outcome}};
   }catch{return{isError:true,content:[{type:'text',text:'{"error":"remote_broker_unavailable","outcome":"UNKNOWN_NO_RETRY","hostFallback":false}'}]}}
  }});
 }
 globalThis[Symbol.for('pi-console.remote-desktop.registered')]=true;
 });
}
