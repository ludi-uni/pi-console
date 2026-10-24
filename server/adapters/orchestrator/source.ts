import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { ExecutionNode, ExecutionStatus } from '../../../shared/types.ts';
import { pathKey } from '../../runtime/workspaces.ts';

type Raw = Record<string, any>;
const safe = (value: unknown, max = 240): string | undefined => typeof value === 'string' ? value.slice(0,max) : undefined;
const mapStatus = (v: unknown): ExecutionStatus => ({ pending:'queued', waiting_for_user:'waiting', needs_user:'waiting', running:'running', blocked:'blocked', completed:'completed', finished:'completed', failed:'failed', cancelled:'cancelled', interrupted:'interrupted' } as Record<string,ExecutionStatus>)[String(v)] ?? 'unknown';
export async function kitRoot(): Promise<string | undefined> {
  if (process.env.PI_CONSOLE_KIT_ROOT) return resolve(process.env.PI_CONSOLE_KIT_ROOT);
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(),'.pi','agent');
  try { const file = await fs.realpath(join(agentDir, 'extensions','ludi-orchestrator','index.js')); return resolve(dirname(file),'../../..'); } catch { /* The kit may be installed as a Pi npm package instead. */ }
  const npmRoot = join(agentDir, 'npm','node_modules','@ludi-uni','ludi-agent-kit');
  try { await fs.access(join(npmRoot,'adapters','pi','orchestrator-ext','index.js')); return await fs.realpath(npmRoot); } catch { return; }
}
// `archived` marks a historical, read-only mirror fallback: the data was preserved by the
// Console OUTSIDE the replaceable kit directory before the kit was removed or reinstalled.
// It is never evidence that the run is still live — nothing may answer, retry, or resume it.
export type OrchestratorRead = { snapshot: Raw; run?: Raw; tasks: Raw[]; decisions: Raw[]; trace: Raw[]; archived?: boolean };

// The kit store does not record which Pi session started a run — the only session linkage is the
// client snapshot file, which names just the latest bound runId. To rehydrate older runs for the
// same session across restarts we keep a console-owned binding journal next to the kit's client
// snapshots: every run this console binds for a session is appended once. Workspace ownership of
// each journaled run is still proven by run.repo_root === workspacePath in the store.
const bindingsFile = (root: string, sessionId: string) => join(root,'.orchestration','activity','clients',`pi-web-${sessionId}.runs.json`);
const sessionFileSafe = (id: string): boolean => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,120}$/.test(id) && id !== '.' && id !== '..';

