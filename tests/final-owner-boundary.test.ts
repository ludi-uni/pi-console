// Characterization of stop conditions, NOT owner-consent acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request,type IncomingMessage} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {finalFixture,dummyReadKey,sampleAnswer} from './final-answer.fixture.ts';
import {accessConfig,allowedHost} from '../server/access.ts';
import {permissionOwnerRequest} from '../server/dots-permissions-api.ts';

test('current native credential authenticates a bearer, not the self-asserted connector/client identity',async()=>{
  const root=await mkdtemp(join(tmpdir(),'final-owner-boundary-'));let f:Awaited<ReturnType<typeof finalFixture>>|undefined;
  const server=createServer((req,res)=>void f!.adapter.handle(req,res).then(ok=>{if(!ok){res.writeHead(404);res.end();}}));
  try{
    f=await finalFixture(root);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;assert(![31717,31718,31719].includes(port));
    const call=(claimedClient:string)=>new Promise<any>((resolve,reject)=>{
      const q=request({host:'127.0.0.1',port,path:'/mcp/dots',method:'POST',headers:{'x-pi-console-dots-read-key':dummyReadKey,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'read_final_answer'}},res=>{
        let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));
      });q.on('error',reject);q.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read_final_answer',arguments:f!.target,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:claimedClient,version:'dummy'}}}}));
    });
    for(const claim of ['dummy-connector-A','dummy-connector-B']){const r=await call(claim);assert.equal(r.status,200);assert.equal(r.body.result.structuredContent.text,sampleAnswer);}
    assert.equal(f.mutations(),0);
  }finally{server.closeAllConnections();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));f?.adapter.dispose();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('Access public Host gate and existing literal-loopback owner gate have no common accepted Host',()=>{
  // Configuration only: do NOT construct a JWKS verifier or make an Access request.
  const config=accessConfig({PI_CONSOLE_PUBLIC_ORIGIN:'https://owner.example.invalid',PI_CONSOLE_ACCESS_TEAM_DOMAIN:'https://dummy.cloudflareaccess.com',PI_CONSOLE_ACCESS_AUD:'A'.repeat(32)})!;
  const req=(host:string,origin:string)=>({method:'POST',socket:{remoteAddress:'127.0.0.1',localPort:45678},headers:{host,origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-pi-console-admin':'1'},rawHeaders:['Host',host,'Origin',origin,'Sec-Fetch-Site','same-origin','Content-Type','application/json','X-Pi-Console-Admin','1']} as unknown as IncomingMessage);
  const local=req('127.0.0.1:45678','http://127.0.0.1:45678');assert.equal(permissionOwnerRequest(local),true);assert.equal(allowedHost(local.headers.host,config),false);
  const publicRequest=req(config.host,config.origin);assert.equal(allowedHost(publicRequest.headers.host,config),true);assert.equal(permissionOwnerRequest(publicRequest),false);
  assert.equal(allowedHost(local.headers.host),true); // Local boundary only, NOT proof of an authenticated owner.
});
