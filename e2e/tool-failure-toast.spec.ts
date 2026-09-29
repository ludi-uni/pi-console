import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('fresh tool failure appears over the UI and expires without moving the chat or execution panels',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-tool-toast-'));
  try{
    await page.setViewportSize({width:390,height:780});await page.goto('/');
    await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    const created=page.waitForResponse(response=>response.url().includes('/api/sessions')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();const createdResponse=await created;expect(createdResponse.ok()).toBeTruthy();
    const selectedSession=(await createdResponse.json()).session;
    await expect(page.getByRole('button',{name:'← Sessions'})).toBeVisible();
    const failure={schemaVersion:1,eventId:'tool-failure-once',seq:999,timestamp:new Date().toISOString(),workspaceId:selectedSession.workspaceId,sessionId:selectedSession.id,runId:'run',type:'ToolFailed',entityId:'tool',source:'pi-rpc',status:'failed',certainty:'observed',payload:{summary:'powershell exited with an error'}};
    let issuedAt:string|undefined;const events=()=>{const timestamp=issuedAt??=new Date().toISOString();return [{...failure,timestamp},...Array.from({length:230},(_,i)=>({...failure,timestamp,eventId:`progress-${i}`,seq:1000+i,type:'ToolProgress',status:'running',payload:{summary:`Progress ${i}`}}))]};
    await page.getByRole('button',{name:'← Sessions'}).click();
    await page.route('**/api/state?*',async route=>{const response=await route.fetch(),body=await response.json();body.events=events();body.seq=1229;await route.fulfill({response,body:JSON.stringify(body)})});
    await page.route('**/api/resume',async route=>{const response=await route.fetch(),body=await response.json();body.snapshot.events=events();body.snapshot.seq=1229;await route.fulfill({response,body:JSON.stringify(body)})});
    const resume=page.waitForResponse(response=>response.url().endsWith('/api/resume')&&response.request().method()==='POST');
    await page.getByLabel('Session list').getByRole('button').first().click();
    const response=await resume;expect((await response.json()).snapshot.events).toHaveLength(231);
    const toast=page.getByRole('alert',{name:'Recent tool or run issue'});
    await expect(toast).toContainText('powershell exited with an error');
    expect(await toast.evaluate(element=>getComputedStyle(element).position)).toBe('fixed');
    expect((await toast.boundingBox())!.y).toBeLessThan(100);
    await expect(page.locator('.alerts')).toHaveCount(0);
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-tool-toast-mobile.png')});
    await toast.hover();
    await page.waitForTimeout(7300);
    await expect(toast).toBeVisible();
    await toast.locator('summary').first().click();
    await page.mouse.move(1,400);
    await page.waitForTimeout(7300);
    await expect(toast).toBeVisible();
    await toast.getByRole('button',{name:'View in Execution'}).click();
    await expect(toast).not.toBeVisible();
    const log=page.getByLabel('Execution Event Log');
    await expect(log).toBeVisible();
    await expect(log.locator('[data-selected-issue="true"]')).toContainText('powershell exited with an error');
    await expect(log).toContainText('Selected issue · older than recent events');
    await page.screenshot({path:join(tmpdir(),'pi-console-tool-issue-history-mobile.png')});
    await expect(toast).not.toBeVisible({timeout:10000});
    await page.getByRole('button',{name:'← Chat'}).click();
    await page.getByRole('button',{name:'← Sessions'}).click();
    await page.getByLabel('Session list').getByRole('button').first().click();
    await expect(toast).toHaveCount(0);
    const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:{path:string})=>w.path===root);
    for(const item of (await(await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions)await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:item.id}});
  }finally{
    try{const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:{path:string})=>w.path===root);
      if(ws)await page.request.post('/api/workspaces/remove',{data:{id:ws.id}})}catch{/* Preserve the original test failure. */}
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
  }
});
