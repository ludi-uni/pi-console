import {createHmac,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {readJsonBody} from './body.ts';
const hex=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
type Identity={pid:number;startedAt:string;nonce:string;port:number};
/** Transport start only. No owner session, bootstrap, grant store or credential issuer dependency. */
export function createManagedResumeOpen(options:{enabled:()=>boolean;token:string|undefined;identity:()=>Identity;open:()=>Promise<void>;status:()=>{listening:boolean;port:number|null};now?:()=>number}){
 const now=options.now??Date.now;let closed=false,opening:Promise<void>|undefined;
 const receipts=new Map<string,{binding:string;until:number;result:Promise<{port:number}|null>}>();
 const open=async()=>{if(!opening)opening=Promise.resolve().then(async()=>{if(closed||!options.enabled())throw Error();if(!options.status().listening)await options.open()}).finally(()=>{opening=undefined});await opening};
 const handler=async(req:IncomingMessage,res:ServerResponse)=>{
  if(req.url!=='/api/manage/local-resume/open')return false;
  const send=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value))};
  try{
   const id=options.identity(),count=(name:string)=>req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()===name).length;
   if(closed||!options.enabled()||!/^[0-9a-f]{48}$/.test(options.token??'')||req.method!=='POST'||req.socket.localAddress!=='127.0.0.1'||req.socket.remoteAddress!=='127.0.0.1'||req.socket.localPort!==id.port||req.headers.host!==`127.0.0.1:${id.port}`||req.headers['content-type']!=='application/json'||['host','content-type','x-pi-console-manage-proof'].some(n=>count(n)!==1)||Object.keys(req.headers).some(k=>k==='cookie'||k==='origin'||k.startsWith('sec-fetch-')||k.startsWith('cf-')||k.startsWith('x-forwarded-')||['forwarded','via','x-real-ip'].includes(k)))throw Error();
   const b=await readJsonBody(req,4096);if(!b||Object.keys(b).sort().join()!=='challenge,pid,requestId,startedAt'||!uuid(b.requestId)||b.challenge!==id.nonce||b.pid!==id.pid||b.startedAt!==id.startedAt)throw Error();
   const binding=JSON.stringify([id.nonce,id.pid,id.startedAt,id.port,b.requestId]),expected=createHmac('sha256',options.token!).update('pi-console-resume-open:'+binding).digest(),candidate=hex(req.headers['x-pi-console-manage-proof'])?Buffer.from(req.headers['x-pi-console-manage-proof'],'hex'):Buffer.alloc(32),valid=timingSafeEqual(expected,candidate);expected.fill(0);candidate.fill(0);if(!valid)throw Error();
   let receipt=receipts.get(b.requestId);if(receipt&&receipt.binding!==binding)throw Error();if(!receipt){if(receipts.size>=64){send(409,{error:'managed_resume_open_unavailable'});return true}const until=now()+120000,result=(async()=>{await open();const s=options.status();return !closed&&s.listening&&Number.isInteger(s.port)&&s.port!==null&&s.port>0&&s.port<=65535&&s.port!==id.port?{port:s.port}:null})().catch(()=>null);receipt={binding,until,result};receipts.set(b.requestId,receipt)}
   const r=await receipt.result,s=options.status(),current=options.identity();if(closed||!options.enabled()||JSON.stringify(current)!==JSON.stringify(id)||receipt.until<=now()||!r||!s.listening||s.port!==r.port){send(409,{error:'managed_resume_open_unavailable'});return true}
   const signature=createHmac('sha256',options.token!).update('pi-console-resume-open-result:'+JSON.stringify([id.nonce,id.pid,id.startedAt,id.port,b.requestId,r.port])).digest('hex');
   send(200,{service:'pi-console',pid:id.pid,startedAt:id.startedAt,nonce:id.nonce,requestId:b.requestId,broker:{port:r.port,signature}});
  }catch{req.resume();send(403,{error:'managed_resume_open_rejected'})}return true;
 };
 return{handle:handler,dispose(){closed=true;receipts.clear()}};
}
