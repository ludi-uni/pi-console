import {timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {readOnlyMcpNativeDenialReasons} from './readonly-mcp.ts';
import {ResultsReadService} from './results-read.ts';
import {createResultsReadTools} from './results-read-tools.ts';
import type {ResultTarget} from '../shared/results-read.ts';
const protocol='2026-07-28',header='x-pi-console-dots-read-key';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Explicit opt-in authenticated adapter + fixed native guard for /mcp/dots.
 * Not mounted by server/index, never handles /mcp/readonly or owner/control APIs.
 * No proxy/Host/Origin exception and no automatic grant/key/config loading. */
export function createFinalAnswerMcp(service:ResultsReadService,options:{enabled?:boolean;authentication?:{mode:'shared_secret';key:string};catalogTarget?:()=>Promise<ResultTarget|null>}={}){
  const enabled=options.enabled===true;
  if(enabled&&(!options.authentication||options.authentication.mode!=='shared_secret'||!/^[a-f0-9]{64}$/.test(options.authentication.key)))throw Error('dedicated_read_authentication_required');
  if(enabled&&!service.protectsKnownSecret(options.authentication!.key))throw Error('read_auth_secret_protection_required');
  const expected=options.authentication?Buffer.from(options.authentication.key,'hex'):Buffer.alloc(32),tools=createResultsReadTools(service,{enabled});let disposed=false,inFlight=0;
  return {dispose(){disposed=true;expected.fill(0);},async handle(req:IncomingMessage,res:ServerResponse){
    const metadata=['/.well-known/oauth-protected-resource/mcp/dots','/.well-known/oauth-protected-resource'].includes(req.url??'');
    if(req.url!=='/mcp/dots'&&!metadata)return false;
    const send=(status:number,value?:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(value===undefined?'':JSON.stringify(value));};
    if(!enabled||disposed){send(404);return true;}
    if(readOnlyMcpNativeDenialReasons(req).length||req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()==='host').length!==1){send(403,{error:'native_boundary_rejected'});return true;}
    const value=req.headers[header],valid=typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),candidate=valid?Buffer.from(value,'hex'):Buffer.alloc(32);
    const authenticated=timingSafeEqual(candidate,expected)&&req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()===header).length===1&&valid;candidate.fill(0);
    if(!authenticated){send(401,{error:'authentication_required'});return true;}
    if(metadata){send(req.method==='GET'?404:405);return true;}if(req.method==='GET'){res.setHeader('allow','POST');send(405);return true;}
    if(req.method!=='POST'){send(405);return true;}if(inFlight>=4){send(429);return true;}inFlight++;
    let id:string|number|null=null;
    const error=(status:number,code:number,message:string,data?:unknown)=>send(status,{jsonrpc:'2.0',id,error:{code,message,...(data?{data}:{})}});
    try{
      const parts:Buffer[]=[];let size=0;const timer=setTimeout(()=>req.destroy(),5000);timer.unref();
      try{for await(const p of req.iterator({destroyOnReturn:false})){const b=Buffer.from(p);size+=b.length;if(size>32768){req.resume();error(413,-32600,'body_limit');return true;}parts.push(b);}}finally{clearTimeout(timer);}
      if(!size){error(400,-32600,'non_rpc_no_body');return true;}
      let m;try{m=JSON.parse(Buffer.concat(parts).toString());}catch{error(400,-32700,'invalid_json');return true;}
      if(!object(m)||m.jsonrpc!=='2.0'||!object(m.params)||!['string','number'].includes(typeof m.id)||typeof m.id==='string'&&m.id.length>128||typeof m.id==='number'&&!Number.isSafeInteger(m.id)||Object.keys(m).some(k=>!['jsonrpc','id','method','params'].includes(k))){error(400,-32600,'invalid_rpc');return true;}id=m.id;
      const meta=m.params._meta,v=meta?.['io.modelcontextprotocol/protocolVersion'];
      if(!object(meta)||!object(meta['io.modelcontextprotocol/clientCapabilities'])){error(400,-32602,'metadata_required');return true;}
      const count=(name:string)=>req.rawHeaders.filter((x,i)=>i%2===0&&x.toLowerCase()===name).length;
      if(count('mcp-protocol-version')!==1||count('mcp-method')!==1||req.headers['mcp-protocol-version']!==v||req.headers['mcp-method']!==m.method){error(400,-32020,'header_mismatch');return true;}
      if(v!==protocol){error(400,-32022,'unsupported_protocol',{supported:[protocol],requested:typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:'unknown'});return true;}
      if(req.headers['content-type']?.split(';')[0]!=='application/json'){error(415,-32600,'content_type');return true;}
      const accept=String(req.headers.accept??'').split(',').map(s=>s.trim().split(';')[0]);if(!accept.includes('application/json')||!accept.includes('text/event-stream')){send(406);return true;}
      let result:Record<string,any>;
      if(['server/discover','tools/list'].includes(m.method)){
        if(Object.keys(m.params).some(k=>k!=='_meta')){error(400,-32602,'invalid_params');return true;}
        result=m.method==='server/discover'?{supportedVersions:[protocol],capabilities:{tools:{}},ttlMs:0,cacheScope:'private'}:{tools:tools.list().filter(t=>t.name==='read_final_answer'),ttlMs:0,cacheScope:'private'};
        if(m.method==='tools/list'&&options.catalogTarget){const target=await options.catalogTarget();if(target)for(const t of result.tools)for(const [k,v] of Object.entries(target))t.inputSchema.properties[k]={...t.inputSchema.properties[k],const:v};}
      }else if(m.method==='tools/call'){
        if(count('mcp-name')!==1||req.headers['mcp-name']!==m.params.name){error(400,-32020,'name_mismatch');return true;}
        if(m.params.name!=='read_final_answer'||Object.keys(m.params).some(k=>!['_meta','name','arguments'].includes(k))){error(404,-32601,'read_final_answer_only');return true;}
        result=await tools.call(m.params.name,m.params.arguments);
      }else{error(404,-32601,'method_not_supported');return true;}
      result.resultType='complete';result._meta={'io.modelcontextprotocol/serverInfo':{name:'pi-console-final-answer-read',version:'1'}};send(200,{jsonrpc:'2.0',id,result});return true;
    }catch{error(400,-32602,'read_unavailable');return true;}finally{inFlight--;}
  }};
}
