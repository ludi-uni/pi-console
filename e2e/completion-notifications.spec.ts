import { test, expect } from '@playwright/test';
import type { ActiveSessionSummary } from '../shared/types.ts';
test.use({serviceWorkers:'block'});

test('child completions do not announce conversation completion in the header or browser',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('pi-console:preferences:v1',JSON.stringify({completionNotifications:true}));
    (window as any).__notices=[];
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
    (window as any).Notification=class {static permission='granted';constructor(title:string){(window as any).__notices.push(title)}};
  });
  await page.route('**/sw.js',route=>void route.abort());
  let sessions:ActiveSessionSummary[]=[];
  await page.route('**/api/activity',route=>void route.fulfill({json:{sessions}}));
  const initial=page.waitForResponse(response=>response.url().includes('/api/activity'));
  await page.goto('/');
  await initial;
  const item:ActiveSessionSummary={sessionId:'s',workspaceId:'w',sessionName:'Review',workspaceName:'Demo',running:true,decisionCount:0,updatedAt:new Date().toISOString(),work:[],completion:{id:'child-1',status:'completed',at:new Date().toISOString(),scope:'subagent'}};
  sessions=[item];
  const alerts=page.getByRole('button',{name:'Active session alerts'});
  await expect(alerts).toHaveText('● 1',{timeout:12000});
  expect(await page.evaluate(()=>(window as any).__notices)).toEqual([]);
  sessions=[{...item,running:false}];
  await expect(alerts).toHaveCount(0,{timeout:12000});
  expect(await page.evaluate(()=>(window as any).__notices)).toEqual([]);
  sessions=[{...item,running:false,completion:{...item.completion!,id:'conversation-1',scope:'conversation'}}];
  await expect(alerts).toHaveText('✓ 1',{timeout:12000});
  await expect.poll(()=>page.evaluate(()=>(window as any).__notices)).toEqual(['Pi work completed']);
});

test('a completion that arrives while running notifies exactly once when the session goes idle',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('pi-console:preferences:v1',JSON.stringify({completionNotifications:true}));
    (window as any).__notices=[];
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
    (window as any).Notification=class {static permission='granted';static requestPermission=async()=> 'granted';constructor(title:string,options:{body:string}){(window as any).__notices.push({title,body:options.body})}};
  });
  await page.route('**/sw.js',route=>void route.abort());
  let sessions:ActiveSessionSummary[]=[],activityCalls=0;
  const item=(running:boolean,decisionCount=0):ActiveSessionSummary=>({sessionId:'s',workspaceId:'w',sessionName:'Review',workspaceName:'Demo',running,decisionCount,updatedAt:new Date().toISOString(),work:[],completion:{id:'deferred-1',status:'completed',at:new Date().toISOString(),scope:'conversation'}});
  await page.route('**/api/activity',route=>{activityCalls++;void route.fulfill({json:{sessions}})});
  const initial=page.waitForResponse(response=>response.url().includes('/api/activity'));
  await page.goto('/');
  await initial;
  // The completion already exists but the session is still running: the ID must NOT be
  // consumed into `seen`, otherwise the later idle poll could never announce it.
  sessions=[item(true)];
  await expect.poll(()=>activityCalls,{timeout:12000}).toBeGreaterThan(1);
  expect(await page.evaluate(()=>(window as any).__notices)).toEqual([]);
  // Same completion with a pending decision stays pending too.
  sessions=[item(false,1)];
  await expect.poll(()=>activityCalls,{timeout:12000}).toBeGreaterThan(2);
  expect(await page.evaluate(()=>(window as any).__notices)).toEqual([]);
  // When the busy state clears, the SAME completion id notifies — exactly once.
  sessions=[item(false)];
  await expect.poll(()=>page.evaluate(()=>(window as any).__notices.length),{timeout:12000}).toBe(1);
  await expect.poll(()=>page.evaluate(()=>(window as any).__notices[0]?.title)).toBe('Pi work completed');
  await expect.poll(()=>activityCalls,{timeout:12000}).toBeGreaterThan(3);
  expect(await page.evaluate(()=>(window as any).__notices.length)).toBe(1);
  // A reload treats the already-idle completion as history: no replay.
  await page.reload();
  await expect.poll(()=>activityCalls,{timeout:12000}).toBeGreaterThan(4);
  expect(await page.evaluate(()=>(window as any).__notices.length)).toBe(0);
});

test('completion notifications are opt-in, hidden-tab only and not replayed on load',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('pi-console:preferences:v1',JSON.stringify({completionNotifications:true}));
    (window as any).__notices=[];
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
    (window as any).Notification=class {static permission='granted';static requestPermission=async()=> 'granted';constructor(title:string,options:{body:string}){(window as any).__notices.push({title,body:options.body})}};
  });
  await page.route('**/sw.js',route=>void route.abort());
  let completed=false,activityCalls=0;
  await page.route('**/api/activity',route=>{activityCalls++;void route.fulfill({json:{sessions:completed?[{sessionId:'s',workspaceId:'w',sessionName:'Review',workspaceName:'Demo',running:false,decisionCount:0,updatedAt:new Date().toISOString(),work:[],completion:{id:'finish-1',status:'completed',at:new Date().toISOString(),scope:'conversation'}}]:[]}})});
  const initial=page.waitForResponse(response=>response.url().includes('/api/activity'));
  await page.goto('/');
  await initial;
  await expect.poll(()=>page.evaluate(()=>(window as any).__notices.length)).toBe(0);
  expect(await page.evaluate(()=>({permission:Notification.permission,hidden:document.visibilityState,enabled:JSON.parse(localStorage.getItem('pi-console:preferences:v1')??'{}').completionNotifications,controller:!!navigator.serviceWorker?.controller}))).toEqual({permission:'granted',hidden:'hidden',enabled:true,controller:false});
  completed=true;
  await expect.poll(()=>activityCalls,{timeout:12000}).toBeGreaterThan(1);
  await expect.poll(()=>page.evaluate(()=>(window as any).__notices.length),{timeout:12000}).toBe(1);
  await expect.poll(()=>page.evaluate(()=>(window as any).__notices[0]?.title)).toBe('Pi work completed');
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>(window as any).__notices.length)).toBe(0);
});
