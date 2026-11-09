// Upstream v0.9.0 CLI/cache contracts and cancellation regressions.
// All executable, PowerShell, network and model effects are injected fakes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { SpeechCppService } from '../server/speech-cpp.ts';
import { fakeSpawn, fakeFetch, versionSpec, modelsSpec, serveSpec, jsonResponse, bytesResponse, releaseJson, FAKE_ZIP, FakeProcess } from './helpers/speech.fixture.ts';

const owner=()=>{};
const enableExisting=(exe:string,allowDownload=false)=>({source:'existing',executablePath:exe,modelId:'qwen3-asr-0.6b',confirmed:true,allowDownload});
const enableManaged={source:'managed',modelId:'qwen3-asr-0.6b',confirmed:true,allowDownload:true};
async function until(check:()=>boolean){for(let i=0;i<500;i++){if(check())return;await new Promise(r=>setTimeout(r,2));}assert.fail('fixture did not reach expected state');}
async function done(service:SpeechCppService){await until(()=>service.ownerStatus().job?.state!=='running');await new Promise(r=>setImmediate(r));return service.ownerStatus().job!;}
async function files(){
 const dataDir=await mkdtemp(join(tmpdir(),'pi speech 日本語-'));
 const exe=join(dataDir,'Program Files','speech.exe'),gguf=join(dataDir,'voice','models','repo--model','sha','Qwen3-ASR-0.6B-Q8_0.gguf');
 await mkdir(join(exe,'..'),{recursive:true});await writeFile(exe,'MZ');
 await mkdir(join(gguf,'..'),{recursive:true});await writeFile(gguf,'GGUF');
 return{dataDir,exe,gguf};
}
async function managed(failExtract=false){
 const f=await files();let fail=failExtract;
 const {spawn,calls}=fakeSpawn([versionSpec(),modelsSpec({'qwen3-asr-0.6b':[f.gguf]}),{
  match:file=>file.endsWith('powershell.exe'),
  run:async(p,call)=>{
   assert.ok(isAbsolute(call.file));assert.equal(call.options.shell,false);
   assert.deepEqual(call.options.stdio,['pipe','pipe','pipe']);
   assert.deepEqual(call.args.slice(0,3),['-NoProfile','-NonInteractive','-EncodedCommand']);
   assert.equal(call.args.length,4,'EncodedCommand must have no trailing path arguments');
   const script=Buffer.from(call.args[3],'base64').toString('utf16le');
   assert.ok(script.includes('[Console]::In.ReadToEnd()'));assert.ok(!script.includes('$args['));
   const input=JSON.parse(p.stdinText);assert.ok(input.destination.startsWith(join(f.dataDir,'voice','speech-install-')));
   assert.ok(!script.includes(input.destination),'paths are data, not PowerShell source');
   await writeFile(join(input.destination,'speech.exe'),'MZ');p.finish(fail?1:0);
  },
 }]);
 const {fetch,calls:fetchCalls}=fakeFetch([
  {match:u=>u.endsWith('/releases/latest'),respond:()=>jsonResponse(releaseJson(FAKE_ZIP))},
  {match:u=>u.endsWith('.zip'),respond:()=>bytesResponse(FAKE_ZIP)},
 ]);
 const service=new SpeechCppService({dataDir:f.dataDir,deps:{platform:'win32',arch:'x64',spawn,fetch,killTree:async()=>{}}});await service.load();
 return{...f,service,calls,fetchCalls,retry:()=>{fail=false;}};
}

