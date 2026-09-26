import { PiProcess } from '../adapters/pi/process.ts';
import { resolve, relative, isAbsolute } from 'node:path';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import { SessionEvents } from './events.ts';
import { kitRoot, OrchestratorSource } from '../adapters/orchestrator/source.ts';
import { orchestratorKit, startKitRun } from '../adapters/orchestrator/start.ts';
import { listSessions, readSession, piSessionDir, WorkspaceStore } from './workspaces.ts';
import type { SessionInfo, Workspace, SessionOptions, ActiveSessionSummary } from '../../shared/types.ts';
import { prepareAttachments } from './attachments.ts';

type Active = { worker: PiProcess; state: SessionEvents; session: SessionInfo; source?: OrchestratorSource };
export class RuntimeManager {
  private active = new Map<string, Active>();
  private failed = new Map<string, Active>();
  private starting = new Map<string, Promise<Active>>();
  private retiring = new Set<string>();
  private kitRuns = new Map<string, { workspaceId: string; running: boolean; request: string; startedAt: string; runId?: string; error?: string; finishedAt?: string }>();
  constructor(readonly workspaces: WorkspaceStore, private readonly sessionsRoot = piSessionDir()) {}
  get sessionRoot(){return this.sessionsRoot}
  async sessions(workspaceId: string) {
    const files = await listSessions(this.workspaces.get(workspaceId), this.sessionsRoot);
    for (const active of this.active.values()) if (active.session.workspaceId === workspaceId && !files.some(s => s.id === active.session.id)) files.unshift(active.session);
    return files.map(s=>{const entry=this.active.get(s.id);const execution=entry?.state.execution.snapshot();return {...s,running:!!entry?.state.activeRunId||!!execution?.nodes.some(n=>n.status==='running'),decisionCount:execution?.decisionCount??0}}).sort((a,b)=>Number(!!b.decisionCount)-Number(!!a.decisionCount)||Number(!!b.running)-Number(!!a.running)||(b.updatedAt??'').localeCompare(a.updatedAt??''));
  }
  async activity(): Promise<ActiveSessionSummary[]> {
    const result:ActiveSessionSummary[]=[];
    for(const entry of this.active.values()){
      const execution=entry.state.execution.snapshot();
      const job=this.kitRuns.get(entry.session.id);
      const kitRunning=job?.workspaceId===entry.session.workspaceId && job.running;
      const liveWork=execution.nodes.filter(n=>['agent','task','orchestrator'].includes(n.kind)&&['running','waiting','blocked'].includes(n.status));
      const recentWork=execution.nodes.filter(n=>['agent','task'].includes(n.kind)&&['completed','failed','cancelled','interrupted'].includes(n.status)&&Date.now()-Date.parse(n.endedAt??n.updatedAt)<24*60*60*1000)
        .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,2);
      const work=[...liveWork,...recentWork].map(n=>({id:n.id,label:n.label,status:n.status,kind:n.kind,action:n.action}));
      if(kitRunning&&!work.some(n=>n.kind==='orchestrator'))work.unshift({id:`kit:${entry.session.id}`,label:'Orchestrator',status:'running',kind:'orchestrator',action:undefined});
      const running=!!entry.state.activeRunId||!!kitRunning||work.some(n=>n.status==='running')||execution.nodes.some(n=>n.status==='running'&&n.kind==='tool');
      const completed=execution.nodes.filter(n=>(['run','orchestrator'].includes(n.kind)||n.kind==='agent'&&n.sourceKind==='pi-subagents'&&!n.parentId)&&['completed','failed','cancelled','interrupted'].includes(n.status)&&n.endedAt)
        .sort((a,b)=>b.endedAt!.localeCompare(a.endedAt!))[0];
      const rootCompletion=completed?.endedAt?{id:completed.id+':'+completed.endedAt,status:completed.status as 'completed'|'failed'|'cancelled'|'interrupted',at:completed.endedAt}:undefined;
      const jobCompletion=job?.finishedAt?{id:`kit:${entry.session.id}:${job.finishedAt}`,status:job.error?'failed' as const:'completed' as const,at:job.finishedAt}:undefined;
      const latest=[rootCompletion,jobCompletion].filter((v):v is NonNullable<typeof v>=>!!v).sort((a,b)=>b.at.localeCompare(a.at))[0];
      const completion=latest&&Date.now()-Date.parse(latest.at)<24*60*60*1000?latest:undefined;
      if(!running&&!execution.decisionCount&&!completion)continue;
      const workspace=this.workspaces.get(entry.session.workspaceId);
      const current=await readSession(entry.session.filePath,workspace);
      if(current?.name)entry.session.name=current.name;
      result.push({sessionId:entry.session.id,workspaceId:workspace.id,sessionName:entry.session.name??'New conversation',workspaceName:workspace.name,running,decisionCount:execution.decisionCount,work,completion,updatedAt:entry.state.events.at(-1)?.timestamp??entry.session.updatedAt??workspace.lastOpenedAt});
    }
    return result.sort((a,b)=>Number(!!b.decisionCount)-Number(!!a.decisionCount)||Number(b.running)-Number(a.running)||b.updatedAt.localeCompare(a.updatedAt)).slice(0,100);
  }
  async create(workspaceId: string): Promise<Active> {
    const workspace = this.workspaces.get(workspaceId);
    const worker = new PiProcess(workspace.path, undefined, this.sessionsRoot);
    await worker.start();
    try {
      const data = (await worker.call('get_state')).data;
      if (!data?.sessionId || !data?.sessionFile) throw new Error('Pi returned no persisted session');
      // Pi may allocate an ID/file path before it writes the first session header.
      const rel = relative(resolve(this.sessionsRoot), resolve(data.sessionFile));
      if (!isAbsolute(data.sessionFile) || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Pi session path escaped session root');
      const exists = await access(data.sessionFile).then(() => true, () => false);
      const session = exists ? await readSession(data.sessionFile, workspace) : { id: data.sessionId as string, workspaceId, filePath: data.sessionFile as string };
      if (!session || session.id !== data.sessionId) throw new Error('Pi session header identity/cwd mismatch');
      const existing = this.active.get(session.id); if (existing) throw new Error('session already active');
      const entry = this.attach(worker, session);
      await this.startSources(entry, workspace.path);
      return entry;
    } catch (error) { await worker.close(); throw error; }
  }
  private attach(worker: PiProcess, session: SessionInfo): Active {
    const state = new SessionEvents(session, () => worker.state);
    const entry: Active = { worker, state, session };
    worker.onRecord = record => state.ingest(record);
    worker.onState = (status, reason) => { if (status === 'failed') { state.interrupted(reason ?? 'Pi process failed'); this.active.delete(session.id); entry.source?.stop(); this.failed.set(session.id, entry); } };
    this.failed.delete(session.id); this.active.set(session.id, entry);
    return entry;
  }
  private async startSources(entry: Active, workspacePath: string) {
    const root = await kitRoot(); if (!root) return;
    entry.source = new OrchestratorSource(root,entry.session.id,workspacePath,node=>entry.state.publishNode(node,node.kind==='decision'?node.status==='waiting'?'DecisionRequired':'DecisionResolved':'ExecutionNodeUpdated'),process.env.PI_CONSOLE_ORCHESTRATOR_STORE);
    await entry.source.poll(); entry.source.start();
  }
  async open(workspaceId: string, sessionId: string): Promise<Active> {
    if(this.retiring.has(sessionId))throw new Error('session is being recycled');
    const workspace = this.workspaces.get(workspaceId);
    const existing = this.active.get(sessionId);
    if (existing) { if (existing.session.workspaceId !== workspaceId) throw new Error('session belongs to another workspace'); return existing; }
    const session = (await listSessions(workspace, this.sessionsRoot)).find(s => s.id === sessionId);
    if (!session) throw new Error('session not found in workspace');
    const pending = this.starting.get(session.id); if (pending) return pending;
    const start = (async () => {
      const worker = new PiProcess(workspace.path, session.filePath, this.sessionsRoot);
      await worker.start();
      try {
        const data = (await worker.call('get_state')).data;
        if (data?.sessionId !== session.id || data?.sessionFile !== session.filePath) throw new Error('resumed Pi session identity mismatch');
        const entry = this.attach(worker, session);
        const messages = (await worker.call('get_messages')).data?.messages;
        if (Array.isArray(messages)) entry.state.load(messages);
        await this.startSources(entry, workspace.path);
        return entry;
      } catch (error) { await worker.close(); throw error; }
    })();
    this.starting.set(session.id, start);
    try { return await start; } finally { this.starting.delete(session.id); }
  }
  async options(workspaceId: string, sessionId: string): Promise<SessionOptions> {
    const { worker } = await this.open(workspaceId, sessionId);
    const [current, available, levels, stats] = await Promise.all([
      worker.call('get_state'), worker.call('get_available_models'), worker.call('get_available_thinking_levels'), worker.call('get_session_stats'),
    ]);
    const model = current.data?.model;
    const usage = stats.data?.contextUsage;
    return {
      models: (available.data?.models ?? []).filter((m: any) => typeof m.provider === 'string' && typeof m.id === 'string').map((m: any) => ({ provider: m.provider, id: m.id, name: String(m.name ?? m.id) })),
      model: model?.provider && model?.id ? { provider: model.provider, id: model.id } : undefined,
      thinkingLevel: String(current.data?.thinkingLevel ?? 'off'),
      thinkingLevels: Array.isArray(levels.data?.levels) ? levels.data.levels : ['off'],
      contextUsage: usage && typeof usage.contextWindow === 'number' ? { tokens: typeof usage.tokens === 'number' ? usage.tokens : null,
        contextWindow: usage.contextWindow, percent: typeof usage.percent === 'number' ? usage.percent : null } : undefined,
    };
  }
  async setModel(workspaceId: string, sessionId: string, provider: unknown, modelId: unknown) {
    if (typeof provider !== 'string' || !provider || provider.length > 100 || typeof modelId !== 'string' || !modelId || modelId.length > 200) throw new Error('invalid model');
    const { worker, state } = await this.open(workspaceId, sessionId);
    if (state.busy) throw new Error('cannot change model during an active run');
    await worker.call('set_model', { provider, modelId });
    return this.options(workspaceId, sessionId);
  }
  async setThinking(workspaceId: string, sessionId: string, level: unknown) {
    const { worker, state } = await this.open(workspaceId, sessionId);
    if (state.busy) throw new Error('cannot change thinking during an active run');
    if (typeof level !== 'string' || !['off','minimal','low','medium','high','xhigh','max'].includes(level)) throw new Error('invalid thinking level');
    const available = (await worker.call('get_available_thinking_levels')).data?.levels;
    if (!Array.isArray(available) || !available.includes(level)) throw new Error('thinking level not available for this model');
    await worker.call('set_thinking_level', { level });
    return this.options(workspaceId, sessionId);
  }
  async kitStatus(workspaceId: string, sessionId: string) {
    this.workspaces.get(workspaceId);
    const kit = await orchestratorKit();
    const job = this.kitRuns.get(sessionId);
    const entry = this.active.get(sessionId);
    const bound = entry?.session.workspaceId === workspaceId ? entry.source?.boundRun : undefined;
    if (job?.workspaceId === workspaceId && job.running && !job.runId && bound && bound.request === job.request &&
        Number.isFinite(Date.parse(bound.createdAt)) && Date.parse(bound.createdAt) >= Date.parse(job.startedAt)) job.runId = bound.id;
    return { available: !!kit, ...(job?.workspaceId === workspaceId ? { job } : {}) };
  }
  async startOrchestrator(workspaceId: string, sessionId: string, request: unknown) {
    if (typeof request !== 'string' || !request.trim() || request.length > 20000) throw new Error('orchestrator request must be 1–20000 characters');
    const kit = await orchestratorKit();
    if (!kit) throw new Error('ludi-agent-kit is not installed or its API is unavailable');
    if (this.kitRuns.get(sessionId)?.running) throw new Error('orchestrator is already running for this session');
    const { state } = await this.open(workspaceId, sessionId);
    if (state.busy || this.kitRuns.get(sessionId)?.running) throw new Error('Pi session or orchestrator is busy');
    const workspace = this.workspaces.get(workspaceId);
    const job = { workspaceId, running: true, request: request.trim(), startedAt: new Date().toISOString(), runId: undefined as string | undefined, error: undefined as string | undefined, finishedAt: undefined as string | undefined };
    this.kitRuns.set(sessionId, job);
    void startKitRun(kit, sessionId, workspace.path, job.request).then(id => { job.runId = id; job.running = false; job.finishedAt = new Date().toISOString(); }, error => { job.error = (error as Error).message; job.running = false; job.finishedAt = new Date().toISOString(); });
    return { job };
  }
  async prompt(workspaceId: string, sessionId: string, message: unknown, attachments: unknown = []): Promise<string> {
    const prepared = prepareAttachments(message, attachments);
    if (this.kitRuns.get(sessionId)?.running) throw new Error('orchestrator is running for this session');
    const { worker, state } = await this.open(workspaceId, sessionId);
    if (this.kitRuns.get(sessionId)?.running) throw new Error('orchestrator is running for this session');
    if(this.retiring.has(sessionId))throw new Error('session is being recycled');
    const id = state.preparePrompt(prepared.message);
    try { await worker.call('prompt', { message: prepared.message, ...(prepared.images.length ? { images: prepared.images } : {}) }); state.accepted(); return id; }
    catch (error) { state.rejected((error as Error).message); throw error; }
  }
  async stop(workspaceId: string, sessionId: string): Promise<void> {
    const { worker, state } = await this.open(workspaceId, sessionId);
    if (!state.activeRunId) throw new Error('no active run');
    await worker.call('clear_queue');
    state.markStop();
    await worker.call('abort', {}, 60000);
  }
  async resume(workspaceId: string, sessionId: string) { return (await this.open(workspaceId, sessionId)).state.snapshot(); }
  async snapshot(workspaceId: string, sessionId: string) {
    const entry = this.active.get(sessionId) ?? this.failed.get(sessionId);
    if (!entry || entry.session.workspaceId !== workspaceId) throw new Error('session not open; resume it first');
    return entry.state.snapshot();
  }
  async subscribe(workspaceId: string, sessionId: string, fn: Parameters<SessionEvents['subscribe']>[0]) {
    const entry = this.active.get(sessionId) ?? this.failed.get(sessionId);
    if (!entry || entry.session.workspaceId !== workspaceId) throw new Error('session not open; resume it first');
    return entry.state.subscribe(fn);
  }
  async closeSession(workspaceId: string, sessionId: string) {
    if (this.kitRuns.get(sessionId)?.running) throw new Error('orchestrator is running for this session');
    const entry = this.active.get(sessionId);
    if (!entry || entry.session.workspaceId !== workspaceId) throw new Error('session worker not found');
    if (entry.state.activeRunId) throw new Error('cannot close worker during active run');
    entry.source?.stop(); await entry.worker.close(); this.active.delete(sessionId); this.failed.delete(sessionId);
  }
  async recycleSession(workspaceId:string,sessionId:string,move:(path:string)=>Promise<void>,cutoff?:number):Promise<void> {
    const workspace=this.workspaces.get(workspaceId);
    if(this.retiring.has(sessionId)||this.starting.has(sessionId)||this.kitRuns.get(sessionId)?.running)throw new Error('session is active or awaiting input');
    this.retiring.add(sessionId);
    try {
      const matches=(await listSessions(workspace,this.sessionsRoot)).filter(s=>s.id===sessionId);
      if(matches.length!==1)throw new Error('session not found or identity ambiguous');
      const session=matches[0];
      const root=await realpath(this.sessionsRoot);const file=await realpath(session.filePath);
      const rel=relative(root,file);
      if(!rel||rel.startsWith('..')||isAbsolute(rel)||!(await lstat(session.filePath)).isFile())throw new Error('session path is not a regular file within the Pi session directory');
      const entry=this.active.get(sessionId)??this.failed.get(sessionId);
      if(entry&&entry.session.workspaceId!==workspaceId)throw new Error('session belongs to another workspace');
      if(cutoff!==undefined&&entry)throw new Error('session is open in Pi Console');
      const execution=entry?.state.execution.snapshot();
      if(entry?.state.activeRunId||execution?.decisionCount||execution?.nodes.some(n=>n.status==='running'||n.status==='waiting'))throw new Error('session is active or awaiting input');
      const info=await stat(file);
      if(cutoff!==undefined&&info.mtimeMs>=cutoff)throw new Error('session was updated after retention cutoff');
      if(entry){entry.source?.stop();if(this.active.has(sessionId))await entry.worker.close();this.active.delete(sessionId);this.failed.delete(sessionId)}
      // Recheck identity and age after closing our worker, before invoking the OS Recycle Bin.
      const again=await readSession(file,workspace);const current=await stat(file);
      if(again?.id!==sessionId||cutoff!==undefined&&current.mtimeMs>=cutoff)throw new Error('session changed before recycling');
      await move(file);
    } finally {this.retiring.delete(sessionId)}
  }
  async removeWorkspace(workspaceId: string) {
    this.workspaces.get(workspaceId);
    if ([...this.starting.values()].length) throw new Error('cannot remove workspace while a session is starting');
    const entries = [...this.active.values(), ...this.failed.values()].filter(e => e.session.workspaceId === workspaceId);
    if ([...this.kitRuns.values()].some(job => job.workspaceId === workspaceId && job.running)) throw new Error('cannot remove workspace while its orchestrator is running');
    if (entries.some(e => e.state.activeRunId || e.state.execution.snapshot().decisionCount || e.state.execution.snapshot().nodes.some(n => n.status === 'running' || n.status === 'waiting')))
      throw new Error('cannot remove workspace while a session is active or awaiting input');
    for (const entry of entries) {
      entry.source?.stop();
      if (this.active.has(entry.session.id)) await entry.worker.close();
      this.active.delete(entry.session.id); this.failed.delete(entry.session.id);
    }
    await this.workspaces.remove(workspaceId);
  }
  async shutdown() { await Promise.allSettled([...this.active.values()].map(x => { x.source?.stop(); return x.worker.close(); })); for (const x of this.failed.values()) x.source?.stop(); this.active.clear(); this.failed.clear(); }
  activeWorker(sessionId: string) { return this.active.get(sessionId)?.worker; }
}
