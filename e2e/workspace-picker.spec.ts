import { test, expect } from '@playwright/test';
import { openWorkspaceAdd } from './workspace-setup.ts';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('workspace can be renamed and removed without deleting its folder',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-remove-workspace-'));
  try{
    await page.goto('/');await openWorkspaceAdd(page);await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    const entry=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:any)=>w.path===root);
    await page.getByRole('button',{name:'Manage workspace'}).click();
    await page.getByLabel('Rename workspace').fill('Renamed workspace');await page.getByRole('button',{name:'Rename',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Renamed workspace'})).toBeVisible();
    page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Remove from Console'}).click();
    await expect(page.getByRole('heading',{name:'Renamed workspace'})).toBeVisible();
    page.once('dialog',dialog=>{expect(dialog.message()).toContain('folder and its Pi sessions stay on disk');void dialog.accept()});
    await page.getByRole('button',{name:'Remove from Console'}).click();
    await expect(page.getByRole('heading',{name:'Renamed workspace'})).toHaveCount(0);
    expect((await(await page.request.get('/api/workspaces')).json()).workspaces.some((w:any)=>w.id===entry.id)).toBe(false);
    expect((await stat(root)).isDirectory()).toBe(true);
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});

test('server failure remains actionable on mobile workspace and session screens',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-error-'));
  try{
    await page.setViewportSize({width:390,height:780});
    await page.goto('/');await openWorkspaceAdd(page);await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    await expect(page.locator('main')).toHaveClass(/view-sessions/);
    await page.getByRole('button',{name:'← Workspaces'}).click();
    await page.route('**/api/workspaces',route=>route.abort());
    await page.locator('.workspace-card').filter({hasText:root}).click();
    await expect(page.locator('main')).toHaveClass(/view-sessions/);
    await expect(page.getByRole('alert')).toContainText('Server unavailable');
    await expect(page.getByRole('button',{name:'Reconnect / retry'})).toBeVisible();
    await page.getByRole('button',{name:'← Workspaces'}).click();
    await expect(page.getByRole('alert')).toBeVisible();
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});

