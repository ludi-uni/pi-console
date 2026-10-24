import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile, rm, appendFile } from 'node:fs/promises';
import {resolve,join} from 'node:path';
import { ownerGuiBinding } from '../package/owner-gui-dialog.mjs';
import { createWindowsTunnelLauncher, tunnelDisplay, assertTunnelLauncherFiles } from '../package/tunnel-key-dialog.mjs';
const tuple={requestId:'11111111-1111-4111-8111-111111111111',subject:'dummy-owner',issuer:'https://dummy.example',audience:'dummy-aud',pid:123,port:31717,startedAt:'2026-10-12T00:00:00Z',generation:'a'.repeat(32),expiresAt:Date.now()+120000};
const view={...tuple,bindingDigest:ownerGuiBinding(tuple),leaseUntil:tuple.expiresAt+60000};
const fake=()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();return child};
async function record(path,removed){
  assert(resolve(path).startsWith(resolve('C:/Users/leade/AppData/Local/Temp')+String.fromCharCode(92)+'pi-console-tunnel-'));
  const evidence=process.env.PI_CONSOLE_TEST_EVIDENCE_ROOT;
  if(evidence)await appendFile(join(evidence,'fake-launcher-fixtures.jsonl'),JSON.stringify({path,removed,actualProcessCreated:false})+'\n');
}
test('pinned scripts are source only and display contains no key values',async()=>{await assertTunnelLauncherFiles();const display=tunnelDisplay(view);assert(display.includes('保存なし'));assert(display.includes('実 App'));assert(!display.includes('CONTROL_PLANE_API_KEY'));assert.throws(()=>tunnelDisplay({...view,subject:'$(evil)'}))});
test('native invocation fixed, minimal env, stdin metadata only; ready != App proof',async()=>{
  let spec;const child=fake(),abort=new AbortController(),states=[];
  const launch=createWindowsTunnelLauncher({spawnProcess:(...args)=>{spec=args;return child}});
  const task=launch(view,{signal:abort.signal,onState:s=>states.push(s)});
  let payload='';child.stdin.on('data',b=>{payload+=b});
  while(!spec)await new Promise(r=>setImmediate(r));
  assert.equal(spec[0],'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(spec[1].slice(0,3),['-NoProfile','-STA','-File']);assert.equal(spec[2].windowsHide,false);assert.equal(spec[2].shell,false);
  assert(!('PATH' in spec[2].env));assert(!('CONTROL_PLANE_API_KEY' in spec[2].env));assert(!spec[1].join(' ').includes('dummy-owner'));
  assert.equal(JSON.parse(payload).requestId,view.requestId);
  child.stdout.write(JSON.stringify({requestId:view.requestId,state:'tunnel-ready'})+'\n');assert.deepEqual(states,['tunnel-ready']);
  abort.abort();assert(payload.includes('"action":"cancel"'));
  child.stderr.write('DUMMY_SECRET_MUST_BE_DISCARDED');
  child.stdout.write(JSON.stringify({requestId:view.requestId,state:'stopped'})+'\n');child.emit('close',0);
  assert.equal((await task).stopped,true);assert(!JSON.stringify(states).includes('DUMMY_SECRET'));await record(spec[2].cwd,true);
});
test('forged output, extra fields and silent launcher exit never verify cleanup',async()=>{
  let child,path;const task=createWindowsTunnelLauncher({spawnProcess:(_e,_a,o)=>{path=o.cwd;child=fake();return child}})(view,{signal:new AbortController().signal,onState:()=>{}});
  while(!child)await new Promise(r=>setImmediate(r));
  child.stdout.write(JSON.stringify({requestId:view.requestId,state:'stopped',key:'DUMMY'})+'\n');child.emit('close',0);
  assert.equal((await task).stopped,false);
  assert(resolve(path).startsWith(resolve('C:/Users/leade/AppData/Local/Temp')+String.fromCharCode(92)+'pi-console-tunnel-'));
  await rm(path,{recursive:true,force:true});await record(path,true);
});
test('pre-cancelled intent never spawns a window',async()=>{const a=new AbortController();a.abort();let count=0;const r=await createWindowsTunnelLauncher({spawnProcess:()=>{count++;return fake()}})(view,{signal:a.signal,onState:()=>{}});assert.equal(count,0);assert.equal(r.stopped,true)});
test('different Console port is refused before native spawn, with confirmed no-process result',async()=>{let count=0;const states=[];const tuple={...view,port:31718};delete tuple.bindingDigest;const invalid={...tuple,bindingDigest:ownerGuiBinding(Object.fromEntries(Object.entries(tuple).filter(([k])=>k!=='leaseUntil')))};const r=await createWindowsTunnelLauncher({spawnProcess:()=>{count++;return fake()}})(invalid,{signal:new AbortController().signal,onState:s=>states.push(s)});assert.equal(count,0);assert.equal(r.stopped,true);assert.deepEqual(states,['unavailable'])});
test('PowerShell source keeps 14pt masked field, default cancel, key wipe and safe output',async()=>{
  const source=await readFile(new URL('../package/tunnel-key-dialog.ps1',import.meta.url),'utf8');
  for(const item of ['[single]14','UseSystemPasswordChar=$true','$form.AcceptButton=$cancel','$password.Clear()','Clear-CompanionParentKey $info','Get-CimInstance','ParentProcessId','Local\\PiConsoleEchoTunnelInput'])assert(source.includes(item),item);
  assert(!/-Property[^\n]*CommandLine/.test(source));assert(!source.includes('Invoke-Expression'));assert(!source.includes('Write-Host'));assert(!source.includes('Set-Content'));
  const binding=await readFile(new URL('../package/tunnel-binding.psm1',import.meta.url),'utf8');
  assert(binding.includes("tunnel_6ac2eee6ba208191ae0a8d1873390b4d"));assert(!binding.includes('DOLL'));assert(binding.includes("$info.EnvironmentVariables.Clear()"));
});
