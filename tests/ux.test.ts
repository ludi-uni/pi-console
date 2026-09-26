import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, readSession, listSessions } from '../server/runtime/workspaces.ts';
import { groupWorkspaces, filterSessions, connectionLabel, validQuickPrompts } from '../web/ui-logic.ts';
import { splitCode } from '../web/ChatMessage.tsx';

test('workspace metadata migrates old array, validates missing path, pin/rename/recent and prompts persist',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-ux-'));try{
    const a=join(root,'a'),b=join(root,'b');await mkdir(a);await mkdir(b);
    const file=join(root,'metadata.json');await writeFile(file,JSON.stringify([{id:'old',name:'old',path:a,pinned:false,lastOpenedAt:'2020-01-01T00:00:00.000Z'}]));
    const store=new WorkspaceStore(file);await store.load();assert.equal(store.list()[0].id,'old');
    await store.add(b);await store.update('old',{name:'Pinned A',pinned:true,open:true});
    assert.deepEqual(groupWorkspaces(await store.listWithValidity(),'a').pinned.map(w=>w.name),['Pinned A']);
    await store.savePrompts(['Review this','Run tests']);assert.rejects(store.savePrompts(['x'.repeat(201)]));
    const next=new WorkspaceStore(file);await next.load();assert.deepEqual(next.quickPrompts(),['Review this','Run tests']);
    assert.equal(next.list()[0].name,'Pinned A');await rm(a,{recursive:true});assert.equal((await next.listWithValidity())[0].valid,false);
    await assert.rejects(next.update('old',{open:true}),/unavailable/);
    await next.remove('old');assert.equal(next.list().some(w=>w.id==='old'),false);
    assert.equal((await stat(b)).isDirectory(),true);
    const reloaded=new WorkspaceStore(file);await reloaded.load();assert.deepEqual(reloaded.list().map(w=>w.path),[b]);
    await assert.rejects(reloaded.remove('old'),/workspace not found/);
  }finally{await rm(root,{recursive:true,force:true})}
});
test('session title fallback, recent ordering, search and running first',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-sessions-'));try{
    const file1=join(root,'1.jsonl'),file2=join(root,'2.jsonl');const header=(id:string)=>JSON.stringify({type:'session',id,cwd:root});
    await writeFile(file1,header('a')+'\n'+JSON.stringify({type:'message',message:{role:'system',content:'x'.repeat(43000)}})+'\n'+JSON.stringify({type:'message',message:{role:'user',content:[{type:'text',text:'Fix the failing test\nplease'}]}})+'\n');
    await writeFile(file2,header('b')+'\n'+JSON.stringify({type:'session_info',name:'Named session'})+'\n');
    const workspace={id:'ws',name:'ws',path:root,pinned:false,lastOpenedAt:''};
    assert.equal((await readSession(file1,workspace))?.name,'Fix the failing test please');
    assert.equal((await readSession(file2,workspace))?.name,'Named session');
    const found=await listSessions(workspace,root);assert.equal(found.length,2);
    const running=found.map(s=>({...s,running:s.id==='a'}));assert.equal(filterSessions(running,'FIX')[0].id,'a');assert.equal(filterSessions(running,'')[0].id,'a');
    assert.equal(filterSessions(running.map(s=>({...s,decisionCount:s.id==='b'?1:0})),'')[0].id,'b');
  }finally{await rm(root,{recursive:true,force:true})}
});
test('quick prompts, code fences and connection states are deterministic',()=>{
  assert.equal(validQuickPrompts(['Edit this']),true);assert.equal(validQuickPrompts(Array(9).fill('x')),false);
  assert.deepEqual(splitCode('before\n```ts\nconst x=1;\n```\nafter').map(p=>p.type),['text','code','text']);
  assert.equal(splitCode('```js\nline\n```')[0].text,'line');
  for(const [input,label] of [
    [{online:false,server:false,sse:'offline'},'Browser offline'],
    [{online:true,server:false,sse:'offline'},'Server unavailable'],
    [{online:true,server:true,sse:'reconnecting'},'SSE reconnecting'],
    [{online:true,server:true,sse:'connected',runtime:'failed'},'Pi process failed'],
    [{online:true,server:true,sse:'connected',runtime:'stopped'},'Pi process stopped'],
    [{online:true,server:true,sse:'connected',runtime:'running'},'Runtime healthy']
  ] as const)assert.equal(connectionLabel(input),label);
});
