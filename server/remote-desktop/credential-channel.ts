import {createServer,type Server} from 'node:https';
import {X509Certificate,randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readJsonBody} from '../body.ts';
import {createWindowsProtection,runWindowsHelper} from '../local-mcp-windows.mjs';
import {ensureRemotePrivateDirectory} from './private-directory.ts';
const generate=String.raw`$ErrorActionPreference='Stop'
$rsa=[Security.Cryptography.RSACng]::new(2048)
try{
 $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Pi Console Remote Credentials localhost',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
 $san=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new();$san.AddDnsName('localhost');$san.AddIpAddress([Net.IPAddress]::Parse('127.0.0.1'));$request.CertificateExtensions.Add($san.Build())
 $cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1),[DateTimeOffset]::UtcNow.AddDays(30))
 try{[Console]::Out.Write([Convert]::ToBase64String($cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,'')))}finally{$cert.Dispose()}
}finally{$rsa.Dispose()}`;
/** Dedicated loopback HTTPS for credential entry only. No trust-store installation or TOFU. */
export function createRemoteCredentialChannel({directory,setToken}:{directory:string;setToken:(name:string,role:'gui'|'transfer',token:Buffer)=>Promise<unknown>}){
 let server:Server|undefined,opening:Promise<void>|undefined,origin='',fingerprint='',expiresUtc='',certificatePem='';const grants=new Map<string,number>();
 const openServer=async()=>{
  await ensureRemotePrivateDirectory(directory);
  const codec=createWindowsProtection({authorized:true}),entropy=Buffer.from('pi-console/remote-credential-https/v1'),file=join(directory,'credential-https.dpapi');
  let sealed:Buffer;
  try{sealed=await readFile(file);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const raw=await runWindowsHelper(generate,Buffer.alloc(0));const pfx=Buffer.from(raw.toString(),'base64');raw.fill(0);try{sealed=await codec.protect(pfx,entropy);await writeFile(file,sealed,{flag:'wx',mode:0o600});}finally{pfx.fill(0);}}
  const pfx=await codec.unprotect(sealed,entropy);
  try{
   server=createServer({pfx,passphrase:'',minVersion:'TLSv1.2'},async(req,res)=>{
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
    const send=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    const native=req.socket.remoteAddress==='127.0.0.1'&&req.headers.host===new URL(origin).host&&!Object.keys(req.headers).some(k=>k==='forwarded'||k==='via'||k.startsWith('x-forwarded-')||k.startsWith('cf-'));
    if(!native){send(403,{error:'local_https_required'});return;}
    if(req.method==='GET'&&req.url==='/'){
     res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><title>Pi Console — Remote credential registration</title><h1>Remote認証情報の登録</h1><p>接続名 caivi-vm。GUIとTransferは別tokenです。証明書fingerprintを通常Consoleの表示と確認してから入力してください。</p><label>Role<select id="role"><option>gui</option><option>transfer</option></select></label><label>token<input id="token" type="password" autocomplete="off" spellcheck="false"></label><button id="save">登録／更新</button><p id="result" role="status"></p><script src="/entry.js"></script></html>');return;
    }
    if(req.method==='GET'&&req.url==='/entry.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end("const grant=location.hash.slice(1);history.replaceState(null,'','/');document.querySelector('#save').onclick=async()=>{const input=document.querySelector('#token');const token=input.value;input.value='';try{const r=await fetch('/token',{method:'POST',headers:{'content-type':'application/json','x-pi-remote-grant':grant},body:JSON.stringify({connection:'caivi-vm',role:document.querySelector('#role').value,token})});document.querySelector('#result').textContent=r.ok?'登録しました。秘密値は再表示しません。':'登録を拒否しました。Consoleで状態を確認してください。';}catch{document.querySelector('#result').textContent='結果未確認。再送せずConsoleで状態を確認してください。';}};");return;}
    if(req.method!=='POST'||req.url!=='/token'||req.headers.origin!==origin||req.headers['content-type']!=='application/json'){send(403,{error:'credential_registration_refused'});return;}
    const grant=req.headers['x-pi-remote-grant'];const until=typeof grant==='string'?grants.get(grant):undefined;
    if(!until||until<Date.now()){send(403,{error:'credential_grant_expired'});return;}
    try{const b=await readJsonBody(req,1024);if(Object.keys(b).sort().join(',')!=='connection,role,token'||b.connection!=='caivi-vm'||!['gui','transfer'].includes(b.role)||typeof b.token!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(b.token))throw Error();const token=Buffer.from(b.token);try{await setToken(b.connection,b.role,token);}finally{token.fill(0);b.token='';}send(200,{registered:true});}catch{send(409,{error:'credential_registration_refused'});}
   });
   // Certificate metadata comes from the owned PFX, never from a remote endpoint.
   const derText=await runWindowsHelper("$ErrorActionPreference='Stop';$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$c=[Security.Cryptography.X509Certificates.X509Certificate2]::new($b,'');try{[Console]::Out.Write([Convert]::ToBase64String($c.RawData))}finally{$c.Dispose();[Array]::Clear($b,0,$b.Length)}",Buffer.from(pfx.toString('base64')));
   const cert=new X509Certificate(Buffer.from(derText.toString(),'base64'));certificatePem=cert.toString();fingerprint=cert.fingerprint256.replaceAll(':','');expiresUtc=new Date(cert.validTo).toISOString();
   if(Date.parse(expiresUtc)<=Date.now())throw Error('remote_management_certificate_expired');
   await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(0,'127.0.0.1',()=>resolve());});const address=server.address();if(!address||typeof address==='string')throw Error('remote_https_unavailable');origin='https://127.0.0.1:'+address.port;
  }finally{pfx.fill(0);}
 };
 return{async open(){if(!server?.listening){opening??=openServer();try{await opening;}finally{opening=undefined;}}for(const[g,until]of grants)if(until<Date.now())grants.delete(g);if(grants.size>=8)throw Error('remote_credential_grant_capacity');const grant=randomBytes(32).toString('hex');grants.set(grant,Date.now()+10*60*1000);return{url:origin+'/#'+grant,fingerprintSha256:fingerprint,expiresUtc,certificatePem,requiresCertificateConfirmation:true};},async close(){grants.clear();server?.closeAllConnections();if(server?.listening)await new Promise<void>(r=>server!.close(()=>r()));}};
}
