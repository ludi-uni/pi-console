import { test, expect } from '@playwright/test';
import type { ChatMessage, ExecutionEvent, Snapshot } from '../shared/types.ts';

// Long-uptime retention: mocked APIs prove the chat DOM stays bounded, older
// messages stay reachable through explicit paging, the composer draft survives
// window moves, and post-event snapshot refetches coalesce. Server history
// paging exercises the optional chatTruncated/chatEarlierCount contract.
test.use({serviceWorkers:'block'});

const ws={id:'w1',name:'w1',path:'C:/fixture/w1',pinned:false,lastOpenedAt:'1',valid:true};
const sessionInfo={id:'s-w1',workspaceId:'w1',name:'Conversation w1',filePath:'/w1.jsonl',updatedAt:'1'};
const chat=(count:number,prefix='msg'):ChatMessage[]=>Array.from({length:count},(_,i)=>({id:`${prefix}-${i}`,role:i%5===4?'user':'assistant',text:`${prefix} ${i}`,complete:true}));

const routeApi=(page:import('@playwright/test').Page,state:{snapshot:Snapshot;historyReads:string[];stateReads:number;historyPages?:Record<number,{messages:ChatMessage[];earlier:number}>})=>page.route('**/api/**',async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname;
 let body:unknown={};
 if(path==='/api/workspaces')body={workspaces:[ws]};
 else if(path==='/api/workspaces/update')body={workspace:ws};
 else if(path==='/api/sessions')body={sessions:[sessionInfo]};
 else if(path==='/api/activity')body={sessions:[]};
 else if(path==='/api/quick-prompts')body={prompts:[]};
 else if(path==='/api/orchestrator'||path==='/api/orchestrator/decisions')body={available:false};
 else if(path==='/api/session/options')body={models:[],thinkingLevel:'off',thinkingLevels:['off']};
 else if(path==='/api/resume')body={snapshot:state.snapshot};
 else if(path==='/api/state'){state.stateReads++;body=state.snapshot;}
 else if(path==='/api/session/chat/history'){
  const before=Number(url.searchParams.get('before'));
  state.historyReads.push(url.search);
  if(url.searchParams.get('generation')!==state.snapshot.generation){await route.fulfill({status:409,json:{error:'Session restarted'}});return;}
  body=state.historyPages?.[before]??{messages:[],earlier:0};
 }
 else if(path==='/api/voice/status')body={enabled:false,available:false,phase:'off',providerId:'speech-cpp'};
 else if(path==='/api/pets')body={pets:[]};
 await route.fulfill({json:body});
});

const installEvents=(page:import('@playwright/test').Page)=>page.addInitScript(()=>{
 (window as any).EventSource=class{
  onopen?:()=>void; listeners=new Map<string,(event:{data:string})=>void>();
  constructor(){(window as any).__execution=this;queueMicrotask(()=>this.onopen?.());}
  addEventListener(name:string,listener:(event:{data:string})=>void){this.listeners.set(name,listener);}
  close(){}
 };
});
const emit=async(page:import('@playwright/test').Page,seq:number,type:ExecutionEvent['type'],payload:Record<string,unknown>,entityId='live')=>{
 const event:ExecutionEvent={schemaVersion:1,eventId:`event-${seq}`,seq,timestamp:new Date().toISOString(),generation:'g',workspaceId:'w1',sessionId:'s-w1',runId:'run',type,entityId,source:'pi-rpc',certainty:'observed',payload};
 await page.evaluate(event=>(window as any).__execution.listeners.get('execution')({data:JSON.stringify(event)}),event);
};
const openSession=async(page:import('@playwright/test').Page)=>{
 await page.setViewportSize({width:1280,height:800});await page.goto('/');
 await page.getByLabel('Workspace',{exact:true}).selectOption('w1');
 await page.getByLabel('Session list').getByRole('button').first().click();
};

