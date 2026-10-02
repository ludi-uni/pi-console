import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { loadConsoleEnvironment } from '../package/environment.mjs';
import { startConsole } from '../package/launcher.mjs';
import { managedServerStatus, stopManagedServer } from '../package/server-manager.mjs';

const availablePort = async () => {
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;probe.close();await once(probe,'close');return port;
};
const status = (port, host) => new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port,path:'/',headers:{Host:host}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
  req.setTimeout(2000,()=>req.destroy(new Error('HTTP timed out')));req.on('error',reject);req.end();
});
const isolatedEnv = root => {
  const env={...process.env,PI_CODING_AGENT_DIR:join(root,'agent'),PI_CONSOLE_DATA_DIR:join(root,'stable config')};
  for(const name of ['PORT','PI_CONSOLE_PUBLIC_ORIGIN','PI_CONSOLE_ACCESS_TEAM_DOMAIN','PI_CONSOLE_ACCESS_AUD','PI_CONSOLE_PI_COMMAND'])delete env[name];
  return env;
};
// Node's double-quoted .env syntax interprets \\n; use forward slashes for Windows paths.
const piCli=join(process.env.APPDATA || '', 'npm','node_modules','@earendil-works','pi-coding-agent','dist','bundle','cli.js').replaceAll('\\','/');
const remoteFile = port => `PORT=${port}\nPI_CONSOLE_PUBLIC_ORIGIN="https://console.example.test"\nPI_CONSOLE_ACCESS_TEAM_DOMAIN=https://test-team.cloudflareaccess.com\nPI_CONSOLE_ACCESS_AUD=${'a'.repeat(64)}\nPI_CONSOLE_PI_COMMAND="${piCli}"\n`;

test('stable Console .env supports quoted values, precedence, missing files and read errors without changing host env',async()=>{
  const root=await mkdtemp(join(tmpdir(),'console-env-'));
  const agent=join(root,'agent'),data=join(agent,'pi-console');
  const env={PI_CODING_AGENT_DIR:agent,PORT:'32123',EMPTY:'',UNCHANGED:'parent'};
  try{
    await mkdir(data,{recursive:true});
    await writeFile(join(data,'.env'),'PORT=40000\nEMPTY=file\nexport LABEL="name # with spaces"\nFILE_ONLY=value\n');
    const loaded=await loadConsoleEnvironment(env);
    assert.equal(loaded.PORT,'32123');assert.equal(loaded.EMPTY,'');assert.equal(loaded.LABEL,'name # with spaces');
    assert.equal(loaded.FILE_ONLY,'value');assert.equal(loaded.UNCHANGED,'parent');
    assert.deepEqual(env,{PI_CODING_AGENT_DIR:agent,PORT:'32123',EMPTY:'',UNCHANGED:'parent'});
    const explicit=join(root,'explicit');await mkdir(explicit);await writeFile(join(explicit,'.env'),'FILE_ONLY=explicit\n');
    assert.equal((await loadConsoleEnvironment({...env,PI_CONSOLE_DATA_DIR:explicit})).FILE_ONLY,'explicit');
    const missing={PI_CODING_AGENT_DIR:join(root,'missing')};assert.deepEqual(await loadConsoleEnvironment(missing),missing);
    const unreadable=join(root,'unreadable');await mkdir(join(unreadable,'.env'),{recursive:true});
    await assert.rejects(loadConsoleEnvironment({PI_CONSOLE_DATA_DIR:unreadable}));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('Pi launcher reads stable remote configuration before port selection and ignores workspace .env', {timeout:20000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'console-env-launcher-')),env=isolatedEnv(root),port=await availablePort();
  let child;
  try{
    const workspace=join(root,'workspace');await mkdir(workspace);await mkdir(env.PI_CONSOLE_DATA_DIR);
    await writeFile(join(env.PI_CONSOLE_DATA_DIR,'.env'),remoteFile(port));
    await writeFile(join(workspace,'.env'),'PORT=invalid\nPI_CONSOLE_PUBLIC_ORIGIN=https://evil.example.test\n');
    const running=await startConsole({cwd:workspace,env});child=running.child;
    assert.equal(running.url,'https://console.example.test');
    assert.equal(env.PORT,undefined);assert.equal(env.PI_CONSOLE_PUBLIC_ORIGIN,undefined);
    assert.equal(await status(port,'console.example.test'),401); // correct Host, missing Access JWT
    assert.equal(await status(port,'evil.example.test'),403);
    assert.equal(await status(port,`127.0.0.1:${port}`),403);
  }finally{if(child){child.kill();await once(child,'close');}await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('Windows startup entry uses the same stable remote .env and ignores cwd .env', {timeout:30000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'console-env-startup-')),env=isolatedEnv(root),port=await availablePort();
  let child;
  try{
    const cwd=join(root,'replaceable-package');await mkdir(cwd);await mkdir(env.PI_CONSOLE_DATA_DIR);
    await writeFile(join(env.PI_CONSOLE_DATA_DIR,'.env'),remoteFile(port));
    await writeFile(join(cwd,'.env'),'PORT=invalid\n');
    // The launcher exits after handing the detached managed server off; server output
    // goes to <data>/server.log, not the launcher's stdout.
    child=spawn(process.execPath,['--import',import.meta.resolve('tsx'),fileURLToPath(new URL('../package/startup.mjs',import.meta.url))],{cwd,env,stdio:'pipe'});
    const [code]=await once(child,'close');
    assert.equal(code,0,'startup entry must exit after spawning the managed server');
    const managed=await managedServerStatus({env});
    assert.equal(managed.status,'running');assert.equal(managed.port,port);
    assert.equal(await status(port,'console.example.test'),401);
    assert.equal(await status(port,'evil.example.test'),403);
  }finally{
    // Always stop the managed child through the manager — never leave it alive.
    await stopManagedServer({env}).catch(()=>{});
    if(child&&child.exitCode===null){child.kill();await once(child,'close');}
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});

test('partial remote .env fails startup instead of silently serving in local mode', {timeout:20000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'console-env-partial-')),env=isolatedEnv(root),port=await availablePort();
  try{
    await mkdir(env.PI_CONSOLE_DATA_DIR);
    await writeFile(join(env.PI_CONSOLE_DATA_DIR,'.env'),`PORT=${port}\nPI_CONSOLE_PI_COMMAND="${piCli}"\nPI_CONSOLE_PUBLIC_ORIGIN=https://console.example.test\n`);
    await assert.rejects(startConsole({cwd:root,env}),/Remote mode requires/);
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
