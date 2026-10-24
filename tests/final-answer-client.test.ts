import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {finalFixture,dummyReadKey,sampleAnswer} from './final-answer.fixture.ts';
const pin='1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42',version='0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0';
const runtimeKey='final_offline_dummy';const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
test('pin official binary -> strict authenticated dots adapter -> saved exact-run final answer', {timeout:60000},async()=>{
  const binary=process.env.FINAL_TEST_BINARY;if(!binary)throw Error('EXPLICIT_EXISTING_BINARY_REQUIRED');assert.equal(sha(await readFile(binary)),pin);
  const root=await mkdtemp(join(tmpdir(),'final-answer-client-'));const servers:Server[]=[];let child:ReturnType<typeof spawn>|undefined,ended:Promise<any>|undefined,closed=false;
  let sequence=0,secretLogDetected=false,logTail='',fixtureFailure=false;const queued:any[]=[],waiting=new Map<string,(r:any)=>void>();
  const proof:any={schemaVersion:1,status:'blocked',scope:'isolated exact-run final text only',binary:{sha256:pin,version},sdkVersion:'1.0.2',startupRuns:0,toolCalls:0,cleanup:{childClosed:false,fixturesClosed:false,tempRemoved:false},actualDotsConnected:false,productionApplied:false,osEgressAuditPerformed:false};
  const listen=async(s:Server)=>{servers.push(s);await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const port=(s.address() as any).port;assert(![31717,31718,31719].includes(port));return port;};
  let f:Awaited<ReturnType<typeof finalFixture>>|undefined;
  try{
    f=await finalFixture(root);const target=createServer((req,res)=>{void f!.adapter.handle(req,res).then(ok=>{if(!ok){res.writeHead(404);res.end();}}).catch(()=>{fixtureFailure=true;res.writeHead(500);res.end();});});const targetPort=await listen(target);
    const control=createServer(async(req,res)=>{
      try{assert.equal(req.headers.authorization,`Bearer ${runtimeKey}`);assert(!JSON.stringify(req.headers).includes(dummyReadKey));const u=new URL(req.url!,'http://fixture'),tunnel='/v1/tunnels/tunnel_00000000000000000000000000000000';
        if(req.method==='GET'&&u.pathname===tunnel){res.writeHead(200,{'content-type':'application/json'});res.end('{"id":"tunnel_00000000000000000000000000000000","name":"isolated final answer"}');}
        else if(req.method==='GET'&&u.pathname===tunnel+'/poll'){assert.deepEqual(u.searchParams.getAll('channel'),['main']);if(!queued.length)await new Promise(r=>setTimeout(r,40));if(!queued.length){res.writeHead(204);res.end();}else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({commands:queued.splice(0,1)}));}}
        else if(req.method==='POST'&&u.pathname===tunnel+'/response'){assert.equal(req.headers['x-tunnel-shard-token'],'fixture_shard');let bytes=0;const parts:Buffer[]=[];for await(const p of req){bytes+=p.length;assert(bytes<256*1024);parts.push(Buffer.from(p));}const r=JSON.parse(Buffer.concat(parts).toString());assert(!JSON.stringify(r).includes(dummyReadKey));waiting.get(r.request_id)?.(r);waiting.delete(r.request_id);res.writeHead(200,{'content-type':'application/json'});res.end('{}');}
        else{throw Error('FIXTURE_ROUTE');}
      }catch{fixtureFailure=true;res.writeHead(500);res.end();}
    });const controlPort=await listen(control),profileRoot=join(root,'profile');await mkdir(profileRoot);
    const env:NodeJS.ProcessEnv={SystemRoot:process.env.SystemRoot??'C:\\Windows',WINDIR:process.env.SystemRoot??'C:\\Windows',CONTROL_PLANE_API_KEY:runtimeKey,FINAL_DUMMY_READ_KEY:dummyReadKey};for(const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])env[k]=profileRoot;
    const v=spawn(binary,['--version'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let vtext='';for(const stream of [v.stdout!,v.stderr!])stream.on('data',b=>vtext=(vtext+String(b)).slice(-1024));const vt=setTimeout(()=>v.kill(),10000);const [exit]=await once(v,'close');clearTimeout(vt);assert.equal(exit,0);assert.equal(vtext.trim(),`${version} (git sha: a390c168ff1b2d14e73a95991c186c6aba3ff5a0)`);vtext='';proof.versionVerified=true;
    const profile=join(root,'client.yaml');await writeFile(profile,`config_version: 1
control_plane:
  base_url: http://127.0.0.1:${controlPort}
  tunnel_id: tunnel_00000000000000000000000000000000
  api_key: env:CONTROL_PLANE_API_KEY
  poll_channels: [main]
mcp:
  server_urls:
    - channel: main
      url: http://127.0.0.1:${targetPort}/mcp/dots
  max_concurrent_requests: 1
  extra_headers:
    X-Pi-Console-Dots-Read-Key: env:FINAL_DUMMY_READ_KEY
health:
  listen_addr: 127.0.0.1:0
  show_details: false
log:
  level: error
  format: json
  file: stdout
  http_raw_unsafe: false
admin_ui:
  allow_remote: false
  open_browser: false
  log_buffer_events: 1
cloudflared:
  managed: false
`);
    child=spawn(binary,['run','--profile-file',profile,'--control-plane.base-url',`http://127.0.0.1:${controlPort}`,'--control-plane.tunnel-id','tunnel_00000000000000000000000000000000','--control-plane.api-key','env:CONTROL_PLANE_API_KEY','--control-plane.poll-channel=main',
      '--mcp.server-url',`channel=main,url=http://127.0.0.1:${targetPort}/mcp/dots`,'--mcp.max-concurrent-requests','1','--health.listen-addr','127.0.0.1:0','--health.url-file',join(root,'health.url'),
      '--harpoon.hosts-include-loopback=false','--harpoon.hosts-include-private=false','--harpoon.allow-plaintext-http=false','--harpoon.capture-payloads=false','--cloudflared.managed=false','--allow-remote-ui=false','--open-web-ui=false','--log.http-raw-unsafe=false','--log.format','json','--log.level','error'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});proof.startupRuns=1;child.once('close',()=>closed=true);ended=once(child,'close');void ended.catch(()=>{});
    for(const stream of [child.stdout!,child.stderr!])stream.on('data',b=>{const text=logTail+String(b);secretLogDetected ||= text.includes(dummyReadKey)||text.includes(runtimeKey);logTail=text.slice(-128);});
    let healthUrl='';const deadline=Date.now()+10000;while(Date.now()<deadline&&!closed){try{healthUrl=(await readFile(join(root,'health.url'),'utf8')).trim();assert.match(healthUrl,/^http:\/\/127\.0\.0\.1:\d+$/);assert(![31717,31718,31719].includes(Number(new URL(healthUrl).port)));if((await fetch(healthUrl+'/readyz',{signal:AbortSignal.timeout(1000)})).status===200)break;}catch{}await new Promise(r=>setTimeout(r,30));}
    assert(healthUrl&&!closed&&!fixtureFailure);assert.equal((await fetch(healthUrl+'/readyz')).status,200);proof.startupReady=true;
    const command=async(method:string,params:any={})=>{const id=++sequence,requestId=`final_fixture_${id}`;let timer:ReturnType<typeof setTimeout>;
      const result=new Promise<any>((resolve,reject)=>{timer=setTimeout(()=>reject(Error('ISOLATED_TOOL_RESPONSE_TIMEOUT')),8000);waiting.set(requestId,resolve);});
      queued.push({request_id:requestId,shard_token:'fixture_shard',command_type:'jsonrpc',channel:'main',created_at:new Date().toISOString(),response_timeout:'8s',headers:{'Mcp-Protocol-Version':['2026-07-28'],'Mcp-Method':[method],...(params.name?{'Mcp-Name':[params.name]}:{})},
        jsonrpc:{jsonrpc:'2.0',id,method,params:{...params,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:'isolated-final-reader',version:'1'}}}}});
      try{const r=await result;assert.equal(r.resp_code,200);assert.equal(r.resp_json.id,id);assert(!fixtureFailure);return r.resp_json.result;}finally{clearTimeout(timer!);waiting.delete(requestId);}};
    const catalog=await command('tools/list');assert.deepEqual(catalog.tools.map((t:any)=>t.name),['read_final_answer']);proof.catalogFinalOnly=true;
    let text='',cursor:string|undefined,returnedHash='';do{const r=await command('tools/call',{name:'read_final_answer',arguments:{...f.target,limit:32,...(cursor?{cursor}:{})}});proof.toolCalls++;assert.equal(r.isError,false);const data=r.structuredContent;assert.equal(data.readable,true);assert.equal(data.foregroundFinalConfirmed,true);assert.equal(data.aggregateCompletionConfirmed,false);assert.equal(data.byteOffset,Buffer.byteLength(text));text+=data.text;returnedHash=data.sha256;cursor=data.nextCursor??undefined;}while(cursor);
    assert.equal(text,sampleAnswer);assert.equal(sha(text),sha(sampleAnswer));assert.equal(returnedHash,sha(sampleAnswer));assert.equal(f.mutations(),0);assert(!secretLogDetected);
    proof.status='isolated_real_binary_final_answer_accepted';proof.expectedSha256=sha(sampleAnswer);proof.clientReturnedSha256=sha(text);proof.bytes=Buffer.byteLength(text);proof.hashMatch=true;proof.workerQueueProviderEventsStarts=0;proof.foregroundFinalConfirmed=true;proof.aggregateCompletionConfirmed=false;
  }catch{proof.failureCode='ISOLATED_FINAL_CHAIN_NOT_PROVEN';throw Error('ISOLATED_FINAL_CHAIN_NOT_PROVEN');}
  finally{
    if(child&&!closed){child.kill();await ended;}proof.cleanup.childClosed=!child||closed;for(const s of servers){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}proof.cleanup.fixturesClosed=true;f?.adapter.dispose();logTail='';proof.dummySecretLogDetected=secretLogDetected;
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});proof.cleanup.tempRemoved=true;
    const serialized=JSON.stringify(proof);assert(!serialized.includes(dummyReadKey)&&!serialized.includes(runtimeKey));const output=process.env.FINAL_TEST_PROOF_PATH??'docs/dots-final-answer-client-proof.json';assert.match(output,/^docs\/dots-final-answer-client-proof(?:-[a-z0-9]+)?\.json$/);await writeFile(output,serialized+'\n',{flag:'wx'});
  }
});
