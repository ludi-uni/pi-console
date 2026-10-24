// Isolated startup/discovery fixture only; no application, SDK, scope or provider imports.
import {createServer,request} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const pin='1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42';
const binaryVersion='0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0';
const modern='2026-07-28',dummyKey='d3'.repeat(32),runtimeDummy='phase1_offline_dummy';
const knownVersions=new Set(['2024-11-05','2025-03-26','2025-06-18','2025-11-25',modern]);
const rpcNames=new Set(['server/discover','initialize','notifications/initialized','tools/list','tools/call','ping']);
const observedHeaders=['host','x-pi-console-dots-read-key','authorization','content-type','accept','mcp-protocol-version','mcp-method','mcp-name','origin'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const vc=v=>v===undefined?'absent':typeof v==='string'&&knownVersions.has(v)?v:'other';
const rc=v=>v===undefined?'absent':rpcNames.has(v)?v:'other';
const count=n=>n<=8?n:'many';
const bytesClass=n=>n===0?'zero':n<=256?'1-256':n<=1024?'257-1024':n<=4096?'1025-4096':n<=16384?'4097-16384':'overflow';
const paths={'/mcp/dots':'dots','/.well-known/oauth-protected-resource/mcp/dots':'dots-metadata','/.well-known/oauth-protected-resource':'root-metadata'};
const safeJson=v=>{const s=JSON.stringify(v);if(s.includes(dummyKey)||s.includes(runtimeDummy))throw Error('UNSAFE_EVIDENCE');return s;};
function hdrCount(req,name){return req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()===name).length;}
function structure(req){return {methodClass:['GET','POST','HEAD','OPTIONS','PUT','DELETE','PATCH'].includes(req.method)?req.method:'other',
  pathClass:Object.hasOwn(paths,req.url)?paths[req.url]:'other',queryPresent:req.url.includes('?'),
  headers:Object.fromEntries(observedHeaders.map(n=>[n,{present:hdrCount(req,n)>0,count:count(hdrCount(req,n))}])),
  headerProtocol:vc(req.headers['mcp-protocol-version']),headerRpcMethod:rc(req.headers['mcp-method'])};}
function bodyStructure(rpc){return {rpcMethod:rc(plain(rpc)?rpc.method:undefined),
  metadataProtocol:vc(rpc?.params?._meta?.['io.modelcontextprotocol/protocolVersion']),initializeProtocol:vc(rpc?.params?.protocolVersion)};}
