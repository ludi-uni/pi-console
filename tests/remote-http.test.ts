import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';

test('remote-mode HTTP fails closed for HTML, API, SSE, invalid Host and forged tokens', {timeout:30000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-remote-'));
  const port=32000+Math.floor(Math.random()*10000);
  const proc=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),PI_CONSOLE_DATA_DIR:root,PI_CONSOLE_PUBLIC_ORIGIN:'https://console.example.com',PI_CONSOLE_ACCESS_TEAM_DOMAIN:'https://test-team.cloudflareaccess.com',PI_CONSOLE_ACCESS_AUD:'a'.repeat(64)},stdio:'pipe'});
  let output='';proc.stdout.on('data',d=>output+=d.toString());proc.stderr.on('data',d=>output+=d.toString());
  try {
    const deadline=Date.now()+12000;while(!output.includes('pi-console http:')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));assert.match(output,/pi-console http:/);
    const request=(path:string,headers:Record<string,string>={},method='GET')=>new Promise<{status:number}>((resolve,reject)=>{
      const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{Host:'console.example.com',...headers}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode!}));});req.on('error',reject);req.end();
    });
    assert.equal((await request('/')).status,401);
    assert.equal((await request('/api/workspaces')).status,401);
    assert.equal((await request('/api/activity')).status,401);
    assert.equal((await request('/api/startup')).status,401);
    assert.equal((await request('/api/startup',{},'POST')).status,401);
    assert.equal((await request('/api/session-retention')).status,401);
    assert.equal((await request('/api/session-retention',{},'POST')).status,401);
    assert.equal((await request('/api/session/recycle',{},'POST')).status,401);
    assert.equal((await request('/api/directories?path=C%3A%5C')).status,401);
    assert.equal((await request('/api/directories/create',{},'POST')).status,401);
    assert.equal((await request('/api/pets')).status,401);
    assert.equal((await request('/api/pet/file?pet=fio-observer&file=spritesheet.webp')).status,401);
    assert.equal((await request('/api/session/options?workspaceId=x&sessionId=y')).status,401);
    assert.equal((await request('/api/session/model',{},'POST')).status,401);
    assert.equal((await request('/api/session/thinking',{},'POST')).status,401);
    assert.equal((await request('/api/prompt',{},'POST')).status,401);
    assert.equal((await request('/api/events')).status,401);
    assert.equal((await request('/sw.js')).status,401);
    assert.equal((await request('/',{'cf-access-jwt-assertion':'not-a-jwt'})).status,401);
    assert.equal((await request('/',{Host:'127.0.0.1:31717'})).status,403);
    const response=await request('/api/workspaces',{Origin:'https://evil.example.com','Content-Type':'application/json'},'POST');assert.equal(response.status,401);
  }finally{proc.kill();await once(proc,'close').catch(()=>{});await rm(root,{recursive:true,force:true});}
});
