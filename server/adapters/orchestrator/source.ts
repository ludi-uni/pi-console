import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { ExecutionNode, ExecutionStatus } from '../../../shared/types.ts';
import { pathKey } from '../../runtime/workspaces.ts';

type Raw = Record<string, any>;
const safe = (value: unknown, max = 240): string | undefined => typeof value === 'string' ? value.slice(0,max) : undefined;
const mapStatus = (v: unknown): ExecutionStatus => ({ pending:'queued', waiting_for_user:'waiting', needs_user:'waiting', running:'running', blocked:'blocked', completed:'completed', finished:'completed', failed:'failed', cancelled:'cancelled' } as Record<string,ExecutionStatus>)[String(v)] ?? 'unknown';
export async function kitRoot(): Promise<string | undefined> {
  if (process.env.PI_CONSOLE_KIT_ROOT) return resolve(process.env.PI_CONSOLE_KIT_ROOT);
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(),'.pi','agent');
  try { const file = await fs.realpath(join(agentDir, 'extensions','ludi-orchestrator','index.js')); return resolve(dirname(file),'../../..'); } catch { /* The kit may be installed as a Pi npm package instead. */ }
  const npmRoot = join(agentDir, 'npm','node_modules','@ludi-uni','ludi-agent-kit');
  try { await fs.access(join(npmRoot,'adapters','pi','orchestrator-ext','index.js')); return await fs.realpath(npmRoot); } catch { return; }
}
export type OrchestratorRead = { snapshot: Raw; run?: Raw; tasks: Raw[]; decisions: Raw[]; trace: Raw[] };
export async function readBoundOrchestrator(root: string, sessionId: string, workspacePath: string, storePath?: string): Promise<OrchestratorRead | undefined> {
  const file = join(root,'.orchestration','activity','clients',`pi-web-${sessionId}.json`);
  let doc: Raw;
  try { doc = JSON.parse(await fs.readFile(file,'utf8')); } catch { return; }
  if (doc.version !== 1 || doc.clientContext?.kind !== 'pi-web' || doc.clientContext?.sessionId !== sessionId ||
      typeof doc.runId !== 'string' || doc.activity?.runId !== doc.runId || typeof doc.repoRoot !== 'string' || pathKey(doc.repoRoot) !== pathKey(workspacePath)) return;
  const result: OrchestratorRead = { snapshot: doc, tasks: [], decisions: [], trace: [] };
  const dbPath = storePath ?? join(root,'.orchestration','state.db');
  let db: DatabaseSync | undefined;
  try {
    await fs.access(dbPath);
    db = new DatabaseSync(dbPath, {readOnly:true});
    const run = db.prepare('SELECT id,request,status,created_at,updated_at,repo_root FROM runs WHERE id=?').get(doc.runId) as Raw | undefined;
    if (!run) return result; // A custom store may hold this exact bound run; keep only the validated public projection.
    if (typeof run.repo_root !== 'string' || pathKey(run.repo_root) !== pathKey(workspacePath)) return;
    result.run = run;
    result.tasks = db.prepare('SELECT id,status,updated_at,payload FROM tasks WHERE run_id=? ORDER BY rowid').all(doc.runId) as Raw[];
    result.decisions = db.prepare('SELECT id,task_id,status,created_at,answered_at,reason FROM decisions WHERE run_id=?').all(doc.runId) as Raw[];
    result.trace = db.prepare('SELECT id,at,type,payload FROM trace WHERE run_id=? ORDER BY id DESC LIMIT 500').all(doc.runId).reverse() as Raw[];
  } catch { /* A validated public snapshot remains usable without the optional DB. */ }
  finally { db?.close(); }
  return result;
}
export class OrchestratorSource {
  private last = new Map<string,string>();
  private timer?: NodeJS.Timeout;
  private polling = false;
  boundRun?: { id: string; request: string; createdAt: string };
  constructor(private readonly kit: string, private readonly sessionId: string, private readonly workspacePath: string,
    private readonly publish: (node: ExecutionNode) => void,
    private readonly storePath?: string) {}
  start() { this.timer = setInterval(() => void this.poll(),1500); void this.poll(); }
  stop() { if (this.timer) clearInterval(this.timer); }
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const data = await readBoundOrchestrator(this.kit,this.sessionId,this.workspacePath,this.storePath);
      if (data) {
        if (typeof data.run?.id === 'string' && typeof data.run.request === 'string' && typeof data.run.created_at === 'string')
          this.boundRun = { id: data.run.id, request: data.run.request, createdAt: data.run.created_at };
        this.project(data);
      }
    } finally { this.polling = false; }
  }
  private upsert(node: ExecutionNode) {
    const key = JSON.stringify(node);
    if (this.last.get(node.id) === key) return;
    this.last.set(node.id,key); this.publish(node);
  }
  project(data: OrchestratorRead) {
    const {snapshot: doc,run} = data, a = doc.activity, orchId = `orchestrator:${doc.runId}`;
    this.upsert({id:orchId,kind:'orchestrator',label:`Orchestrator ${doc.runId}`,status:mapStatus(run?.status ?? a.state),
      correlation:'unknown',sourceKind:'orchestrator',nativeId:doc.runId,
      startedAt:safe(run?.created_at ?? doc.startedAt),updatedAt:safe(run?.updated_at ?? a.updatedAt) ?? new Date().toISOString(),
      endedAt:['completed','failed','cancelled'].includes(run?.status ?? a.state) ? safe(run?.updated_at ?? a.updatedAt) : undefined});
    const taskRows = data.tasks.length ? data.tasks.map(row => { try {return {row,task:JSON.parse(row.payload)}}catch{return null} }).filter((x):x is {row:Raw;task:Raw}=>!!x) : (a.tasks ?? []).map((task:Raw) => ({row:{id:task.taskId,status:task.state,updated_at:a.updatedAt},task}));
    for (const {row,task} of taskRows) {
      const id = `orch-task:${doc.runId}:${row.id}`;
      const matching = (a.tasks ?? []).find((t:Raw)=>t.taskId===row.id);
      const attempts = Array.isArray(task.attemptsLog) ? task.attemptsLog.slice(-12).map((t:Raw)=>({attempt:Number(t.attempt),model:safe(t.modelId),failureClass:safe(t.failureClass)})) : undefined;
      this.upsert({id,kind:'task',label:safe(task.title) ?? String(row.id),status:row.status==='skipped' && task.blockedReason?'blocked':mapStatus(row.status),parentId:orchId,correlation:'explicit',sourceKind:'orchestrator',nativeId:String(row.id),
        updatedAt:safe(row.updated_at) ?? new Date().toISOString(), attempt:Number(task.attempts ?? 0),model:safe(matching?.modelId ?? task.modelId),
        dependencies:Array.isArray(task.dependencies)?task.dependencies.filter((v:unknown)=>typeof v==='string').slice(0,32):undefined,
        blockedReason:safe(task.blockedReason), attempts, action:Number(task.attempts??0)>1?'retried':undefined,
        details: {agent:safe(task.assignedAgent ?? task.agent) ?? '',capability:safe(task.capability) ?? '',failureClass:safe(task.failureClass) ?? '',
          fallbackFrom:safe(matching?.fallbackFrom) ?? '',fallbackTo:safe(matching?.fallbackTo) ?? ''} });
    }
    for (const decision of data.decisions) {
      this.upsert({id:`orch-decision:${doc.runId}:${decision.id}`,kind:'decision',label:`Decision ${decision.id}`,status:decision.status==='pending'?'waiting':'completed',parentId:`orch-task:${doc.runId}:${decision.task_id}`,
        correlation:'explicit',sourceKind:'orchestrator',nativeId:decision.id,startedAt:safe(decision.created_at),updatedAt:safe(decision.answered_at ?? decision.created_at) ?? new Date().toISOString(),
        details:{reason:safe(decision.reason) ?? ''}});
    }
    const traceInvocations = new Map<string,Raw>();
    for (const row of data.trace) {
      let t:Raw;try{t=JSON.parse(row.payload)}catch{continue}
      if (!t.invocationId || !t.taskId || t.runId!==doc.runId) continue;
      const id=`orch-agent:${doc.runId}:${t.invocationId}`;
      if (row.type==='invocation-start' || row.type==='invocation-end') {
        const previous=traceInvocations.get(id);
        const status=row.type==='invocation-start'?'running':mapStatus(t.status);
        const node:ExecutionNode={id,kind:'agent',label:safe(t.agent)??'agent',status,parentId:`orch-task:${doc.runId}:${t.taskId}`,correlation:'explicit',sourceKind:'orchestrator',nativeId:String(t.invocationId),
          startedAt:row.type==='invocation-start'?safe(row.at):previous?.startedAt,updatedAt:safe(row.at)??new Date().toISOString(),endedAt:row.type==='invocation-end'?safe(row.at):undefined,
          model:safe(t.modelId),provider:safe(t.provider),details:{reason:safe(t.reason)??'',toolCalls:Number(t.toolCalls??0)}};
        traceInvocations.set(id,{...previous,...node});
      }
      if (row.type==='invocation-tool' && t.tool?.name) this.upsert({id:`orch-tool:${doc.runId}:${row.id}`,kind:'tool',label:safe(t.tool.name,100)!,status:'unknown',parentId:id,correlation:'explicit',sourceKind:'orchestrator',nativeId:String(row.id),updatedAt:safe(row.at)??new Date().toISOString(),action:'Observed tool call (completion unavailable)'});
    }
    for (const node of traceInvocations.values()) {
      const finished = node as ExecutionNode;
      if (finished.status !== 'running' && safe(a.updatedAt) && a.updatedAt > finished.updatedAt) finished.updatedAt = a.updatedAt;
      this.upsert(finished);
    }
    for (const inv of a.activeInvocations ?? []) {
      if (!inv.invocationId || !inv.taskId || inv.runId !== doc.runId) continue;
      this.upsert({id:`orch-agent:${doc.runId}:${inv.invocationId}`,kind:'agent',label:safe(inv.agent)??'agent',status:'running',parentId:`orch-task:${doc.runId}:${inv.taskId}`,correlation:'explicit',sourceKind:'orchestrator',nativeId:inv.invocationId,
        updatedAt:safe(a.updatedAt)??new Date().toISOString(),model:safe(inv.modelId),details:{turnsUsed:Number(inv.turnsUsed??0),toolCalls:Number(inv.toolCalls??0)}});
    }
  }
}
