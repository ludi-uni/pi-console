import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PiProcess } from '../server/adapters/pi/process.ts';

test('installed SDK 1.0.2 real prompt contract: pre-dispatch idle/queue refusal, input/before-start races and closed deferred admission', {timeout:15000,skip:!process.env.DOTS_TEST_SDK_SOURCE},async()=>{
  const source=process.env.DOTS_TEST_SDK_SOURCE!;
  const root=await mkdtemp(join(tmpdir(),'dots-sdk-contract-'));
  const previous={...process.env};let worker:PiProcess|undefined;
  try{
    for(const key of Object.keys(process.env))delete process.env[key];
    for(const key of ['SystemRoot','WINDIR','PATH','PATHEXT','ComSpec'])if(previous[key])process.env[key]=previous[key];
    const profile=join(root,'profile');await mkdir(profile);
    Object.assign(process.env,{TEMP:root,TMP:root,HOME:profile,USERPROFILE:profile,APPDATA:profile,LOCALAPPDATA:profile,PI_CODING_AGENT_DIR:profile});
    const sdk=join(root,'sdk.mjs');
    await writeFile(sdk,`
      export * from ${JSON.stringify(new URL('./helpers/fake-sdk.mjs',import.meta.url).href)};
      import {createAgentSessionFromServices as fakeCreate} from ${JSON.stringify(new URL('./helpers/fake-sdk.mjs',import.meta.url).href)};
      import {AgentSession} from ${JSON.stringify(pathToFileURL(source).href)};
      export async function createAgentSessionFromServices(options){
        const created=await fakeCreate(options),s=created.session;
        let calls=0,starts=0,queued=0,deferredErrors=0,beforeRace=false,deferredOnce=false;
        Object.assign(s,{isCompacting:false,pendingMessageCount:0,model:{provider:'dummy'},_isEmittingAgentSettled:false,_deferredSettledActions:[],_pendingNextTurnMessages:[],_baseSystemPromptOptions:{selectedTools:[]},
          _modelRuntime:{hasConfiguredAuth:()=>true},_findLastAssistantMessage:()=>undefined,
          _flushPendingBashMessages(){},_flushPendingCustomMessages(){},_expandSkillCommand:t=>t,
          getActiveToolNames:()=>[],_normalizePromptImages:async()=>({images:[],hints:[]}),_preparePromptAndToolLoadout:()=>undefined,
          _runInputHandlers:async text=>{await new Promise(r=>setTimeout(r,10));if(text==='input-race')s.isStreaming=true;if(text==='before-race')beforeRace=true;return {text,images:[]};},
          _queueSteer:async()=>{queued++;},_queueFollowUp:async()=>{queued++;},
          _runAgentPrompt:async()=>{starts++;s.isStreaming=true;},
          _extensionRunner:{emitBeforeAgentStart:async()=>{await new Promise(r=>setTimeout(r,10));if(beforeRace)s.isStreaming=true;return {systemPromptOptions:{selectedTools:[]},messages:[]};}}
        });
        s.setThinkingLevel=level=>{s.isStreaming=level==='busy';s.isCompacting=level==='compacting';s.pendingMessageCount=level==='queued'?1:0;beforeRace=false;};
        s.getSessionStats=()=>({calls,starts,queued,deferredErrors});
        s.prompt=async(text,options)=>{
          calls++;const wasDeferred=text==='defer'&&!deferredOnce;if(wasDeferred){deferredOnce=true;s._isEmittingAgentSettled=true;}
          const result=AgentSession.prototype.prompt.call(s,text,{...options,expandPromptTemplates:false});
          if(wasDeferred)result.then(()=>setTimeout(()=>{s._isEmittingAgentSettled=false;s._deferredSettledActions.shift()().catch(()=>{deferredErrors++;});},20));
          return result;
        };
        return created;
      }
    `);
    const entry=join(root,'worker.mjs');
    await writeFile(entry,`process.argv.push('--sdk-entry',${JSON.stringify(sdk)},'--sdk-version','1.0.2');await import(${JSON.stringify(new URL('../package/sdk-worker.mjs',import.meta.url).href)});`);
    process.env.PI_CONSOLE_WORKER_COMMAND=entry;
    worker=new PiProcess(root,undefined,join(root,'sessions'));await worker.start();
    const fields=(message:string)=>({message,requireIdle:true,nativeAdmissionDeadline:Date.now()+5000,consoleRunId:'00000000-0000-4000-8000-000000000001'});
    for(const level of ['busy','compacting','queued']){
      await worker.call('set_thinking_level',{level});
      await assert.rejects(worker.call('prompt',fields('dummy')),/native_session_not_idle/);
      assert.equal((await worker.call('get_session_stats')).data.calls,0);
    }
    await worker.call('set_thinking_level',{level:'idle'});
    await assert.rejects(worker.call('prompt',fields('input-race')),/Agent is already processing/);
    assert.equal((await worker.call('get_session_stats')).data.queued,0);
    await worker.call('set_thinking_level',{level:'idle'});
    await assert.rejects(worker.call('prompt',fields('before-race')),/native_session_not_idle/);
    assert.equal((await worker.call('get_session_stats')).data.starts,0);
    await worker.call('set_thinking_level',{level:'idle'});
    await assert.rejects(worker.call('prompt',{...fields('dummy'),nativeAdmissionDeadline:Date.now()-1}),/native_admission_expired/);
    await assert.rejects(worker.call('prompt',fields('defer')),/SDK did not report prompt acceptance/);
    await new Promise(r=>setTimeout(r,80));
    const stats=(await worker.call('get_session_stats')).data;
    assert.equal(stats.starts,0);assert.equal(stats.queued,0);assert.equal(stats.deferredErrors,1);
    await worker.call('set_thinking_level',{level:'idle'});
    assert.equal((await worker.call('prompt',fields('dummy'))).data.disposition,'started');
    assert.equal((await worker.call('get_session_stats')).data.starts,1);
  }finally{
    await worker?.close();for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,previous);
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
