import type {IncomingMessage,ServerResponse} from 'node:http';
import {ExternalMcpGate,type McpAdmission} from './external-mcp-gate.ts';
import {permissionOwnerRequest} from './dots-permissions-api.ts';
import {readJsonBody} from './body.ts';
export const externalMcpPath=(path:string)=>path==='/mcp'||path.startsWith('/mcp/')||path==='/.well-known/oauth-protected-resource'||path.startsWith('/.well-known/oauth-protected-resource/');
type Handler=(req:IncomingMessage,res:ServerResponse)=>Promise<boolean>;
/** The normal-server mount: all current/legacy MCP paths must terminate here, never fall through.
 * Buffer bounded non-streaming responses and revalidate at byte release. This is an application
 * authorization fence, not a JS/OS sandbox. Existing adapter guards still run unchanged. */
export function createExternalMcpBoundary(gate:ExternalMcpGate,handler:Handler){
  const denied=(req:IncomingMessage,res:ServerResponse)=>{req.resume();for(const name of res.getHeaderNames())res.removeHeader(name);const status=gate.status();res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'external_mcp_disabled',reason:status.reason==='ready'?'authority_changed':status.reason}));};
  return {
    async handle(req:IncomingMessage,res:ServerResponse){
      const path=new URL(req.url??'/','http://localhost').pathname;if(!externalMcpPath(path))return false;
      let ticket:McpAdmission;try{ticket=await gate.admit();}catch{denied(req,res);return true;}
      let size=0,ended=false;const chunks:Buffer[]=[];let status=200;let headers:Record<string,any>={};
      const buffered:ServerResponse=new Proxy(res,{get(target,key){
        if(key==='writeHead')return (code:number,h?:unknown,h2?:unknown)=>{status=code;const v=typeof h==='string'?h2:h;if(v&&typeof v==='object'&&!Array.isArray(v))headers={...headers,...v};return buffered;};
        if(key==='flushHeaders')return ()=>{};
        if(key==='write')return (chunk:any,encoding?:any,callback?:any)=>{if(ended)throw Error('response_already_ended');const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding as BufferEncoding:undefined);size+=b.length;if(size>2*1024*1024)throw Error('mcp_response_limit');chunks.push(b);if(typeof encoding==='function')encoding();else if(typeof callback==='function')callback();return true;};
        if(key==='end')return (chunk?:any,encoding?:any,callback?:any)=>{if(ended)return buffered;if(chunk!==undefined)(buffered.write as any)(chunk,encoding);ended=true;try{gate.assert(ticket);res.writeHead(status,headers);res.end(Buffer.concat(chunks),typeof encoding==='function'?encoding:callback);}catch{denied(req,res);}return buffered;};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      try{if(!await handler(req,buffered)&&!ended){buffered.writeHead(404);buffered.end();}else if(!ended){buffered.writeHead(503);buffered.end();}}
      catch{if(!res.writableEnded)denied(req,res);}return true;
    },
    /** Mounted AFTER normal Host/Origin/Access gates; no new owner-auth exception. */
    async owner(req:IncomingMessage,res:ServerResponse){
      const url=new URL(req.url??'/','http://localhost');if(!url.pathname.startsWith('/api/external-mcp/'))return false;
      const send=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
      if(!permissionOwnerRequest(req)){send(403,{error:'local_owner_required'});return true;}
      try{
        if(url.search)throw Error();const b:any=await readJsonBody(req,2048);if(!b||typeof b!=='object'||Array.isArray(b))throw Error();
        const action=url.pathname.slice('/api/external-mcp/'.length),keys=action==='status'?[]:action==='enable'?['revision','confirmed']:['revision'];
        if(Object.keys(b).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(b,k))||action!=='status'&&!Number.isSafeInteger(b.revision))throw Error();
        if(action==='status'){send(200,gate.status());return true;}
        if(action==='enable'&&b.confirmed!==true)throw Error();
        const value=action==='enable'?await gate.update(b.revision,true):action==='recheck'?await gate.update(b.revision,false):action==='disable'?gate.disable(b.revision):null;
        if(!value)throw Error();send(200,value);
      }catch{send(409,{error:'external_mcp_operation_rejected',status:gate.status()});}return true;
    },
  };
}