// Optional Console-owned preservation area (default OFF — `preserveDir` undefined disables
// every mirror read/write). It lives outside the replaceable kit directory and is keyed by a
// hash of the normalized kit root, so a kit replaced in place reuses the same namespace while
// a differently located kit can never collide. Mirror files are validated journaled data only
// — never a reseed source for the kit store.
type MirrorTarget = { kind: 'snapshot'|'journal'; dir: string; file: string; validate: (doc: Raw) => boolean };
const mirrorKitKey = (root: string) => createHash('sha256').update(pathKey(root)).digest('hex').slice(0,32);
const mirrorDirFor = (preserveDir: string, root: string) => join(preserveDir, `kit-${mirrorKitKey(root)}`);
function mirrorTarget(preserveDir: string | undefined, root: string, sessionId: string, workspacePath: string, runId: string, kind: 'snapshot'|'journal'): MirrorTarget | undefined {
  if (!preserveDir || !sessionFileSafe(sessionId) || (kind === 'snapshot' && !/^[A-Za-z0-9_.-]{1,200}$/.test(runId))) return;
  const dir = mirrorDirFor(preserveDir, root);
  const file = join(dir, kind === 'journal' ? `pi-web-${sessionId}.journal.json` : `pi-web-${sessionId}.snapshot.${runId}.json`);
  const validate = kind === 'snapshot'
    ? (doc: Raw) => doc.version === 1 && doc.kind === 'snapshot' && doc.clientContext?.kind === 'pi-web' && doc.clientContext?.sessionId === sessionId &&
        doc.runId === runId && typeof doc.repoRoot === 'string' && pathKey(doc.repoRoot) === pathKey(workspacePath) &&
        doc.snapshot?.version === 1 && doc.snapshot?.clientContext?.kind === 'pi-web' && doc.snapshot?.clientContext?.sessionId === sessionId &&
        doc.snapshot?.runId === runId && doc.snapshot?.activity?.runId === runId && pathKey(String(doc.snapshot?.repoRoot)) === pathKey(workspacePath)
    : (doc: Raw) => doc.version === 1 && doc.clientContext?.kind === 'pi-web' && doc.clientContext?.sessionId === sessionId && doc.kind === 'run-bindings' &&
        typeof doc.repoRoot === 'string' && pathKey(doc.repoRoot) === pathKey(workspacePath) && Array.isArray(doc.bindings) &&
        doc.bindings.length <= 50 && doc.bindings.every((entry: Raw) => typeof entry?.runId === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(entry.runId) && typeof entry?.repoRoot === 'string');
  return { kind, dir, file, validate };
}
// Serialized per target so concurrent in-process writers cannot lose each other's bindings or
// snapshots; the write itself is atomic via same-directory temp + rename (with EPERM retries).
const mirrorPending = new Map<string, Promise<unknown>>();
function mirrorWrite<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const next = (mirrorPending.get(file) ?? Promise.resolve()).then(fn);
  const settled = next.then(() => {}, () => {});
  mirrorPending.set(file, settled);
  void settled.then(() => { if (mirrorPending.get(file) === settled) mirrorPending.delete(file); });
  return next;
}
async function writeAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, contents);
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temp, file); break; }
      catch (error: any) { if (!['EPERM','EACCES'].includes(error.code) || attempt >= 3) throw error; await new Promise(resolve => setTimeout(resolve, 40*(attempt+1))); }
    }
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}
async function readMirror(target: MirrorTarget | undefined): Promise<Raw | undefined> {
  if (!target) return;
  try { const doc = JSON.parse(await fs.readFile(target.file, 'utf8')); if (typeof doc === 'object' && doc && target.validate(doc)) return doc; }
  catch { /* Missing or malformed mirror data is treated as absent, never as truth. */ }
}
export async function recordRunBinding(root: string, sessionId: string, runId: string, preserveDir?: string, repoRoot?: string): Promise<void> {
  if (typeof runId !== 'string' || !runId) return;
  const file = bindingsFile(root, sessionId);
  let existing: string[];
  try {
    const list = JSON.parse(await fs.readFile(file,'utf8'));
    existing = Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string' && !!v).slice(-50) : [];
  } catch { existing = []; }
  if (!existing.includes(runId))
    try { await fs.writeFile(file, JSON.stringify([...existing, runId].slice(-50))); } catch { /* A missing journal only loses older-run history, never the current binding. */ }
  const target = typeof repoRoot === 'string' && sessionFileSafe(sessionId) ? mirrorTarget(preserveDir, root, sessionId, repoRoot, runId, 'journal') : undefined;
  if (target) await mirrorWrite(target!.file, async () => {
    const mirror = await readMirror(target);
    const seen = new Map<string,string>();
    for (const entry of mirror?.bindings ?? []) if (!seen.has(entry.runId)) seen.set(entry.runId, entry.repoRoot);
    for (const id of existing) if (!seen.has(id)) seen.set(id, repoRoot as string);
    if (!seen.has(runId)) seen.set(runId, repoRoot as string);
    const bindings = [...seen.entries()].map(([id, rootAtBind]) => ({ runId: id, repoRoot: rootAtBind })).slice(-50);
    await writeAtomic(target!.file, JSON.stringify({ version: 1, kind: 'run-bindings', clientContext: { kind: 'pi-web', sessionId }, repoRoot, bindings }));
  }).catch(() => { /* Mirror loss only reduces archive history. */ });
}
export async function readRunBindings(root: string, sessionId: string, workspacePath?: string, preserveDir?: string): Promise<string[]> {
  let live: string[] = [];
  try {
    const list = JSON.parse(await fs.readFile(bindingsFile(root, sessionId),'utf8'));
    live = Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string' && !!v).slice(-50) : [];
  } catch { /* No live journal — the mirror may still hold imported bindings. */ }
  if (!preserveDir || !workspacePath || !sessionFileSafe(sessionId)) return live;
  const merged = new Set(live);
  const dir = mirrorDirFor(preserveDir, root);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  for (const name of names.sort()) {
    if (name !== `pi-web-${sessionId}.journal.json` && !(name.startsWith(`pi-web-${sessionId}.snapshot.`) && name.endsWith('.json'))) continue;
    const kind = name.endsWith('.journal.json') ? 'journal' : 'snapshot';
    const runId = kind === 'snapshot' ? name.slice(`pi-web-${sessionId}.snapshot.`.length, -'.json'.length) : '';
    const doc = await readMirror(mirrorTarget(preserveDir, root, sessionId, workspacePath, runId, kind));
    if (!doc) continue;
    if (kind === 'journal') for (const entry of doc.bindings) merged.add(entry.runId);
    else merged.add(doc.runId);
    if (merged.size > 50) break;
  }
  return [...merged].slice(-50);
}

