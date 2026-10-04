import { test, expect } from '@playwright/test';
import { openWorkspaceAdd } from './workspace-setup.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import packageInfo from '../package.json' with { type: 'json' };

test('mobile resume and focus follow latest; thought, command, and software information stay distinct',async({page})=>{
  test.setTimeout(45000);
  const root=await mkdtemp(join(tmpdir(),'pi-console-mobile-details-'));
  try {
    await page.setViewportSize({width:390,height:780});await page.goto('/');
    await openWorkspaceAdd(page);await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    const created=page.waitForResponse(r=>r.url().includes('/api/sessions')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();
    const session=(await (await created).json()).session;
    const id=session.workspaceId,sid=session.id;
    await page.route('**/api/resume',async route=>{
      const response=await route.fetch(), body=await response.json();
      if(body.snapshot.session.id!==sid)return route.fulfill({response});
      body.snapshot.chat=[...Array.from({length:20},(_,i)=>({id:`old-${i}`,role:'assistant',text:`Older message ${i} ${'content '.repeat(12)}`,complete:true})),{id:'latest',role:'assistant',text:'LATEST ANSWER',thinking:'Need to verify',tools:[{id:'tool-1',name:'powershell',command:'Write-Output CHECK_OK'}],complete:true}];
      await route.fulfill({response,body:JSON.stringify(body)});
    });
    await page.reload();
    const chat=page.getByLabel('Chat output'),latest=page.locator('[data-message-id="latest"]');
    await expect(latest).toContainText('LATEST ANSWER');
    await expect(latest.locator('details')).toHaveCount(2);
    await expect(latest.getByText('Need to verify')).not.toBeVisible();
    await latest.locator('summary').filter({hasText:'Thinking'}).click({timeout:10000});await expect(latest.getByText('Need to verify')).toBeVisible();
    await expect(latest.getByText('Write-Output CHECK_OK')).not.toBeVisible();
    await latest.locator('summary').filter({hasText:'Command · powershell'}).click({timeout:10000});await expect(latest.getByText('Write-Output CHECK_OK')).toBeVisible();
    const atBottom=()=>chat.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<25);
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-mobile-details.png')});
    await chat.evaluate(el=>el.scrollTop=0);await page.getByRole('button',{name:'Open settings'}).click();
    await page.getByRole('button',{name:'About the app'}).click();
    await expect(page.getByText(packageInfo.version,{exact:true})).toBeVisible();
    await expect(page.getByText(packageInfo.license,{exact:true})).toBeVisible();
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-mobile-overview.png')});
    await page.getByRole('button',{name:'← Settings'}).click();await page.getByRole('button',{name:'← Back'}).click();
    await expect(chat).toBeVisible();await expect.poll(atBottom).toBe(true);
    await chat.evaluate(el=>el.scrollTop=0);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect.poll(atBottom).toBe(true);
    await page.getByRole('button',{name:/Execution ·/}).click();
    await page.getByRole('button',{name:'← Chat'}).click();
    await page.getByRole('button',{name:'← Sessions'}).click();
    await expect(page.getByLabel('Search sessions')).toBeVisible();
    await page.getByRole('button',{name:'← Workspaces'}).click();
    await expect(page.getByRole('heading',{name:'Workspaces'})).toBeVisible();
    await page.request.post('/api/close',{data:{workspaceId:id,sessionId:sid}});
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});