test('chat window stays bounded, earlier messages stay reachable, and the composer draft is preserved',async({page})=>{
 const state={snapshot:{session:sessionInfo,runtime:'stopped',generation:'g',seq:1,events:[],execution:{nodes:[],rows:[],roots:[],unattached:[],activeCount:0,failedCount:0,decisionCount:0},chat:chat(400)} as Snapshot,historyReads:[] as string[],stateReads:0};
 await installEvents(page);await routeApi(page,state);
 await openSession(page);
 const box=page.locator('.chat');
 // Bounded DOM: the live tail is mounted, older messages are hidden behind an
 // explicit control rather than unmounted forever or all mounted at once.
 await expect(box.locator('[data-message-id="msg-399"]')).toBeVisible();
 await expect(box.locator('[data-message-id="msg-0"]')).toHaveCount(0);
 const mounted=()=>box.locator('[data-message-id]').count();
 expect(await mounted()).toBeLessThanOrEqual(240);
 const earlier=box.getByRole('button',{name:/earlier messages|前のメッセージ/});
 await expect(earlier).toBeVisible();
 // An unsent draft must survive window expansion — nothing about paging the
 // DOM may touch composer state.
 const prompt=page.getByRole('textbox',{name:'Prompt',exact:true});
 await prompt.fill('Unsent draft survives paging');await expect(prompt).toHaveValue('Unsent draft survives paging');
 // Page backwards twice: earlier messages appear, the newest drop out of the
 // DOM (bounded window), and the draft is untouched.
 await earlier.click();
 await expect(box.locator('[data-message-id="msg-100"]')).toBeVisible();
 await expect(box.locator('[data-message-id="msg-399"]')).toHaveCount(0);
 expect(await mounted()).toBeLessThanOrEqual(240);
 await earlier.click();
 await expect(box.locator('[data-message-id="msg-0"]')).toBeVisible();
 await expect(earlier).toHaveCount(0);
 await expect(prompt).toHaveValue('Unsent draft survives paging');
 // Prompt history still spans every supplied message, not just the window.
 await page.getByRole('button',{name:'Open prompt history',exact:true}).first().click();
 const history=page.locator('.prompt-history');
 await expect(history).toBeVisible();
 // Oldest user message (msg-4) is listed; jumping to a hidden prompt mounts it.
 await history.getByRole('button').last().click();
 await expect(box.locator('[data-message-id]')).not.toHaveCount(0);
});

test('server-trimmed history pages load via the history endpoint and failures keep the view',async({page})=>{
 const historyPages:Record<number,{messages:ChatMessage[];earlier:number}>={
  60:{messages:chat(40,'old').map((m,i)=>({...m,id:`old-${i+20}`})),earlier:20},
  20:{messages:chat(20,'old'),earlier:0},
 };
 const state={snapshot:{session:sessionInfo,runtime:'stopped',generation:'g',seq:1,events:[],execution:{nodes:[],rows:[],roots:[],unattached:[],activeCount:0,failedCount:0,decisionCount:0},chat:chat(60),chatTruncated:true,chatEarlierCount:60} as Snapshot,historyReads:[] as string[],stateReads:0,historyPages};
 await installEvents(page);await routeApi(page,state);
 await openSession(page);
 const box=page.locator('.chat');
 await expect(box.locator('[data-message-id="msg-59"]')).toBeVisible();
 // Supplied chat is fully inside the window, so the only "earlier" control is
 // the server-backed one — the button reports the server's earlier count.
 const earlier=box.getByRole('button',{name:/earlier messages|前のメッセージ/});
 await expect(earlier).toContainText('60');
 await earlier.click();
 await expect.poll(()=>state.historyReads.length).toBe(1);
 expect(state.historyReads[0]).toContain('before=60');
 expect(state.historyReads[0]).toContain('generation=g');
 await expect(box.locator('[data-message-id="old-20"]')).toBeVisible();
 // Second page: `before` follows the response's absolute index.
 await earlier.click();
 await expect.poll(()=>state.historyReads.length).toBe(2);
 expect(state.historyReads[1]).toContain('before=20');
 await expect(box.locator('[data-message-id="old-0"]')).toBeVisible();
 await expect(earlier).toHaveCount(0);
 // A draft survives server paging.
 await page.getByRole('textbox',{name:'Prompt',exact:true}).fill('Draft across history paging');
 await expect(page.getByRole('textbox',{name:'Prompt',exact:true})).toHaveValue('Draft across history paging');
});

