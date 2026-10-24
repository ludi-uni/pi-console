import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { createReadOnlyMcpGuard } from '../server/readonly-mcp-guard.ts';
import { readOnlyMcpAuthHeader } from '../server/readonly-mcp-auth.ts';

const dummy='a7'.repeat(32);
const metadata=['/.well-known/oauth-protected-resource/mcp/readonly','/.well-known/oauth-protected-resource'];
const rpc={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_status',arguments:{}}};
async function listen(server:Server){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return(server.address() as {port:number}).port;}
async function fixture(){
  let upstreamRequests=0,captureRequests=0,status=200,responseSecret=false,location='/capture',routingHeadersCopied=false;
  const capture=createServer((req,res)=>{captureRequests++;assert.equal(req.headers[readOnlyMcpAuthHeader],undefined);res.writeHead(404);res.end();});
  const otherPort=await listen(capture);
  const upstream=createServer((req,res)=>{
    if(req.url==='/capture'){captureRequests++;assert.equal(req.headers[readOnlyMcpAuthHeader],undefined);res.writeHead(404);res.end();return;}
    upstreamRequests++;assert.equal(req.headers[readOnlyMcpAuthHeader],dummy);
    assert.equal(req.headers.host,`127.0.0.1:${(upstream.address() as {port:number}).port}`);
    routingHeadersCopied ||= ['authorization','forwarded','x-forwarded-host','x-real-ip','x-fixture-routing'].some(name=>Object.hasOwn(req.headers,name));
    if(status>=300&&status<=399){res.writeHead(status,{location,refresh:'0;url='+location,'www-authenticate':'Bearer realm="fixture"'});res.end();return;}
    if(metadata.includes(req.url!)){res.writeHead(404);res.end();return;}
    res.writeHead(status,{'content-type':'application/json','location':location,'set-cookie':'fixture_cookie','www-authenticate':'fixture'});
    res.end(JSON.stringify(responseSecret?{secret:dummy}:{jsonrpc:'2.0',id:1,result:{readOnly:true}}));
  });
  const upstreamPort=await listen(upstream);
  const guard=createReadOnlyMcpGuard({authentication:{mode:'shared_secret',key:dummy},upstreamUrl:`http://127.0.0.1:${upstreamPort}/mcp/readonly`});
  const server=createServer((req,res)=>void guard.handle(req,res));const port=await listen(server);
  const call=(path='/mcp/readonly',method='POST',headers:Record<string,string|string[]>={},body:unknown=rpc)=>new Promise<{status:number;body:string;headers:any}>((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path,method,headers:{'content-type':'application/json',accept:'application/json, text/event-stream',[readOnlyMcpAuthHeader]:dummy,...headers}},res=>{
      const chunks:Buffer[]=[];res.on('data',part=>chunks.push(part));res.on('end',()=>resolve({status:res.statusCode!,body:Buffer.concat(chunks).toString('utf8'),headers:res.headers}));
    });req.on('error',error=>reject(new Error(`Dummy fixture ${method} ${path}: ${(error as NodeJS.ErrnoException).code}`)));req.end(['POST','PUT','DELETE'].includes(method)?JSON.stringify(body):undefined);
  });
  return {call,port,otherPort,guard,state:()=>({upstreamRequests,captureRequests,routingHeadersCopied}),redirect:(code:number,to:string)=>{status=code;location=to;},secret:()=>{responseSecret=true;},
    close:async()=>{guard.dispose();for(const s of[server,upstream,capture]){s.closeAllConnections();await new Promise<void>(resolve=>s.close(()=>resolve()));}}};
}

