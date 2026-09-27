import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { kitRoot } from './source.ts';

const load = (root: string, file: string) => import(pathToFileURL(join(root,file)).href);
async function withContext<T>(root: string, sessionId: string, use: (api: any, ctx: any) => Promise<T> | T): Promise<T> {
  const api=await load(root,'lib/orchestrator/api.mjs');
  const ctx=api.loadOrchestrationContext({kit:root,storePath:process.env.PI_CONSOLE_ORCHESTRATOR_STORE??api.defaultStorePath(root),clientContext:{kind:'pi-web',sessionId}});
  try {if(ctx.errors.length)throw new Error(ctx.errors.join('\n'));return await use(api,ctx)}
  finally {ctx.session.close()}
}

export async function pendingKitDecisions(root: string, sessionId: string, runId: string): Promise<any[]> {
  return withContext(root,sessionId,(api,ctx)=>api.pendingDecisions(ctx,{runId}));
}
export async function answerKitDecision(root: string, sessionId: string, runId: string, decisionId: string, answer: string): Promise<{remaining:number}> {
  return withContext(root,sessionId,(api,ctx)=>{
    api.answerOrchestration(ctx,{runId,decisionId,answer});
    return {remaining:api.pendingDecisions(ctx,{runId}).length};
  });
}
export async function resumeKitRun(root: string, sessionId: string, workspacePath: string, runId: string, onProgress?: (message:string)=>void): Promise<{completed:boolean;needsInput:boolean;report?:string}> {
  return withContext(root,sessionId,async(api,ctx)=>{
    const [pi,subagent]=await Promise.all([load(root,'adapters/pi/lib/invoke.mjs'),load(root,'adapters/pi/lib/subagent.mjs')]);
    const health=api.createRunHealth(ctx),invoke=pi.createPiInvoker();
    const runner=api.createRunRunner(ctx,{invoke,runSubagent:subagent.createPiSubagentRunner(),repoRoot:workspacePath,apply:false,health,runId});
    const result=await api.resumeOrchestration(ctx,{runId,repoRoot:workspacePath,runner,invoke,health,onProgress});
    return {completed:result.status==='completed',needsInput:result.status==='needs-user',report:typeof api.formatReport==='function'?api.formatReport(result):undefined};
  });
}

export async function orchestratorKit(): Promise<string | undefined> {
  const root = await kitRoot();
  if (!root) return;
  const files = ['lib/orchestrator/api.mjs', 'adapters/pi/lib/invoke.mjs', 'adapters/pi/lib/subagent.mjs'];
  if ((await Promise.all(files.map(file => access(join(root, file)).then(() => true, () => false)))).every(Boolean)) return root;
}

// Use the kit's public programmatic API, not a synthetic Pi prompt that merely asks the model to call a tool.
// The kit owns its run store and model invocations; this console only supplies a verified session binding.
export async function startKitRun(root: string, sessionId: string, workspacePath: string, request: string, onProgress?: (message: string) => void, onReport?: (report: string) => void, onNeedsInput?: (waiting: boolean) => void): Promise<string> {
  const [api, pi, subagent] = await Promise.all([
    load(root,'lib/orchestrator/api.mjs'), load(root,'adapters/pi/lib/invoke.mjs'), load(root,'adapters/pi/lib/subagent.mjs'),
  ]);
  const ctx = api.loadOrchestrationContext({
    kit: root,
    storePath: process.env.PI_CONSOLE_ORCHESTRATOR_STORE ?? api.defaultStorePath(root),
    clientContext: { kind: 'pi-web', sessionId },
  });
  try {
    if (ctx.errors.length) throw new Error(ctx.errors.join('\n'));
    const health = api.createRunHealth(ctx);
    const invoke = pi.createPiInvoker();
    const runner = api.createRunRunner(ctx, { invoke, runSubagent: subagent.createPiSubagentRunner(), repoRoot: workspacePath, apply: false, health });
    const result = await api.startOrchestration(ctx, { request, repoRoot: workspacePath, runner, invoke, health, onProgress });
    onNeedsInput?.(result.status==='needs-user');
    if (result.status!=='needs-user' && onReport && typeof api.formatReport === 'function') {
      try { const report = api.formatReport(result); if (typeof report === 'string') onReport(report); }
      catch { /* Display formatting must not turn a completed run into a failure. */ }
    }
    return String(result.runId ?? '');
  } finally { ctx.session.close(); }
}
