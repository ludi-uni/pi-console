import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm, rename, symlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { readSession, listSessions } from '../server/runtime/workspaces.ts';

const header = (id: string, cwd: string) => JSON.stringify({ type: 'session', id, cwd });

// Counts how many times the runtime opened a .jsonl session file while a
// wrapped readSession/listSessions call ran.
function counted<T>(paths: Set<string>, fn: () => Promise<T>): Promise<{ result: T; opens: number }> {
  const original = fs.open;
  let opens = 0;
  (fs as any).open = async (path: any, ...rest: any[]) => {
    if (typeof path === 'string' && path.endsWith('.jsonl') && paths.has(path)) opens++;
    return original(path, ...rest);
  };
  return Promise.resolve()
    .then(fn)
    .then(result => ({ result, opens }))
    .finally(() => { (fs as any).open = original; });
}

test('unchanged session files are not re-opened or re-parsed on repeat polls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-session-cache-'));
  try {
    const dir = join(root, 'work'); await mkdir(dir);
    const file = join(root, 'a.jsonl');
    await writeFile(file, header('s1', dir) + '\n' + JSON.stringify({ type: 'session_info', name: 'Stable name' }) + '\n');
    const workspace = { id: 'ws', name: 'ws', path: dir, pinned: false, lastOpenedAt: '' };
    const paths = new Set([file]);

    const first = await counted(paths, () => readSession(file, workspace));
    assert.equal(first.opens, 1);
    assert.equal(first.result?.name, 'Stable name');

    for (let i = 0; i < 3; i++) {
      const again = await counted(paths, () => readSession(file, workspace));
      assert.equal(again.opens, 0);
      assert.equal(again.result?.id, 's1');
      assert.equal(again.result?.name, 'Stable name');
    }
    const listed = await counted(paths, () => listSessions(workspace, root));
    assert.equal(listed.opens, 0);
    assert.deepEqual(listed.result.map(s => s.id), ['s1']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('content changes, session_info renames, deletes and file replacement are reflected on the next read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-session-cache-'));
  try {
    const dir = join(root, 'work'); await mkdir(dir);
    const file = join(root, 'b.jsonl');
    await writeFile(file, header('s2', dir) + '\n' + JSON.stringify({ type: 'session_info', name: 'Before' }) + '\n');
    const workspace = { id: 'ws', name: 'ws', path: dir, pinned: false, lastOpenedAt: '' };
    const paths = new Set([file]);
    assert.equal((await counted(paths, () => readSession(file, workspace))).opens, 1);
    assert.equal((await counted(paths, () => readSession(file, workspace))).opens, 0);

    // Appended session_info renames the session; the signature change forces a re-read.
    await appendFile(file, JSON.stringify({ type: 'session_info', name: 'After' }) + '\n');
    const renamed = await counted(paths, () => readSession(file, workspace));
    assert.equal(renamed.opens, 1);
    assert.equal(renamed.result?.name, 'After');
    assert.equal((await counted(paths, () => readSession(file, workspace))).opens, 0);

    // Size-preserving mtime/ctime update still invalidates the cached metadata.
    const bumped = new Date(Date.now() + 5000);
    await utimes(file, bumped, bumped);
    const touched = await counted(paths, () => readSession(file, workspace));
    assert.equal(touched.opens, 1);
    assert.equal(touched.result?.name, 'After');

    // Atomic-style replace (rename over the path) is picked up via dev/ino.
    const replacement = join(root, 'tmp.jsonl');
    await writeFile(replacement, header('s2', dir) + '\n' + JSON.stringify({ type: 'session_info', name: 'Replaced' }) + '\n');
    await rename(replacement, file);
    const replaced = await counted(paths, () => readSession(file, workspace));
    assert.equal(replaced.opens, 1);
    assert.equal(replaced.result?.name, 'Replaced');

    // Deletion is reflected and never cached as a stale negative or positive entry.
    await rm(file);
    const gone = await counted(paths, () => readSession(file, workspace));
    assert.equal(gone.opens, 0);
    assert.equal(gone.result, undefined);
    await writeFile(file, header('s3', dir) + '\n');
    const recreated = await counted(paths, () => readSession(file, workspace));
    assert.equal(recreated.opens, 1);
    assert.equal(recreated.result?.id, 's3');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('workspace membership is re-verified per call and malformed files are never negatively cached', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-session-cache-'));
  try {
    const dirA = join(root, 'a'), dirB = join(root, 'b');
    await mkdir(dirA); await mkdir(dirB);
    const file = join(root, 'c.jsonl');
    await writeFile(file, header('s4', dirA) + '\n');
    const wsA = { id: 'ws-a', name: 'a', path: dirA, pinned: false, lastOpenedAt: '' };
    const wsB = { id: 'ws-b', name: 'b', path: dirB, pinned: false, lastOpenedAt: '' };
    const paths = new Set([file]);

    // Cached metadata still yields no session for a non-member workspace.
    assert.equal((await counted(paths, () => readSession(file, wsA))).result?.workspaceId, 'ws-a');
    assert.equal((await counted(paths, () => readSession(file, wsB))).result, undefined);
    assert.equal((await counted(paths, () => readSession(file, wsB))).opens, 0);
    const listed = await counted(paths, () => listSessions(wsB, root));
    assert.equal(listed.opens, 0);
    assert.equal(listed.result.length, 0);

    // Cache a raw cwd alias, then retarget it without changing the session
    // file. Membership must follow realpath, not the old cache's workspace.
    const link = join(root, 'link');
    let linked=false;
    try { await symlink(dirA,link,process.platform==='win32'?'junction':'dir'); linked=true; }
    catch(error){if(!['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??''))throw error;t.diagnostic('Filesystem does not permit fixture symlinks');}
    if(linked){
      await writeFile(file,header('s4',link)+'\n');
      assert.equal((await readSession(file,wsA))?.workspaceId,'ws-a');
      assert.equal((await counted(paths,()=>readSession(file,wsA))).opens,0);
      await rm(link,{recursive:true});await symlink(dirB,link,process.platform==='win32'?'junction':'dir');
      const moved=await counted(paths,()=>readSession(file,wsA));
      assert.equal(moved.opens,0);assert.equal(moved.result,undefined);
      assert.equal((await readSession(file,wsB))?.workspaceId,'ws-b');
    }

    // Malformed content is re-attempted on every call, never negatively cached.
    const bad = join(root, 'd.jsonl');
    await writeFile(bad, 'not json\n');
    const badPaths = new Set([bad]);
    assert.equal((await counted(badPaths, () => readSession(bad, wsA))).result, undefined);
    assert.equal((await counted(badPaths, () => readSession(bad, wsA))).opens, 1);
    await writeFile(bad, header('s5', dirA) + '\n');
    const healed = await counted(badPaths, () => readSession(bad, wsA));
    assert.equal(healed.opens, 1);
    assert.equal(healed.result?.id, 's5');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('oversize metadata remains readable without retaining large custom names',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-console-session-cache-large-'));
 try{
  const file=join(root,'large.jsonl'),name='N'.repeat(9000);
  await writeFile(file,JSON.stringify({type:'session',id:'large',cwd:root,name})+'\n');
  const workspace={id:'w',name:'w',path:root,pinned:false,lastOpenedAt:''},paths=new Set([file]);
  for(let i=0;i<2;i++){const result=await counted(paths,()=>readSession(file,workspace));assert.equal(result.opens,1);assert.equal(result.result?.name,name);}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a file removed while reading is not returned or retained as a stale entry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-console-session-cache-race-')),original=fs.open;
 try{
  const file=join(root,'race.jsonl');await writeFile(file,header('race',root)+'\n');
  const workspace={id:'w',name:'w',path:root,pinned:false,lastOpenedAt:''};let removed=false;
  (fs as any).open=async(path:any,...rest:any[])=>{
   const handle=await original(path,...rest),read=handle.read.bind(handle);
   if(path===file)handle.read=(async(...args:any[])=>{const result=await (read as any)(...args);if(!removed){removed=true;await rm(file);}return result;}) as any;
   return handle;
  };
  assert.equal(await readSession(file,workspace),undefined);
  (fs as any).open=original;await writeFile(file,header('recreated',root)+'\n');
  const result=await counted(new Set([file]),()=>readSession(file,workspace));assert.equal(result.opens,1);assert.equal(result.result?.id,'recreated');
 }finally{(fs as any).open=original;await rm(root,{recursive:true,force:true});}
});

test('metadata cache covers realistic scans, is bounded, and returned sessions cannot poison cached entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-session-cache-'));
  try {
    const dir = join(root, 'work'); await mkdir(dir);
    const workspace = { id: 'ws', name: 'ws', path: dir, pinned: false, lastOpenedAt: '' };
    const files: string[] = [];
    for (let i = 0; i < 2050; i++) {
      const file = join(root, `s${String(i).padStart(3, '0')}.jsonl`);
      await writeFile(file, header(`id-${i}`, dir) + '\n');
      files.push(file);
    }
    const paths = new Set(files);
    // The observed installation has 713 files. A cache below that size would
    // evict entries while scanning and yield zero hits on the next full scan.
    const workingSet=files.slice(0,720);
    const first=await counted(paths,async()=>{for(const file of workingSet)await readSession(file,workspace);});
    assert.equal(first.opens,workingSet.length);
    const second=await counted(paths,async()=>{for(const file of workingSet)await readSession(file,workspace);});
    assert.equal(second.opens,0,'a realistic full repeat scan must perform no content reads');
    for(const file of files.slice(720))await readSession(file,workspace);
    assert.equal((await counted(paths,()=>readSession(files.at(-1)!,workspace))).opens,0);
    assert.equal((await counted(paths,()=>readSession(files[0],workspace))).opens,1,'oldest entry is evicted once the bound is exceeded');

    // Mutating a returned SessionInfo must not leak into the cache.
    const file = files[0];
    const session = (await readSession(file, workspace))!;
    session.name = 'MUTATED'; session.id = 'forged';
    const fresh = await readSession(file, workspace);
    assert.equal(fresh?.id, 'id-0');
    assert.notEqual(fresh?.name, 'MUTATED');
    assert.notEqual(session, fresh);
  } finally { await rm(root, { recursive: true, force: true }); }
});
