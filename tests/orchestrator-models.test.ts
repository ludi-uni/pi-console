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

test('vision scope gates image input separately from agent roles: image review needs vision+review, scout/planner need vision+planning',()=>{
  // Rewire every capability's user-model primary at the model under test.
  const route=(id:string)=>({...routing,capabilities:Object.fromEntries(Object.entries(routing.capabilities).map(([k,v]:[string,any])=>[k,{...v,primary:`user-${id}`,fallback:v.fallback.map((b:string)=>b.startsWith('user-')?`user-${id}`:b)}]))});
  const visionReview:Overlay={version:1,models:{vr:{id:'vr',name:'Vision Reviewer',provider:'test',model:'vr',vision:true,scopes:['vision','review']}}};
  const view=applyOverlay(route(Object.keys(visionReview.models)[0]),registry,visionReview);
  assert.equal(view.routing.capabilities['deep-review'].primary,'user-vr','review scope keeps text review eligible');
  assert.equal(view.routing.capabilities['vision-reasoning'].primary,'user-vr');
  // reviewer role routing: allowed for review+vision tasks, still denied for coder
  assert.equal(routingForRole(view.routing,view.registry,'reviewer').capabilities['vision-reasoning'].primary,'user-vr');
  assert.equal(routingForRole(view.routing,view.registry,'coder').capabilities['vision-reasoning'].primary,'console-denied');
  // vision-only (no review scope): capability chain admits it, but the reviewer role cannot use it
  const visionOnly:Overlay={version:1,models:{vo:{id:'vo',name:'Vision only',provider:'test',model:'vo',vision:true,scopes:['vision']}}};
  const voView=applyOverlay(route(Object.keys(visionOnly.models)[0]),registry,visionOnly);
  assert.equal(voView.routing.capabilities['vision-reasoning'].primary,'user-vo');
  assert.equal(voView.routing.capabilities['deep-review'].primary,'console-denied','vision scope alone must not grant review work');
  assert.equal(routingForRole(voView.routing,voView.registry,'reviewer').capabilities['vision-reasoning'].primary,'console-denied','reviewer cannot borrow a vision-only model');
  assert.equal(routingForRole(voView.routing,voView.registry,'visual').capabilities['vision-reasoning'].primary,'user-vo');
  // review scope + image-capable hardware but NO vision checkbox: text review passes,
  // image review and requires.vision routes are refused — the vision scope permission
  // is separate from the model's image-input flag.
  const reviewOnly:Overlay={version:1,models:{ro:{id:'ro',name:'Review only',provider:'test',model:'ro',vision:true,scopes:['review']}}};
  const roView=applyOverlay(route(Object.keys(reviewOnly.models)[0]),registry,reviewOnly);
  assert.equal(roView.routing.capabilities['deep-review'].primary,'user-ro','text review needs only review scope');
  assert.equal(roView.routing.capabilities['vision-reasoning'].primary,'console-denied','image review also needs the vision checkbox');
  const deepVision=applyOverlay({...route('ro'),capabilities:{...route('ro').capabilities,'deep-review':{primary:'user-ro',fallback:[],requires:{vision:true}}}},registry,reviewOnly);
  assert.equal(deepVision.routing.capabilities['deep-review'].primary,'console-denied','reviewer+vision hardware without vision scope cannot take image review');
  // planning + image-capable but no vision checkbox: image planning is refused too
  const planOnly:Overlay={version:1,models:{pl:{id:'pl',name:'Planner',provider:'test',model:'pl',vision:true,scopes:['planning']}}};
  const plView=applyOverlay(route('pl'),registry,planOnly);
  assert.equal(plView.routing.capabilities['vision-reasoning'].primary,'console-denied','image planning needs the vision checkbox');
  // scout/design-planner taking images need planning role + vision flag (vision scope marks the capability)
  const scoutVision:Overlay={version:1,models:{sv:{id:'sv',name:'Vision scout',provider:'test',model:'sv',vision:true,scopes:['planning','vision']}}};
  const svView=applyOverlay(route(Object.keys(scoutVision.models)[0]),registry,scoutVision);
  assert.equal(routingForRole(svView.routing,svView.registry,'scout').capabilities['vision-reasoning'].primary,'user-sv');
  assert.equal(routingForRole(svView.routing,svView.registry,'design-planner').capabilities['vision-reasoning'].primary,'user-sv');
  const scoutNoVision={...scoutVision,models:{sv:{...scoutVision.models.sv,vision:false}}} as Overlay;
  assert.equal(routingForRole(applyOverlay(route(Object.keys(scoutNoVision.models)[0]),registry,scoutNoVision).routing,applyOverlay(route(Object.keys(scoutNoVision.models)[0]),registry,scoutNoVision).registry,'scout').capabilities['vision-reasoning'].primary,'console-denied','image-taking scout still needs model vision');
  const scoutNoScope={...scoutVision,models:{sv:{...scoutVision.models.sv,scopes:['planning']}}} as Overlay; // vision:true but checkbox off
  assert.equal(applyOverlay(route('sv'),registry,scoutNoScope).routing.capabilities['vision-reasoning'].primary,'console-denied','vision hardware without the vision checkbox is refused at routing');
  // capability-level requires.vision forces the same gate even without the vision scope tag
  const reqCaps:Overlay={version:1,models:{vr:{id:'vr',name:'vr',provider:'t',model:'m',vision:true,scopes:['review']}},capabilities:{custom:{primary:'user-vr',fallback:[],scope:'review'}}};
  const withReq=applyOverlay({...route('vr'),capabilities:{...route('vr').capabilities,custom:{primary:'user-vr',fallback:[],requires:{vision:true}}}},registry,reqCaps);
  assert.equal(withReq.routing.capabilities.custom.primary,'console-denied','requires.vision rejects non-vision models regardless of scope');
});

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
