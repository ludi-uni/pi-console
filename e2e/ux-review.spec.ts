import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('language, prompt suggestions and filtered model picker', async ({page}) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-ux-'));
  try {
    await page.setViewportSize({width:390,height:844});
    await page.route('**/api/quick-prompts', route => void route.fulfill({json:{prompts:['続きを実装して','テストして','原因を調べて']}}));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByLabel('Workspace path').fill(root);
    await page.getByRole('button', {name:'Add & open'}).click();
    const models=[{provider:'alpha',id:'current',name:'Current'},{provider:'beta',id:'other',name:'Other'}];
    await page.route('**/api/session/options?*', route => void route.fulfill({json:{
      model:{provider:'alpha',id:'current'}, models:[
        ...models
      ],thinkingLevel:'medium',thinkingLevels:['medium'],contextUsage:null
    }}));
    await page.route('**/api/session/model', route => void route.fulfill({json:{model:models[1],models,thinkingLevel:'medium',thinkingLevels:['medium'],contextUsage:null}}));
    const created=page.waitForResponse(r=>r.url().endsWith('/api/sessions')&&r.request().method()==='POST');
    await page.getByRole('button', {name:'New Session'}).click();
    const response=await created;expect(response.ok(),await response.text()).toBeTruthy();
    await expect(page.getByText('Suggested prompts')).toBeVisible();
    await page.locator('.quick-details > summary').click();
    await expect(page.getByRole('button', {name:'Continue implementing'})).toBeVisible();
    await expect(page.getByLabel('Model', {exact:true})).toBeEnabled();
    await expect(page.getByLabel('Model', {exact:true}).locator('option')).toHaveCount(2);
    await page.getByRole('button', {name:'Find models'}).click();
    await page.getByLabel('Model provider').selectOption('beta');
    await page.getByLabel('Search models').fill('other');
    await expect(page.getByLabel('Model', {exact:true}).locator('option')).toHaveCount(3);
    await expect(page.getByLabel('Model', {exact:true}).locator('option[value="beta::other"]')).toHaveCount(1);
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-ux-model-filter.png')});
    await page.getByLabel('Model', {exact:true}).selectOption('beta::other');
    await expect(page.getByLabel('Model', {exact:true})).toHaveValue('beta::other');
    await expect(page.getByLabel('Search models')).toHaveCount(0);
    await page.getByRole('button', {name:'Open settings'}).click();
    await page.getByRole('button', {name:'Language'}).click();
    await page.getByLabel('Display language').selectOption('ja');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await page.getByRole('button',{name:'← 設定'}).click();
    await page.getByRole('button',{name:'← 戻る'}).click();
    await page.locator('.quick-details > summary').click();
    await expect(page.getByRole('button',{name:'続きを実装して'})).toBeVisible();
  } finally {
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
  }
});
