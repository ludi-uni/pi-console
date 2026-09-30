import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyOverlay, routingForRole, validateUserModel, loadOverlay, type Overlay } from '../server/adapters/orchestrator/overlay.ts';
import { startKitRun, resumeKitRun } from '../server/adapters/orchestrator/start.ts';

const overlay:Overlay={version:1,models:{demo:{id:'demo',name:'名前 / 自由',provider:'test',model:'chosen',vision:false,scopes:['code']}}};
const registry={backends:{legacy:{provider:'test',model:'legacy'}}};
const routing={version:1,backends:{legacy:{vision:true}},capabilities:{
  'strong-code':{primary:'user-demo',fallback:['legacy']},
  'deep-review':{primary:'user-demo',fallback:[]},
  orchestration:{primary:'legacy',fallback:['user-demo']},
  'vision-reasoning':{primary:'user-demo',fallback:[],requires:{vision:true}},
  browser:{primary:'user-demo',fallback:[]},
  custom:{primary:'user-demo',fallback:[]},
}};

test('usage permissions filter primary and fallbacks, preserve requirements and deny unknown custom scopes',()=>{
  const view=applyOverlay(routing,registry,overlay);
  assert.deepEqual(view.routing.capabilities['strong-code'],{primary:'user-demo',fallback:['legacy']});
  for(const name of ['deep-review','vision-reasoning','browser','custom'])assert.equal(view.routing.capabilities[name].primary,'console-denied');
  assert.deepEqual(view.routing.capabilities.orchestration.fallback,[]);
  assert.equal(view.registry.backends['console-denied'],undefined);
  assert.deepEqual(view.routing.capabilities['vision-reasoning'].requires,{vision:true});
  const deniedRole=routingForRole(view.routing,view.registry,'browser');
  assert.equal(deniedRole.capabilities['strong-code'].primary,'legacy');
  assert.equal(routingForRole(view.routing,view.registry,'coder').capabilities['strong-code'].primary,'user-demo');
  assert.equal(Object.hasOwn(routing.backends,'user-demo'),false); // pure merge
  const vision:Overlay={...overlay,models:{demo:{...overlay.models.demo,scopes:['vision'],vision:false}},capabilities:{custom:{primary:'user-demo',fallback:[],scope:'vision'}}};
  assert.equal(applyOverlay(routing,registry,vision).routing.capabilities.custom.primary,'console-denied');
  vision.models.demo.vision=true;
  const visible=applyOverlay(routing,registry,vision);
  assert.equal(visible.routing.capabilities.custom.primary,'user-demo');
  assert.equal(visible.routing.capabilities['vision-reasoning'].primary,'user-demo');
  assert.equal(routingForRole(visible.routing,visible.registry,'coder').capabilities.custom.primary,'console-denied');
  assert.equal(routingForRole(visible.routing,visible.registry,'visual').capabilities.custom.primary,'user-demo');
  const revoked={...vision,models:{demo:{...vision.models.demo,scopes:[]}}} as Overlay;
  assert.equal(applyOverlay(routing,registry,revoked).routing.capabilities.custom.primary,'console-denied');
});

test('model validation is strict and malformed persisted permissions fail closed',async()=>{
  assert.throws(()=>validateUserModel({...overlay.models.demo,scopes:['shell']},overlay,'demo'),/invalid permission scopes/);
  assert.throws(()=>validateUserModel({...overlay.models.demo,name:'\n'},overlay,'demo'),/invalid display name/);
  assert.throws(()=>validateUserModel({...overlay.models.demo,provider:'sk-123456789012345678901234'},overlay,'demo'),/credential/);
  const root=await mkdtemp(join(tmpdir(),'console-model-validation-')),before=process.env.PI_CONSOLE_DATA_DIR;
  try {
    process.env.PI_CONSOLE_DATA_DIR=root;
    await writeFile(join(root,'orchestrator-models.json'),JSON.stringify({...overlay,models:{demo:{...overlay.models.demo,scopes:['shell']}}}));
    await assert.rejects(loadOverlay(),/invalid permission scopes/);
  } finally {if(before===undefined)delete process.env.PI_CONSOLE_DATA_DIR;else process.env.PI_CONSOLE_DATA_DIR=before;await rm(root,{recursive:true,force:true});}
});

test('Console start and resume merge persistent models and guard capability/role overrides before runner use',async()=>{
  const root=await mkdtemp(join(tmpdir(),'console-model-runtime-')),before=process.env.PI_CONSOLE_DATA_DIR;
  try {
    process.env.PI_CONSOLE_DATA_DIR=join(root,'data');
    for(const dir of ['lib/orchestrator','adapters/pi/lib','data'])await mkdir(join(root,dir),{recursive:true});
    await writeFile(join(root,'data/orchestrator-models.json'),JSON.stringify(overlay));
    await writeFile(join(root,'lib/orchestrator/api.mjs'),`import {writeFileSync} from 'node:fs';
export const defaultStorePath=()=>'';
export const loadOrchestrationContext=()=>({routing:${JSON.stringify(routing)},registry:${JSON.stringify(registry)},errors:[],session:{close(){}}});
export const createRunHealth=()=>({});
export const createRunRunner=ctx=>({run:async task=>ctx.routing.capabilities[task.capability]});
const run=async(ctx,args,kind)=>{const code=await args.runner.run({assignedAgent:'coder',capability:'strong-code'});const browser=await args.runner.run({assignedAgent:'browser',capability:'strong-code'});writeFileSync(${JSON.stringify(root)}+'/'+kind,JSON.stringify({code,browser,review:ctx.routing.capabilities['deep-review']}));return {runId:'overlay-run',status:'completed'}};
export const startOrchestration=(ctx,args)=>run(ctx,args,'start');
export const resumeOrchestration=(ctx,args)=>run(ctx,args,'resume');`);
    await writeFile(join(root,'adapters/pi/lib/invoke.mjs'),'export const createPiInvoker=()=>()=>{};');
    await writeFile(join(root,'adapters/pi/lib/subagent.mjs'),'export const createPiSubagentRunner=()=>()=>{};');
    assert.equal(await startKitRun(root,'session',root,'request'),'overlay-run');
    assert.equal((await resumeKitRun(root,'session',root,'overlay-run')).completed,true);
    for(const kind of ['start','resume']){
      const observed=JSON.parse(await readFile(join(root,kind),'utf8'));
      assert.equal(observed.code.primary,'user-demo');
      assert.equal(observed.browser.primary,'legacy');
      assert.equal(observed.review.primary,'console-denied');
    }
    // A later resume reloads revocations rather than keeping an old candidate snapshot.
    await writeFile(join(root,'data/orchestrator-models.json'),JSON.stringify({...overlay,models:{demo:{...overlay.models.demo,scopes:[]}}}));
    await resumeKitRun(root,'session',root,'overlay-run');
    assert.equal(JSON.parse(await readFile(join(root,'resume'),'utf8')).code.primary,'legacy');
  } finally {if(before===undefined)delete process.env.PI_CONSOLE_DATA_DIR;else process.env.PI_CONSOLE_DATA_DIR=before;await rm(root,{recursive:true,force:true});}
});