// Copy a fully validated bound snapshot + run row out of the replaceable kit tree so it
// survives kit removal/replacement. Called only AFTER every identity/workspace/DB check in
// readBoundOrchestrator has passed — an inconsistent source never overwrites a good mirror.
async function mirrorBoundRead(preserveDir: string | undefined, root: string, sessionId: string, workspacePath: string, result: OrchestratorRead): Promise<void> {
  const target = mirrorTarget(preserveDir, root, sessionId, workspacePath, String(result.snapshot.runId), 'snapshot');
  if (!target) return;
  await mirrorWrite(target.file, async () => {
    const mirror = await readMirror(target);
    const bindings = new Map<string,string>();
    for (const entry of mirror?.bindings ?? []) bindings.set(entry.runId, entry.repoRoot);
    bindings.set(String(result.snapshot.runId), typeof result.run?.repo_root === 'string' ? result.run.repo_root : String(result.snapshot.repoRoot));
    await writeAtomic(target.file, JSON.stringify({
      version: 1, kind: 'snapshot', clientContext: { kind: 'pi-web', sessionId }, runId: result.snapshot.runId,
      repoRoot: result.snapshot.repoRoot, snapshot: result.snapshot, run: result.run,
      bindings: [...bindings.entries()].map(([runId, rootAtBind]) => ({ runId, repoRoot: rootAtBind })).slice(-50),
      archivedAt: new Date().toISOString(),
    }));
  }).catch(() => { /* Archival is best-effort; it never fails a live read. */ });
}