test('mobile drill-down keeps workspace and session context while switching views',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-navigation-'));
  try{
    await page.setViewportSize({width:1440,height:900});await page.goto('/');
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-navigation-desktop.png')});
    await page.setViewportSize({width:390,height:780});
    await expect(page.getByRole('heading',{name:'Workspaces'})).toBeVisible();
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-navigation-workspaces.png')});
    await expect(page.getByRole('button',{name:'＋ Add a workspace',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'＋ Add a workspace',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Add a workspace'})).toBeInViewport();
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-navigation-add-workspace.png')});
    await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    await expect(page.locator('main')).toHaveClass(/view-sessions/);
    await expect(page.getByRole('button',{name:'← Workspaces'})).toBeVisible();
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-navigation-sessions.png')});
    const created=page.waitForResponse(response=>response.url().includes('/api/sessions')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();
    const response=await created;expect(response.ok(),await response.text()).toBeTruthy();
    await expect(page.locator('main')).toHaveClass(/view-chat/);
    await expect(page.getByRole('button',{name:'← Sessions'})).toBeVisible();
    await page.getByRole('button',{name:'Model settings',exact:true}).click();
    await expect(page.getByLabel('Model',{exact:true})).toBeEnabled({timeout:15000});
    const model=page.getByLabel('Model',{exact:true});
    const workspaceEntry=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:any)=>w.path===root);
    const sessionEntry=(await(await page.request.get(`/api/sessions?workspaceId=${workspaceEntry.id}`)).json()).sessions[0];
    const settings=(await(await page.request.get(`/api/session/options?workspaceId=${workspaceEntry.id}&sessionId=${sessionEntry.id}`)).json());
    await expect(model).toHaveValue(`${settings.model.provider}::${settings.model.id}`);
    const alternate=settings.models.find((m:any)=>m.provider!==settings.model.provider||m.id!==settings.model.id);
    if(alternate){
      await page.getByRole('button',{name:'Find models'}).click();
      await page.getByLabel('Model provider').selectOption(alternate.provider);
      await page.getByLabel('Search models').fill(alternate.id);
      await model.selectOption(`${alternate.provider}::${alternate.id}`);
      await expect(model).toHaveValue(`${alternate.provider}::${alternate.id}`);
      await page.getByRole('button',{name:'Find models'}).click();
      await page.getByLabel('Model provider').selectOption(settings.model.provider);
      await page.getByLabel('Search models').fill(settings.model.id);
      await model.selectOption(`${settings.model.provider}::${settings.model.id}`);
    }
    const thinking=page.getByLabel('Thinking',{exact:true});
    const nextLevel=settings.thinkingLevels.find((level:string)=>level!==settings.thinkingLevel);
    if(nextLevel){await thinking.selectOption(nextLevel);await expect(thinking).toHaveValue(nextLevel);await thinking.selectOption(settings.thinkingLevel);}
    await page.getByRole('button',{name:'Close model settings',exact:true}).click();
    await page.getByLabel('Choose files').setInputFiles([
      {name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('ATTACHMENT_OK')},
      {name:'icon.png',mimeType:'image/png',buffer:await readFile(join(process.cwd(),'public','icon-192.png'))},
    ]);
    await expect(page.getByLabel('Attached files')).toContainText('note.txt');
    await expect(page.getByLabel('Attached files')).toContainText('icon.png');
    if(process.env.PI_CONSOLE_SCREENSHOT){
      await page.screenshot({path:join(tmpdir(),'pi-console-controls-mobile.png')});
      await page.setViewportSize({width:1440,height:900});
      await page.screenshot({path:join(tmpdir(),'pi-console-controls-desktop.png')});
      await page.setViewportSize({width:390,height:780});
    }
    await page.setViewportSize({width:320,height:568});
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    const sendBottom=await page.getByRole('button',{name:'Send',exact:true}).evaluate(el=>el.getBoundingClientRect().bottom);
    const navTop=await page.locator('.mobile-nav').evaluate(el=>el.getBoundingClientRect().top);
    expect(sendBottom).toBeLessThanOrEqual(navTop);
    await page.setViewportSize({width:390,height:780});
    await page.route('**/api/prompt',route=>{const body=route.request().postDataJSON();expect(body.attachments).toHaveLength(2);expect(body.attachments[0].text).toBe('ATTACHMENT_OK');expect(body.attachments[1].data).toMatch(/^iVBOR/);void route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({runId:'test-only'})})});
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.getByLabel('Attached files')).not.toBeVisible();
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-navigation-chat.png')});
    await page.getByRole('button',{name:/Execution ·/}).click();
    await expect(page.locator('main')).toHaveClass(/view-execution/);
    await expect(page.getByRole('button',{name:/Execution ·/})).toHaveAttribute('aria-current','page');
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.waitForTimeout(230);
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-navigation-execution.png')});
    await page.getByRole('button',{name:'← Chat'}).click();
    await page.getByRole('button',{name:'← Sessions'}).click();
    await expect(page.locator('.session-list .session-row')).toHaveCount(1);
    await page.getByRole('button',{name:'← Workspaces'}).click();
    await page.locator('.workspace-card').filter({hasText:root}).click();
    await page.locator('.session-list .session-row>button:first-child').click();
    await expect(page.locator('main')).toHaveClass(/view-chat/);
    const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:any)=>w.path===root);
    for(const s of (await(await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions)await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:s.id}});
  }finally{
    try{const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:{path:string})=>w.path===root);
      if(ws)await page.request.post('/api/workspaces/remove',{data:{id:ws.id}})}catch{/* Preserve the original test failure. */}
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
  }
});

