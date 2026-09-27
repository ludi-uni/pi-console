import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cp,lstat,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {answerKitDecision,pendingKitDecisions} from '../server/adapters/orchestrator/start.ts';

// Opt-in, model-free integration against an actual kit copy. Never use an installed kit as a writable context.
test('real kit answer and resume work with isolated data and zero model invocations',{timeout:20000},async t=>{
  const installed=process.env.PI_CONSOLE_REAL_KIT_ROOT;
  if(!installed){t.skip('set PI_CONSOLE_REAL_KIT_ROOT to the installed kit directory');return}
  const root=await mkdtemp(join(tmpdir(),'pi-console-real-kit-'));
  const kit=join(root,'kit'),workspace=join(root,'workspace'),storePath=join(root,'state.db');
  const oldStore=process.env.PI_CONSOLE_ORCHESTRATOR_STORE,oldAgent=process.env.PI_CODING_AGENT_DIR;
  try{
    await cp(installed,kit,{recursive:true,filter:async path=>{
      if((await lstat(path)).isSymbolicLink())throw new Error(`refusing to copy kit symlink: ${path}`);
      return true;
    }});
    await mkdir(workspace);await mkdir(join(root,'agent'));
    process.env.PI_CONSOLE_ORCHESTRATOR_STORE=storePath;
    process.env.PI_CODING_AGENT_DIR=join(root,'agent');
    const api=await import(pathToFileURL(join(kit,'lib/orchestrator/api.mjs')).href);
    const sessionId='isolated-pi-session';
    const context=()=>api.loadOrchestrationContext({kit,storePath,clientContext:{kind:'pi-web',sessionId}});
    const ctx=context();let runId,decisionId;
    try{
      assert.deepEqual(ctx.errors,[]);
      runId=ctx.session.createRun({request:'Verify a completed isolated task',policy:ctx.policy,repoRoot:workspace,scopeKey:workspace});
      ctx.session.openTaskStore(runId).add({id:'t1',title:'Completed fixture',goal:'No model calls',capability:'strong-code',dependencies:[],status:'completed',attempts:0,acceptance:[],outputs:[],decisions:[]});
      decisionId=ctx.session.insertDecision({runId,taskId:'t1',question:'Keep this result?',options:[{id:'yes',summary:'Keep it'}],reason:'Isolated test decision'});
      ctx.session.updateRun(runId,{status:'waiting_for_user'});
    }finally{ctx.session.close()}
    assert.equal((await pendingKitDecisions(kit,sessionId,runId)).length,1);
    assert.deepEqual(await answerKitDecision(kit,sessionId,runId,decisionId,'yes'),{remaining:0});
    const resumed=context();let modelCalls=0;
    try{
      assert.deepEqual(api.pendingDecisions(resumed,{runId}),[]);
      // Any attempt to invoke a model fails the test rather than charging a provider.
      const forbidden=()=>{modelCalls++;throw new Error('model invocation prohibited in isolated test')};
      const result=await api.resumeOrchestration(resumed,{runId,repoRoot:workspace,invoke:forbidden,runner:forbidden});
      assert.equal(result.status,'completed');assert.equal(result.runId,runId);assert.equal(modelCalls,0);
      assert.equal(resumed.session.getRun(runId).status,'completed');
      assert.equal(resumed.session.getDecision(decisionId).answer,'yes');
    }finally{resumed.session.close()}
  }finally{
    if(oldStore===undefined)delete process.env.PI_CONSOLE_ORCHESTRATOR_STORE;else process.env.PI_CONSOLE_ORCHESTRATOR_STORE=oldStore;
    if(oldAgent===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=oldAgent;
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