// Rebuild a historical read from a mirror file. Every field is revalidated against this
// session/workspace and the run row's repo_root, exactly as the live path does. When the
// preserved DB row is absent (the DB itself is not mirrored — see limitation in
// docs/pi-console.md / task notes) tasks/decisions/trace stay empty and the projection is
// snapshot-only; the run row is still attached so renderers can show status/request.
async function mirrorToRead(root: string, workspacePath: string, storePath: string | undefined, doc: Raw): Promise<OrchestratorRead | undefined> {
  const run = doc.run;
  if (run !== undefined && (typeof run !== 'object' || run === null || run.id !== doc.runId || typeof run.repo_root !== 'string' || pathKey(run.repo_root) !== pathKey(workspacePath))) return;
  const result: OrchestratorRead = { snapshot: doc.snapshot, run, tasks: [], decisions: [], trace: [], archived: true };
  const dbPath = storePath ?? join(root,'.orchestration','state.db');
  let db: DatabaseSync | undefined;
  try {
    await fs.access(dbPath);
    db = new DatabaseSync(dbPath, { readOnly: true });
    // Attach preserved detail rows only when the live store still holds this exact run in this
    // workspace; a rebuilt kit DB may be a different run that happens to share the id.
    const live = readRun(db, doc.runId);
    if (live && typeof live.repo_root === 'string' && pathKey(live.repo_root) === pathKey(workspacePath)) Object.assign(result, readRunRows(db, doc.runId));
  } catch { /* Without a live store the preserved snapshot/run row remain readable. */ }
  finally { db?.close(); }
  return result;
}
async function readMirroredBound(preserveDir: string | undefined, root: string, sessionId: string, workspacePath: string, storePath?: string): Promise<OrchestratorRead | undefined> {
  if (!preserveDir || !sessionFileSafe(sessionId)) return;
  const dir = mirrorDirFor(preserveDir, root);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const docs: Raw[] = [];
  for (const name of names) {
    if (!name.startsWith(`pi-web-${sessionId}.snapshot.`) || !name.endsWith('.json')) continue;
    const runId = name.slice(`pi-web-${sessionId}.snapshot.`.length, -'.json'.length);
    const doc = await readMirror(mirrorTarget(preserveDir, root, sessionId, workspacePath, runId, 'snapshot'));
    if (doc) docs.push(doc);
  }
  if (!docs.length) return;
  // Newest preserved snapshot wins. Its id is deterministic (filename), so a malformed latest
  // file is skipped rather than masking an older valid one.
  docs.sort((a, b) => String(b.snapshot?.activity?.updatedAt ?? b.archivedAt ?? '').localeCompare(String(a.snapshot?.activity?.updatedAt ?? a.archivedAt ?? '')));
  let read: OrchestratorRead | undefined;
  let doc = docs[0];
  for (const candidate of docs) {
    read = await mirrorToRead(root, workspacePath, storePath, candidate);
    if (read) { doc = candidate; break; }
  }
  if (!read) return;
  // Fold every other preserved run for this session into the mirror journal so history
  // rehydration sees them even when the kit journal was deleted with the kit. This writes
  // ONLY mirror data — the kit journal is untouched, so archived runs can never reseed it.
  const journal = mirrorTarget(preserveDir, root, sessionId, workspacePath, '', 'journal');
  const others = docs.filter(other => other !== doc);
  if (journal && others.length) await mirrorWrite(journal.file, async () => {
    const mirror = await readMirror(journal);
    const seen = new Map<string,string>();
    for (const entry of mirror?.bindings ?? []) if (!seen.has(entry.runId)) seen.set(entry.runId, entry.repoRoot);
    for (const other of others) if (!seen.has(other.runId)) seen.set(other.runId, typeof other.run?.repo_root === 'string' ? other.run.repo_root : String(other.repoRoot));
    const bindings = [...seen.entries()].map(([id, rootAtBind]) => ({ runId: id, repoRoot: rootAtBind })).slice(-50);
    await writeAtomic(journal.file, JSON.stringify({ version: 1, kind: 'run-bindings', clientContext: { kind: 'pi-web', sessionId }, repoRoot: workspacePath, bindings }));
  }).catch(() => { /* Mirror journal loss only reduces archive history. */ });
  return read;
}
function readRun(db: DatabaseSync, runId: string): Raw | undefined { return db.prepare('SELECT id,request,status,created_at,updated_at,repo_root FROM runs WHERE id=?').get(runId) as Raw | undefined; }
// Ownership is proven only by the console's own binding journal (written when this session bound
// the run) plus the run row still existing in the kit store. The kit store has no per-session
// origin column, so repo_root/workspace equality is a necessary but not sufficient check on its own.
function runOwnedBySession(run: Raw, bindings: Set<string>): boolean {
  return typeof run?.id === 'string' && bindings.has(run.id);
}
function readRunRows(db: DatabaseSync, runId: string): Pick<OrchestratorRead,'tasks'|'decisions'|'trace'> {
  return {
    tasks: db.prepare('SELECT id,status,updated_at,payload FROM tasks WHERE run_id=? ORDER BY rowid').all(runId) as Raw[],
    decisions: db.prepare('SELECT id,task_id,status,created_at,answered_at,reason FROM decisions WHERE run_id=?').all(runId) as Raw[],
    trace: db.prepare('SELECT id,at,type,payload FROM trace WHERE run_id=? ORDER BY id DESC LIMIT 500').all(runId).reverse() as Raw[],
  };
}
// Synthesize a minimal snapshot for an older bound run so project() can render it uniformly.
function historicalRead(run: Raw, rows: Pick<OrchestratorRead,'tasks'|'decisions'|'trace'>): OrchestratorRead {
  return { snapshot: { version: 1, runId: run.id, repoRoot: run.repo_root, startedAt: run.created_at, activity: { runId: run.id, state: run.status, tasks: [], activeInvocations: [], updatedAt: run.updated_at } }, run, ...rows };
}
export async function readBoundOrchestrator(root: string, sessionId: string, workspacePath: string, storePath?: string, preserveDir?: string): Promise<OrchestratorRead | undefined> {
  const file = join(root,'.orchestration','activity','clients',`pi-web-${sessionId}.json`);
  let doc: Raw;
  try { doc = JSON.parse(await fs.readFile(file,'utf8')); }
  catch (error: any) {
    // Fallback exists only for an absent current snapshot (ENOENT: kit removed/replaced). A
    // malformed or inaccessible CURRENT snapshot must never be masked by stale mirror data.
    if (error?.code === 'ENOENT') return readMirroredBound(preserveDir, root, sessionId, workspacePath, storePath);
    return;
  }
  if (doc.version !== 1 || doc.clientContext?.kind !== 'pi-web' || doc.clientContext?.sessionId !== sessionId ||
      typeof doc.runId !== 'string' || doc.activity?.runId !== doc.runId || typeof doc.repoRoot !== 'string' || pathKey(doc.repoRoot) !== pathKey(workspacePath)) return;
  const result: OrchestratorRead = { snapshot: doc, tasks: [], decisions: [], trace: [] };
  const dbPath = storePath ?? join(root,'.orchestration','state.db');
  let db: DatabaseSync | undefined;
  try {
    await fs.access(dbPath);
    db = new DatabaseSync(dbPath, {readOnly:true});
    const run = readRun(db, doc.runId);
    if (!run) return result; // A custom store may hold this exact bound run; keep only the validated public projection.
    if (typeof run.repo_root !== 'string' || pathKey(run.repo_root) !== pathKey(workspacePath)) return;
    result.run = run;
    Object.assign(result, readRunRows(db, doc.runId));
    // Only a fully consistent binding (snapshot + live run row, workspace proven) is archived.
    await mirrorBoundRead(preserveDir, root, sessionId, workspacePath, result);
  } catch { /* A validated public snapshot remains usable without the optional DB. */ }
  finally { db?.close(); }
  return result;
}