test('folder browser creates a local subfolder and rejects invalid or duplicate names',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-create-picker-'));
  try{
    await page.goto('/');
    await openWorkspaceAdd(page);await page.getByLabel('Workspace path').fill(root);
    await page.getByRole('button',{name:'Browse folders'}).click();
    const dialog=page.getByRole('dialog',{name:'Browse local folders'});
    await dialog.getByLabel('New folder name').fill('../escape');
    await dialog.getByRole('button',{name:'Create folder'}).click();
    await expect(dialog.getByRole('alert')).toContainText('invalid folder name');
    await dialog.getByLabel('New folder name').fill('fresh project');
    await dialog.getByRole('button',{name:'Create folder'}).click();
    await expect(dialog.getByRole('button',{name:'Use this folder'})).toBeEnabled();
    await expect(dialog.locator('.picker-footer')).toContainText('fresh project');
    await dialog.getByRole('button',{name:'Parent folder'}).click();
    await expect(dialog.getByRole('button',{name:'fresh project'})).toBeVisible();
    await dialog.getByLabel('New folder name').fill('fresh project');
    await dialog.getByRole('button',{name:'Create folder'}).click();
    await expect(dialog.getByRole('alert')).toContainText('EEXIST');
    await dialog.getByRole('button',{name:'fresh project'}).click();
    await dialog.getByRole('button',{name:'Use this folder'}).click();
    await expect(page.getByLabel('Workspace path')).toHaveValue(join(root,'fresh project'));
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});

test('folder browser selects a server-local workspace on desktop and mobile without exposing files',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-picker-'));
  const project=join(root,'my-project'),nested=join(project,'nested');
  await mkdir(nested,{recursive:true});await writeFile(join(root,'private.txt'),'not a directory');
  try {
    await page.goto('/');
    await openWorkspaceAdd(page);await page.getByRole('button',{name:'Browse folders'}).click();
    const dialog=page.getByRole('dialog',{name:'Browse local folders'});
    await expect(dialog.getByLabel('Folders',{exact:true})).toContainText('Home');
    await expect(dialog.getByLabel('Folders',{exact:true})).toContainText('Current directory');
    await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
    await page.getByLabel('Workspace path').fill(root);
    await page.getByRole('button',{name:'Browse folders'}).click();
    await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Folders',{exact:true})).toContainText('my-project');
    await expect(dialog.getByLabel('Folders',{exact:true})).not.toContainText('private.txt');
    await dialog.getByLabel('Filter folders').fill('my-proj');await expect(dialog.getByLabel('Folders',{exact:true}).getByRole('button')).toHaveCount(1);
    await dialog.getByRole('button',{name:'my-project'}).click();
    await expect(dialog.getByRole('button',{name:'Use this folder'})).toBeEnabled();
    await dialog.getByRole('button',{name:'Use this folder'}).click();
    await expect(page.getByLabel('Workspace path')).toHaveValue(project);
    await page.getByRole('button',{name:'Add & open'}).click();
    await expect(page.getByLabel('Workspace',{exact:true})).toHaveValue(/.+/);
    await page.getByRole('button',{name:'Manage workspace'}).click();
    await expect(page.getByLabel('Rename workspace')).toBeVisible();
    await page.getByRole('button',{name:'Hide workspace tools'}).click();
    await page.setViewportSize({width:390,height:780});
    await expect(page.locator('main')).toHaveClass(/view-sessions/);
    await page.getByRole('button',{name:'← Workspaces'}).click();
    await page.getByRole('button',{name:'＋ Add a workspace',exact:true}).click();
    await page.getByRole('button',{name:'Browse folders'}).click();
    await expect(dialog.getByLabel('Folders',{exact:true})).toContainText('nested');
    await dialog.getByRole('button',{name:'nested'}).click();
    expect(await dialog.getByRole('button',{name:'Use this folder'}).evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(40);
    await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button',{name:'Browse folders'})).toBeFocused();
    await page.getByRole('button',{name:'Browse folders'}).click();
    await dialog.getByRole('button',{name:'nested'}).click();await dialog.getByRole('button',{name:'Use this folder'}).click();
    await expect(page.getByLabel('Workspace path')).toHaveValue(nested);
    await page.locator('.workspace-card').filter({hasText:project}).click();
    await page.getByRole('button',{name:'New Session'}).click();
    await page.setViewportSize({width:320,height:568});
    const send=page.getByRole('button',{name:'Send',exact:true});await send.scrollIntoViewIfNeeded();
    const positions=await page.evaluate(()=>({send:document.querySelector('.composer-actions button')!.getBoundingClientRect().bottom,nav:document.querySelector('.mobile-nav')!.getBoundingClientRect().top}));
    expect(positions.send).toBeLessThanOrEqual(positions.nav);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
    const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:any)=>w.path===project);
    for(const s of (await(await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions)await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:s.id}});
  }finally {await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});
