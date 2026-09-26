import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startKitRun } from '../server/adapters/orchestrator/start.ts';

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