// Rehydrate kit runs this same Pi session started before the latest bound snapshot — e.g. after a
// server restart or when a second run overwrote the client file. The bound run is projected by
// readBoundOrchestrator; this only adds older, still-validated runs.
export async function readSessionRunHistory(root: string, sessionId: string, workspacePath: string, storePath?: string, boundRunId?: string, preserveDir?: string): Promise<OrchestratorRead[]> {
  const dbPath = storePath ?? join(root,'.orchestration','state.db');
  const out: OrchestratorRead[] = [];
  const bindings = new Set(await readRunBindings(root, sessionId, workspacePath, preserveDir));
  if (!bindings.size) return out;
  let db: DatabaseSync | undefined;
  try {
    await fs.access(dbPath);
    db = new DatabaseSync(dbPath, {readOnly:true});
    const rows = db.prepare('SELECT id,request,status,created_at,updated_at,repo_root FROM runs WHERE repo_root IS NOT NULL ORDER BY updated_at DESC LIMIT 50').all() as Raw[];
    for (const run of rows) {
      if (run.id === boundRunId || typeof run.repo_root !== 'string' || pathKey(run.repo_root) !== pathKey(workspacePath)) continue;
      if (!runOwnedBySession(run, bindings)) continue;
      out.push(historicalRead(run, readRunRows(db, run.id)));
      if (out.length >= 10) break;
    }
  } catch { /* Older runs are optional history; the bound snapshot already covers the current run. */ }
  finally { db?.close(); }
  return out;
}
export class OrchestratorSource {
  private last = new Map<string,string>();
  private timer?: NodeJS.Timeout;
  private polling = false;
  boundRun?: { id: string; request: string; createdAt: string };
  constructor(private readonly kit: string, private readonly sessionId: string, private readonly workspacePath: string,
    private readonly publish: (node: ExecutionNode) => void,
    private readonly storePath?: string, private readonly preserveDir?: string) {}
  start() { this.timer = setInterval(() => void this.poll(),1500); void this.poll(); }
  stop() { if (this.timer) clearInterval(this.timer); }
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const data = await readBoundOrchestrator(this.kit,this.sessionId,this.workspacePath,this.storePath,this.preserveDir);
      this.boundRun = undefined;
      if (data) {
        // An archived fallback is never a live binding: boundRun stays unset so kitStatus and
        // the answer/retry paths cannot act on a stale snapshot.
        if (!data.archived && typeof data.run?.id === 'string' && typeof data.run.request === 'string' && typeof data.run.created_at === 'string')
          this.boundRun = { id: data.run.id, request: data.run.request, createdAt: data.run.created_at };
        // Persist this session's bound runId so older runs can be rehydrated after the bound
        // snapshot is replaced by a newer run or after a console restart. The snapshot's runId
        // is already validated by readBoundOrchestrator even when the DB row is absent. An
        // archived fallback is never written back into the kit journal (no reseed).
        if (!data.archived)
          await recordRunBinding(this.kit, this.sessionId, data.snapshot.runId, this.preserveDir, data.run?.repo_root ?? data.snapshot.repoRoot);
        this.project(data);
      }
      // Rehydrate this session's earlier validated runs so they are not lost from Execution
      // when the client snapshot only names the latest bound run.
      const boundId = this.boundRun?.id ?? data?.run?.id;
      for (const historical of await readSessionRunHistory(this.kit, this.sessionId, this.workspacePath, this.storePath, typeof boundId === 'string' ? boundId : undefined, this.preserveDir))
        this.project(data?.archived ? {...historical, archived:true} : historical);
    } finally { this.polling = false; }
  }
  private upsert(node: ExecutionNode) {
    const key = JSON.stringify(node);
    if (this.last.get(node.id) === key) return;
    this.last.set(node.id,key); this.publish(node);
  }
  project(data: OrchestratorRead) {
    const {snapshot: doc,run} = data, a = doc.activity;
    // A mirror fallback is historical read-only evidence: it must never claim a live
    // running/waiting state in the UI. Non-terminal archived reads show as unknown; terminal
    // archived reads keep their final status with archived provenance.
    const orchId = `orchestrator:${doc.runId}`;
    const runStatus = data.archived && !['completed','failed','cancelled','interrupted'].includes(mapStatus(run?.status ?? a.state))
      ? 'unknown' : mapStatus(run?.status ?? a.state);
    const closed = ['completed','failed','cancelled','interrupted'].includes(runStatus);
    this.upsert({id:orchId,kind:'orchestrator',label:`Orchestrator ${doc.runId}`,status:runStatus,
      correlation:'unknown',sourceKind:'orchestrator',nativeId:doc.runId,details:{stateSource:data.archived?'archived':run?'store':'snapshot',...(data.archived?{archived:true}:{})},
      startedAt:safe(run?.created_at ?? doc.startedAt),updatedAt:safe(run?.updated_at ?? a.updatedAt) ?? new Date().toISOString(),
      endedAt:closed ? safe(run?.updated_at ?? a.updatedAt) : undefined});
    const taskRows = data.tasks.length ? data.tasks.map(row => { try {return {row,task:JSON.parse(row.payload)}}catch{return null} }).filter((x):x is {row:Raw;task:Raw}=>!!x) : (a.tasks ?? []).map((task:Raw) => ({row:{id:task.taskId,status:task.state,updated_at:a.updatedAt},task}));
    for (const {row,task} of taskRows) {
      const id = `orch-task:${doc.runId}:${row.id}`;
      const matching = (a.tasks ?? []).find((t:Raw)=>t.taskId===row.id);
      const attempts = Array.isArray(task.attemptsLog) ? task.attemptsLog.slice(-12).map((t:Raw)=>({attempt:Number(t.attempt),model:safe(t.modelId),failureClass:safe(t.failureClass)})) : undefined;
      this.upsert({id,kind:'task',label:safe(task.title) ?? String(row.id),status:data.archived&&!['completed','failed','cancelled','interrupted'].includes(mapStatus(row.status))?'unknown':row.status==='skipped' && task.blockedReason?'blocked':mapStatus(row.status),parentId:orchId,correlation:'explicit',sourceKind:'orchestrator',nativeId:String(row.id),
        updatedAt:safe(row.updated_at) ?? new Date().toISOString(), attempt:Number(task.attempts ?? 0),model:safe(matching?.modelId ?? task.modelId),
        dependencies:Array.isArray(task.dependencies)?task.dependencies.filter((v:unknown)=>typeof v==='string').slice(0,32):undefined,
        blockedReason:safe(task.blockedReason), attempts, action:Number(task.attempts??0)>1?'retried':undefined,
        details: {agent:safe(task.assignedAgent ?? task.agent) ?? '',capability:safe(task.capability) ?? '',failureClass:safe(task.failureClass) ?? '',
          fallbackFrom:safe(matching?.fallbackFrom) ?? '',fallbackTo:safe(matching?.fallbackTo) ?? ''} });
    }
    for (const decision of data.decisions) {
      this.upsert({id:`orch-decision:${doc.runId}:${decision.id}`,kind:'decision',label:`Decision ${decision.id}`,status:decision.status==='pending'?(data.archived?'unknown':'waiting'):'completed',parentId:`orch-task:${doc.runId}:${decision.task_id}`,
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
        const status=row.type==='invocation-start'?(closed||data.archived?'unknown':'running'):mapStatus(t.status);
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
      const traced = traceInvocations.get(`orch-agent:${doc.runId}:${inv.invocationId}`);
      if (traced?.endedAt || closed && traced) continue;
      // A stale public snapshot cannot reopen an invocation with an observed end,
      // nor claim ongoing work under a terminal run. Unknown is not completion.
      this.upsert({id:`orch-agent:${doc.runId}:${inv.invocationId}`,kind:'agent',label:safe(inv.agent)??'agent',status:closed||data.archived?'unknown':'running',parentId:`orch-task:${doc.runId}:${inv.taskId}`,correlation:'explicit',sourceKind:'orchestrator',nativeId:inv.invocationId,
        updatedAt:safe(a.updatedAt)??new Date().toISOString(),model:safe(inv.modelId),details:{turnsUsed:Number(inv.turnsUsed??0),toolCalls:Number(inv.toolCalls??0)}});
    }
  }
}
