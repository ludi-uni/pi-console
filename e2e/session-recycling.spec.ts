import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('session settings allow server-side retention days and manual recycling removes the row',async({page})=>{
  await page.setViewportSize({width:390,height:780});
  let policy={enabled:false,days:30};let recycled='';
  await page.route('**/api/session-retention',async route=>{
    if(route.request().method()==='POST')policy=route.request().postDataJSON();
    await route.fulfill({json:policy});
  });
  await page.route('**/api/session/recycle',async route=>{recycled=route.request().postDataJSON().sessionId;await route.fulfill({json:{ok:true}})});
  const root=await mkdtemp(join(tmpdir(),'pi-console-recycle-ui-'));
  try{
    await page.goto('/');
    const workspace=(await (await page.request.post('/api/workspaces',{data:{path:root}})).json()).workspace;
    const session=(await (await page.request.post('/api/sessions',{data:{workspaceId:workspace.id}})).json()).session;
    await page.reload();await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Automatic cleanup'}).click();
    await expect(page.getByLabel('Automatically recycle sessions')).not.toBeChecked();
    await page.getByLabel('Retention days').fill('45');await page.getByRole('button',{name:'Save retention days'}).click();expect(policy).toEqual({enabled:false,days:45});
    await page.getByLabel('Automatically recycle sessions').click();await expect(page.getByLabel('Automatically recycle sessions')).toBeChecked();expect(policy).toEqual({enabled:true,days:45});
    await page.screenshot({path:join(tmpdir(),'pi-console-retention-settings-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'← Settings'}).click();await page.getByRole('button',{name:'← Back'}).click();
    await page.locator('.workspace-card').filter({hasText:root}).click();
    await expect(page.getByRole('button',{name:'Move New conversation to Recycle Bin'})).not.toBeVisible();
    await page.getByRole('button',{name:'Session menu for New conversation',exact:true}).click();
    await expect(page.getByRole('button',{name:'Move New conversation to Recycle Bin'})).toBeVisible();
    await page.screenshot({path:join(tmpdir(),'pi-console-session-recycle-mobile.png'),fullPage:true});
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Move New conversation to Recycle Bin'}).click();
    expect(recycled).toBe(session.id);await expect(page.getByLabel('Session list')).toContainText('No sessions yet');
    await page.request.post('/api/close',{data:{workspaceId:workspace.id,sessionId:session.id}});
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});