test('guard rejects unauthenticated, ambiguous and foreign requests before any upstream read',async()=>{
  const f=await fixture();try{
    for(const value of['','bad','b8'.repeat(32),[dummy,dummy]])assert.equal((await f.call('/mcp/readonly','POST',{[readOnlyMcpAuthHeader]:value})).status,401);
    const missing=await fetch(`http://127.0.0.1:${f.port}/mcp/readonly`,{method:'POST',body:'{}'});assert.equal(missing.status,401);
    const deniedHeaders:Record<string,string>[]=[{Host:'foreign.invalid'},{Origin:'https://fixture.invalid'},{'cf-ray':'dummy'},{'sec-fetch-site':'cross-site'}];
    for(const headers of deniedHeaders)assert.equal((await f.call('/mcp/readonly','POST',headers)).status,403);
    for(const path of['/api/workspaces','/capture','/mcp/readonly?url=http://127.0.0.1:9','/mcp/readonly/','/mcp/%72eadonly','/.well-known/oauth-protected-resource?x=1',`http://127.0.0.1:${f.port}/mcp/readonly`])assert.equal((await f.call(path)).status,404);
    for(const method of['GET','PUT','DELETE','OPTIONS'])assert.equal((await f.call('/mcp/readonly',method)).status,405);
    assert.equal((await fetch(`http://127.0.0.1:${f.port}/mcp/readonly`,{method:'HEAD',headers:{[readOnlyMcpAuthHeader]:dummy}})).status,405);
    await assert.rejects(f.call('/mcp/readonly','CONNECT'),/ECONNRESET/);
    for(const path of metadata)assert.equal((await f.call(path,'POST')).status,405);
    for(const name of['x-http-method-override','x-original-url','x-rewrite-url','x-tunnel-channel','x-mcp-channel'])assert.equal((await f.call('/mcp/readonly','POST',{[name]:'other'})).status,400);
    for(const method of['prompt','resources/read','elicitation/create','shutdown'])assert.equal((await f.call('/mcp/readonly','POST',{}, {...rpc,method})).status,400);
    assert.equal((await f.call('/mcp/readonly','POST',{}, {...rpc,params:{name:'prompt',arguments:{}}})).status,400);
    assert.equal(f.state().upstreamRequests,0);
    const ok=await f.call('/mcp/readonly','POST',{'x-forwarded-host':'foreign.invalid',forwarded:'for=fixture',authorization:'Bearer dummy','x-fixture-routing':'http://elsewhere.invalid'});
    assert.equal(ok.status,200);assert.equal(f.state().routingHeadersCopied,false);
    for(const name of['location','refresh','www-authenticate','set-cookie'])assert.equal(ok.headers[name],undefined);
    f.guard.dispose();assert.equal((await f.call()).status,503);
  }finally{await f.close();}
});

test('guard blocks every 3xx for RPC and both metadata routes, with zero redirected requests or credential exposure',async()=>{
  const f=await fixture();try{
    for(let status=300;status<=399;status++){
      f.redirect(status,status%2?'/capture':`http://127.0.0.1:${f.otherPort}/capture`);
      for(const path of['/mcp/readonly',...metadata]){
        const result=await f.call(path,path==='/mcp/readonly'?'POST':'GET');
        assert.equal(result.status,502);assert.ok(!result.body.includes(dummy));assert.match(result.body,/blocked upstream redirect/);
        for(const name of['location','refresh','www-authenticate'])assert.equal(result.headers[name],undefined);
      }
    }
    assert.equal(f.state().captureRequests,0);
  }finally{await f.close();}
});

test('guard rejects secret reflection and oversized bodies without exposing values',async()=>{
  const f=await fixture();try{
    const secretBody=await f.call('/mcp/readonly','POST',{}, {...rpc,id:dummy});assert.equal(secretBody.status,400);assert.ok(!secretBody.body.includes(dummy));
    const large=await f.call('/mcp/readonly','POST',{}, {...rpc,padding:'x'.repeat(17000)});assert.equal(large.status,413);
    assert.equal(f.state().upstreamRequests,0);
    f.secret();const response=await f.call();assert.equal(response.status,502);assert.ok(!response.body.includes(dummy));
  }finally{await f.close();}
});

test('guard configuration accepts only a literal local upstream and requires dedicated authentication',()=>{
  for(const upstreamUrl of['https://127.0.0.1:31717/mcp/readonly','http://localhost:31717/mcp/readonly','http://127.0.0.1:65536/mcp/readonly','http://127.0.0.1:31717/api','http://127.0.0.1:31717/mcp/readonly?x=1','http://user@127.0.0.1:31717/mcp/readonly'])assert.throws(()=>createReadOnlyMcpGuard({authentication:{mode:'shared_secret',key:dummy},upstreamUrl}));
  assert.throws(()=>createReadOnlyMcpGuard({authentication:undefined as any,upstreamUrl:'http://127.0.0.1:31717/mcp/readonly'}));
});