test('streamed deltas still commit and post-event snapshot refetches coalesce',async({page})=>{
 const state={snapshot:{session:sessionInfo,runtime:'running',activeRunId:'run',generation:'g',seq:1,events:[],execution:{nodes:[],rows:[],roots:[],unattached:[],activeCount:0,failedCount:0,decisionCount:0},chat:[{id:'live',role:'assistant',text:'',complete:false}]} as Snapshot,historyReads:[] as string[],stateReads:0};
 await installEvents(page);await routeApi(page,state);
 await openSession(page);
 // A burst of deltas must accumulate into the visible text — throttling may
 // defer frames but never drops content.
 for(let i=0;i<5;i++)await emit(page,2+i,'MessageDelta',{delta:`t${i} `});
 await expect(page.locator('[data-message-id="live"]')).toContainText('t0 t1 t2 t3 t4');
 // A terminal event flushes immediately and lands the completed text.
 await emit(page,7,'MessageCompleted',{text:'Final answer',role:'assistant'});
 await expect(page.locator('[data-message-id="live"]')).toContainText('Final answer');
 // The first post-event refetch stays prompt (~120ms); a dense burst of tool
 // events coalesces into bounded refreshes instead of one request per event.
 const before=state.stateReads;
 await emit(page,8,'ToolStarted',{});
 await page.waitForTimeout(300);
 expect(state.stateReads).toBeGreaterThan(before);
 const afterFirst=state.stateReads;
 for(let i=0;i<6;i++)await emit(page,9+i,'ToolProgress',{});
 await page.waitForTimeout(300);
 // Coalesced: six events produced far fewer than six fetches while the first
 // refresh was still in flight / inside the minimum interval.
 expect(state.stateReads-afterFirst).toBeLessThan(6);
 await page.waitForTimeout(1000);
});

test('deep history replaces pages, navigates forward without gaps, and preserves the view on failure',async({page})=>{
 const transcript=chat(1360,'all');
 const historyPages:Record<number,{messages:ChatMessage[];earlier:number}>={};
 for(let end=120;end<=960;end+=120)historyPages[end]={messages:transcript.slice(end-120,end),earlier:end-120};
 const state={snapshot:{session:sessionInfo,runtime:'stopped',generation:'g',seq:1,events:[],execution:{nodes:[],rows:[],roots:[],unattached:[],activeCount:0,failedCount:0,decisionCount:0},chat:transcript.slice(960),chatTruncated:true,chatEarlierCount:960} as Snapshot,historyReads:[] as string[],stateReads:0,historyPages};
 await installEvents(page);await routeApi(page,state);await openSession(page);
 const box=page.locator('.chat'),earlier=box.getByRole('button',{name:/earlier messages/});
 const prompt=page.getByRole('textbox',{name:'Prompt',exact:true});
 await prompt.fill('Keep while reading');
 // First traverse the supplied live window, then all eight server pages.
 await earlier.click();await earlier.click();
 for(let end=960;end>0;end-=120){
  await earlier.click();
  await expect(box.locator('[data-message-id]').first()).toHaveAttribute('data-message-id',`all-${end-120}`);
  await expect(box.locator('[data-message-id]').last()).toHaveAttribute('data-message-id',`all-${end-1}`);
  expect(await box.locator('[data-message-id]').count()).toBeLessThanOrEqual(240);
 }
 await expect(earlier).toHaveCount(0);
 await page.route('**/api/session/chat/history?**',route=>route.fulfill({status:503,json:{error:'Temporarily unavailable'}}),{times:1});
 const newer=page.getByRole('button',{name:/newer messages/});
 await newer.click();
 await expect(page.getByRole('alert')).toContainText('History could not be loaded');
 await expect(box.locator('[data-message-id]').first()).toHaveAttribute('data-message-id','all-0');
 await expect(prompt).toHaveValue('Keep while reading');
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(box.locator('[data-message-id]').first()).toHaveAttribute('data-message-id','all-120');
 for(let start=240;start<=840;start+=120){
  await newer.click();
  await expect(box.locator('[data-message-id]').first()).toHaveAttribute('data-message-id',`all-${start}`);
 }
 await newer.click(); // Return to the beginning of the retained live snapshot.
 await expect(box.locator('[data-message-id]').first()).toHaveAttribute('data-message-id','all-960');
 await page.getByRole('button',{name:'Jump to latest',exact:true}).click();
 await expect(box.locator('[data-message-id]').last()).toHaveAttribute('data-message-id','all-1359');
 await expect(box.locator('[data-message-id="all-0"]')).toHaveCount(0);
 await expect(prompt).toHaveValue('Keep while reading');
});

