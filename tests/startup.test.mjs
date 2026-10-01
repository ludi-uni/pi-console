import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {startupStatus,setStartup,ensureStartupOnPiSession} from '../package/startup-manager.mjs';

test('first interactive Pi session registers only its own shortcut; Settings off persists and removes it', {skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-startup-'));const agentDir=join(root,'agent'),startupDir=join(root,'Startup');await mkdir(startupDir);
  const opts={agentDir,startupDir};const link=join(startupDir,'Pi Console.lnk');
  try{
    assert.deepEqual(await startupStatus(opts),{supported:true,enabled:true,installed:false,conflict:false});
    await ensureStartupOnPiSession(opts);assert.equal((await startupStatus(opts)).installed,true);
    const inspect=`$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${link.replaceAll("'","''")}');Write-Output $s.Arguments`;
    const {stdout:argumentsText}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(inspect,'utf16le').toString('base64')],{windowsHide:true});
    assert.match(argumentsText,/--import tsx/);assert.doesNotMatch(argumentsText,/--env-file/);
    await ensureStartupOnPiSession(opts);assert.equal((await stat(link)).isFile(),true);
    assert.equal((await setStartup(false,opts)).installed,false);
    assert.deepEqual(JSON.parse(await readFile(join(agentDir,'pi-console','startup.json'),'utf8')),{enabled:false});
    await ensureStartupOnPiSession(opts);assert.equal((await startupStatus(opts)).installed,false);
    assert.equal((await setStartup(true,opts)).installed,true);
    assert.equal((await setStartup(false,opts)).enabled,false);
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
});

test('an unrelated same-name Startup shortcut is never overwritten or removed', {skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-startup-foreign-'));const startupDir=join(root,'Startup');await mkdir(startupDir);const opts={agentDir:join(root,'agent'),startupDir};const link=join(startupDir,'Pi Console.lnk');
  try{
    await setStartup(true,opts);
    const literal=`'${link.replaceAll("'","''")}'`;
    const script=`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${literal});$s.Description='Unrelated program';$s.Save()`;
    await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});
    assert.equal((await startupStatus(opts)).conflict,true);
    await assert.rejects(setStartup(true,opts),/unrelated Startup entry/);
    assert.equal((await setStartup(false,opts)).installed,false);assert.equal((await stat(link)).isFile(),true);
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
});

test('startup entry starts a separate loopback server and exits if a listener already exists',async()=>{
  const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;
  const child=spawn(process.execPath,['package/startup.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port)},stdio:'ignore'});
  try{const [code]=await once(child,'close');assert.equal(code,0);assert.equal(listener.listening,true)}finally{listener.close();await once(listener,'close')}
  const root=await mkdtemp(join(tmpdir(),'pi-console-startup-server-'));
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const freePort=probe.address().port;probe.close();await once(probe,'close');
  const server=spawn(process.execPath,['--import','tsx','package/startup.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(freePort),PI_CONSOLE_DATA_DIR:root,PI_CODING_AGENT_DIR:join(root,'agent'),PI_CONSOLE_PUBLIC_ORIGIN:'',PI_CONSOLE_ACCESS_TEAM_DOMAIN:'',PI_CONSOLE_ACCESS_AUD:''},stdio:'pipe'});
  let stderr='';server.stderr.on('data',chunk=>stderr+=chunk.toString());
  try{let response;const until=Date.now()+10000;while(Date.now()<until){try{response=await fetch(`http://127.0.0.1:${freePort}/api/session-retention`);break}catch{await new Promise(resolve=>setTimeout(resolve,50))}}assert.equal(response?.status,200,stderr);assert.equal((await response.json()).enabled,false)}
  finally{server.kill();await once(server,'close').catch(()=>{});await rm(root,{recursive:true,force:true})}
});
