import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,stat,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {consoleDataDir} from '../package/data-directory.mjs';
import {startManagedServer,stopManagedServer} from '../package/server-manager.mjs';

test('package startup keeps workspace registrations outside replaceable package cwd', {timeout:20000}, async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-data-dir-'));
  const agentDir=join(root,'agent'),workspace=join(root,'workspace'),installedCwd=join(root,'replaceable-package');
  await mkdir(workspace);await mkdir(installedCwd);await mkdir(join(agentDir,'pi-console'),{recursive:true});
  const metadata=join(agentDir,'pi-console','workspaces.json');
  await writeFile(metadata,JSON.stringify({workspaces:[{id:'saved',name:'Saved workspace',path:workspace,pinned:false,lastOpenedAt:new Date().toISOString()}],quickPrompts:['Saved prompt']}));
  assert.equal(consoleDataDir({PI_CODING_AGENT_DIR:agentDir,PI_CONSOLE_DATA_DIR:''}),join(agentDir,'pi-console'));
  assert.equal(consoleDataDir({PI_CODING_AGENT_DIR:agentDir,PI_CONSOLE_DATA_DIR:join(root,'explicit')}),join(root,'explicit'));
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;probe.close();await once(probe,'close');
  const env={...process.env,PORT:String(port),PI_CONSOLE_DATA_DIR:'',PI_CODING_AGENT_DIR:agentDir,PI_CONSOLE_PUBLIC_ORIGIN:'',PI_CONSOLE_ACCESS_TEAM_DOMAIN:'',PI_CONSOLE_ACCESS_AUD:''};
  try{
    // startup.mjs now runs the same shared manager: state lands under the agent
    // directory even when invoked from a replaceable package cwd.
    const started=await startManagedServer({env:{...env,PI_CONSOLE_PI_COMMAND:join(process.env.APPDATA||'','npm','node_modules','@earendil-works','pi-coding-agent','dist','bundle','cli.js')}});
    assert.equal(started.status,'running');assert.equal(started.changed,true);
    let response;const until=Date.now()+12000;
    while(Date.now()<until){try{response=await fetch(`http://127.0.0.1:${port}/api/workspaces`);break}catch{await new Promise(resolve=>setTimeout(resolve,50))}}
    assert.equal(response?.status,200);
    assert.deepEqual((await response.json()).workspaces.map(item=>item.name),['Saved workspace']);
    assert.equal(JSON.parse(await readFile(metadata,'utf8')).quickPrompts[0],'Saved prompt');
    await assert.rejects(stat(join(installedCwd,'.pi-console')),{code:'ENOENT'});
    const stopped=await stopManagedServer({env:{...env,PI_CONSOLE_DATA_DIR:join(agentDir,'pi-console')}});
    assert.equal(stopped.status,'stopped');
  }finally{await stopManagedServer({env:{...env,PI_CONSOLE_DATA_DIR:join(agentDir,'pi-console')}}).catch(()=>{});await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
});
