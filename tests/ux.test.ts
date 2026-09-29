import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, readSession, listSessions } from '../server/runtime/workspaces.ts';
import { groupWorkspaces, filterSessions, connectionLabel, recentIssue, validQuickPrompts, visibleExecutionRows } from '../web/ui-logic.ts';
import type { ExecutionEvent, ExecutionNode, ExecutionStateSnapshot } from '../shared/types.ts';
import ChatItem from '../web/ChatMessage.tsx';
import MarkdownContent, { workspacePath, workspaceReference } from '../web/MarkdownContent.tsx';
import { completionIds, freshCompletions } from '../web/notification-logic.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KitRunCard, { kitRequestTitle, kitRunProgress } from '../web/KitRunCard.tsx';
import KitChatReport from '../web/KitChatReport.tsx';

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
test('Recent issue clears on success, dismissal or expiry; newer failures remain visible',()=>{
  const now=Date.parse('2026-01-01T12:00:00Z');
  const event=(seq:number,type:ExecutionEvent['type'],minutesAgo:number):ExecutionEvent=>({schemaVersion:1,eventId:`event-${seq}`,seq,timestamp:new Date(now-minutesAgo*60_000).toISOString(),workspaceId:'w',sessionId:'s',runId:'r',type,entityId:'r',source:'pi-rpc',certainty:'observed',payload:{}});
  const failed=event(1,'ToolFailed',0.05),success=event(2,'RunCompleted',0.03),newFailure=event(3,'RunFailed',0);
  assert.equal(recentIssue([failed],[],now)?.eventId,failed.eventId);
  assert.equal(recentIssue([failed,success],[],now),undefined);
  assert.equal(recentIssue([failed,success,newFailure],[],now)?.eventId,newFailure.eventId);
  assert.equal(recentIssue([failed,success,newFailure],[newFailure.eventId],now),undefined);
  const expired=event(4,'RunFailed',0.2),held={eventId:expired.eventId,until:now+7000};
  assert.equal(recentIssue([expired],[],now),undefined);
  assert.equal(recentIssue([expired],[],now,held)?.eventId,expired.eventId);
  assert.equal(recentIssue([expired],[],now+7000,held),undefined);
  assert.equal(recentIssue([expired],[expired.eventId],now,held),undefined);
  assert.equal(recentIssue([expired,event(5,'RunCompleted',0.05)],[],now,held),undefined);
  assert.equal(recentIssue([expired,event(6,'ToolFailed',0.05)],[],now)?.eventId,'event-6');
});
test('completed subagent remains visible in Now while unrelated completed tools stay hidden',()=>{
  const make=(id:string,kind:ExecutionNode['kind'],parentId?:string):ExecutionNode=>({id,kind,parentId,label:id,status:'completed',correlation:'explicit',sourceKind:'pi',updatedAt:'2026-01-01T00:00:00Z'});
  const run=make('run','run'),tool=make('subagent-tool','tool','run'),agent=make('child','agent','subagent-tool'),other=make('other-tool','tool','run');
  const state:ExecutionStateSnapshot={nodes:[run,tool,agent,other],roots:['run'],unattached:[],rows:[{node:run,depth:0,unattached:false},{node:tool,depth:1,unattached:false},{node:agent,depth:2,unattached:false},{node:other,depth:1,unattached:false}],activeCount:0,failedCount:0,decisionCount:0};
  assert.deepEqual(visibleExecutionRows(state,new Set(),new Set()).map(row=>row.node.id),['run','subagent-tool','child']);
  assert.deepEqual(visibleExecutionRows(state,new Set(),new Set(['run'])),[{node:run,depth:0,unattached:false}]);
});

test('kit status uses only a verified run ID and never substitutes previous task progress',()=>{
  const node=(id:string,kind:ExecutionNode['kind'],parentId?:string):ExecutionNode=>({id,kind,parentId,label:id,status:'running',sourceKind:'orchestrator',correlation:'explicit',nativeId:kind==='orchestrator'?id.slice(5):id,updatedAt:'2026-01-01T00:00:00Z'});
  const previous=node('orch:old','orchestrator'),current=node('orch:new','orchestrator');
  const nodes=[previous,node('old task','task',previous.id),current,node('new task','task',current.id),node('reviewer','agent','new task')];
  assert.equal(kitRunProgress({running:true,request:'New task'},nodes).root,undefined);
  const progress=kitRunProgress({running:true,request:'New task',runId:'new'},nodes);
  assert.deepEqual(progress.tasks.map(n=>n.label),['new task']);assert.equal(progress.agents[0].label,'reviewer');
  assert.equal(kitRequestTitle('# Useful title\n'+'x'.repeat(10000)),'Useful title');
  assert.equal(kitRequestTitle('x'.repeat(10000)).length,120);
});

test('kit card renders live progress independently of task snapshot and escapes model text',()=>{
  const markup=renderToStaticMarkup(createElement(KitRunCard,{job:{running:true,request:'Test',progress:['計画中','報告 <script>']},nodes:[]}));
  assert.match(markup,/報告 &lt;script&gt;/);
  assert.match(markup,/計画中/);
  assert.match(markup,/Waiting for the first task update/);
});

