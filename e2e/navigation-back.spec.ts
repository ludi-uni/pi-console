import { test, expect } from '@playwright/test';
import { openWorkspaceAdd } from './workspace-setup.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('direct Execution entry backs through Chat, Sessions, then Workspaces',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-back-'));
  try{
    await page.setViewportSize({width:390,height:780});
    await page.addInitScript(()=>localStorage.setItem('pi-console:preferences:v1',JSON.stringify({defaultSessionView:'execution'})));
    await page.goto('/');await openWorkspaceAdd(page);await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    const created=page.waitForResponse(r=>r.url().includes('/api/sessions')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();const session=(await(await created).json()).session;
    await expect(page.getByLabel('Execution Timeline')).toBeVisible();
    await page.getByRole('button',{name:'← Chat'}).click();await expect(page.getByLabel('Chat output')).toBeVisible();
    await page.getByRole('button',{name:'← Sessions'}).click();await expect(page.getByLabel('Search sessions')).toBeVisible();
    await page.getByRole('button',{name:'← Workspaces'}).click();await expect(page.getByRole('heading',{name:'Workspaces'})).toBeVisible();
    await page.request.post('/api/close',{data:{workspaceId:session.workspaceId,sessionId:session.id}});
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});

test('session opened from workspace activity returns to Workspaces',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-activity-back-'));
  let reported:any[]=[];
  await page.route('**/api/activity*',route=>route.fulfill({json:{sessions:reported}}));
  try{
    await page.setViewportSize({width:390,height:780});await page.goto('/');
    await openWorkspaceAdd(page);await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    const created=page.waitForResponse(r=>r.url().includes('/api/sessions')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();const session=(await(await created).json()).session;
    reported=[{sessionId:session.id,workspaceId:session.workspaceId,workspaceName:'Workspace',sessionName:'Running task',running:true,decisionCount:0,updatedAt:new Date().toISOString(),work:[]}];
    await page.getByRole('button',{name:'← Sessions'}).click();await page.getByRole('button',{name:'← Workspaces'}).click();
    const inbox=page.getByRole('region',{name:'Activity notifications'});
    await expect(inbox).toContainText('1 running',{timeout:10000});
    await inbox.locator('summary').click();
    await inbox.getByRole('button',{name:/Running task/}).click();await expect(page.getByLabel('Chat output')).toBeVisible();
    await page.reload();await expect(page.getByLabel('Chat output')).toBeVisible();
    await page.getByRole('button',{name:'← Workspaces'}).click();await expect(page.getByRole('heading',{name:'Workspaces'})).toBeVisible();
    await page.request.post('/api/close',{data:{workspaceId:session.workspaceId,sessionId:session.id}});
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});
