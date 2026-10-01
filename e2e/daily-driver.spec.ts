import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('mobile: workspace/session switch, send, execution, stop and output copy',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await page.setViewportSize({width:390,height:780});
  const cwd=await mkdtemp(join(tmpdir(),'pi-console-mobile-'));
  try{
    await page.goto('/');await expect(page.getByRole('heading',{name:'Workspaces'})).toBeVisible();
    await page.getByLabel('Workspace path').fill(cwd);await page.getByRole('button',{name:'Add & open'}).click();
    await expect(page.getByRole('button',{name:'New Session'})).toBeVisible();
    await page.getByRole('button',{name:'← Workspaces'}).click();
    await page.getByRole('button',{name:'Edit selected workspace'}).click();
    await page.getByRole('button',{name:'Pin',exact:true}).click();await expect(page.getByRole('button',{name:'Unpin'})).toBeVisible();
    await page.getByLabel('Rename workspace').fill('Mobile workspace');await page.getByRole('button',{name:'Rename',exact:true}).click();
    await page.getByRole('button',{name:'Hide workspace tools'}).click();
    await page.locator('.workspace-card').filter({hasText:cwd}).click();
    const firstSession=page.waitForResponse(r=>r.url().endsWith('/api/sessions')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();
    const firstResponse=await firstSession;expect(firstResponse.ok(),await firstResponse.text()).toBeTruthy();
    await expect(page.getByLabel('Model',{exact:true})).toBeEnabled({timeout:15000});
    await expect(page.getByLabel('Thinking',{exact:true})).toBeEnabled();
    await page.locator('.quick-details > summary').click();await page.getByRole('button',{name:'Edit saved shortcuts'}).click();await page.getByLabel('Quick prompts').fill('Check the result');await page.getByRole('button',{name:'Save prompts'}).click();
    await page.getByRole('button',{name:'Check the result'}).click();await expect(page.getByRole('textbox',{name:'Prompt',exact:true})).toHaveValue('Check the result');
    expect(await page.getByRole('button',{name:'Send',exact:true}).evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThan(720);
    await page.getByRole('textbox',{name:'Prompt',exact:true}).fill('Reply exactly MOBILE_COPY_OK.');await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.locator('.message[data-role="assistant"]').last()).toContainText('MOBILE_COPY_OK',{timeout:120000});
    await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible({timeout:30000});
    await expect(page.getByLabel('Context usage',{exact:true})).toContainText(/Context\s+\d+%/,{timeout:15000});
    await expect(page.getByLabel('runtime state')).not.toBeVisible();
    await page.locator('.message[data-role="assistant"]').last().getByRole('button',{name:'Copy all'}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('MOBILE_COPY_OK');
    await page.getByRole('button',{name:'← Sessions'}).click();await expect(page.getByLabel('Search sessions')).toBeVisible();
    await page.getByLabel('Search sessions').fill('MOBILE_COPY_OK');
    await expect(page.getByLabel('Session list').locator('.session-row')).toHaveCount(1,{timeout:15000});
    await page.getByLabel('Search sessions').fill('');
    const created=page.waitForResponse(r=>r.url().endsWith('/api/sessions')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();
    expect((await created).ok()).toBeTruthy();
    await expect(page.getByLabel('Chat output')).not.toContainText('MOBILE_COPY_OK');
    await page.getByRole('button',{name:'← Sessions'}).click();
    await page.getByLabel('Session list').locator('.session-row > button:first-child').filter({hasText:'MOBILE_COPY_OK'}).click();
    await expect(page.locator('.message[data-role="assistant"]').last()).toContainText('MOBILE_COPY_OK');
    await page.getByRole('textbox',{name:'Prompt',exact:true}).fill('Use powershell to run Start-Sleep -Seconds 8 and then reply done.');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.getByRole('button',{name:/Execution ·/}).click();
    await expect(page.getByLabel('Execution Timeline')).toContainText('running',{timeout:30000});
    await page.getByRole('button',{name:'Chat',exact:true}).click();
    await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Stop',exact:true}).click();
    await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
    const ws=(await (await page.request.get('/api/workspaces')).json()).workspaces.find((w:any)=>w.path===cwd);
    const sessions=(await (await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions;
    for(const item of sessions)await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:item.id}});
  }finally{await rm(cwd,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});

test('PWA: manifest, icons, service worker, offline shell and reconnect UI',async({page,context})=>{
  await page.goto('/');await page.evaluate(()=>navigator.serviceWorker.ready);await expect.poll(async()=>page.evaluate(async()=>{const c=await caches.open('pi-console-shell-v3');return (await c.keys()).some(req=>req.url.includes('/assets/'))})).toBe(true);
  const manifest=await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');expect(manifest.icons.some((i:any)=>i.sizes==='192x192')).toBe(true);expect(manifest.icons.some((i:any)=>i.sizes==='512x512')).toBe(true);
  const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');const check=await cdp.send('Page.getInstallabilityErrors');
  // Playwright's Chrome context is incognito; that browser-mode restriction is not an app blocker.
  expect(check.installabilityErrors.filter((e:any)=>e.errorId!=='in-incognito')).toEqual([]);
  await context.setOffline(true);await page.reload();await expect(page.getByRole('heading',{name:'pi-console'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reconnect / retry'})).toBeVisible();
  await context.setOffline(false);
});

test('long session: 350 messages, 1200 events, code copy and bounded history',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);const cwd=await mkdtemp(join(tmpdir(),'pi-console-long-'));
  try{
    await page.goto('/');const ws=(await (await page.request.post('/api/workspaces',{data:{path:cwd}})).json()).workspace;
    const sid=(await (await page.request.post('/api/sessions',{data:{workspaceId:ws.id}})).json()).session.id;
    await page.route('**/api/resume',async route=>{const response=await route.fetch();const body=await response.json();
      body.snapshot.chat=Array.from({length:350},(_,i)=>({id:`m${i}`,role:'assistant',text:i===349?'Result:\n\n```ts\nconst answer = 42;\n```':`message ${i}`,complete:true}));
      body.snapshot.events=Array.from({length:1200},(_,i)=>({eventId:`e${i}`,seq:i+1,timestamp:new Date().toISOString(),type:'RunCompleted',runId:'long',entityId:'long',source:'pi',payload:{summary:`event ${i}`}}));
      body.snapshot.seq=1200;await route.fulfill({response,body:JSON.stringify(body)});
    });
    await page.reload();await page.getByLabel('Workspace',{exact:true}).selectOption(ws.id);await page.getByLabel('Session',{exact:true}).selectOption(sid);
    await expect(page.getByLabel('Chat output').locator('article')).toHaveCount(350,{timeout:15000});
    await page.getByRole('button',{name:'Copy code'}).click();await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('const answer = 42;');
    await page.getByRole('button',{name:'History / Canonical Events'}).click();
    await expect(page.getByLabel('Execution Event Log').locator('div')).toHaveCount(200);
    const c=await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:sid}});expect(c.ok()).toBe(true);
  }finally{await rm(cwd,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});
