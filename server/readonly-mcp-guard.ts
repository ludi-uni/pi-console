import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadOnlyMcpAuthentication, readOnlyMcpAuthHeader, type ReadOnlyMcpAuthentication } from './readonly-mcp-auth.ts';
import { readOnlyMcpNativeDenialReasons, type NativeDenialReason } from './readonly-mcp.ts';

export const readOnlyMcpGuardTarget = Object.freeze({
  listenHost: '127.0.0.1', listenPort: 31718,
  upstreamUrl: 'http://127.0.0.1:31717/mcp/readonly',
  clientUrl: 'http://127.0.0.1:31718/mcp/readonly', channel: 'main',
});
const metadataPaths = ['/.well-known/oauth-protected-resource/mcp/readonly', '/.well-known/oauth-protected-resource'];
const methods = new Set(['initialize','ping','server/discover','tools/list','tools/call','notifications/initialized','notifications/cancelled']);
const tools = new Set(['get_status','list_sessions','get_progress']);
const fixedError = () => new Error('Read-only guard configuration was not accepted.');

/** Operator-only fixture configuration; no request field selects a URL or port.
 * The production entry uses only the frozen target above and accepts no args.
 */
export function createReadOnlyMcpGuard(configuration: {
  authentication: ReadOnlyMcpAuthentication;
  upstreamUrl: string;
  onNativeDenial?: (reasons: NativeDenialReason[]) => void;
}) {
  const target=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/mcp\/readonly$/.exec(configuration.upstreamUrl);
  if (!configuration.authentication || !target || Number(target[1])>65535) throw fixedError();
  const upstreamPort=Number(target[1]);
  const auth=createReadOnlyMcpAuthentication(configuration.authentication);
  const key=Buffer.from(configuration.authentication.key,'ascii');
  const denials=new Set<string>();let inFlight=0,disposed=false;
  const send=(res:ServerResponse,status:number,value?:unknown)=>{
    if(res.destroyed||res.writableEnded)return;
    // Discard unparsed rejected bytes so a keep-alive connection cannot carry
    // an unread request body into the next request. Nothing is retained/logged.
    res.req.resume();
    res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',connection:'close'});
    res.end(res.req.method==='HEAD'||value===undefined?undefined:JSON.stringify(value));
  };
  const deny=(res:ServerResponse,status:number,reasons:NativeDenialReason[])=>{
    const signature=reasons.join(',');
    if(!denials.has(signature)){denials.add(signature);try{configuration.onNativeDenial?.([...reasons]);}catch{/* Fixed diagnostics never control access. */}}
    res.setHeader('x-pi-console-mcp-denial',signature);
    send(res,status,{error:status===401?'MCP authentication required':'native loopback client required',denialReasons:reasons});
  };
  const handle=async(req:IncomingMessage,res:ServerResponse)=>{
    if(disposed){send(res,503,{error:'Read-only guard unavailable'});return;}
    const reasons=readOnlyMcpNativeDenialReasons(req);
    if(reasons.some(reason=>reason!=='proxy_header_present')){deny(res,403,reasons);return;}
    if(!auth.verify(req)){deny(res,401,['mcp_auth_failed']);return;}
    // Exact origin-form request targets only: no query, encoded/alternate path,
    // absolute URL, CONNECT, method override, or arbitrary forwarding route.
    const path=req.url??'';const metadata=metadataPaths.includes(path);
    if(path!=='/mcp/readonly'&&!metadata){send(res,404,{error:'Read-only guard route unavailable'});return;}
    if(req.method!==(metadata?'GET':'POST')){send(res,405,{error:'Read-only guard method unavailable'});return;}
    if(['x-http-method-override','x-method-override','x-original-url','x-rewrite-url','x-tunnel-channel','x-mcp-channel'].some(name=>Object.hasOwn(req.headers,name))){send(res,400,{error:'Read-only guard request rejected'});return;}
    if(inFlight>=8){send(res,429,{error:'Read-only guard busy'});return;}
    inFlight++;
    try {
      let body:Buffer|undefined;
      if(metadata) {
        if(req.headers['transfer-encoding']!==undefined||req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'){send(res,400,{error:'Read-only guard request rejected'});return;}
      } else {
        if(String(req.headers['content-type']??'').split(';')[0].trim()!=='application/json'){send(res,415,{error:'JSON required'});return;}
        const chunks:Buffer[]=[];let size=0;
        const timeout=setTimeout(()=>req.destroy(),5000);timeout.unref();
        try {
          for await(const part of req.iterator({destroyOnReturn:false})) {
            const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);size+=chunk.length;
            if(size>16*1024){send(res,413,{error:'Read-only guard request too large'});return;}
            chunks.push(chunk);
          }
        } finally {clearTimeout(timeout);}
        body=Buffer.concat(chunks);
        if(body.includes(key)){send(res,400,{error:'Read-only guard request rejected'});return;}
        let rpc:any;
        try{rpc=JSON.parse(body.toString('utf8'));}catch{send(res,400,{error:'Invalid JSON'});return;}
        if(!rpc||Array.isArray(rpc)||rpc.jsonrpc!=='2.0'||!methods.has(rpc.method)||rpc.method==='tools/call'&&!tools.has(rpc.params?.name)){
          // Match existing readonly tool error semantics without forwarding a
          // forbidden operation. Only a bounded ordinary RPC id is echoed.
          const id=typeof rpc?.id==='number'&&Number.isSafeInteger(rpc.id)||typeof rpc?.id==='string'&&rpc.id.length<=128?rpc.id:null;
          send(res,400,{jsonrpc:'2.0',id,error:{code:-32602,message:'Read-only guard request rejected'}});return;
        }
      }
      const headers:Record<string,string>={accept:String(req.headers.accept??'application/json, text/event-stream'),[readOnlyMcpAuthHeader]:key.toString('ascii')};
      if(body)headers['content-type']='application/json';
      for(const name of ['mcp-protocol-version','mcp-method','mcp-name'])if(typeof req.headers[name]==='string')headers[name]=req.headers[name];
      // Node http.request neither follows redirects nor consults proxy env.
      // Host, key and target are regenerated; caller routing/auth headers are
      // never copied. Never relay Location/Refresh/WWW-Authenticate/cookies.
      await new Promise<void>(resolve=>{
        const upstreamRequest=request({hostname:'127.0.0.1',port:upstreamPort,path,method:req.method,headers,agent:false},reply=>{
          const status=reply.statusCode??502;
          if(status>=300&&status<=399){reply.destroy();send(res,502,{error:'Read-only guard blocked upstream redirect'});resolve();return;}
          if(metadata){reply.destroy();send(res,status===404?404:502,{error:status===404?'not found':'Read-only guard metadata unavailable'});resolve();return;}
          const parts:Buffer[]=[];let bytes=0;
          reply.on('data',(part:Buffer)=>{
            bytes+=part.length;if(bytes>2*1024*1024){reply.destroy();send(res,502,{error:'Read-only guard response rejected'});resolve();return;}parts.push(part);
          });
          reply.on('end',()=>{
            const result=Buffer.concat(parts);
            if(result.includes(key)){send(res,502,{error:'Read-only guard response rejected'});resolve();return;}
            if(status===202&&result.length===0){send(res,202);resolve();return;}
            try{
              const value=JSON.parse(result.toString('utf8'));
              if(JSON.stringify(value).includes(key.toString('ascii')))send(res,502,{error:'Read-only guard response rejected'});
              else send(res,status,value);
            }catch{send(res,502,{error:'Read-only guard response rejected'});}resolve();
          });
          reply.on('error',()=>{send(res,502,{error:'Read-only guard upstream unavailable'});resolve();});
        });
        upstreamRequest.setTimeout(5000,()=>upstreamRequest.destroy());
        upstreamRequest.on('error',()=>{send(res,502,{error:'Read-only guard upstream unavailable'});resolve();});
        res.once('close',()=>{if(!res.writableEnded)upstreamRequest.destroy();});
        upstreamRequest.end(body);
      });
    } catch {send(res,400,{error:'Read-only guard request rejected'});} finally {inFlight--;}
  };
  return {handle,dispose(){disposed=true;auth.dispose();key.fill(0);}};
}
