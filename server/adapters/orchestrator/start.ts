import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { kitRoot } from './source.ts';

export async function orchestratorKit(): Promise<string | undefined> {
  const root = await kitRoot();
  if (!root) return;
  const files = ['lib/orchestrator/api.mjs', 'adapters/pi/lib/invoke.mjs', 'adapters/pi/lib/subagent.mjs'];
  if ((await Promise.all(files.map(file => access(join(root, file)).then(() => true, () => false)))).every(Boolean)) return root;
}

// Use the kit's public programmatic API, not a synthetic Pi prompt that merely asks the model to call a tool.
// The kit owns its run store and model invocations; this console only supplies a verified session binding.
export async function startKitRun(root: string, sessionId: string, workspacePath: string, request: string): Promise<string> {
  const load = (file: string) => import(pathToFileURL(join(root, file)).href);
  const [api, pi, subagent] = await Promise.all([
    load('lib/orchestrator/api.mjs'), load('adapters/pi/lib/invoke.mjs'), load('adapters/pi/lib/subagent.mjs'),
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
    const result = await api.startOrchestration(ctx, { request, repoRoot: workspacePath, runner, invoke, health });
    return String(result.runId ?? '');
  } finally { ctx.session.close(); }
}
