import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import type { SessionInfo, Workspace } from '../../shared/types.ts';
import { splitPromptAttachments } from '../../shared/attachments.ts';
import type { ManagedFolderEntry } from '../windows-folder-provider.ts';
import { canonicalParent, childName } from '../folder-mcp.ts';

export function pathKey(path: string): string { return resolve(path).replace(/[\\/]+$/, '').toLowerCase(); }
export class WorkspaceStore {
  private items: Workspace[] = [];
  private prompts: string[] = ['続きを実装して', 'テストして', '原因を調べて'];
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  /** Internal provider assembly metadata; never exposed as an HTTP/MCP capability. */
  managedRegistryDirectory(): string { return dirname(resolve(this.file)); }
  async load() { try { const saved=JSON.parse(await fs.readFile(this.file, 'utf8')); this.items=Array.isArray(saved)?saved:saved.workspaces??[];this.prompts=Array.isArray(saved.quickPrompts)?saved.quickPrompts:[]; } catch (error: any) { if (error.code !== 'ENOENT') throw error; } }
  list() { return [...this.items].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.lastOpenedAt.localeCompare(a.lastOpenedAt)); }
  async listWithValidity() { return Promise.all(this.list().map(async w=>({...w,valid:await fs.stat(w.path).then(s=>s.isDirectory(),()=>false)}))); }
  quickPrompts() { return [...this.prompts]; }
  async savePrompts(values: unknown) { if (!Array.isArray(values)||values.length>8||values.some(v=>typeof v!=='string'||!v.trim()||v.length>200)) throw new Error('up to 8 nonempty prompts (200 characters each)'); this.prompts=values.map(v=>v.trim()); await this.save(); return this.quickPrompts(); }
  get(id: string) { const item = this.items.find(w => w.id === id); if (!item) throw new Error('workspace not found'); return item; }
  async update(id:string, changes:{name?:unknown;pinned?:unknown;open?:unknown}) {
    const item=this.get(id);
    if (changes.name!==undefined) { if(typeof changes.name!=='string'||!changes.name.trim()||changes.name.length>80) throw new Error('invalid workspace name'); item.name=changes.name.trim(); }
    if (changes.pinned!==undefined) { if(typeof changes.pinned!=='boolean') throw new Error('invalid pinned value'); item.pinned=changes.pinned; }
    if (changes.open===true) { if(!(await fs.stat(item.path).then(s=>s.isDirectory(),()=>false))) throw new Error('workspace path unavailable'); item.lastOpenedAt=new Date().toISOString(); }
    await this.save();return item;
  }
  async remove(id: string) {
    this.get(id);
    this.items = this.items.filter(w => w.id !== id);
    await this.save();
  }
  private save():Promise<void> { const next=this.pending.then(async()=>{
    await fs.mkdir(dirname(this.file),{recursive:true});const temp=`${this.file}.${randomUUID()}.tmp`;
    try{await fs.writeFile(temp,JSON.stringify({workspaces:this.items,quickPrompts:this.prompts},null,2));
      for(let attempt=0;;attempt++){try{await fs.rename(temp,this.file);break;}catch(error:any){if(!['EPERM','EACCES'].includes(error.code)||attempt>=3)throw error;await new Promise(resolve=>setTimeout(resolve,40*(attempt+1)));}}
    }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  });this.pending=next.catch(()=>{});return next;
  }
  async add(path: string): Promise<Workspace> {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('absolute workspace path required');
    const actual = await fs.realpath(path); if (!(await fs.stat(actual)).isDirectory()) throw new Error('workspace must be a directory');
    let item = this.items.find(w => pathKey(w.path) === pathKey(actual));
    if (!item) { item = { id: randomUUID(), path: actual, name: actual.split(/[\\/]/).at(-1) || actual, pinned: false, lastOpenedAt: new Date().toISOString() }; this.items.push(item); }
    item.lastOpenedAt = new Date().toISOString();
    await this.save();
    return item;
  }
  /** Trusted provider-only, create-only metadata registration. No realpath/stat/Git/Pi.
   * A native parent/child lease must enclose this call and every guard invocation.
   * Existing add() deliberately remains separate: it reuses existing rows. */
  async registerManagedNew(entry: ManagedFolderEntry, guard: () => void): Promise<Workspace> {
    const display = canonicalParent(entry.displayPath), name = childName(entry.name);
    const physical = /^\\\\\?\\Volume\{[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\}\\(.+)$/i.exec(entry.stablePath);
    if (!physical || physical[1].toLowerCase() !== display.slice(3) || display.split('\\').at(-1) !== name.toLowerCase()
      || !/^[a-f0-9]{16}$/.test(entry.volume) || !/^[a-f0-9]{32}$/.test(entry.fileId)) throw Error('invalid managed workspace');
    const next = this.pending.then(async () => {
      guard();
      if (this.items.some(w => [entry.displayPath, entry.stablePath].some(p => pathKey(w.path) === pathKey(p)))) throw Error('managed workspace already registered');
      const item: Workspace = { id: randomUUID(), path: entry.stablePath, name, pinned: false, lastOpenedAt: new Date().toISOString() };
      guard(); await fs.mkdir(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try {
        guard(); await fs.writeFile(temp, JSON.stringify({ workspaces: [...this.items, item], quickPrompts: this.prompts }, null, 2), { flag: 'wx' });
        for (let attempt = 0;; attempt++) {
          guard();
          try { await fs.rename(temp, this.file); break; }
          catch (error: any) { if (!['EPERM', 'EACCES'].includes(error.code) || attempt >= 3) throw error; await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1))); }
        }
        // A successful atomic metadata commit stays committed even if the lease expires
        // just afterward; receipt reconciliation must report it, never retry/create again.
        this.items.push(item); return item;
      } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    });
    this.pending = next.catch(() => {}); return next;
  }
}
export function piSessionDir(): string { return process.env.PI_CODING_AGENT_SESSION_DIR ?? join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'sessions'); }

