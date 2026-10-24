import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import type { FinalPublication, PermissionInventory, PermissionSnapshot, WorkspacePermission } from '../shared/workspace-permissions.ts';
import { pathKey } from './runtime/workspaces.ts';

export class PermissionFault extends Error { constructor(readonly code: string) { super(code); } }
const fail = (code = 'permission_unavailable'): never => { throw new PermissionFault(code); };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export function strictPermissionObject(v: unknown, keys: string[]): asserts v is Record<string, any> {
  if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail('invalid_arguments');
}
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(v);
export function validatePermissionSnapshot(v: unknown): PermissionSnapshot {
  strictPermissionObject(v, object(v)&&v.version===2?['version','revision','workspaces','finalPublication','finalRequests']:['version', 'revision', 'workspaces']);
  if (![1,2].includes(v.version) || !Number.isSafeInteger(v.revision) || v.revision < 0 || !Array.isArray(v.workspaces) || v.workspaces.length > 100) fail();
  const ids = new Set<string>(), paths = new Set<string>();
  for (const w of v.workspaces) {
    strictPermissionObject(w, ['id', 'path', 'scope', 'sessions']);
    if (!identifier(w.id) || ids.has(w.id) || typeof w.path !== 'string' || w.path.length > 2048 || !isAbsolute(w.path) || w.path.startsWith('\\\\') || w.path.startsWith('//') || paths.has(pathKey(w.path)) || !['read', 'control'].includes(w.scope) || !Array.isArray(w.sessions) || !w.sessions.length || w.sessions.length > 64) fail();
    ids.add(w.id); paths.add(pathKey(w.path));
    const sessions = new Set<string>();
    for (const s of w.sessions) {
      strictPermissionObject(s, ['id', 'generation']);
      if (!identifier(s.id) || !identifier(s.generation) || sessions.has(s.id)) fail();
      sessions.add(s.id);
    }
  }
  if(v.version===2){
    if(!Array.isArray(v.finalRequests)||v.finalRequests.length>64)fail();
    const requests=new Set<string>();for(const r of v.finalRequests){strictPermissionObject(r,['requestId','instance','credentialEpoch','action','revision']);if(!identifier(r.requestId)||!identifier(r.instance)||!identifier(r.credentialEpoch)||!['grant','revoke'].includes(r.action)||!Number.isSafeInteger(r.revision)||r.revision<1||r.revision>v.revision||requests.has(r.requestId))fail();requests.add(r.requestId);}
    if(v.finalPublication!==null){const g=v.finalPublication;strictPermissionObject(g,['target','feature','expiresAt','credentialEpoch','requestId']);strictPermissionObject(g.target,['instance','revision','workspaceId','sessionId','generation','runId']);
      if(g.feature!=='final_answer'||!identifier(g.credentialEpoch)||!identifier(g.requestId)||!Number.isFinite(g.expiresAt)||g.expiresAt<0||g.target.revision!==v.revision||!Number.isSafeInteger(g.target.revision)||!['instance','workspaceId','sessionId','generation','runId'].every(k=>identifier(g.target[k])))fail();
      if(!v.finalRequests.some((r:any)=>r.requestId===g.requestId&&r.instance===g.target.instance&&r.credentialEpoch===g.credentialEpoch&&r.revision===v.revision&&r.action==='grant'))fail();
    }
  }
  return structuredClone(v) as PermissionSnapshot;
}
/** One exclusive disk lock covers CAS and admitted requests, including all await points.
 * Revoke linearizes only after admitted work settles; a crashed lock is fail-closed,
 * never reclaimed automatically. Stable permission data is outside update artifacts.
 */
