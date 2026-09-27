import { test, expect } from '@playwright/test';
test.use({serviceWorkers:'block'});

test('completion notifications are opt-in, hidden-tab only and not replayed on load',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('pi-console:preferences:v1',JSON.stringify({completionNotifications:true}));
    (window as any).__notices=[];
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
    (window as any).Notification=class {static permission='granted';static requestPermission=async()=> 'granted';constructor(title:string,options:{body:string}){(window as any).__notices.push({title,body:options.body})}};
  });
  await page.route('**/sw.js',route=>void route.abort());
  let completed=false,activityCalls=0;
  await page.route('**/api/activity',route=>{activityCalls++;void route.fulfill({json:{sessions:completed?[{sessionId:'s',workspaceId:'w',sessionName:'Review',workspaceName:'Demo',running:false,decisionCount:0,updatedAt:new Date().toISOString(),work:[],completion:{id:'finish-1',status:'completed',at:new Date().toISOString()}}]:[]}})});
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
