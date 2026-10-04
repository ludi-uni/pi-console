import {test,expect} from '@playwright/test';
import { openWorkspaceAdd } from './workspace-setup.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('new session shows startup progress, prevents duplicate requests, and recovers after a startup failure',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-startup-ui-'));
  let release=()=>{};const pending=new Promise<void>(resolve=>{release=resolve});let requests=0;
  try{
    await page.setViewportSize({width:390,height:780});await page.goto('/');
    await openWorkspaceAdd(page);await page.getByLabel('Workspace path').fill(root);
    await page.getByRole('button',{name:'Add & open'}).click();
    await page.route('**/api/sessions',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      requests++;await pending;
      await route.fulfill({status:400,json:{error:'RPC get_state timed out'}});
    });
    const button=page.getByRole('button',{name:'New Session'});
    await button.click();
    await expect(page.getByRole('status',{name:'Session startup'})).toContainText('Extensions may take up to a minute');
    await expect(button).toBeDisabled();
    await expect(page.getByLabel('runtime state')).toHaveText('starting');
    await expect(page.getByText('No sessions yet. Select New Session to start.')).toHaveCount(0);
    await page.screenshot({path:join(tmpdir(),'pi-console-session-starting-mobile.png')});
    release();
    await expect(page.getByText('RPC get_state timed out')).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(page.getByLabel('runtime state')).toHaveText('stopped');
    await expect(page.getByRole('status',{name:'Session startup'})).toHaveCount(0);
    expect(requests).toBe(1);
  }finally{
    release();
    try{const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((item:{path:string})=>item.path===root);
      if(ws)await page.request.post('/api/workspaces/remove',{data:{id:ws.id}})}catch{/* Preserve the test failure. */}
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
  }
});