export class WorkspacePermissions {
  readonly instance = randomUUID();
  private poisoned = false;
  constructor(readonly file: string) {}
  private async read(): Promise<PermissionSnapshot> {
    try {
      const stat = await lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) fail();
      return validatePermissionSnapshot(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, revision: 0, workspaces: [] };
      return fail();
    }
  }
  private async locked<T>(work: (snapshot: PermissionSnapshot) => Promise<T>): Promise<T> {
    if (this.poisoned) return fail();
    await mkdir(dirname(this.file), { recursive: true });
    let lock;
    try { lock = await open(`${this.file}.lock`, 'wx', 0o600); }
    catch { return fail('permission_busy'); }
    try { return await work(await this.read()); }
    finally {
      await lock.close();
      // A failed save must not resurrect the old scope in another process/restart.
      // Leave the lock as a fail-closed tombstone for explicit owner diagnosis.
      if (!this.poisoned) try { await rm(`${this.file}.lock`); } catch { this.poisoned = true; }
    }
  }
  snapshot() { return this.locked(async s => structuredClone(s)); }
  async replace(instance: unknown, revision: unknown, workspaces: unknown, inventory: () => Promise<PermissionInventory[]>, beforeSave: () => void = () => {}) {
    return this.locked(async old => {
      if (instance !== this.instance || revision !== old.revision || old.revision >= Number.MAX_SAFE_INTEGER) return fail('permission_stale');
      const next = validatePermissionSnapshot(old.version===2?{version:2,revision:old.revision+1,workspaces,finalPublication:null,finalRequests:old.finalRequests}:{ version: 1, revision: old.revision + 1, workspaces });
      const candidates = await inventory();
      for (const w of next.workspaces) {
        const candidate = candidates.find(c => c.id === w.id);
        if (!candidate?.eligible || pathKey(candidate.path) !== pathKey(w.path) || w.sessions.some(s => !candidate.sessions.some(c => c.id === s.id && c.generation === s.generation))) return fail('target_unavailable');
      }
      beforeSave(); await this.persist(next, beforeSave); return next;
    });
  }
  private async persist(next:PermissionSnapshot, beforeRename:()=>void=()=>{}){
    const temp=`${this.file}.${randomUUID()}.tmp`;try{const handle=await open(temp,'wx',0o600);try{await handle.writeFile(JSON.stringify(next));await handle.sync();}finally{await handle.close();}beforeRename();await rename(temp,this.file);}
    catch{this.poisoned=true;return fail('permission_save_failed');}finally{await rm(temp,{force:true}).catch(()=>{});}
  }
  async saveFinal(instance:string,revision:number,requestId:string,credentialEpoch:string,grant:Omit<FinalPublication,'requestId'|'credentialEpoch'>|null,verify:(snapshot:PermissionSnapshot)=>Promise<void>){
    return this.locked(async old=>{
      if(old.finalRequests?.some(r=>r.requestId===requestId))return fail('request_already_recorded');
      if(instance!==this.instance||revision!==old.revision||old.revision>=Number.MAX_SAFE_INTEGER)return fail('permission_stale');
      if(!identifier(requestId)||!identifier(credentialEpoch)||(old.finalRequests?.length??0)>=64)return fail('request_capacity');
      await verify(old);
      const next=validatePermissionSnapshot({version:2,revision:old.revision+1,workspaces:old.workspaces,
        finalPublication:grant?{...grant,target:{...grant.target,revision:old.revision+1},credentialEpoch,requestId}:null,
        finalRequests:[...(old.finalRequests??[]),{requestId,instance,credentialEpoch,action:grant?'grant':'revoke',revision:old.revision+1}]});
      await this.persist(next);return next;
    });
  }
  admit<T>(instance: unknown, revision: unknown, target: { workspaceId: string; sessionId: string; generation: string }, scope: 'read' | 'control', verify: (w: WorkspacePermission) => Promise<void>, dispatch: (w: WorkspacePermission) => Promise<T>, final?:{epoch:string;runId:string;active:()=>boolean;now:()=>number}) {
    return this.locked(async snapshot => {
      if (instance !== this.instance || revision !== snapshot.revision) return fail('permission_stale');
      const w = snapshot.workspaces.find(w => w.id === target.workspaceId);
      if (!w || scope === 'control' && w.scope !== 'control' || !w.sessions.some(s => s.id === target.sessionId && s.generation === target.generation)) return fail('permission_denied');
      const fence=()=>{if(!final)return;const g=snapshot.finalPublication;
        if(!final.active()||!g||g.feature!=='final_answer'||g.credentialEpoch!==final.epoch||g.expiresAt<=final.now()||g.target.instance!==instance||g.target.revision!==revision||g.target.workspaceId!==target.workspaceId||g.target.sessionId!==target.sessionId||g.target.generation!==target.generation||g.target.runId!==final.runId)return fail('final_scope_denied');};
      fence();await verify(w);const result=await dispatch(w);fence();return result;
    });
  }
}
export async function canonicalPermissionPath(path: string) {
  try {
    const stat = await lstat(path), actual = await realpath(path);
    if (!stat.isDirectory() || pathKey(actual) !== pathKey(path)) return fail('target_unavailable');
    return actual;
  } catch { return fail('target_unavailable'); }
}
