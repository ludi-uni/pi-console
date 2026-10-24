import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';
import { createReadOnlyMcp } from '../server/readonly-mcp.ts';
import { readOnlyMcpAuthHeader } from '../server/readonly-mcp-auth.ts';
import { createReadOnlyMcpGuard } from '../server/readonly-mcp-guard.ts';

type MetadataPolicy = 'fixed' | 'legacy403' | 'mixed403' | 'mixed500' | 'metadataSameOriginRedirect' | 'metadataCrossOriginRedirect';
// Every scenario uses the reviewed binary, dummy key, and temporary ports only.
const dummyMcpKey='a7'.repeat(32);
async function tunnelScenario(policy: MetadataPolicy, modern = false, authenticated = false) {
  const client = process.env.PI_CONSOLE_TEST_TUNNEL_CLIENT!;
  assert.equal(createHash('sha256').update(await readFile(client)).digest('hex'),
    '1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42');
  const root = await mkdtemp(join(tmpdir(), 'pi-readonly-tunnel-'));
  const sessions = join(root,'sessions'); await mkdir(sessions);
  const store = new WorkspaceStore(join(root,'workspaces.json'));
  const workspace = await store.add(root);
  const forbidden = 'FORBIDDEN_OTHER_PROJECT_CONVERSATION';
  await writeFile(join(sessions,'closed.jsonl'), JSON.stringify({ type:'session',id:'closed',cwd:root })+'\n'+forbidden);
  const other = join(root,'other'); await mkdir(other); await store.add(other);
  await writeFile(join(sessions,'foreign.jsonl'),JSON.stringify({type:'session',id:'foreign',cwd:other})+'\n'+forbidden);
  const runtime = new RuntimeManager(store,sessions,join(root,'reports'),join(root,'queue'));
  let mutations = 0;
  for (const name of ['open','resume','prompt','stop','kitStatus','kitDecisions','activity','startOrchestrator','shutdown']) {
    (runtime as any)[name] = () => { mutations++; throw Error('Forbidden mutation'); };
  }
  const denialEvents: string[][] = [];
  const mcp = createReadOnlyMcp(runtime,{enabled:true,scope:{version:1,workspaces:[{id:workspace.id,path:root,sessionIds:['closed']}]},
    ...(authenticated?{authentication:{mode:'shared_secret' as const,key:dummyMcpKey}}:{}),
    onNativeDenial: reasons => denialEvents.push(reasons)});
  const httpResults: number[]=[];
  let crossOrigin='';let leakedCredential=false;let otherDestinationRequests=0;let sameOriginCaptureRequests=0;let runtimeRedirect='';
  const paths: string[] = [];
  const metadataPaths=['/.well-known/oauth-protected-resource/mcp/readonly','/.well-known/oauth-protected-resource'];
  const metadataResponses: {path:string;status:number}[]=[];
  const target = createServer((req,res) => {
    res.once('finish',()=>httpResults.push(res.statusCode));
    const path=new URL(req.url!,'http://fixture').pathname;paths.push(path);
    if(path==='/capture') {
      sameOriginCaptureRequests++;
      leakedCredential ||= Object.hasOwn(req.headers,readOnlyMcpAuthHeader)||JSON.stringify(req.headers).includes(dummyMcpKey);
      res.writeHead(404);res.end();return;
    }
    if(authenticated&&path==='/mcp/readonly'&&runtimeRedirect==='cross-origin') {
      res.writeHead(307,{location:crossOrigin+'/capture'});res.end();return;
    }
    if(authenticated&&path==='/mcp/readonly'&&runtimeRedirect==='same-origin') {
      res.writeHead(307,{location:'/capture'});res.end();return;
    }
    if(metadataPaths.includes(path)&&req.method==='GET') {
      res.once('finish',()=>metadataResponses.push({path,status:res.statusCode}));
      if(path===metadataPaths[0]&&policy.startsWith('metadata')) {
        res.writeHead(307,{location:policy==='metadataSameOriginRedirect'?'/capture':crossOrigin+'/capture'});res.end();return;
      }
      if(policy==='legacy403'||path===metadataPaths[1]&&policy.startsWith('mixed')) {
        res.writeHead(policy==='mixed500'?500:403,{'content-type':'application/json'});
        res.end(JSON.stringify({error:policy==='mixed500'?'fixture failure':'invalid host'}));return;
      }
    }
    void mcp.handle(req,res).then(handled => { if (!handled) { res.writeHead(403); res.end(); } });
  });
  const listen = async (server: Server) => { await new Promise<void>(r=>server.listen(0,'127.0.0.1',r)); return (server.address() as {port:number}).port; };
  const targetPort = await listen(target);
  const otherDestination=createServer((req,res)=>{
    otherDestinationRequests++;
    leakedCredential ||= Object.hasOwn(req.headers,readOnlyMcpAuthHeader)||JSON.stringify(req.headers).includes(dummyMcpKey);
    res.writeHead(403);res.end();
  });
  crossOrigin=`http://127.0.0.1:${await listen(otherDestination)}`;
  const guard=authenticated?createReadOnlyMcpGuard({authentication:{mode:'shared_secret',key:dummyMcpKey},upstreamUrl:`http://127.0.0.1:${targetPort}/mcp/readonly`,onNativeDenial:reasons=>denialEvents.push(reasons)}):undefined;
  const guardResults:number[]=[];
  const guardServer=createServer((req,res)=>{res.once('finish',()=>guardResults.push(res.statusCode));void guard!.handle(req,res)});
  const clientTargetPort=guard?await listen(guardServer):targetPort;
  const queued: any[] = [], waiting = new Map<string,(value:any)=>void>();
  const tunnel = 'tunnel_00000000000000000000000000000000'; let sequence = 0; let assertionFailure: unknown;
  const control = createServer(async (req,res) => {
    try {
      assert.equal(req.headers.authorization,'Bearer offline_dummy');
      assert.equal(JSON.stringify(req.headers).includes(dummyMcpKey),false,'MCP credential must not reach the control plane');
      const url = new URL(req.url!,'http://fixture');
      assert.deepEqual(JSON.parse(String(req.headers['x-tunnel-mcp-server-info'])), {version:1,channels:[{name:'main'}]});
      if (req.method==='GET' && url.pathname===`/v1/tunnels/${tunnel}`) {
        res.setHeader('content-type','application/json'); res.end(JSON.stringify({id:tunnel,name:'Isolated fixture',description:'No external service'}));
      } else if (req.method==='GET' && url.pathname===`/v1/tunnels/${tunnel}/poll`) {
        assert.deepEqual(url.searchParams.getAll('channel'),['main']);
        if (!queued.length) await new Promise(r=>setTimeout(r,40));
        if (!queued.length) { res.writeHead(204); res.end(); }
        else { res.setHeader('content-type','application/json'); res.end(JSON.stringify({commands:queued.splice(0,1)})); }
      } else if (req.method==='POST' && url.pathname===`/v1/tunnels/${tunnel}/response`) {
        assert.equal(req.headers['x-tunnel-shard-token'],'fixture_shard');
        const parts: Buffer[]=[]; for await (const part of req) parts.push(Buffer.from(part));
        const response=JSON.parse(Buffer.concat(parts).toString());
        assert.ok(['main','other','harpoon'].includes(response.channel)); assert.ok(!JSON.stringify(response).includes(forbidden));assert.equal(JSON.stringify(response).includes(dummyMcpKey),false);
        waiting.get(response.request_id)?.(response); waiting.delete(response.request_id);
        res.setHeader('content-type','application/json'); res.end('{}');
      } else { throw Error('Unexpected control plane route'); }
    } catch(error) { assertionFailure=error; res.writeHead(500); res.end(); }
  });
  const controlPort = await listen(control);
  const profile=join(root,'readonly-fixture.yaml');
  await writeFile(profile,`config_version: 1
control_plane:
  base_url: http://127.0.0.1:${controlPort}
  tunnel_id: ${tunnel}
  api_key: env:CONTROL_PLANE_API_KEY
  poll_channels: [main]
mcp:
  server_urls:
    - channel: main
      url: http://127.0.0.1:${clientTargetPort}/mcp/readonly
  max_concurrent_requests: 1
${authenticated?`  extra_headers:\n    X-Pi-Console-Readonly-Key: env:PI_CONSOLE_TEST_MCP_KEY\n`:''}health:
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
  const child = spawn(client,['run','--profile-file',profile,
    '--control-plane.base-url',`http://127.0.0.1:${controlPort}`,
    '--control-plane.tunnel-id',tunnel,'--control-plane.api-key','env:CONTROL_PLANE_API_KEY',
    '--control-plane.poll-channel=main','--mcp.server-url',`channel=main,url=http://127.0.0.1:${clientTargetPort}/mcp/readonly`,
    '--mcp.max-concurrent-requests','1','--health.listen-addr','127.0.0.1:0','--health.url-file',join(root,'health.url'),
    '--harpoon.hosts-include-loopback=false','--harpoon.hosts-include-private=false',
    '--harpoon.allow-plaintext-http=false','--harpoon.capture-payloads=false',
    '--cloudflared.managed=false','--allow-remote-ui=false','--open-web-ui=false',
    '--log.http-raw-unsafe=false','--log.format','json','--log.level','error'],
    {cwd:root,env:{SystemRoot:process.env.SystemRoot ?? 'C:\\Windows',CONTROL_PLANE_API_KEY:'offline_dummy',...(authenticated?{PI_CONSOLE_TEST_MCP_KEY:dummyMcpKey}:{})},windowsHide:true,stdio:['ignore','ignore','pipe']});
  let diagnostic=''; child.stderr.on('data',part=>{diagnostic=(diagnostic+String(part)).slice(0,4096);});
  const command = async (method:string,params:any={},notification=false, extraHeaders: Record<string,string[]> = {},channel='main') => {
    const id=++sequence,requestId=`fixture_${id}`;
    let timer: ReturnType<typeof setTimeout>;
    const response=new Promise<any>((resolve,reject)=>{
      timer=setTimeout(()=>reject(assertionFailure ?? Error(`Isolated client response timed out (exit=${child.exitCode}, diagnostic=${diagnostic.replaceAll('offline_dummy','[dummy]').replaceAll(dummyMcpKey,'[dummy-mcp]')})`)),10000);
      waiting.set(requestId,resolve);
    });
    queued.push({request_id:requestId,shard_token:'fixture_shard',command_type:'jsonrpc',channel,
      created_at:new Date().toISOString(),response_timeout:'10s',headers:{'Mcp-Protocol-Version':[modern?'2026-07-28':'2025-06-18'], ...(authenticated?{'X-Forwarded-For':['192.0.2.1']} : {}), ...extraHeaders},
      jsonrpc:{jsonrpc:'2.0',...(!notification?{id}:{}),method,params: modern ? {...params,_meta:{
        'io.modelcontextprotocol/protocolVersion':'2026-07-28',
        'io.modelcontextprotocol/clientCapabilities':{},
        'io.modelcontextprotocol/clientInfo':{name:'isolated-client',version:'1'},
      }} : params}});
    try {
      const result=await response;
      if(!notification && !Object.keys(extraHeaders).length&&channel==='main')assert.equal(result.resp_json.id,id);
      if(modern && result.resp_json?.result) {
        assert.equal(result.resp_json.result.resultType,'complete');
        assert.deepEqual(result.resp_json.result._meta,{'io.modelcontextprotocol/serverInfo':{name:'pi-console-readonly',version:'0.5.0'}});
      }
      return result;
    }
    finally { clearTimeout(timer!); waiting.delete(requestId); }
  };
  try {
    let healthUrl='',oauth:any;
    const deadline=Date.now()+10000;
    while(Date.now()<deadline) {
      try {
        healthUrl=(await readFile(join(root,'health.url'),'utf8')).trim();
        assert.match(healthUrl,/^http:\/\/127\.0\.0\.1:\d+$/);
        oauth=await (await fetch(healthUrl+'/api/oauth')).json();
        if(!oauth.pending&&oauth.metadata?.attempts?.length)break;
      } catch { /* Startup observation is bounded; never retry real services. */ }
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.ok(oauth?.metadata?.attempts?.length,'Isolated discovery did not complete');
    if(policy.startsWith('metadata')) {
      assert.equal(leakedCredential,false,'STOP: dedicated dummy key reached a metadata redirect destination outside the two allowed metadata paths');
      assert.equal(sameOriginCaptureRequests,0,'Guard must block metadata redirect before a same-origin capture request');
      assert.equal(otherDestinationRequests,0,'Cross-origin metadata redirect destination must receive zero requests');
      assert.ok(guardResults.includes(502));assert.equal((await fetch(healthUrl+'/readyz')).status,503);
      assert.equal(mutations,0);assert.ok(!assertionFailure);return;
    }
    const ready=await fetch(healthUrl+'/readyz');
    const health=await (await fetch(healthUrl+'/health?details=false')).json();
    const oauthHealth=await (await fetch(healthUrl+'/health/oauth')).json();
    assert.equal(ready.status,policy==='fixed'?200:503);assert.equal(health.ready,policy==='fixed');
    assert.equal(oauthHealth.state,policy==='fixed'?'not_advertised':'failed');
    assert.equal(oauthHealth.reason_code,policy==='fixed'?'metadata_not_advertised':'discovery_failed');
    assert.ok(!oauth.www_authenticate_probe?.url,'No-auth fixture must not advertise OAuth');
    const attempts=oauth.metadata.attempts;
    assert.equal(attempts[0].status_code,policy==='legacy403'?403:404);
    assert.equal(!!attempts[0].tried,true);assert.equal(!!attempts[1].tried,policy!=='legacy403');
    if(policy!=='legacy403')assert.equal(attempts[1].status_code,policy==='mixed403'?403:policy==='mixed500'?500:404);
    assert.deepEqual(metadataResponses,policy==='legacy403'?[{path:metadataPaths[0],status:403}]:[
      {path:metadataPaths[0],status:404},{path:metadataPaths[1],status:policy==='mixed403'?403:policy==='mixed500'?500:404},
    ]);
    if(modern) {
      const discovery=await command('server/discover'); assert.equal(discovery.resp_code,200);
      assert.deepEqual(discovery.resp_json.result.supportedVersions,['2026-07-28','2025-06-18','2025-03-26']);
      assert.deepEqual(discovery.resp_json.result.capabilities,{tools:{}});
      assert.equal(discovery.resp_json.result.cacheScope,'private'); assert.equal(discovery.resp_json.result.ttlMs,0);
    } else {
      const init=await command('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}});
      assert.equal(init.resp_code,200); assert.equal(init.resp_json.result.protocolVersion,'2025-06-18');
      const notify=await command('notifications/initialized',{},true); assert.equal(notify.resp_type,'notify_ack');
    }
    const tools=await command('tools/list');
    assert.deepEqual(tools.resp_json.result.tools.map((t:any)=>t.name),['get_status','list_sessions','get_progress']);
    const call=async(name:string,args:any={})=>(await command('tools/call',{name,arguments:args})).resp_json;
    const status=(await call('get_status')).result.structuredContent;
    assert.equal(status.workspaces.length,1); assert.equal(status.runtime.runningWorkers,0);
    const ws={serverId:status.serverId,workspaceId:status.workspaces[0].workspaceId};
    const listing=(await call('list_sessions',ws)).result.structuredContent; assert.equal(listing.sessions.length,1);
    const session=listing.sessions[0];
    const args={...ws,sessionId:session.sessionId,generation:session.generation,runId:null};
    const progress=(await call('get_progress',args)).result.structuredContent;
    assert.equal(progress.source,'none'); assert.equal(progress.currentStatus,'unknown');
    assert.equal((await call('get_progress',{...args,sessionId:'a'.repeat(64)})).error.code,-32602);
    assert.equal((await call('prompt',{})).error.code,-32602);
    if(authenticated) {
      assert.equal(denialEvents.length,0,'Authenticated proxy requests must pass through the readonly flow');
      for(const keyValues of [[''],['b8'.repeat(32)],[dummyMcpKey,dummyMcpKey]]) {
        const denied=await command('tools/call',{name:'get_status',arguments:{}},false,{[readOnlyMcpAuthHeader]:keyValues});
        assert.ok(!denied.resp_json?.result);assert.equal(guardResults.at(-1),401);
        assert.equal(JSON.stringify(denied).includes(dummyMcpKey),false);
      }
      assert.deepEqual(denialEvents,[['mcp_auth_failed']]);
      const origin=await command('server/discover',{},false,{Origin:['https://fixture.invalid']});
      assert.ok(!origin.resp_json?.result);assert.equal(guardResults.at(-1),403);
      assert.deepEqual(denialEvents.at(-1),['origin_present','proxy_header_present']);
      assert.equal((await call('list_sessions',{...ws,workspaceId:'a'.repeat(64)})).error.code,-32602);
      assert.equal(diagnostic.includes(dummyMcpKey),false);
      const logs=await(await fetch(healthUrl+'/api/logs')).text();assert.equal(logs.includes(dummyMcpKey),false);
      for(const channel of ['other','harpoon']) {
        const before=guardResults.length;
        const rejected=await command('server/discover',{},false,{},channel);
        assert.ok(!rejected.resp_json?.result);assert.equal(guardResults.length,before,'Unconfigured/disabled channel must never reach the guard');
      }
      runtimeRedirect='cross-origin';
      const redirect=await command('server/discover',{},false,{'X-Fixture-Test':['dummy']});
      assert.equal(guardResults.at(-1),502);
      assert.ok(!redirect.resp_json?.result);assert.equal(leakedCredential,false,'Local key must never reach another destination');
      assert.equal(otherDestinationRequests,0,'Official runtime must reject cross-origin redirects before sending any headers');
      runtimeRedirect='same-origin';
      const sameOriginRedirect=await command('server/discover',{},false,{'X-Fixture-Test':['dummy']});
      assert.equal(guardResults.at(-1),502);
      assert.ok(!sameOriginRedirect.resp_json?.result);
      assert.equal(leakedCredential,false,'STOP: dedicated dummy key reached an unrelated same-origin redirect path');
      assert.equal(sameOriginCaptureRequests,0,'Runtime redirect outside the configured MCP path must receive zero requests');
      runtimeRedirect='';
    } else if(modern) {
      // Use the actual official forwarding path; these are fake values, never
      // captured from a real user's request. Trust-boundary changes stay pending.
      const waitFailures=async(expected:number)=>{
        const deadline=Date.now()+5000;let snapshot:any;
        do {
          snapshot=await(await fetch(healthUrl+'/health?details=true')).json();
          if(snapshot.components.dispatcher.details.failures===expected)return snapshot;
          await new Promise(resolve=>setTimeout(resolve,25));
        }while(Date.now()<deadline);
        assert.equal(snapshot.components.dispatcher.details.failures,expected,'Wait for completed dispatcher accounting, not only response delivery');return snapshot;
      };
      // The two earlier rejected tool calls are delivered before their async
      // dispatcher completion is always visible, especially in the full suite.
      const beforeDenial=await waitFailures(2);
      const denied=await command('tools/call',{name:'get_status',arguments:{}},false,{
        Origin:['https://fixture.invalid'], 'X-Forwarded-For':['192.0.2.1'], 'CF-Ray':['fixture_dummy'],
      });
      assert.ok(!denied.resp_json?.result);
      assert.deepEqual(denialEvents,[['origin_present','proxy_header_present','cloudflare_header_present']]);
      const completed=await waitFailures(beforeDenial.components.dispatcher.details.failures+1);
      assert.equal(completed.components.dispatcher.details.failures,beforeDenial.components.dispatcher.details.failures+1);
      assert.equal(completed.components['response-delivery'].details.terminal_failures,0);
    }
    assert.equal(mutations,0); assert.ok(paths.includes('/mcp/readonly')); assert.ok(!assertionFailure);
  } finally {
    mcp.dispose();
    guard?.dispose();
    if(child.exitCode===null){child.kill(); await once(child,'exit');}
    for (const server of [control,target,otherDestination,...(guard?[guardServer]:[])]) { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}

test('official tunnel-client sessionless server/discover -> catalog -> scoped readonly calls and classified proxy denial', {
  skip:!process.env.PI_CONSOLE_TEST_TUNNEL_CLIENT,timeout:30000,
},()=>tunnelScenario('fixed',true));

test('official client env-referenced local authentication, proxy discovery/catalog/reads, caller override rejection and no credential exposure', {
  skip:!process.env.PI_CONSOLE_TEST_TUNNEL_CLIENT,timeout:30000,
},()=>tunnelScenario('fixed',true,true));

for(const policy of ['metadataSameOriginRedirect','metadataCrossOriginRedirect'] as const) {
  test(`official client dedicated key ${policy} destination scope`,{skip:!process.env.PI_CONSOLE_TEST_TUNNEL_CLIENT,timeout:30000},()=>tunnelScenario(policy,true,true));
}

for(const policy of ['fixed','legacy403','mixed403','mixed500'] as const) {
  test(`official tunnel-client discovery ${policy}, readiness and scoped read forwarding`,{
    skip:!process.env.PI_CONSOLE_TEST_TUNNEL_CLIENT,timeout:30000,
  },()=>tunnelScenario(policy));
}
