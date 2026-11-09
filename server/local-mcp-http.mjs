import {readJsonBody}from'./body.ts';
import {renewalReason,serverRenewalReasons}from'./local-mcp-diagnostic.mjs';
const renewalServerReasons=new Set(serverRenewalReasons);
const ownerRoutes=new Set(['view','review','approve','cancel','result','revoke','recover']);
const clientRoutes=new Set(['request','claim','resume','renew','rpc','cancel-request']);
/** Only wired into the existing separate literal-127 owner broker. Never public listener. */
export function createLocalMcpHttp({service,ownerVerify,ownerExpiry,port}){
 return async(req,res)=>{
  if(!req.url?.startsWith('/local-owner/resume/'))return false;
  const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value))};
  const route=req.url.slice('/local-owner/resume/'.length),single=n=>req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()===n).length===1;
  const native=req.method==='POST'&&req.socket.localAddress==='127.0.0.1'&&req.socket.remoteAddress==='127.0.0.1'&&req.socket.localPort===port()&&single('host')&&req.headers.host===`127.0.0.1:${port()}`&&single('content-type')&&req.headers['content-type']==='application/json'&&!Object.keys(req.headers).some(k=>k.startsWith('cf-')||k.startsWith('x-forwarded-')||['forwarded','via','x-real-ip'].includes(k));
  const owner=ownerRoutes.has(route),client=clientRoutes.has(route);
  if(!native||!owner&&!client||owner&&(!single('origin')||req.headers.origin!==`http://127.0.0.1:${port()}`||!single('sec-fetch-site')||req.headers['sec-fetch-site']!=='same-origin')||client&&(req.headers.origin||req.headers.cookie||Object.keys(req.headers).some(k=>k.startsWith('sec-fetch-')))){send(403,{error:'local_resume_boundary_rejected'});return true}
  const check=()=>{if(!ownerVerify(req))throw Error('owner_unverified')};
  try{
   if(owner)check();const app=await service();if(!app?.status().enabled){send(503,{error:'local_resume_disabled'});return true}
   const b=await readJsonBody(req,8192);let result;
   if(route==='view'){if(Object.keys(b).length)throw Error();result=app.view()}
   else if(route==='request')result=app.request(b);
   else if(route==='claim')result=await app.claim(b);
   else if(route==='cancel-request')result=await app.cancelPending(b);
   else if(route==='resume')result=await app.resume(b);
   else if(route==='renew')result=await app.renew(b);
   else if(route==='review')result=await app.review(b,check);
   else if(route==='approve')result=await app.approve(b,check,ownerExpiry(req));
   else if(route==='cancel'){if(Object.keys(b).join()!=='reviewId')throw Error();result=await app.cancel(b.reviewId,check)}
   else if(route==='result'){if(Object.keys(b).join()!=='requestId')throw Error();result=await app.result(b.requestId,check)}
   else if(route==='recover'){if(Object.keys(b).sort().join()!=='requestId,reviewId')throw Error();result=await app.recover(b,check)}
   else if(route==='revoke')result=await app.revoke(b,check);
   else if(route==='rpc'){if(!single('authorization')||!/^Bearer [0-9a-f]{64}$/.test(req.headers.authorization??'')||Object.keys(b).sort().join()!=='args,name')throw Error();result=await app.call(req.headers.authorization.slice(7),b.name,b.args)}
   if(owner)check();send(200,result);
   }catch(error){const reason=route==='renew'?renewalReason(error):null;send(403,{error:'local_resume_request_rejected',...(renewalServerReasons.has(reason)?{renewalDiagnostic:{version:1,reason}}:{})})}return true;
 }
}
