import assert from 'node:assert/strict';import {createServer} from 'node:http';import {once} from 'node:events';
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';
import {dummyReadKey} from '../final-answer.fixture.ts';
export async function startOwnerPin(root:string,targetBase:string){
 const binary=process.env.FINAL_TEST_BINARY;if(!binary)throw Error('EXPLICIT_BINARY_REQUIRED');const pin='1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42';assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),pin);
 const runtimeKey='owner_offline_dummy',queued:any[]=[],waiting=new Map<string,(r:any)=>void>();let sequence=0,failure=false,detected=false,tail='',closed=false,calls=0;
 const control=createServer(async(req,res)=>{try{assert.equal(req.headers.authorization,`Bearer ${runtimeKey}`);assert(!JSON.stringify(req.headers).includes(dummyReadKey));const u=new URL(req.url!,'http://fixture'),tunnel='/v1/tunnels/tunnel_00000000000000000000000000000000';
 if(req.method==='GET'&&u.pathname===tunnel){res.writeHead(200,{'content-type':'application/json'});res.end('{"id":"tunnel_00000000000000000000000000000000","name":"isolated owner"}');}
 else if(req.method==='GET'&&u.pathname===tunnel+'/poll'){assert.deepEqual(u.searchParams.getAll('channel'),['main']);if(!queued.length)await new Promise(r=>setTimeout(r,40));if(!queued.length){res.writeHead(204);res.end();}else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({commands:queued.splice(0,1)}));}}
 else if(req.method==='POST'&&u.pathname===tunnel+'/response'){assert.equal(req.headers['x-tunnel-shard-token'],'fixture_shard');const parts:Buffer[]=[];let size=0;for await(const p of req){size+=p.length;assert(size<256*1024);parts.push(Buffer.from(p));}const r=JSON.parse(Buffer.concat(parts).toString());assert(!JSON.stringify(r).includes(dummyReadKey));waiting.get(r.request_id)?.(r);waiting.delete(r.request_id);res.writeHead(200,{'content-type':'application/json'});res.end('{}');}
 else throw Error('FIXTURE_ROUTE');}catch{failure=true;res.writeHead(500);res.end();}});
 control.listen(0,'127.0.0.1');await once(control,'listening');const cpPort=(control.address() as any).port;assert(![31717,31718,31719].includes(cpPort));const profileRoot=join(root,'pin-profile');await mkdir(profileRoot);
 const env:NodeJS.ProcessEnv={SystemRoot:process.env.SystemRoot??'C:\\Windows',WINDIR:process.env.SystemRoot??'C:\\Windows',CONTROL_PLANE_API_KEY:runtimeKey,FINAL_DUMMY_READ_KEY:dummyReadKey};for(const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])env[k]=profileRoot;
 const profile=join(root,'pin.yaml');await writeFile(profile,`config_version: 1
control_plane:
  base_url: http://127.0.0.1:${cpPort}
  tunnel_id: tunnel_00000000000000000000000000000000
  api_key: env:CONTROL_PLANE_API_KEY
  poll_channels: [main]
mcp:
  server_urls:
    - channel: main
      url: ${targetBase}/mcp/dots
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
 const child=spawn(binary,['run','--profile-file',profile,'--control-plane.base-url',`http://127.0.0.1:${cpPort}`,'--control-plane.tunnel-id','tunnel_00000000000000000000000000000000','--control-plane.api-key','env:CONTROL_PLANE_API_KEY','--control-plane.poll-channel=main','--mcp.server-url',`channel=main,url=${targetBase}/mcp/dots`,'--mcp.max-concurrent-requests','1','--health.listen-addr','127.0.0.1:0','--health.url-file',join(root,'health.url'),'--harpoon.hosts-include-loopback=false','--harpoon.hosts-include-private=false','--harpoon.allow-plaintext-http=false','--harpoon.capture-payloads=false','--cloudflared.managed=false','--allow-remote-ui=false','--open-web-ui=false','--log.http-raw-unsafe=false','--log.format','json','--log.level','error'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.once('close',()=>closed=true);const ended=once(child,'close');void ended.catch(()=>{});
 for(const stream of [child.stdout!,child.stderr!])stream.on('data',b=>{const t=tail+String(b);detected ||= t.includes(dummyReadKey)||t.includes(runtimeKey);tail=t.slice(-128);});
 const cleanup=async()=>{if(!closed){child.kill();await ended;}control.closeAllConnections();await new Promise<void>(r=>control.close(()=>r()));tail='';assert(!detected&&!failure);};
 try{let health='';const deadline=Date.now()+10000;while(Date.now()<deadline&&!closed){try{health=(await readFile(join(root,'health.url'),'utf8')).trim();assert.match(health,/^http:\/\/127\.0\.0\.1:\d+$/);assert(![31717,31718,31719].includes(Number(new URL(health).port)));if((await fetch(health+'/readyz',{signal:AbortSignal.timeout(1000)})).status===200)break;}catch{}await new Promise(r=>setTimeout(r,30));}assert(health&&!closed&&!failure);assert.equal((await fetch(health+'/readyz')).status,200);
 }catch{await cleanup();throw Error('PIN_STARTUP_NOT_PROVEN');}
 return {pin,version:'0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0',calls:()=>calls,cleanup,async command(method:string,params:any={}){
  const id=++sequence,requestId=`owner_fixture_${id}`;let timer:ReturnType<typeof setTimeout>;const result=new Promise<any>((resolve,reject)=>{timer=setTimeout(()=>reject(Error('PIN_COMMAND_TIMEOUT')),8000);waiting.set(requestId,resolve);});
  queued.push({request_id:requestId,shard_token:'fixture_shard',command_type:'jsonrpc',channel:'main',created_at:new Date().toISOString(),response_timeout:'8s',headers:{'Mcp-Protocol-Version':['2026-07-28'],'Mcp-Method':[method],...(params.name?{'Mcp-Name':[params.name]}:{})},jsonrpc:{jsonrpc:'2.0',id,method,params:{...params,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:'dummy-keyholder',version:'1'}}}}});
  try{const r=await result;assert.equal(r.resp_code,200);assert.equal(r.resp_json.id,id);assert(!failure);if(method==='tools/call')calls++;return r.resp_json.result;}finally{clearTimeout(timer!);waiting.delete(requestId);}
 }};
}
