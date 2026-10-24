import type {IncomingMessage,ServerResponse} from 'node:http';
import {PermissionFault,strictPermissionObject} from './workspace-permissions.ts';
import {readJsonBody} from './body.ts';
import type {PiControlActivation} from './pi-control-activation.ts';
export async function piControlOwnerAction(app:PiControlActivation,route:string,body:any,actor:string,owner:()=>void){owner();let result:any;
 if(route==='status'){strictPermissionObject(body,[]);result=await app.view()}
 else if(route==='prepare')result=await app.prepare(body,actor,owner);
 else if(route==='preparation-result')result=await app.preparationResult(body,actor,owner);
 else if(route==='review')result=await app.review(body,actor,owner);
 else if(route==='approve')result=await app.approve(body,actor,owner);
 else if(route==='cancel')result=await app.cancel(body,actor,owner);
 else if(route==='revoke')result=await app.revoke(body,actor,owner);
 else if(route==='result'){strictPermissionObject(body,['requestId']);result=await app.result(body.requestId)}
 else throw new PermissionFault('pi_owner_route_unavailable');owner();return result;
}
export function piControlHttp(app:PiControlActivation,verify:(r:IncomingMessage)=>boolean){return async(req:IncomingMessage,res:ServerResponse)=>{
 const url=req.url??'',prefix='/local-owner/pi-control/';if(!url.startsWith(prefix))return false;
 const send=(code:number,value:any)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value))};
 try{const count=(name:string)=>req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()===name).length;
  if(req.method!=='POST'||url.includes('?')||req.socket.localAddress!=='127.0.0.1'||req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==`127.0.0.1:${req.socket.localPort}`||req.headers['content-type']!=='application/json'||['host','content-type'].some(k=>count(k)!==1)||Object.keys(req.headers).some(k=>k==='forwarded'||k==='via'||k==='x-real-ip'||k.startsWith('cf-')||k.startsWith('x-forwarded-')))throw new PermissionFault('pi_local_boundary_rejected');
  const route=url.slice(prefix.length),client=['request','claim','rpc'].includes(route);if(client?(!!req.headers.origin||!!req.headers.cookie||!!req.headers['sec-fetch-site']):!verify(req)||count('x-pi-console-admin')!==1||req.headers['x-pi-console-admin']!=='1')throw new PermissionFault('pi_owner_or_client_rejected');
  const body=await readJsonBody(req,65536);let value:any;
  if(route==='request')value=app.request(body);else if(route==='claim')value=await app.claim(body);
  else if(route==='rpc'){strictPermissionObject(body,['name','arguments']);if(count('authorization')!==1||!/^Bearer [a-f0-9]{64}$/.test(String(req.headers.authorization)))throw new PermissionFault('pi_control_unavailable');value=await app.rpc(String(req.headers.authorization).slice(7),body.name,body.arguments)}
  else value=await piControlOwnerAction(app,route,body,'local-owner',()=>{if(!verify(req))throw new PermissionFault('owner_session_expired')});send(200,value);
 }catch(e){req.resume();send(409,{error:e instanceof PermissionFault?e.code:'pi_control_request_unavailable'})}return true;
}}
