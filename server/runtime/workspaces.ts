import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import type { SessionInfo, Workspace } from '../../shared/types.ts';

export function pathKey(path: string): string { return resolve(path).replace(/[\\/]+$/, '').toLowerCase(); }
export class WorkspaceStore {
  private items: Workspace[] = [];
  private prompts: string[] = ['続きを実装して', 'テストして', '原因を調べて'];
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
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
}
export function piSessionDir(): string { return process.env.PI_CODING_AGENT_SESSION_DIR ?? join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'sessions'); }
export async function readSession(path: string, workspace: Workspace): Promise<SessionInfo | undefined> {
  let handle;
  try {
    handle = await fs.open(path, 'r'); const buffer = Buffer.alloc(131072); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const line = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0];
    const header = JSON.parse(line);
    if (header.type !== 'session' || typeof header.id !== 'string' || typeof header.cwd !== 'string') return;
    const cwd = await fs.realpath(header.cwd).catch(() => header.cwd);
    if (pathKey(cwd) !== pathKey(workspace.path)) return;
    const stat = await fs.stat(path);
    const first=buffer.subarray(0,bytesRead).toString('utf8').split('\n');
    let firstPrompt='';
    for (const line of first.slice(1)) { try { const entry=JSON.parse(line); if(entry.type==='message'&&entry.message?.role==='user') { const content=entry.message.content; firstPrompt=typeof content==='string'?content:Array.isArray(content)?content.filter((v:any)=>v.type==='text').map((v:any)=>v.text).join(' '):'';break; } } catch {} }
    const tailSize=Math.min(65536,stat.size);const tail=Buffer.alloc(tailSize);await handle.read(tail,0,tailSize,stat.size-tailSize);
    let name=typeof header.name==='string'?header.name:undefined;
    for(const line of tail.toString('utf8').split('\n')) { try { const entry=JSON.parse(line); if(entry.type==='session_info') name=typeof entry.name==='string'?entry.name:undefined; } catch {} }
    const fallback=firstPrompt.replace(/\s+/g,' ').trim().slice(0,72);
    return { id: header.id, workspaceId: workspace.id, filePath: path, name:name||fallback||undefined, updatedAt: stat.mtime.toISOString() };
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
