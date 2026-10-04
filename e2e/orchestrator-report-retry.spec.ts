import {test,expect} from '@playwright/test';
import { openWorkspaceAdd } from './workspace-setup.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test.use({serviceWorkers:'block'});
test('report-only retry in Execution does not restart the kit',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-report-ui-'));
  let retries=0,handled=0,kitRestarts=0,piPrompts=0;
  const job:{running:boolean;request:string;runId:string;report:string;reportError?:string;reportHandled?:boolean}={running:false,request:'Report this run',runId:'run-report',report:'The run is done',reportError:'Pi response failed'};
  await page.route('**/api/orchestrator?*',route=>route.fulfill({json:{available:true,job}}));
  await page.route('**/api/orchestrator/decisions?*',route=>route.fulfill({json:{runId:'run-report',decisions:[],canResume:false}}));
  await page.route('**/api/orchestrator/report/retry',route=>{const value=route.request().postDataJSON();expect(value.workspaceId).toBeTruthy();expect(value.sessionId).toBeTruthy();expect(value.runId).toBe('run-report');retries++;job.running=true;job.reportError=undefined;void route.fulfill({json:{runId:'run-report',retrying:true}})});
  await page.route('**/api/orchestrator/report/handled',route=>{const value=route.request().postDataJSON();expect(value).toMatchObject({runId:'run-report',confirmed:true});handled++;job.reportError=undefined;job.reportHandled=true;void route.fulfill({json:{runId:'run-report',handled:true,reportedToPi:false}})});
  await page.route('**/api/orchestrator/resume',route=>{kitRestarts++;void route.abort()});
  await page.route('**/api/prompt',route=>{piPrompts++;void route.abort()});
  try{
    await page.setViewportSize({width:390,height:780});await page.goto('/');
    await openWorkspaceAdd(page);await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    await page.getByRole('button',{name:'New Session'}).click();
    await page.getByRole('button',{name:/Execution ·/}).click();
    const card=page.getByRole('status',{name:'Orchestrator run status'});
    await expect(card.locator('summary').first()).toContainText('Report not saved · Open to resolve');
    await expect(card.locator('.kit-run-body')).not.toBeVisible();
    await page.screenshot({path:join(tmpdir(),'pi-console-report-collapsed-mobile.png')});
    await page.getByRole('button',{name:'Chat',exact:true}).click();
    const report=page.locator('.kit-chat-report');
    await expect(report.locator('.kit-chat-final')).toBeVisible();
    await expect(report.locator('.kit-chat-final')).toContainText('The run is done');
    await page.getByRole('button',{name:/Execution ·/}).click();
    await card.locator('summary').first().click();
    await expect(page.getByLabel('Orchestrator request')).not.toBeVisible();
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-report-retry-mobile.png')});
    await card.getByRole('button',{name:'Retry saving report to Pi'}).click();
    await expect(card.getByRole('button',{name:'Retry saving report to Pi'})).toHaveCount(0);
    expect(retries).toBe(1);expect(kitRestarts).toBe(0);expect(piPrompts).toBe(0);
    job.running=false;job.reportError='Uncertain delivery';
    await expect(card).toContainText('Uncertain delivery');
    page.once('dialog',dialog=>{expect(dialog.message()).toContain('does not save the report');void dialog.accept()});
    await card.getByRole('button',{name:'Mark report handled after inspection'}).click();
    await expect(card).toContainText('Handled manually');
    await expect(page.getByText('New orchestrator run',{exact:true})).toBeVisible();
    await expect(page.getByLabel('Orchestrator request')).not.toBeVisible();
    expect(handled).toBe(1);expect(piPrompts).toBe(0);
    const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:{path:string})=>w.path===root);
    for(const s of (await(await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions)await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:s.id}});
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});
