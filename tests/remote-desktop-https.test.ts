import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {request} from 'node:https';
import {randomBytes,X509Certificate} from 'node:crypto';
import {createRemoteCredentialChannel} from '../server/remote-desktop/credential-channel.ts';
test('real loopback HTTPS validates its certificate and never returns the entered credential',{skip:process.platform!=='win32'},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pi-remote-tls-'));
 // The production ACL helper must create its own new private directory.
 const privateDir=join(directory,'private');const token=randomBytes(32).toString('base64');let registered=false;
 const channel=createRemoteCredentialChannel({directory:privateDir,setToken:async(name,role,value)=>{assert.equal(name,'caivi-vm');assert.equal(role,'gui');assert.equal(value.toString(),token);registered=true;}});
 try{
  const view=await channel.open(),url=new URL(view.url),grant=url.hash.slice(1);assert.equal(view.fingerprintSha256,new X509Certificate(view.certificatePem).fingerprint256.replaceAll(':',''));
  const send=(g:string)=>new Promise<{status:number;body:string}>((resolve,reject)=>{const req=request({hostname:url.hostname,port:url.port,path:'/token',method:'POST',ca:view.certificatePem,headers:{origin:url.origin,'content-type':'application/json','x-pi-remote-grant':g}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode!,body}));});req.on('error',reject);req.end(JSON.stringify({connection:'caivi-vm',role:'gui',token}));});
  assert.equal((await send('bad')).status,403);assert.equal(registered,false);
  const reply=await send(grant);assert.equal(reply.status,200);assert.equal(registered,true);assert.equal(reply.body.includes(token),false);
  const sealed=await readFile(join(privateDir,'credential-https.dpapi'));assert.equal(sealed.includes(Buffer.from('PRIVATE KEY')),false);
 }finally{await channel.close();if(resolve(directory).startsWith(resolve(tmpdir())+'\\pi-remote-tls-'))await rm(directory,{recursive:true,force:true});}
});