// Cached session metadata is keyed by a stat signature covering identity (dev/ino),
// size and timestamp granularity; any change, replace or rename forces a re-read.
// Only successful reads are cached: failed or malformed files are re-read every
// call, so a transient failure never becomes a stale negative entry.
type SessionSignature = { dev: number; ino: number | bigint; size: number; mtimeMs: number; ctimeMs: number };
type SessionMeta = { signature: SessionSignature; id: string; name?: string; cwd: string };
const sessionMetaCache = new Map<string, SessionMeta>();
const SESSION_META_CACHE_LIMIT = 2048;
const SESSION_META_ENTRY_BYTES = 8192;
function statSignature(stat: { dev: number; ino: number | bigint; size: number; mtimeMs: number; ctimeMs: number }): SessionSignature {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}
function sameSignature(a: SessionSignature, b: SessionSignature): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function rememberSessionMeta(path: string, meta: SessionMeta): void {
  sessionMetaCache.delete(path);
  // Do not let unusually large custom names/headers turn a metadata cache into
  // another copy of session content. Oversize entries remain readable uncached.
  if(Buffer.byteLength(path)+Buffer.byteLength(meta.id)+Buffer.byteLength(meta.cwd)+Buffer.byteLength(meta.name??'')>SESSION_META_ENTRY_BYTES)return;
  sessionMetaCache.set(path, meta); // fresh entries land at the end
  while (sessionMetaCache.size > SESSION_META_CACHE_LIMIT) sessionMetaCache.delete(sessionMetaCache.keys().next().value as string);
}
export async function readSession(path: string, workspace: Workspace): Promise<SessionInfo | undefined> {
  let stat;
  try { stat = await fs.stat(path); if (!stat.isFile()) { sessionMetaCache.delete(path); return; } } catch { sessionMetaCache.delete(path); return; }
  let meta = sessionMetaCache.get(path);
  if (!meta || !sameSignature(meta.signature, statSignature(stat))) {
    meta = await readSessionMeta(path, stat);
    // Stat again after the reads: a file changed mid-read is returned once but
    // never cached, so the next poll re-reads a consistent snapshot.
    const after = await fs.stat(path).catch(() => undefined);
    if (!meta || !after || !sameSignature(meta.signature, statSignature(after))) sessionMetaCache.delete(path);
    else rememberSessionMeta(path, meta);
    if (!after) return;
    stat = after;
  }
  if (!meta) return;
  // Workspace membership is re-verified on every call so a symlink retarget or a
  // workspace-path update can never widen the boundary through cached metadata.
  const cwd = await fs.realpath(meta.cwd).catch(() => meta.cwd);
  if (pathKey(cwd) !== pathKey(workspace.path)) return;
  // A fresh object per call: callers may freely mutate or extend it without
  // touching the cached metadata, which only holds immutable primitives.
  return { id: meta.id, workspaceId: workspace.id, filePath: path, name: meta.name, updatedAt: stat.mtime.toISOString() };
}
async function readSessionMeta(path: string, stat: SessionSignature): Promise<SessionMeta | undefined> {
  let handle;
  try {
    handle = await fs.open(path, 'r'); const buffer = Buffer.alloc(131072); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const line = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0];
    const header = JSON.parse(line);
    if (header.type !== 'session' || typeof header.id !== 'string' || typeof header.cwd !== 'string') return;
    const first=buffer.subarray(0,bytesRead).toString('utf8').split('\n');
    let firstPrompt='';
    for (const line of first.slice(1)) { try { const entry=JSON.parse(line); if(entry.type==='message'&&entry.message?.role==='user') { const content=entry.message.content; firstPrompt=typeof content==='string'?content:Array.isArray(content)?content.filter((v:any)=>v.type==='text').map((v:any)=>v.text).join(' '):'';break; } } catch {} }
    const tailSize=Math.min(65536,stat.size);const tail=Buffer.alloc(tailSize);await handle.read(tail,0,tailSize,stat.size-tailSize);
    let name=typeof header.name==='string'?header.name:undefined;
    for(const line of tail.toString('utf8').split('\n')) { try { const entry=JSON.parse(line); if(entry.type==='session_info') name=typeof entry.name==='string'?entry.name:undefined; } catch {} }
    // Prompts may embed attachment payloads; the title uses the typed text plus
    // attachment names, never file bodies.
    const split=splitPromptAttachments(firstPrompt);
    const fallback=(split.text+(split.attachments.length?` 📎 ${split.attachments.map(a=>a.name).join(', ')}`:'')).replace(/\s+/g,' ').trim().slice(0,72);
    return { signature: statSignature(stat), id: header.id, cwd: header.cwd, name: name||fallback||undefined };
  } catch { return; } finally { await handle?.close(); }
}
export async function listSessions(workspace: Workspace, root = piSessionDir()): Promise<SessionInfo[]> {
  const result: SessionInfo[] = [];
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (dir.isFile() && dir.name.endsWith('.jsonl')) { const found = await readSession(join(root, dir.name), workspace); if (found) result.push(found); }
    if (!dir.isDirectory()) continue;
    const files = await fs.readdir(join(root, dir.name), { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const found = await readSession(join(root, dir.name, file.name), workspace);
      if (found) result.push(found);
    }
  }
  return result.sort((a,b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}
