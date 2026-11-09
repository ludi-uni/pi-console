import {appendFile, mkdir, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createWindowsProtection} from '../local-mcp-windows.mjs';
import {RemoteDesktopStore} from './store.ts';
import {RemoteDesktopBroker} from './broker.ts';
import {remoteTransport} from './transport.ts';
import {ensureRemotePrivateDirectory} from './private-directory.ts';
import {createRemoteCredentialChannel} from './credential-channel.ts';
import {createRemoteManagement} from './http.ts';
import {createRemoteArtifactRegistry, createRemoteTargetRegistry} from './artifacts.ts';
import type {IncomingMessage} from 'node:http';
/** No network/secret reads at boot. Existing Worker protocol and per-role identity remain intact. */
export async function createRemoteDesktop({dataDir,port,onEnabled,origin,authorize,transport:transportOverride}:{dataDir:string;port:number;onEnabled:(invoke:((r:any)=>Promise<unknown>)|undefined)=>void;origin?:string;authorize?:(request:IncomingMessage)=>boolean;transport?:any}){
 const directory=join(resolve(dataDir),'remote-desktop');
 const codec=createWindowsProtection({authorized:true});
 const store=new RemoteDesktopStore({file:join(directory,'connections.json'),codec,ensurePrivateDirectory:ensureRemotePrivateDirectory});
 await store.load();
 const transport=transportOverride??remoteTransport;
 const target=createRemoteTargetRegistry({store,transport,file:join(directory,'approved-target.json')});
 const artifacts=createRemoteArtifactRegistry(directory,codec);
 const auditWrites:Promise<unknown>[]=[];const lastChecks:Record<string,{at:string;outcome:string}>={};
 try{const lines=(await readFile(join(directory,'audit.jsonl'),'utf8')).trim().split('\n').slice(-200);for(const line of lines){const e=JSON.parse(line);if(['gui','transfer'].includes(e.role)&&typeof e.timestamp==='string')lastChecks[e.role]={at:e.timestamp,outcome:e.outcome};}}catch{}
 // Artifacts resolve live from the sealed manifest on every send: registration,
 // unregistration and recovery take effect without a Console restart, and a legacy
 // plaintext manifest fails closed until the operator explicitly recovers it.
 try{await mkdir(join(directory,'approved-artifacts','staging'),{recursive:true});}catch{}
 const broker=new RemoteDesktopBroker({store,transport,trustedArtifacts:()=>artifacts.trusted(),artifactRevision:()=>artifacts.revision(),targetRevision:()=>target.revision(),expectedTarget:(result:any)=>target.matches(result),audit:event=>{lastChecks[event.role]={at:event.timestamp,outcome:event.outcome};const p=appendFile(join(directory,'audit.jsonl'),JSON.stringify(event)+'\n',{mode:0o600}).catch(()=>{});auditWrites.push(p);if(auditWrites.length>100)auditWrites.splice(0,50);}});
 const invoke=(r:any,assertAuthority?:()=>void)=>broker.invoke(r,assertAuthority);
 const channel=createRemoteCredentialChannel({directory,setToken:(name,role,token)=>store.setToken(name,role,token)});
 const publicStore={view:async()=>({...await store.view(),lastChecks}),configure:async(b:any)=>{const v=await store.configure(b);onEnabled(undefined);return v;},approvePin:(...a:any[])=>store.approvePin(a[0],a[1],a[2]),setEnabled:async(name:string,enabled:boolean)=>{const v=await store.setEnabled(name,enabled);onEnabled(enabled?invoke:undefined);return v;},setGrants:(name:string,grants:any)=>store.setGrants(name,grants),remove:async(name:string)=>{const v=await store.remove(name);onEnabled(undefined);return v;}};
 const handle=createRemoteManagement({origin:origin??'http://127.0.0.1:'+port,store:publicStore,broker,channel,target,artifacts,authorize});
 if((await store.current()).enabled)onEnabled(invoke);
 return{store,broker,handle,channel,target,artifacts,async close(){await channel.close();await Promise.all(auditWrites);}};
}