test('clean loaded attachment drafts are evicted and lazily reloaded after visiting many sessions',async({page})=>{
 const sessions=Array.from({length:10},(_,i)=>({...sessionInfo,id:`s-${i}`,name:`Draft ${i}`}));
 const state={snapshot:{session:sessions[0],runtime:'stopped',generation:'g',seq:1,events:[],execution:{nodes:[],rows:[],roots:[],unattached:[],activeCount:0,failedCount:0,decisionCount:0},chat:chat(1)} as Snapshot,historyReads:[] as string[],stateReads:0};
 await installEvents(page);await routeApi(page,state);
 await page.route('**/api/sessions?**',route=>route.fulfill({json:{sessions}}));
 await page.route('**/api/resume',route=>{const id=route.request().postDataJSON().sessionId;return route.fulfill({json:{snapshot:{...state.snapshot,session:sessions.find(s=>s.id===id)}}})});
 await page.route('**/api/state?**',route=>{const id=new URL(route.request().url()).searchParams.get('sessionId');return route.fulfill({json:{...state.snapshot,session:sessions.find(s=>s.id===id)}})});
 await page.setViewportSize({width:1280,height:800});await page.goto('/');
 await page.evaluate(async()=>{
  const request=indexedDB.open('pi-console-composer-drafts-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
  const transaction=db.transaction('drafts','readwrite');
  for(let i=0;i<10;i++)transaction.objectStore('drafts').put({text:`Saved ${i}`,revision:1,files:[{name:`file-${i}.txt`,type:'text/plain',lastModified:1,size:1024*1024,bytes:new ArrayBuffer(1024*1024)}]},JSON.stringify(['w1',`s-${i}`]));
  await new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error)});db.close();
 });
 await page.getByLabel('Workspace',{exact:true}).selectOption('w1');
 const prompt=page.getByRole('textbox',{name:'Prompt',exact:true});
 for(let i=0;i<10;i++){
  await page.getByLabel('Session list').getByRole('button',{name:new RegExp(`^Draft ${i} `)}).click();
  await expect(prompt).toHaveValue(`Saved ${i}`);
  await expect(page.getByLabel('Attached files')).toContainText(`file-${i}.txt`);
 }
 // Change IndexedDB without a cross-tab notification. Revisiting an evicted
 // clean draft must read storage, rather than retaining its old File[] forever.
 await page.evaluate(async()=>{
  const request=indexedDB.open('pi-console-composer-drafts-v1',1);
  const db=await new Promise<IDBDatabase>(resolve=>{request.onsuccess=()=>resolve(request.result)});
  const transaction=db.transaction('drafts','readwrite'),store=transaction.objectStore('drafts'),key=JSON.stringify(['w1','s-0']);
  const read=store.get(key);read.onsuccess=()=>store.put({...read.result,text:'Reloaded after eviction',revision:2},key);
  await new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error)});db.close();
 });
 await page.getByLabel('Session list').getByRole('button',{name:/^Draft 0 /}).click();
 await expect(prompt).toHaveValue('Reloaded after eviction');
 await expect(page.getByLabel('Attached files')).toContainText('file-0.txt');
});
