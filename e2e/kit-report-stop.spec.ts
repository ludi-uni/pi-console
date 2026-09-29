import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('Pi report saving owned by the Orchestrator cannot be mistaken for a stoppable chat run',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-kit-stop-'));
  let stops=0;
  const job:{running:boolean;reporting:boolean;request:string;runId:string;startedAt:string;progress:string[];report?:string}={running:true,reporting:true,request:'Produce a report',runId:'kit-run',startedAt:new Date().toISOString(),progress:['Inspecting workspace','Saving final result']};
  await page.route('**/api/orchestrator?*',route=>route.fulfill({json:{available:true,job}}));
  await page.route('**/api/resume',async route=>{const response=await route.fetch(),body=await response.json();body.snapshot.activeRunId='pi-report-run';await route.fulfill({response,body:JSON.stringify(body)})});
  await page.route('**/api/stop',route=>{stops++;void route.fulfill({json:{ok:true}})});
  try{
    await page.setViewportSize({width:390,height:780});await page.goto('/');
    await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    const created=page.waitForResponse(r=>r.url().includes('/api/sessions')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();expect((await created).ok()).toBeTruthy();
    await page.getByRole('button',{name:'← Sessions'}).click();await page.getByLabel('Session list').getByRole('button').first().click();
    await expect(page.getByLabel('Progress reports')).toBeVisible();
    await expect(page.getByLabel('Progress reports').getByText('Saving final result')).toBeVisible();
    await expect(page.getByRole('button',{name:'Saving kit report…'})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
    await expect(page.getByLabel('Prompt',{exact:true})).toBeDisabled();
    await page.screenshot({path:join(tmpdir(),'pi-console-kit-report-stop-mobile.png')});
    expect(stops).toBe(0);
    const report=page.locator('.kit-chat-report');
    await report.locator('summary').first().click();
    job.progress.push('One more update');
    await expect(report).toContainText('One more update');
    await expect(page.getByLabel('Progress reports')).not.toBeVisible();
    await report.locator('summary').first().click();
    await expect(page.getByLabel('Progress reports')).toBeVisible();
    job.running=false;job.reporting=false;job.report='Completed report';
    await expect(report.locator('summary').first()).toContainText('Finished');
    await expect(report.locator('.kit-chat-final')).toBeVisible();
    await expect(report.locator('.kit-chat-final')).toContainText('Completed report');
  }finally{
    try{const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:{path:string})=>w.path===root);
      if(ws){for(const item of (await(await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions)await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:item.id}});
        await page.request.post('/api/workspaces/remove',{data:{id:ws.id}})}}catch{/* Preserve the original test failure. */}
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
  }
});