function detector(){let tail='',mcp=false,control=false;return {accept(b){const s=tail+String(b);mcp ||= s.includes(dummyKey);control ||= s.includes(runtimeDummy);tail=s.slice(-64);},result(){return {mcp,control};},clear(){tail='';}};}
const meta=()=>({'io.modelcontextprotocol/protocolVersion':modern,'io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:'isolated-selftest',version:'1'}});
const discovery=()=>({jsonrpc:'2.0',id:1,method:'server/discover',params:{_meta:meta()}});
const modernHeaders=()=>({'x-pi-console-dots-read-key':dummyKey,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':modern,'mcp-method':'server/discover'});
const goodId=v=>Number.isSafeInteger(v)||typeof v==='string'&&v.length<=128&&!/[\x00-\x1f]/.test(v)&&!v.includes(dummyKey)&&!v.includes(runtimeDummy);
function outcome(status,code,errorCode=-32602){return {status,code,errorCode};}
function boundary(req){
  if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return outcome(403,'PEER_DENIED');
  if(hdrCount(req,'host')!==1||req.headers.host!==`127.0.0.1:${req.socket.localPort}`)return outcome(403,'HOST_DENIED');
  if(hdrCount(req,'x-pi-console-dots-read-key')>1)return outcome(401,'AUTH_DUPLICATE');
  if(req.headers['x-pi-console-dots-read-key']!==dummyKey)return outcome(401,hdrCount(req,'x-pi-console-dots-read-key')?'AUTH_MISMATCH':'AUTH_MISSING');
  if(Object.keys(req.headers).some(n=>n==='origin'||n==='forwarded'||n==='via'||n.startsWith('x-forwarded-')||n.startsWith('cf-')))return outcome(403,'BROWSER_PROXY_DENIED');
  if(!Object.hasOwn(paths,req.url))return outcome(404,'PATH_DENIED');
  if(req.method==='GET')return outcome(req.url==='/mcp/dots'?405:404,req.url==='/mcp/dots'?'NO_GET_STREAM':'METADATA_NOT_ADVERTISED');
  if(req.method!=='POST'||req.url!=='/mcp/dots')return outcome(405,'METHOD_DENIED');
  return null;
}
function classify(req,bytes){
  const first=boundary(req);if(first)return {...first,kind:'boundary-denial'};
  if(bytes.length>16384)return {...outcome(413,'BODY_OVERSIZE'),kind:'rpc-denial'};
  if(!bytes.length)return {...outcome(400,'NON_RPC_NO_BODY',-32600),kind:'authenticated-non-rpc-probe'};
  let rpc;try{rpc=JSON.parse(bytes.toString());}catch{return {...outcome(400,'INVALID_RPC_JSON',-32700),kind:'rpc-denial'};}
  const observed=bodyStructure(rpc);
  if(!plain(rpc)||rpc.jsonrpc!=='2.0'||!goodId(rpc.id)||typeof rpc.method!=='string'||!plain(rpc.params))return {...outcome(400,'INVALID_RPC_SHAPE'),kind:'rpc-denial',observed};
  const base={kind:'rpc',id:rpc.id,observed};
  if(rpc.method==='initialize'||rpc.method==='notifications/initialized')return {...base,...outcome(400,'LEGACY_REFUSED',-32022)};
  if(rpc.method!=='server/discover')return {...base,...outcome(404,'RPC_METHOD_DENIED',-32601)};
  const m=rpc.params._meta;
  if(!plain(m)||!plain(m['io.modelcontextprotocol/clientCapabilities'])||typeof m['io.modelcontextprotocol/protocolVersion']!=='string')return {...base,...outcome(400,'METADATA_REQUIRED')};
  for(const name of ['mcp-protocol-version','mcp-method','content-type','accept'])if(hdrCount(req,name)!==1)return {...base,...outcome(400,'HEADER_REQUIRED_OR_DUPLICATE',-32020)};
  if(req.headers['mcp-protocol-version']!==m['io.modelcontextprotocol/protocolVersion']||req.headers['mcp-method']!==rpc.method)return {...base,...outcome(400,'HEADER_BODY_MISMATCH',-32020)};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(m['io.modelcontextprotocol/protocolVersion']))return {...base,...outcome(400,'INVALID_VERSION_FORMAT')};
  if(req.headers['mcp-protocol-version']!==modern)return {...base,...outcome(400,'UNSUPPORTED_VERSION',-32022),requestedVersion:req.headers['mcp-protocol-version']};
  if(!Object.keys(rpc.params).every(k=>k==='_meta'))return {...base,...outcome(400,'PARAMS_DENIED')};
  if(String(req.headers['content-type']).split(';')[0].trim()!=='application/json')return {...base,...outcome(415,'CONTENT_TYPE_DENIED')};
  const accept=String(req.headers.accept).split(',').map(v=>v.trim().split(';')[0]);
  if(!accept.includes('application/json')||!accept.includes('text/event-stream'))return {...base,...outcome(406,'ACCEPT_DENIED')};
  return {...base,status:200,code:'MODERN_DISCOVERY_SUCCESS',result:{resultType:'complete',supportedVersions:[modern],capabilities:{},
    _meta:{'io.modelcontextprotocol/serverInfo':{name:'pi-console-isolated-startup-fixture',version:'1'}},ttlMs:0,cacheScope:'private'}};
}
function targetFixture(record){
  let sequence=0;const pending=new Set(),results=[];
  const server=createServer((req,res)=>{
    const correlationId=`request-${++sequence}`;
    const work=(async()=>{
      await record({phase:'request',correlationId,...structure(req)});
      let parts=[],size=0,readFailure=false;const timer=setTimeout(()=>req.destroy(),5000);
      try{for await(const p of req){size+=p.length;if(size>16384){readFailure=true;break;}parts.push(p);}}catch{readFailure=true;}finally{clearTimeout(timer);}
      await record({phase:'body',correlationId,empty:size===0,byteCountClass:bytesClass(size),readComplete:!readFailure});
      const bytes=Buffer.concat(parts);const decision=readFailure?{...outcome(413,'BODY_READ_REFUSED'),kind:'rpc-denial'}:classify(req,bytes);bytes.fill(0);parts=[];
      const {id,result,requestedVersion,...observable}=decision;await record({phase:'validation',correlationId,...observable});results.push({...observable,correlationId});
      if(res.destroyed)return;
      const headers={'content-type':'application/json','cache-control':'no-store'};if(decision.status===405)headers.allow='POST';
      res.writeHead(decision.status,headers);
      if(decision.status===200)res.end(safeJson({jsonrpc:'2.0',id,result}));
      else res.end(safeJson({jsonrpc:'2.0',id:id??null,error:{code:decision.errorCode,message:decision.code,
        ...(decision.errorCode===-32022?{data:{supported:[modern],requested:requestedVersion??'2025-11-25'}}:{})}}));
    })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{if(!res.destroyed){res.writeHead(500);res.end();}});
  });
  return {server,pending,results};
}
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;if([31717,31718,31719].includes(port))throw Error('PRODUCTION_PORT_REFUSED');return port;}
async function close(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
async function localCall(port,{headers=modernHeaders(),body=JSON.stringify(discovery()),method='POST',path='/mcp/dots'}={}){
  return new Promise((resolve,reject)=>{const q=request({hostname:'127.0.0.1',port,path,method,headers},res=>{let data='';res.on('data',b=>{data+=b;});res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(data)}));});q.on('error',reject);q.end(body);});
}
async function selfTest(){
  const events=[];const fixture=targetFixture(async e=>events.push(e));const port=await listen(fixture.server);let pass=0;
  const cases=[
    [{},200,'MODERN_DISCOVERY_SUCCESS'],[{body:''},400,'NON_RPC_NO_BODY'],[{body:'invalid'},400,'INVALID_RPC_JSON'],
    [{headers:{...modernHeaders(),'x-pi-console-dots-read-key':'invalid'}},401,'AUTH_MISMATCH'],
    [{headers:Object.fromEntries(Object.entries(modernHeaders()).filter(([k])=>k!=='x-pi-console-dots-read-key'))},401,'AUTH_MISSING'],
    [{headers:{...modernHeaders(),'x-pi-console-dots-read-key':[dummyKey,dummyKey]}},401,'AUTH_DUPLICATE'],
    [{path:'/api/workspace-permissions/save'},404,'PATH_DENIED'],[{path:'/other'},404,'PATH_DENIED'],[{path:'/mcp/dots?secret=test'},404,'PATH_DENIED'],
    [{headers:{...modernHeaders(),host:'foreign.invalid'}},403,'HOST_DENIED'],[{headers:{...modernHeaders(),origin:'https://fixture.invalid'}},403,'BROWSER_PROXY_DENIED'],
    [{headers:{...modernHeaders(),'x-forwarded-for':'192.0.2.1'}},403,'BROWSER_PROXY_DENIED'],
    [{headers:Object.fromEntries(Object.entries(modernHeaders()).filter(([k])=>k!=='mcp-protocol-version'))},400,'HEADER_REQUIRED_OR_DUPLICATE'],
    [{headers:{...modernHeaders(),'mcp-protocol-version':[modern,modern]}},400,'HEADER_REQUIRED_OR_DUPLICATE'],
    [{headers:{...modernHeaders(),'mcp-protocol-version':'2025-11-25'}},400,'HEADER_BODY_MISMATCH'],
    [{body:JSON.stringify({...discovery(),params:{_meta:{...meta(),'io.modelcontextprotocol/protocolVersion':'2099-01-01'}}}),headers:{...modernHeaders(),'mcp-protocol-version':'2099-01-01'}},400,'UNSUPPORTED_VERSION'],
    [{body:JSON.stringify({...discovery(),params:{}})},400,'METADATA_REQUIRED'],
    [{headers:{...modernHeaders(),'mcp-method':'tools/call'}},400,'HEADER_BODY_MISMATCH'],
    [{headers:{...modernHeaders(),'content-type':'text/plain'}},415,'CONTENT_TYPE_DENIED'],
    [{headers:{...modernHeaders(),accept:'application/json'}},406,'ACCEPT_DENIED'],
    [{body:JSON.stringify({...discovery(),params:{_meta:{'io.modelcontextprotocol/protocolVersion':modern}}})},400,'METADATA_REQUIRED'],
    [{body:JSON.stringify({...discovery(),params:{_meta:{...meta(),'io.modelcontextprotocol/protocolVersion':'invalid'}}}),headers:{...modernHeaders(),'mcp-protocol-version':'invalid'}},400,'INVALID_VERSION_FORMAT'],
    [{body:JSON.stringify({...discovery(),method:'tools/call',params:{name:'stop_execution',arguments:{},_meta:meta()}}),headers:{...modernHeaders(),'mcp-method':'tools/call','mcp-name':'stop_execution'}},404,'RPC_METHOD_DENIED'],
    [{body:JSON.stringify({...discovery(),method:'initialize',params:{protocolVersion:'2025-11-25'}})},400,'LEGACY_REFUSED'],
    [{method:'GET',body:''},405,'NO_GET_STREAM'],[{method:'GET',body:'',path:'/.well-known/oauth-protected-resource/mcp/dots'},404,'METADATA_NOT_ADVERTISED'],
  ];
  try {
    for(const [options,status,code] of cases){const result=await localCall(port,options);assert(result.status===status,'SELFTEST_STATUS_FAILED');assert((result.value.error?.message??'MODERN_DISCOVERY_SUCCESS')===code,'SELFTEST_CLASS_FAILED');
      if(status===200)assert(result.value.result.resultType==='complete'&&result.value.result.supportedVersions[0]===modern&&Object.keys(result.value.result.capabilities).length===0&&result.value.result.cacheScope==='private','DISCOVERY_RESULT_INVALID');pass++;}
    for(const name of ['submit_instruction','start_execution','cancel_instruction','get_request','get_status','get_progress']){const result=await localCall(port,{body:JSON.stringify({...discovery(),method:'tools/call',params:{name,arguments:{},_meta:meta()}})});assert(result.status!==200,'CONTROL_OR_TOOL_EXPOSED');pass++;}
    const secret=dummyKey+runtimeDummy;
    const injected={headers:{...modernHeaders(),origin:secret},path:'/'+secret,body:secret};await localCall(port,injected);
    const s=safeJson(events);assert(!s.includes(dummyKey)&&!s.includes(runtimeDummy),'SELFTEST_SECRET_LEAK');pass++;
    const d=detector();d.accept(dummyKey.slice(0,31));d.accept(dummyKey.slice(31));d.accept(runtimeDummy);assert(d.result().mcp&&d.result().control,'SELFTEST_DETECTOR_FAILED');d.clear();pass++;
    for(const result of fixture.results){const group=events.filter(e=>e.correlationId===result.correlationId);assert(group.length===3&&group[0].phase==='request'&&group[1].phase==='body'&&group[2].phase==='validation','SELFTEST_CORRELATION_FAILED');}pass++;
    assert(fixture.results.some(e=>e.code==='NON_RPC_NO_BODY')&&!fixture.results.some(e=>e.code==='NON_RPC_NO_BODY'&&e.status===200),'EMPTY_POST_ACCEPTED');pass++;
    return {pass,fail:0,realHTTP:true,redaction:true,requestCorrelation:true,emptyPostNeverSuccessful:true};
  }finally{await close(fixture.server);await Promise.allSettled([...fixture.pending]);}
}
function probeState(mcp){const details=mcp?.details;const p=details?.startup_probe??details?.startupProbe;return ['pending','succeeded','failed'].includes(p?.state)?p.state:'unobserved';}
async function run(binary,attempt){
  if(!/^[1-3]$/.test(attempt))throw Error('INVALID_ATTEMPT');
  const stem=`docs/dots-phase1-modern-startup-attempt-${attempt}`;
  const root=await mkdtemp(join(tmpdir(),'dots-modern-startup-')),profileRoot=join(root,'profile');await mkdir(profileRoot);
  const report={schemaVersion:1,authorisedAt:'2026-10-07T13:20:27Z',attempt:Number(attempt),stage:'isolated startup and modern discovery only',selfTest:await selfTest(),
    binary:{sha256:pin,version:binaryVersion,hashVerified:false,versionVerified:false},startupRuns:0,failures:[],cleanup:{childClosed:false,fixturesClosed:false,tempRemoved:false},C1Accepted:false,applicationImplemented:false};
  let h,tail=Promise.resolve(),sequence=0,child,ended,childClosed=false,target,control;const pending=new Set(),log=detector();
  const record=async e=>{if(++sequence>512)throw Error('OBSERVATION_LIMIT');const s=safeJson(e);const task=tail.then(async()=>{await h.writeFile(s+'\n');await h.sync();});tail=task.catch(()=>{});await task;};
  try {
    if(createHash('sha256').update(await readFile(binary)).digest('hex')!==pin)throw Error('BINARY_PIN_MISMATCH');report.binary.hashVerified=true;
    h=await open(stem+'.jsonl','wx');
    const env={SystemRoot:process.env.SystemRoot??'C:\\Windows',WINDIR:process.env.SystemRoot??'C:\\Windows',CONTROL_PLANE_API_KEY:runtimeDummy,PHASE1_DUMMY_KEY:dummyKey};
    for(const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])env[k]=profileRoot;
    const v=spawn(binary,['--version'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';
    for(const s of [v.stdout,v.stderr])s.on('data',p=>{text=(text+String(p)).slice(-1024);});const timer=setTimeout(()=>v.kill(),10000);const [code]=await once(v,'close');clearTimeout(timer);
    if(code!==0||text.trim()!==`${binaryVersion} (git sha: a390c168ff1b2d14e73a95991c186c6aba3ff5a0)`)throw Error('BINARY_VERSION_FAILED');text='';report.binary.versionVerified=true;
    target=targetFixture(record);const targetPort=await listen(target.server);let cpSequence=0;
    control=createServer((req,res)=>{const id=`control-${++cpSequence}`;const work=(async()=>{
      const url=new URL(req.url,'http://fixture');const pathClass=url.pathname.endsWith('/poll')?'poll':url.pathname==='/v1/tunnels/tunnel_00000000000000000000000000000000'?'tunnel-metadata':'other';
      await record({phase:'control-request',correlationId:id,pathClass,authorization:{present:hdrCount(req,'authorization')>0,count:count(hdrCount(req,'authorization'))}});
      if(req.headers.authorization!==`Bearer ${runtimeDummy}`||JSON.stringify(req.headers).includes(dummyKey)||req.method!=='GET'||pathClass==='other'){report.failures.push('CONTROL_BOUNDARY_FAILED');res.writeHead(403);res.end();return;}
      if(pathClass==='poll'){await new Promise(r=>setTimeout(r,100));res.writeHead(204);res.end();}
      else {res.writeHead(200,{'content-type':'application/json'});res.end('{"id":"tunnel_00000000000000000000000000000000","name":"isolated startup fixture"}');}
    })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>report.failures.push('CONTROL_INTERNAL_FAILED'));});
    const cpPort=await listen(control);report.ports={target:targetPort,control:cpPort};const profile=join(root,'probe.yaml');
    await writeFile(profile,`config_version: 1
control_plane:
  base_url: http://127.0.0.1:${cpPort}
  tunnel_id: tunnel_00000000000000000000000000000000
  api_key: env:CONTROL_PLANE_API_KEY
  poll_channels: [main]
mcp:
  server_urls:
    - channel: main
      url: http://127.0.0.1:${targetPort}/mcp/dots
  max_concurrent_requests: 1
  extra_headers:
    X-Pi-Console-Dots-Read-Key: env:PHASE1_DUMMY_KEY
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
    child=spawn(binary,['run','--profile-file',profile,'--control-plane.base-url',`http://127.0.0.1:${cpPort}`,'--control-plane.tunnel-id','tunnel_00000000000000000000000000000000',
      '--control-plane.api-key','env:CONTROL_PLANE_API_KEY','--control-plane.poll-channel=main','--mcp.server-url',`channel=main,url=http://127.0.0.1:${targetPort}/mcp/dots`,
      '--mcp.max-concurrent-requests','1','--health.listen-addr','127.0.0.1:0','--health.url-file',join(root,'health.url'),
      '--harpoon.hosts-include-loopback=false','--harpoon.hosts-include-private=false','--harpoon.allow-plaintext-http=false','--harpoon.capture-payloads=false',
      '--cloudflared.managed=false','--allow-remote-ui=false','--open-web-ui=false','--log.http-raw-unsafe=false','--log.format','json','--log.level','error'],
      {cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});report.startupRuns=1;
    child.once('close',()=>{childClosed=true;});ended=once(child,'close');void ended.catch(()=>{});for(const s of [child.stdout,child.stderr])s.on('data',p=>log.accept(p));
    const deadline=Date.now()+12000;let successfulAt=0;
    while(Date.now()<deadline&&!childClosed&&!report.failures.length){
      try {
        const url=(await readFile(join(root,'health.url'),'utf8')).trim();if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw Error('HEALTH_URL_FAILED');
        if([31717,31718,31719].includes(Number(new URL(url).port)))throw Error('HEALTH_PORT_FAILED');
        const mcp=await(await fetch(url+'/health/mcp',{signal:AbortSignal.timeout(1000)})).json();const ready=await fetch(url+'/readyz',{signal:AbortSignal.timeout(1000)});
        const oauth=await(await fetch(url+'/health/oauth',{signal:AbortSignal.timeout(1000)})).json();
        report.health={readyStatus:ready.status,startupProbe:probeState(mcp),oauthState:['not_advertised','failed','pending'].includes(oauth.state)?oauth.state:'other'};
        if(report.health.readyStatus===200&&report.health.startupProbe==='succeeded'&&target.results.some(e=>e.code==='MODERN_DISCOVERY_SUCCESS')){
          if(!successfulAt)successfulAt=Date.now();if(Date.now()-successfulAt>=500)break;
        }
      }catch{/* Bounded local health observation, no other destination or fallback. */}
      if(target.results.some(e=>e.observed?.rpcMethod==='initialize'))break;
      await new Promise(r=>setTimeout(r,50));
    }
    report.modernSuccess=target.results.some(e=>e.code==='MODERN_DISCOVERY_SUCCESS');report.legacyObserved=target.results.some(e=>e.observed?.rpcMethod==='initialize');
    report.binaryModernAccepted=report.modernSuccess&&report.health?.startupProbe==='succeeded';
    report.startupAccepted=report.binaryModernAccepted&&report.health?.readyStatus===200&&report.health?.oauthState==='not_advertised'&&!report.legacyObserved;
    if(!report.startupAccepted)report.failures.push('STARTUP_NOT_PROVEN');
  }catch(e){report.failures.push(['BINARY_PIN_MISMATCH','BINARY_VERSION_FAILED','INVALID_ATTEMPT'].includes(e.message)?e.message:'FIXTURE_INTERNAL_FAILED');}
  finally {
    try{if(child&&!childClosed){child.kill();await ended;}report.cleanup.childClosed=!child||childClosed;}catch{report.failures.push('CHILD_CLEANUP_FAILED');}
    try{if(target)await close(target.server);if(control)await close(control);await Promise.allSettled([...(target?.pending??[]),...pending]);report.cleanup.fixturesClosed=true;}catch{report.failures.push('FIXTURE_CLEANUP_FAILED');}
    await tail;if(h){try{await h.sync();await h.close();}catch{report.failures.push('JOURNAL_CLOSE_FAILED');}}
    report.dummySecretInClientLog=log.result();log.clear();if(report.dummySecretInClientLog.mcp||report.dummySecretInClientLog.control)report.failures.push('DUMMY_SECRET_IN_LOG');
    try{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});report.cleanup.tempRemoved=true;}catch{report.failures.push('TEMP_CLEANUP_FAILED');}
  }
  report.events=sequence;report.expectedDenials=target?.results.filter(e=>e.status!==200).map(e=>({correlationId:e.correlationId,code:e.code,status:e.status}))??[];
  report.osEgressAuditPerformed=false;report.productionOperationPerformed=false;report.workerQueueKitProviderEventsStarted=0;
  await writeFile(stem+'.json',safeJson(report)+'\n',{flag:'wx'});console.log(safeJson(report));process.exitCode=report.failures.length?2:0;
}
try{if(process.argv[2]==='--self-test')console.log(safeJson({selfTest:await selfTest()}));else if(process.argv[2])await run(process.argv[2],process.argv[3]??'1');else throw Error('EXPLICIT_BINARY_REQUIRED');}
catch{console.error('FIXTURE_STOPPED_WITHOUT_RAW_DIAGNOSTIC');process.exitCode=1;}
