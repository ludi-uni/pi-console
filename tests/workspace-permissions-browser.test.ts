import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspacePermissions } from '../server/workspace-permissions.ts';
import { createDotsPermissionsApi } from '../server/dots-permissions-api.ts';
import { PromptReceipts } from '../server/runtime/prompt-receipts.ts';
import type { RuntimeManager } from '../server/runtime/manager.ts';

test('isolated real HTTP owner GUI desktop/mobile: multi-select, explicit control, review/cancel/revoke, lost response refresh and unmount', {timeout:120000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'dots-browser-'));
  const evidence=await mkdtemp(join(tmpdir(),'dots-permissions-visual-'));
  const workspaces=[{id:'workspace-A',path:join(root,'A')},{id:'workspace-B',path:join(root,'B')}];
  for(const w of workspaces)await mkdir(w.path);
  let generation='generation-1';
  const runtime={workspaces:{list:()=>workspaces},readOnlySessions:async(wid:string)=>({sessions:[{id:`session-${wid}`}],unavailable:false,truncated:false,ambiguousSessionIds:[]}),readOnlyObservation:()=>({observation:'observed',generation,runtime:'running',seq:1,truncated:false,nodes:[]})} as unknown as RuntimeManager;
  const permissions=new WorkspacePermissions(join(root,'workspace-permissions.json'));
  let api=createDotsPermissionsApi(runtime,permissions,new PromptReceipts(join(root,'receipts')));
  const vite=await createViteServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(root,'vite-cache'),server:{middlewareMode:true,hmr:false},appType:'custom'});
  const server=createServer((req,res)=>{void (async()=>{
    if(await api.handle(req,res))return;
    if(req.url==='/'){res.setHeader('content-type','text/html');res.end(await vite.transformIndexHtml('/', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/workspace-permissions.fixture.tsx"></script></body></html>'));return;}
    if(req.url?.startsWith('/api/')){res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/api/session-retention'?{enabled:false,days:30}:req.url==='/api/startup'?{supported:false,enabled:false,installed:false}:{pets:[]}));return;}
    vite.middlewares(req,res);
  })().catch(()=>{res.writeHead(500);res.end();});});
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
  const base=`http://127.0.0.1:${address.port}`;
  let browser;
  try{
    // Browser inherits only OS launch variables and an isolated profile/temp root.
    const env:Record<string,string>={TEMP:root,TMP:root,HOME:root,USERPROFILE:root,APPDATA:root,LOCALAPPDATA:root};
    for(const k of ['SystemRoot','WINDIR','PATH','PATHEXT','ComSpec'])if(process.env[k])env[k]=process.env[k]!;
    browser=await chromium.launch({executablePath:process.env.DOTS_TEST_BROWSER_EXECUTABLE??chromium.executablePath(),headless:true,env});
    for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
      const context=await browser.newContext({viewport});
      await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
      const page=await context.newPage();await page.goto(base);
      const open=async()=>{await page.getByRole('button',{name:'Local MCP',exact:true}).click();await page.getByRole('button',{name:'Manage existing connections and permissions',exact:true}).click();await page.getByRole('button',{name:'Review workspace and session permissions',exact:true}).click();await expect(page.getByLabel('Workspace workspace-A')).toBeVisible();};
      await open();
      await expect(page.getByText('Control is currently unavailable.',{exact:false})).toBeVisible();
      for(const id of ['A','B']){
        await page.getByLabel(`Workspace workspace-${id}`,{exact:true}).check();
        await page.getByLabel(`Session session-workspace-${id}`,{exact:true}).check();
      }
      await page.getByLabel('Scope workspace-B').selectOption('control');
      await page.getByRole('button',{name:'Review changes',exact:true}).click();
      await expect(page.getByText(workspaces[1].path,{exact:true}).first()).toBeVisible();
      await expect(page.getByRole('button',{name:'Save confirmed scope',exact:true})).toBeDisabled();
      await page.getByRole('button',{name:'Cancel changes',exact:true}).click();
      await expect(page.getByLabel('Workspace workspace-A')).not.toBeChecked();
      // Repeat and commit only after owner review.
      for(const id of ['A','B']){await page.getByLabel(`Workspace workspace-${id}`,{exact:true}).check();await page.getByLabel(`Session session-workspace-${id}`,{exact:true}).check();}
      await page.getByLabel('Scope workspace-B').selectOption('control');
      await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.getByLabel('Confirm permission scope').check();
      await page.getByRole('button',{name:'Save confirmed scope',exact:true}).click();
      await expect(page.getByRole('button',{name:'Review changes',exact:true})).toBeVisible();
      assert.equal((await permissions.snapshot()).workspaces.length,2);
      await page.screenshot({path:join(evidence,`permissions-selected-${viewport.width}.png`),fullPage:true});
      // Section navigation and mobile back unmount discard unsaved review/confirmation.
      await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.getByLabel('Confirm permission scope').check();
      if(viewport.width<901)await page.getByRole('button',{name:'← Settings',exact:true}).click();
      else await page.getByRole('button',{name:'Language',exact:true}).click();
      await open();await expect(page.getByRole('button',{name:'Review changes',exact:true})).toBeVisible();
      await page.getByLabel('Scope workspace-B').selectOption('read');
      await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.getByLabel('Confirm permission scope').check();
      // Commit succeeds but its response is lost. UI must not claim completion/retry.
      await page.route('**/api/workspace-permissions/save',async route=>{const response=await route.fetch({headers:{...route.request().headers(),origin:base,'sec-fetch-site':'same-origin'}});assert.equal(response.status(),200,await response.text());await route.abort();},{times:1});
      await page.getByRole('button',{name:'Save confirmed scope',exact:true}).click();
      await expect(page.getByRole('alert').filter({hasText:'Save outcome is unknown'})).toContainText('Save outcome is unknown');
      assert.equal((await permissions.snapshot()).workspaces[1].scope,'read');
      await page.getByRole('button',{name:'Refresh current permissions',exact:true}).click();
      await expect(page.getByLabel('Scope workspace-B')).toHaveValue('read');
      // Restart instance invalidates owner grants, refresh required.
      const before=await permissions.snapshot();api.dispose();
      const restarted=new WorkspacePermissions(permissions.file);api=createDotsPermissionsApi(runtime,restarted,new PromptReceipts(join(root,'receipts')));
      await page.getByLabel('Workspace workspace-A').uncheck();
      await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.getByLabel('Confirm permission scope').check();await page.getByRole('button',{name:'Save confirmed scope',exact:true}).click();
      await expect(page.getByRole('alert').filter({hasText:'Save outcome is unknown'})).toContainText('Save outcome is unknown');assert.deepEqual(await restarted.snapshot(),before);
      await page.getByRole('button',{name:'Refresh current permissions',exact:true}).click();await expect(page.getByLabel('Workspace workspace-A')).toBeChecked();
      // Explicit none selection revokes all new scope; legacy remains separate.
      await page.getByLabel('Workspace workspace-A').uncheck();await page.getByLabel('Workspace workspace-B').uncheck();await page.getByRole('button',{name:'Review changes',exact:true}).click();
      await expect(page.getByText('Revoke all NEW Dots permissions.',{exact:false})).toBeVisible();await page.getByLabel('Confirm permission scope').check();await page.getByRole('button',{name:'Save confirmed scope',exact:true}).click();
      await expect(page.getByLabel('Workspace workspace-A')).not.toBeChecked();assert.deepEqual((await restarted.snapshot()).workspaces,[]);
      await page.screenshot({path:join(evidence,`permissions-revoked-${viewport.width}.png`),fullPage:true});
      await context.close();
      generation='generation-2';
    }
    console.log(`Visual evidence: ${evidence}`);
  }finally{await browser?.close();api.dispose();server.close();server.closeAllConnections();await once(server,'close');await vite.close();await rm(root,{recursive:true,force:true});}
});
