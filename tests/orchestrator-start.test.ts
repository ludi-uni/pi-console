import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { orchestratorKit, startKitRun } from '../server/adapters/orchestrator/start.ts';
import { kitRoot } from '../server/adapters/orchestrator/source.ts';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';

test('discovers the official Pi npm kit when the legacy extension junction is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-kit-discovery-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const override = process.env.PI_CONSOLE_KIT_ROOT;
  try {
    process.env.PI_CODING_AGENT_DIR = root;
    delete process.env.PI_CONSOLE_KIT_ROOT;
    assert.equal(await kitRoot(), undefined);
    const kit = join(root,'npm','node_modules','@ludi-uni','ludi-agent-kit');
    for (const path of ['adapters/pi/orchestrator-ext','adapters/pi/lib','lib/orchestrator']) await mkdir(join(kit,path),{recursive:true});
    for (const path of ['adapters/pi/orchestrator-ext/index.js','adapters/pi/lib/invoke.mjs','adapters/pi/lib/subagent.mjs','lib/orchestrator/api.mjs']) await writeFile(join(kit,path),'');
    assert.equal(await kitRoot(),kit);
    assert.equal(await orchestratorKit(),kit);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    if (override === undefined) delete process.env.PI_CONSOLE_KIT_ROOT; else process.env.PI_CONSOLE_KIT_ROOT = override;
    await rm(root,{recursive:true,force:true});
  }
});

test('running kit job receives a run ID only from a new, exact bound run and request', async () => {
  const root=await mkdtemp(join(tmpdir(),'pi-console-current-run-'));
  const previous=process.env.PI_CONSOLE_KIT_ROOT;
  try {
    for(const dir of ['lib/orchestrator','adapters/pi/lib'])await mkdir(join(root,dir),{recursive:true});
    for(const file of ['lib/orchestrator/api.mjs','adapters/pi/lib/invoke.mjs','adapters/pi/lib/subagent.mjs'])await writeFile(join(root,file),'');
    process.env.PI_CONSOLE_KIT_ROOT=root;
    const store=new WorkspaceStore(join(root,'workspaces.json')),workspace=await store.add(root);
    const runtime=new RuntimeManager(store,root),sessionId='exact-session';
    const source={boundRun:{id:'old',request:'same request',createdAt:'2026-01-01T00:00:00.000Z'}};
    (runtime as any).active.set(sessionId,{session:{workspaceId:workspace.id},source});
    const job={workspaceId:workspace.id,request:'same request',running:true,startedAt:'2026-01-02T00:00:00.000Z',runId:undefined as string|undefined};
    (runtime as any).kitRuns.set(sessionId,job);
    assert.equal((await runtime.kitStatus(workspace.id,sessionId)).job?.runId,undefined);
    source.boundRun={id:'other',request:'different request',createdAt:'2026-01-02T00:00:01.000Z'};
    assert.equal((await runtime.kitStatus(workspace.id,sessionId)).job?.runId,undefined);
    source.boundRun={id:'current',request:'same request',createdAt:'2026-01-02T00:00:01.000Z'};
    assert.equal((await runtime.kitStatus(workspace.id,sessionId)).job?.runId,'current');
  } finally { if(previous===undefined)delete process.env.PI_CONSOLE_KIT_ROOT;else process.env.PI_CONSOLE_KIT_ROOT=previous;await rm(root,{recursive:true,force:true}); }
});

test('kit start uses exact session/workspace binding, leaves model execution to kit and closes store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-kit-'));
  const api = join(root, 'lib/orchestrator'), pi = join(root, 'adapters/pi/lib');
  try {
    await mkdir(api, {recursive:true});await mkdir(pi, {recursive:true});
    await writeFile(join(api, 'api.mjs'), `import {writeFileSync} from 'node:fs';
export const defaultStorePath=root=>root+'/default.db';
export const loadOrchestrationContext=args=>({args,errors:[],session:{close(){writeFileSync(args.kit+'/closed','yes')}}});
export const createRunHealth=()=>({});
export const createRunRunner=(_ctx,args)=>args;
export const startOrchestration=async(ctx,args)=>{writeFileSync(ctx.args.kit+'/received',JSON.stringify({binding:ctx.args.clientContext,store:ctx.args.storePath,request:args.request,repo:args.repoRoot,apply:args.runner.apply}));return {runId:'test-run'}};`);
    await writeFile(join(pi, 'invoke.mjs'), 'export const createPiInvoker=()=>()=>{};');
    await writeFile(join(pi, 'subagent.mjs'), 'export const createPiSubagentRunner=()=>()=>{};');
    assert.equal(await startKitRun(root,'exact-session','C:/project','Implement feature'), 'test-run');
    assert.deepEqual(JSON.parse(await readFile(join(root,'received'),'utf8')),{binding:{kind:'pi-web',sessionId:'exact-session'},store:root+'/default.db',request:'Implement feature',repo:'C:/project',apply:false});
    assert.equal(await readFile(join(root,'closed'),'utf8'),'yes');
  } finally { await rm(root,{recursive:true,force:true}); }
});
