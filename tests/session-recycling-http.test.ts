import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

test('server-side retention API validates and persists configuration; recycling requires a known session', {timeout:30000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-retention-http-'));
  const port=32000+Math.floor(Math.random()*10000);
  const proc=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),PI_CONSOLE_DATA_DIR:root,PI_CONSOLE_PUBLIC_ORIGIN:'',PI_CONSOLE_ACCESS_TEAM_DOMAIN:'',PI_CONSOLE_ACCESS_AUD:''},stdio:'pipe'});
  let output='';proc.stdout.on('data',d=>output+=d.toString());proc.stderr.on('data',d=>output+=d.toString());
  try{
    const deadline=Date.now()+12000;while(!output.includes('pi-console http:')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));assert.match(output,/pi-console http:/);
    const request=async(path:string,method='GET',data?:unknown)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return {status:response.status,json:await response.json()}};
    assert.deepEqual((await request('/api/session-retention')).json,{enabled:false,days:30});
    assert.equal((await request('/api/session-retention','POST',{enabled:true,days:0})).status,400);
    assert.equal((await request('/api/session-retention','POST',{enabled:false,days:12})).status,200);
    assert.deepEqual((await request('/api/session-retention')).json,{enabled:false,days:12});
    assert.deepEqual(JSON.parse(await readFile(join(root,'session-retention.json'),'utf8')),{enabled:false,days:12});
    assert.equal((await request('/api/session/recycle','POST',{workspaceId:'missing',sessionId:'missing'})).status,400);
  }finally{proc.kill();await once(proc,'close').catch(()=>{});await rm(root,{recursive:true,force:true})}
});
