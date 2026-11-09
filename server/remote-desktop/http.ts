import type {IncomingMessage,ServerResponse} from 'node:http';
import {readJsonBody} from '../body.ts';
const proxy=(req:IncomingMessage)=>Object.keys(req.headers).some(k=>k==='forwarded'||k==='via'||k.startsWith('cf-')||k.startsWith('x-forwarded-'));
const send=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
export function createRemoteManagement({origin,store,broker,channel,target,artifacts,authorize}:{origin:string;store:any;broker:any;channel:any;target?:any;artifacts?:any;authorize?:(request:IncomingMessage)=>boolean}){
 return async(req:IncomingMessage,res:ServerResponse)=>{
  const url=new URL(req.url??'/','http://localhost'),prefix='/api/remote-connections';
  if(!url.pathname.startsWith(prefix))return false;
  const local=authorize?authorize(req):req.socket.remoteAddress==='127.0.0.1'&&req.headers.host===new URL(origin).host&&!proxy(req);
  if(!local){send(res,403,{error:'remote_local_operator_required'});return true;}
  if(req.method==='GET'&&url.pathname===prefix){
   // An untrusted (legacy plaintext) manifest must not take the whole snapshot
   // down: the panel reports the state and offers the explicit recover step.
   let artifactList:unknown[]=[],artifactError:string|null=null;
   try{artifactList=(await artifacts?.list?.()??[]) as unknown[];}catch(e){artifactError=e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'artifact_denied';}
   let stagedList:unknown[]=[];
   try{stagedList=(await artifacts?.staged?.()??[]) as unknown[];}catch{}
   send(res,200,{connection:await store.view(),pendingApproval:broker.pendingApproval?.()??null,approvedTarget:(await target?.status?.()??null),artifacts:artifactList,artifactError,staged:stagedList,config:{perRequestApproval:broker.perRequestApproval?.()!==false}});return true;}
  if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-pi-remote-admin']!=='1'||req.headers['content-type']!=='application/json'){send(res,403,{error:'remote_local_operator_required'});return true;}
  const route=url.pathname.slice(prefix.length+1);
  // This HTTP listener categorically never accepts a Worker credential.
  if(!['configure','pin','enabled','delete','test','credential-channel','approval','grants','target','artifacts','artifacts-upload'].includes(route)){send(res,404,{error:'not_found'});return true;}
  try{
   // The upload route carries base64-encoded file bytes, so it gets its own
   // bounded body (~22 MiB for a 16 MiB file plus envelope). Every other
   // management route stays at 16 KiB.
   const b=await readJsonBody(req,route==='artifacts-upload'?24*1024*1024:16384);
   if(route==='configure'){await store.configure(b);send(res,200,{connection:await store.view()});}
   else if(route==='pin'){if(b.confirmed!==true||Object.keys(b).some(k=>!['connection','role','pinSha256','confirmed'].includes(k)))throw Error('remote_pin_confirmation_required');await store.approvePin(b.connection,b.role,b.pinSha256);send(res,200,{connection:await store.view()});}
   else if(route==='enabled'){if(Object.keys(b).sort().join(',')!=='connection,enabled')throw Error('invalid_arguments');await store.setEnabled(b.connection,b.enabled);send(res,200,{connection:await store.view()});}
   else if(route==='grants'){const keys=Object.keys(b).sort();if(keys.join(',')!=='connection,grants'||b.connection!=='caivi-vm'||!b.grants||typeof b.grants!=='object'||Array.isArray(b.grants)||Object.keys(b.grants).some(k=>!['read','operate','send'].includes(k))||Object.values(b.grants).some(v=>typeof v!=='boolean'))throw Error('remote_grants_invalid');await store.setGrants(b.connection,b.grants);send(res,200,{connection:await store.view()});}
   else if(route==='delete'){if(b.confirmed!==true||Object.keys(b).sort().join(',')!=='confirmed,connection')throw Error('operator_confirmation_required');await store.remove(b.connection);send(res,200,{connection:await store.view()});}
   else if(route==='credential-channel'){if(Object.keys(b).length)throw Error('invalid_arguments');send(res,200,await channel.open());}
   else if(route==='approval'){if(Object.keys(b).sort().join(',')!=='approvalId,approved,connection'||b.connection!=='caivi-vm'||typeof b.approvalId!=='string'||typeof b.approved!=='boolean')throw Error('invalid_arguments');send(res,200,{resolved:broker.resolveApproval(b.approvalId,b.approved)===true});}
   else if(route==='target'){if(!target)throw Error('remote_management_refused');if(b.action==='clear'){if(Object.keys(b).sort().join(',')!=='action,confirmed,connection'||b.connection!=='caivi-vm'||b.confirmed!==true)throw Error('operator_confirmation_required');await target.clear();}else{if(b.action!=='probe'||Object.keys(b).sort().join(',')!=='action,connection'||b.connection!=='caivi-vm')throw Error('invalid_arguments');await target.probe();}send(res,200,{approvedTarget:await target.status(),connection:await store.view()});}
   else if(route==='artifacts-upload'){if(!artifacts)throw Error('remote_management_refused');if(Object.keys(b).sort().join(',')!=='connection,dataBase64,name'||b.connection!=='caivi-vm'||typeof b.name!=='string'||typeof b.dataBase64!=='string')throw Error('invalid_arguments');const staged=await artifacts.stageUpload(b.name,b.dataBase64);send(res,200,{staged,artifact:{name:staged.name,size:staged.size,sha256:staged.sha256},connection:await store.view()});}
   else if(route==='artifacts'){if(!artifacts)throw Error('remote_management_refused');const keys=Object.keys(b).sort();if(b.action==='register'){if(keys.join(',')!=='action,connection,name'||b.connection!=='caivi-vm'||typeof b.name!=='string')throw Error('invalid_arguments');await artifacts.register(b.name);send(res,200,{artifacts:await artifacts.list(),staged:await artifacts.staged(),connection:await store.view()});}else if(b.action==='unregister'){if(keys.join(',')!=='action,confirmed,connection,name'||b.connection!=='caivi-vm'||b.confirmed!==true||typeof b.name!=='string')throw Error('operator_confirmation_required');await artifacts.unregister(b.name);send(res,200,{artifacts:await artifacts.list(),connection:await store.view()});}else if(b.action==='unstage'){if(keys.join(',')!=='action,confirmed,connection,name'||b.connection!=='caivi-vm'||b.confirmed!==true||typeof b.name!=='string')throw Error('operator_confirmation_required');send(res,200,{staged:await artifacts.unstage(b.name),connection:await store.view()});}else if(b.action==='recover'){if(keys.join(',')!=='action,confirmed,connection'||b.connection!=='caivi-vm'||b.confirmed!==true)throw Error('operator_confirmation_required');send(res,200,{recovered:await artifacts.recover(true),artifacts:await artifacts.list(),staged:await artifacts.staged(),connection:await store.view()});}else throw Error('invalid_arguments');}
   else {if(Object.keys(b).sort().join(',')!=='connection'||b.connection!=='caivi-vm')throw Error('invalid_arguments');const result=await broker.invoke({connection:b.connection,operation:'inspect'});send(res,200,{gui:{ok:result.ok,error:result.error??null,outcome:result.outcome},transfer:{state:'UNTESTED',reason:'no_readonly_authenticated_probe_in_existing_protocol'},connection:await store.view()});}
  }catch(e){const code=e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'remote_management_refused';send(res,409,{error:code});}
  return true;
 };
}