describe('real speech.cpp cache and installation contracts',()=>{
 it('adopts cached files in spaced Unicode paths without shell parsing or downloading',async()=>{
  const f=await files();const {spawn,calls}=fakeSpawn([versionSpec(),modelsSpec({'qwen3-asr-0.6b':[f.gguf]})]);
  const service=new SpeechCppService({dataDir:f.dataDir,deps:{platform:'win32',arch:'x64',spawn,fetch:async()=>{throw Error('unexpected network');}}});await service.load();
  await service.enable(enableExisting(f.exe),owner);assert.equal((await done(service)).state,'done');
  assert.equal(calls[0].file,f.exe);assert.equal(calls[0].options.shell,false);
  assert.equal(service.ownerStatus().executablePath,f.exe);
 });
 it('rejects missing, unfetched, and outside-root catalog paths instead of trusting directory metadata',async()=>{
  for(const mode of ['unfetched','missing','outside'] as const){
   const f=await files(),root=join(f.dataDir,'voice','models');
   const path=mode==='missing'?join(root,'not-downloaded.gguf'):f.gguf;
   const {spawn,calls}=fakeSpawn([versionSpec(),{match:(_f,a)=>a[0]==='models',run:p=>p.finish(0,JSON.stringify({version:'0.9.0',directory:mode==='outside'?f.dataDir:root,models:[{name:'qwen3-asr-0.6b',type:'Q8_0',files:[{type:'Q8_0',path,fetched:mode!=='unfetched',partial:0}]}],old:[]}))}]);
   const service=new SpeechCppService({dataDir:f.dataDir,deps:{platform:'win32',arch:'x64',spawn,fetch:async()=>{throw Error('unexpected network');}}});await service.load();
   await service.enable(enableExisting(f.exe),owner);assert.equal((await done(service)).error,'speech_model_not_cached',mode);
   assert.ok(!calls.some(c=>c.args[0]==='pull'),mode);
  }
 });
 it('skips an absent default variant and chooses a fetched GGUF that actually exists',async()=>{
  const f=await files(),root=join(f.dataDir,'voice','models');
  const {spawn}=fakeSpawn([versionSpec(),{match:(_f,a)=>a[0]==='models',run:p=>p.finish(0,JSON.stringify({directory:root,models:[{name:'qwen3-asr-0.6b',type:'Q8_0',files:[{type:'Q8_0',path:join(root,'absent.gguf'),fetched:false},{type:'Q4_K_M',path:f.gguf,fetched:true}]}]}))}]);
  const service=new SpeechCppService({dataDir:f.dataDir,deps:{platform:'win32',arch:'x64',spawn}});await service.load();
  await service.enable(enableExisting(f.exe),owner);assert.equal((await done(service)).state,'done');
  assert.equal(JSON.parse(await readFile(join(f.dataDir,'voice','settings.json'),'utf8')).modelFile,f.gguf);
 });
 it('publishes a staged install, reuses only a verified receipt, and rejects later tampering',async()=>{
  const f=await managed();await f.service.enable(enableManaged,owner);assert.equal((await done(f.service)).state,'done');
  const installed=join(f.dataDir,'voice','speech-cpp','speech.exe');assert.equal(await readFile(installed,'utf8'),'MZ');
  const receipt=JSON.parse(await readFile(join(installed,'..','managed.json'),'utf8'));assert.match(receipt.executableSha256,/^[0-9a-f]{64}$/);
  await f.service.disable(owner);const downloads=f.fetchCalls.length;
  await f.service.enable(enableManaged,owner);assert.equal((await done(f.service)).state,'done');
  assert.equal(f.fetchCalls.length,downloads,'verified managed cache reuse is offline');
  assert.equal(f.calls.filter(c=>c.file.endsWith('powershell.exe')).length,1);
  await f.service.disable(owner);await writeFile(installed,'changed executable');const executions=f.calls.length;
  await f.service.enable(enableManaged,owner);assert.equal((await done(f.service)).error,'speech_install_conflict');
  assert.equal(f.calls.length,executions,'unverified file must not execute');assert.equal(f.fetchCalls.length,downloads);
 });
 it('does not adopt or overwrite an arbitrary executable already occupying the managed directory',async()=>{
  const f=await managed(),installed=join(f.dataDir,'voice','speech-cpp','speech.exe');await mkdir(join(installed,'..'),{recursive:true});await writeFile(installed,'unknown');
  await f.service.enable(enableManaged,owner);assert.equal((await done(f.service)).error,'speech_install_conflict');
  assert.equal(f.calls.length,0);assert.equal(f.fetchCalls.length,0);assert.equal(await readFile(installed,'utf8'),'unknown');
 });
 it('removes partial extraction before a clean retry and never runs the partial executable',async()=>{
  const f=await managed(true);await f.service.enable(enableManaged,owner);assert.equal((await done(f.service)).error,'speech_extract_failed');
  assert.equal(await stat(join(f.dataDir,'voice','speech-cpp')).then(()=>true,()=>false),false);
  assert.ok(!(await readdir(join(f.dataDir,'voice'))).some(n=>n.startsWith('speech-install-')));
  assert.ok(!f.calls.some(c=>c.args[0]==='--version'));
  f.retry();await f.service.enable(enableManaged,owner);assert.equal((await done(f.service)).state,'done');
 });
});

