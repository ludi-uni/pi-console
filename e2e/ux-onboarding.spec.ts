import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('empty mobile sessions foreground creation and explain costs before a run', async ({page}) => {
  const root=await mkdtemp(join(tmpdir(),'pi-console-onboarding-'));
  await page.route('**/api/orchestrator?*',route=>void route.fulfill({json:{available:true}}));
  try {
    await page.setViewportSize({width:390,height:844});
    await page.goto('/');
    await page.getByLabel('Workspace path').fill(root);
    await page.getByRole('button',{name:'Add & open'}).click();
    await expect(page.getByText('No sessions yet. Select New Session to start.')).toBeVisible();
    await expect(page.getByRole('button',{name:'New Session'})).toBeVisible();
    await expect(page.getByLabel('Search sessions')).toHaveCount(0);
    await expect(page.getByLabel('Session',{exact:true})).toHaveCount(0);
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-ux-empty-sessions.png')});
    const created=page.waitForResponse(r=>r.url().endsWith('/api/sessions')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();
    const response=await created;expect(response.ok(),await response.text()).toBeTruthy();
    await expect(page.getByText('Sending a prompt calls the selected Pi model; provider charges may apply.')).toBeVisible();
    await page.getByRole('button',{name:/Execution ·/}).click();
    await expect(page.getByText(/Additional model calls: a new session first gets a Pi acknowledgement/)).not.toBeVisible();
    await page.getByText('New orchestrator run',{exact:true}).click();
    await expect(page.getByText(/Additional model calls: a new session first gets a Pi acknowledgement/)).toBeVisible();
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-ux-cost-note.png')});
    await page.getByRole('button',{name:'← Chat'}).click();
    await page.getByRole('button',{name:'← Sessions'}).click();
    await expect(page.getByLabel('Search sessions')).toBeVisible();
    await expect(page.getByLabel('Session',{exact:true})).toBeVisible();
  } finally { await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{}); }
});
