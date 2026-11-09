import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const operations:Record<string,string>={inspect:'observe',screenshot:'screenshot',file_send:'put',caivi_click:'click',caivi_input:'input',caivi_drag:'drag'};
/** Existing Phase5/7 wire clients, unchanged. Secrets enter only the owned child's stdin. */
export async function remoteTransport(request:any):Promise<any>{
 const endpoint=request.endpoint,operation=operations[request.operation];
 if(!operation||!Buffer.isBuffer(request.token))throw Error('remote_transport_invalid');
 const payload=Buffer.from(JSON.stringify({role:operation==='put'?'transfer':'gui',operation,address:endpoint.address,port:endpoint.port,pin:endpoint.pinSha256,token:request.token.toString('utf8'),path:request.artifact?.path,name:request.artifact?.name,expectedHash:request.artifact?.sha256,expectedSize:request.artifact?.size}));
 return new Promise(resolve=>{
  const child=spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',fileURLToPath(new URL('./rpc.ps1',import.meta.url))],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  let bytes=0,failed=false;const chunks:Buffer[]=[];const timer=setTimeout(()=>{failed=true;child.kill()},85000);
  child.stdout.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>9*1024*1024){failed=true;child.kill()}else chunks.push(b)});
  child.stderr.on('data',()=>{failed=true});child.stdin.on('error',()=>{failed=true});
  child.once('error',()=>{failed=true});
  child.once('close',code=>{clearTimeout(timer);payload.fill(0);if(failed||code!==0)return resolve({ok:false,error:'remote_rpc_unconfirmed',outcome:'UNKNOWN'});
   try{const r=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));resolve({...r,result:r.result??(r.ok?{sha256:r.sha256,bytes:r.bytes}:undefined),authenticated:r.ok===true,outcome:r.ok?'KNOWN':(['unauthorized','target_mismatch','mutation_already_attempted'].includes(r.error)?'KNOWN':'UNKNOWN')})}catch{resolve({ok:false,error:'remote_rpc_unconfirmed',outcome:'UNKNOWN'})}
  });child.stdin.end(payload);
 });
}