test('assistant thought and command are separate, collapsed, and escaped',()=>{
  const markup=renderToStaticMarkup(createElement(ChatItem,{message:{id:'a',role:'assistant',text:'Answer',thinking:'<private>',tools:[{id:'x',name:'powershell',command:'Write-Output <safe>'}],complete:true}}));
  assert.match(markup,/<summary>Thinking/);assert.match(markup,/<summary>Command · powershell/);
  assert.match(markup,/&lt;private&gt;/);assert.match(markup,/Write-Output &lt;safe&gt;/);
  assert.match(markup,/>Answer<\/p>/);
});

test('kit progress and final report render as separate, escaped chat content',()=>{
  const active=renderToStaticMarkup(createElement(KitChatReport,{job:{running:true,request:'test',progress:['進捗あり']}}));
  assert.match(active,/<details[^>]*open=""/);assert.match(active,/aria-live="polite"/);
  const markup=renderToStaticMarkup(createElement(KitChatReport,{job:{running:false,request:'test',progress:['計画: <script>','報告受信'],report:'完了: <img>'}}));
  assert.doesNotMatch(markup,/<details[^>]*open=""/);
  assert.match(markup,/計画: &lt;script&gt;/);
  assert.match(markup,/報告受信/);
  assert.match(markup,/完了: &lt;img&gt;/);
  assert.match(markup,/最終結果は Pi の応答として保存します/);
});

test('Markdown output supports GFM, safe links and file references',()=>{
  const markup=renderToStaticMarkup(createElement(MarkdownContent,{text:'# Heading\n\n**bold** and [notes](docs/notes.md), `README.md`\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n```ts\nconst x=1;\n```\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))'}));
  assert.match(markup,/<h1>Heading<\/h1>/);assert.match(markup,/<strong>bold<\/strong>/);
  assert.match(markup,/<table>/);assert.match(markup,/type="checkbox"/);
  assert.match(markup,/Copy code|const x=1/);
  assert.match(markup,/Open docs\/notes.md in workspace/);assert.match(markup,/Open README.md in workspace/);
  assert.doesNotMatch(markup,/<script>/);assert.doesNotMatch(markup,/href="javascript:/);
  assert.equal(workspacePath('https://example.com/readme.md'),undefined);
  assert.equal(workspacePath('C:\\Dev\\project\\README.md'),'C:\\Dev\\project\\README.md');
  const spaced=renderToStaticMarkup(createElement(MarkdownContent,{text:'See C:\\Program Files\\My App\\notes.md and docs/my notes.md for details.'}));
  assert.match(spaced,/Open C:\\Program Files\\My App\\notes.md in workspace/);
  assert.match(spaced,/Open docs\/my notes.md in workspace/);
  const source=renderToStaticMarkup(createElement(MarkdownContent,{text:'Open src/main.ts or `main.py`.'}));
  assert.match(source,/Open src\/main.ts in workspace/);
  assert.match(source,/Open main.py in workspace/);
  assert.equal(workspacePath('payload.exe'),undefined);
  assert.deepEqual(workspaceReference('C:\\Dev\\project\\main.ts:42:8'),{path:'C:\\Dev\\project\\main.ts',line:42});
  assert.deepEqual(workspaceReference('src/main.ts#L42'),{path:'src/main.ts',line:42});
  assert.equal(workspaceReference('src/main.ts:0'),undefined);
  assert.equal(workspaceReference('src/main.ts:999999999999999999'),undefined);
  const lines=renderToStaticMarkup(createElement(MarkdownContent,{text:'See src/main.ts:42 and [there](src/main.ts#L42), or `main.py:7`.'}));
  assert.match(lines,/Open src\/main.ts:42 in workspace/);
  assert.match(lines,/Open main.py:7 in workspace/);
});

test('completion notifications ignore initial history and repeat poll results',()=>{
  const done={sessionId:'s',workspaceId:'w',sessionName:'work',workspaceName:'space',running:false,decisionCount:0,updatedAt:'',work:[],completion:{id:'done-1',status:'completed' as const,at:''}};
  assert.deepEqual(freshCompletions(undefined,[done]),[]);
  assert.deepEqual(freshCompletions(new Set(),[done]),[done]);
  assert.deepEqual(freshCompletions(completionIds([done]),[done]),[]);
});

test('quick prompts and connection states are deterministic',()=>{
  assert.equal(validQuickPrompts(['Edit this']),true);assert.equal(validQuickPrompts(Array(9).fill('x')),false);
  for(const [input,label] of [
    [{online:false,server:false,sse:'offline'},'Browser offline'],
    [{online:true,server:false,sse:'offline'},'Server unavailable'],
    [{online:true,server:true,sse:'reconnecting'},'SSE reconnecting'],
    [{online:true,server:true,sse:'connected',runtime:'failed'},'Pi process failed'],
    [{online:true,server:true,sse:'connected',runtime:'stopped'},'Pi process stopped'],
    [{online:true,server:true,sse:'connected',runtime:'running'},'Runtime healthy']
  ] as const)assert.equal(connectionLabel(input),label);
});
