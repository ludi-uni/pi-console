import {request} from 'node:http';
import {renewalError,serverRenewalReasons} from '../server/local-mcp-diagnostic.mjs';
const serverReasons=new Set(serverRenewalReasons);
// Only parsed bounded JSON can supply a server classification; never exception fields.
function rejectionReason(data){
 try{const v=JSON.parse(data),d=v?.renewalDiagnostic;
  if(v&&Object.keys(v).sort().join()==='error,renewalDiagnostic'&&v.error==='local_resume_request_rejected'&&d&&Object.keys(d).sort().join()==='reason,version'&&d.version===1&&serverReasons.has(d.reason))return d.reason;
 }catch{}return 'HTTP_REJECTED';
}
/** Production defaults are unchanged; injection is for no-network dummy tests. */
export function createPrivateResumePost({request:send=request,setTimeout:later=setTimeout,clearTimeout:cancel=clearTimeout}={}){
 return function privateResumePost(origin,route,body,token){
  const u=new URL(origin);
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/'||!['request','claim','resume','renew','rpc','cancel-request'].includes(route))throw Error('resume_endpoint_rejected');
  const error=reason=>route==='renew'?renewalError(reason):Error('resume_request_unavailable');
  return new Promise((resolve,reject)=>{
   let timedOut=false,oversized=false;
   const r=send(new URL('/local-owner/resume/'+route,u),{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}},res=>{
    let data='',size=0;
    res.on('data',b=>{size+=b.length;if(size>65536){oversized=true;r.destroy()}else data+=b});
    res.on('end',()=>{if(res.statusCode!==200){reject(error(oversized?'INVALID_REPLY':rejectionReason(data)));return}try{resolve(JSON.parse(data))}catch{reject(error('INVALID_REPLY'))}});
    res.on('error',()=>reject(error(oversized?'INVALID_REPLY':timedOut?'TRANSPORT_TIMEOUT':'IO_FAILURE')));
   });
   const timer=later(()=>{timedOut=true;r.destroy(Error('resume_timeout'))},12000);
   r.on('close',()=>cancel(timer));r.on('error',()=>reject(error(oversized?'INVALID_REPLY':timedOut?'TRANSPORT_TIMEOUT':'IO_FAILURE')));r.end(JSON.stringify(body));
  });
 };
}
export const privateResumePost=createPrivateResumePost();
