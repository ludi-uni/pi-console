import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('selected kit target sends exact request without a Pi prompt and shows run status',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-orch-target-'));
  let job: {running:boolean;request:string;runId?:string}|undefined;
  let piPrompts=0;
  await page.route('**/api/orchestrator?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({available:true,...(job?{job}:{})})}));
  await page.route('**/api/prompt',route=>{piPrompts++;void route.abort()});
  await page.route('**/api/orchestrator/start',route=>{const b=route.request().postDataJSON();expect(b.request).toBe('Build a small plan');expect(b.workspaceId).toBeTruthy();expect(b.sessionId).toBeTruthy();job={running:true,request:b.request};void route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({job})})});
  try {
    await page.setViewportSize({width:390,height:780});await page.goto('/');
    await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    await page.getByRole('button',{name:'New Session'}).click();
    await expect(page.getByLabel('Send with')).toBeVisible();
    await page.getByLabel('Send with').selectOption('kit');
    await page.getByLabel('Prompt',{exact:true}).fill('Build a small plan');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.getByLabel('Execution Timeline')).toBeVisible();
    await expect(page.locator('.execution-area').getByText('ludi-agent-kit · Running')).toBeVisible();
    expect(piPrompts).toBe(0);
    const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:any)=>w.path===root);
    for(const s of (await(await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions)await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:s.id}});
  } finally {await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});
