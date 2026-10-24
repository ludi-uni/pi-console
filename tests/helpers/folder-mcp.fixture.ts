import assert from 'node:assert/strict';
import { appendFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { FolderMcp, canonicalParent } from '../../server/folder-mcp.ts';
import { ownerFixture } from '../local-owner.fixture.ts';
export function fakeFolders() {
  let identity = 'volume:file:1', reparse = false, stageFailure = '', callback: (() => void) | undefined;
  const created: any[] = [], registered: any[] = [];
  const provider = {
    kind: 'fake' as const,
    inspect: async (path: string) => { if (reparse) throw Error(); return { path: canonicalParent(path), identity }; },
    withParent: async (pin: any, guard: () => void, work: (tx: any) => Promise<any>) => {
      if (pin.identity !== identity || reparse) throw Error(); guard();
      const tx = {
        createDirectory: async (name: string) => { guard(); if (created.some(v => v.name.toLowerCase() === name.toLowerCase())) throw Error(); const item = { name, path: pin.path + '\\' + name }; created.push(item); callback?.(); return item; },
        gitInit: async () => { guard(); if (stageFailure === 'git') throw Error(); },
        registerWorkspace: async (item: any) => { guard(); if (stageFailure === 'workspace') throw Error(); const w = { id: 'workspace-' + registered.length, path: item.path }; registered.push(w); return w; }
      };
      return work(tx);
    }
  };
  return { provider, created, registered, replace: () => { identity = 'volume:file:2'; }, reparse: () => { reparse = true; }, fail: (stage: string) => { stageFailure = stage; }, callback: (fn: () => void) => { callback = fn; } };
}
export function setup() {
  let time = Date.now(), issues = 0;
  const f = fakeFolders();
  const app = new FolderMcp(f.provider, { now: () => time, secret: () => (++issues).toString(16).padStart(64, '0') });
  const pair = () => app.request({ name: 'Generic MCP client' });
  const approve = async (p: any, ops = ['list', 'directory', 'repo', 'workspace']) => {
    const r = await app.review({ connectionId: p.connectionId, parent: 'D:\\Allowed', operations: ops, expiresAt: time + 60000 });
    await app.approve({ reviewId: r.reviewId, requestId: r.requestId, confirmed: true }, () => {});
    return { review: r, claim: app.claim({ connectionId: p.connectionId, proof: p.proof }) as any };
  };
  return { f, app, pair, approve, time: () => time, advance: (n: number) => { time += n; }, issues: () => issues };
}

export async function folderFixture(options: { randomKey?: () => string } = {}) {
  const x=setup(), f=await ownerFixture({...options,folders:x.app});
  const absolute=resolve(f.root); assert(absolute.startsWith(resolve(tmpdir())+'\\dummy-owner-'));
  const report=process.env.FOLDER_MCP_LIFECYCLE;
  if(report) await appendFile(report,JSON.stringify({phase:'created',kind:'dummy-folder-owner',pid:process.pid,root:absolute,owner:'folder-mcp',realProvider:false})+'\n');
  let closed=false;
  const issue: typeof f.issue = async (...args: Parameters<typeof f.issue>) => { const r=await f.issue(...args); if(report && r.status===200)await appendFile(report,JSON.stringify({phase:'listening',kind:'dummy-folder-owner',root:absolute,address:'127.0.0.1',managerPort:f.managerPort,ownerPort:f.app.status().port,realProvider:false})+'\n'); return r; };
  return {...f, issue, folders:x, cleanup:async()=>{if(closed)return;closed=true;await f.cleanup();assert.equal(f.app.status().listening,false);assert.equal(await access(absolute).then(()=>true,()=>false),false);if(report)await appendFile(report,JSON.stringify({phase:'closed',kind:'dummy-folder-owner',root:absolute,ownerListenerClosed:true,managerListenerClosed:true,tempRemoved:true,realProvider:false})+'\n');}};
}