describe('owned startup and command cancellation',()=>{
 it('cancels identity probing immediately and kills the tree before its parent',async()=>{
  const f=await files();let child:FakeProcess|undefined,aliveAtKill=false;
  const {spawn,calls}=fakeSpawn([{match:()=>true,run:p=>{child=p;}}]);
  const service=new SpeechCppService({dataDir:f.dataDir,deps:{platform:'win32',arch:'x64',spawn,killTree:async()=>{aliveAtKill=child?.exitCode===null;}}});await service.load();
  await service.enable(enableExisting(f.exe,true),owner);await until(()=>!!child);await service.cancel(owner);
  assert.equal(service.ownerStatus().job?.state,'cancelled');assert.equal(aliveAtKill,true);assert.equal(child?.killed,true);
  assert.deepEqual(calls.map(c=>c.args[0]),['--version']);
 });
 it('cancels a metadata probe without falling through into an authorized model download',async()=>{
  const f=await files();let child:FakeProcess|undefined;
  const {spawn,calls}=fakeSpawn([versionSpec(),{match:(_f,a)=>a[0]==='models',run:p=>{child=p;}}]);
  const service=new SpeechCppService({dataDir:f.dataDir,deps:{platform:'win32',arch:'x64',spawn,killTree:async()=>{}}});await service.load();
  await service.enable(enableExisting(f.exe,true),owner);await until(()=>!!child);await service.cancel(owner);
  assert.equal(service.ownerStatus().job?.state,'cancelled');assert.equal(child?.killed,true);assert.ok(!calls.some(c=>c.args[0]==='pull'));
 });
 it('disables a pending lazy startup before releasing the job slot or launching another server',async()=>{
  const f=await files();let child:FakeProcess|undefined,aliveAtKill=false;
  const {spawn,calls}=fakeSpawn([versionSpec(),modelsSpec({'qwen3-asr-0.6b':[f.gguf]}),{match:(_f,a)=>a[0]==='serve',run:p=>{child=p;}}]);
  const service=new SpeechCppService({dataDir:f.dataDir,deps:{platform:'win32',arch:'x64',spawn,killTree:async()=>{aliveAtKill=child?.exitCode===null;}}});await service.load();await service.enable(enableExisting(f.exe),owner);await done(service);
  const pending=assert.rejects(service.transcribe(Buffer.alloc(44),undefined,new AbortController().signal),/speech_cancelled/);
  await until(()=>!!child);await service.disable(owner);await pending;
  assert.equal(service.publicStatus().phase,'off');assert.equal(service.publicStatus().available,false);assert.equal(aliveAtKill,true);assert.equal(child?.killed,true);
  assert.equal(calls.filter(c=>c.args[0]==='serve').length,1);
 });
 it('keeps readiness body reads abortable, rejects concurrent requests during startup, and suppresses upload',async()=>{
  const f=await files();let bodySignal:AbortSignal|undefined;
  const {spawn}=fakeSpawn([versionSpec(),modelsSpec({'qwen3-asr-0.6b':[f.gguf]}),serveSpec()]);
  const {fetch,calls}=fakeFetch([{match:u=>u.endsWith('/health'),respond:call=>{
   bodySignal=call.init.signal;
   return{...jsonResponse({status:'ok'}),json:()=>new Promise((_resolve,reject)=>{bodySignal!.addEventListener('abort',()=>reject(Error('aborted')),{once:true});})};
  }}]);
  const service=new SpeechCppService({dataDir:f.dataDir,deps:{platform:'win32',arch:'x64',spawn,fetch,killTree:async()=>{}}});await service.load();await service.enable(enableExisting(f.exe),owner);await done(service);
  const client=new AbortController(),pending=assert.rejects(service.transcribe(Buffer.alloc(44),undefined,client.signal),/speech_cancelled/);
  await until(()=>!!bodySignal);
  await assert.rejects(service.transcribe(Buffer.alloc(44),undefined,new AbortController().signal),/speech_busy/);
  await assert.rejects(service.start(owner),/speech_busy/);
  client.abort();await pending;assert.equal(bodySignal?.aborted,true);assert.equal(service.publicStatus().available,false);
  assert.ok(!calls.some(c=>c.url.includes('transcriptions')));await service.dispose();
 });
});
