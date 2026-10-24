import {test} from 'node:test';import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';import {createServer as createViteServer} from 'vite';import {createServer} from 'node:http';import {once} from 'node:events';
import {mkdir,writeFile,readFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {ownerFixture} from './final-owner.fixture.ts';import {dummyReadKey,sampleAnswer} from './final-answer.fixture.ts';
import {createDotsPermissionsApi} from '../server/dots-permissions-api.ts';import {PromptReceipts} from '../server/runtime/prompt-receipts.ts';
import {createReadOnlyMcp} from '../server/readonly-mcp.ts';import {allowedHost,allowedPost} from '../server/access.ts';
import {createFinalOwnerComposition} from '../server/final-owner-composition.ts';import {WorkspacePermissions} from '../server/workspace-permissions.ts';
import {startOwnerPin} from './helpers/final-owner-pin.ts';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
test('shared normal composition desktop/mobile UI grant -> real pin text/hash -> revoke; loss/navigation/restart', {timeout:120000},async()=>{
 const evidence=process.env.FINAL_OWNER_EVIDENCE_DIR;if(!evidence||!/^docs\/verification\/final-owner\/acceptance-[a-z0-9]+$/.test(evidence))throw Error('EXPLICIT_NEW_EVIDENCE_DIRECTORY_REQUIRED');await mkdir(evidence,{recursive:false});
 const results:any[]=[];
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const trace:{method:string;path:string;status:number}[]=[];
  const f=await ownerFixture();let comp=f.composition,permissions=f.permissions;const baseApi=createDotsPermissionsApi(f.runtime,f.permissions,new PromptReceipts(join(f.root,'receipts')));
  const w=f.workspaces.list()[0],legacy=createReadOnlyMcp(f.runtime,{enabled:true,authentication:{mode:'shared_secret',key:'a1'.repeat(32)},scope:{version:1,workspaces:[{id:w.id,path:w.path,sessionIds:[f.sdk.getSessionId()]}]}});
  const vite=await createViteServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'vite-cache'),server:{middlewareMode:true,hmr:false},appType:'custom'});
  const server=createServer((req,res)=>void(async()=>{
   const url=new URL(req.url??'/','http://127.0.0.1');if(url.pathname.startsWith('/mcp/')||url.pathname.startsWith('/.well-known/'))res.once('finish',()=>{if(trace.length<32)trace.push({method:req.method??'unknown',path:url.pathname,status:res.statusCode});});
   if(comp.claimsDots&&(url.pathname==='/mcp/dots'||url.pathname.startsWith('/.well-known/oauth-protected-resource'))&&await comp.handle(req,res))return;
   if(await legacy.handle(req,res))return;
   if(!allowedHost(req.headers.host)||req.method==='POST'&&!allowedPost(req)){res.writeHead(403);res.end();return;}
   if(await comp.handle(req,res))return;if(await baseApi.handle(req,res))return;
   if(req.url==='/'){res.setHeader('content-type','text/html');res.end(await vite.transformIndexHtml('/','<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/workspace-permissions.fixture.tsx"></script></body></html>'));return;}
   if(req.url?.startsWith('/api/')){res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/api/session-retention'?{enabled:false,days:30}:req.url==='/api/startup'?{supported:false,enabled:false,installed:false}:{pets:[]}));return;}vite.middlewares(req,res);
  })().catch(()=>{res.writeHead(500);res.end();}));server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port;assert(![31717,31718,31719].includes(port));const base=`http://127.0.0.1:${port}`;
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,pin:Awaited<ReturnType<typeof startOwnerPin>>|undefined;
  try{
   const env:Record<string,string>={TEMP:f.root,TMP:f.root,HOME:f.root,USERPROFILE:f.root,APPDATA:f.root,LOCALAPPDATA:f.root};for(const k of ['SystemRoot','WINDIR','PATH','PATHEXT','ComSpec'])if(process.env[k])env[k]=process.env[k]!;
   browser=await chromium.launch({executablePath:process.env.DOTS_TEST_BROWSER_EXECUTABLE??chromium.executablePath(),headless:true,env});const context=await browser.newContext({viewport,timezoneId:'UTC'});
   await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());const page=await context.newPage();await page.goto(base);
   const open=async()=>{await page.getByRole('button',{name:'Local MCP',exact:true}).click();await page.getByRole('button',{name:'Manage existing connections and permissions',exact:true}).click();await page.getByRole('button',{name:'Review workspace and session permissions',exact:true}).click();await expect(page.getByLabel('Final target',{exact:true})).toBeVisible();};await open();
   const prepare=async()=>{await page.getByLabel('Final target',{exact:true}).selectOption('0');await page.getByLabel('Final expiry',{exact:true}).fill(new Date(Date.now()+10*60*1000).toISOString().slice(0,16));await page.getByRole('button',{name:'Review final-only publication',exact:true}).click();await expect(page.getByLabel('Confirm final-only keyholders scope')).toBeVisible();};
   const confirm=async()=>{await page.getByLabel('Confirm final-only keyholders scope').check();await page.getByRole('button',{name:'Save reviewed final scope',exact:true}).click();};
   await prepare();await expect(page.getByRole('button',{name:'Save reviewed final scope',exact:true})).toBeDisabled();await expect(page.getByText('Recipient: dedicated read-key holders.',{exact:false})).toBeVisible();
   const uiText=await page.locator('body').innerText();for(const s of [dummyReadKey,sampleAnswer,'DUMMY_PROMPT_NOT_PUBLIC','credentialEpoch'])assert(!uiText.includes(s));
   await page.screenshot({path:join(evidence,`review-${viewport.width}.png`),fullPage:true});await page.getByRole('button',{name:'Cancel final review',exact:true}).click();assert.equal((await permissions.snapshot()).finalPublication,undefined);
   await prepare();await confirm();await expect(page.getByLabel('Final target',{exact:true})).toBeVisible();const target=(await permissions.snapshot()).finalPublication!.target;
   if(viewport.width===1280){
    pin=await startOwnerPin(f.root,base);const catalog=await pin.command('tools/list');assert.deepEqual(catalog.tools.map((x:any)=>x.name),['read_final_answer']);
    const discovered=Object.fromEntries(Object.entries(catalog.tools[0].inputSchema.properties).filter(([k])=>Object.hasOwn(target,k)).map(([k,v])=>[k,(v as any).const]));assert.deepEqual(discovered,target);
    let text='',cursor:string|undefined,hash='';do{const r:any=await pin.command('tools/call',{name:'read_final_answer',arguments:{...discovered,limit:32,...(cursor?{cursor}:{})}});assert.equal(r.isError,false);assert.equal(r.structuredContent.byteOffset,Buffer.byteLength(text));assert.equal(r.structuredContent.aggregateCompletionConfirmed,false);text+=r.structuredContent.text;hash=r.structuredContent.sha256;cursor=r.structuredContent.nextCursor??undefined;}while(cursor);
    assert.equal(text,sampleAnswer);assert.equal(sha(text),hash);results.push({kind:'pin',sha256:pin.pin,version:pin.version,answerBytes:Buffer.byteLength(text),answerSha256:sha(text),successfulBodyCalls:pin.calls(),catalogExactTargetDiscovered:true,hashMatch:true});
    const rpc=async(path:string,key:string,claim='different-keyholder')=>{const r=await fetch(base+path,{method:'POST',headers:{'x-pi-console-dots-read-key':key,'x-pi-console-readonly-key':key,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'read_final_answer'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read_final_answer',arguments:target,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:claim,version:'dummy'}}}})});return {status:r.status,body:await r.json()};};
    assert.equal((await rpc('/mcp/dots',dummyReadKey)).body.result.structuredContent.text,sampleAnswer);assert.equal((await rpc('/mcp/dots','a1'.repeat(32))).status,401);assert.equal((await rpc('/mcp/dots','00'.repeat(32))).status,401);assert(!JSON.stringify((await rpc('/mcp/readonly','a1'.repeat(32))).body).includes(sampleAnswer));
   }
   await page.getByRole('button',{name:'Review revoke final publication',exact:true}).click();await confirm();await expect(page.getByLabel('Final target')).toBeVisible();assert.equal((await permissions.snapshot()).finalPublication,null);
   if(pin)assert.equal((await pin.command('tools/call',{name:'read_final_answer',arguments:target})).isError,true);
   await page.screenshot({path:join(evidence,`revoked-${viewport.width}.png`),fullPage:true});
   // Commit, lose response, then inspect result without resending.
   await prepare();await page.route('**/api/workspace-permissions/final/save',async route=>{const r=await route.fetch({headers:{...route.request().headers(),origin:base,'sec-fetch-site':'same-origin'}});assert.equal(r.status(),200);await route.abort();},{times:1});await confirm();await expect(page.getByText('Save outcome unknown or rejected.',{exact:false})).toBeVisible();const afterLoss=(await permissions.snapshot()).revision;
   await page.getByRole('button',{name:'Read final publication state / save result',exact:true}).click();await expect(page.getByText('Save result checked: committed',{exact:true})).toBeVisible();assert.equal((await permissions.snapshot()).revision,afterLoss);
   // Pending original response while section navigation unmounts; commit is not cancellation.
   await prepare();let release!:()=>void,arrived!:()=>void;const arrivedPromise=new Promise<void>(r=>arrived=r),releasePromise=new Promise<void>(r=>release=r);
   await page.route('**/api/workspace-permissions/final/save',async route=>{const r=await route.fetch({headers:{...route.request().headers(),origin:base,'sec-fetch-site':'same-origin'}});assert.equal(r.status(),200);arrived();await releasePromise;await route.fulfill({response:r}).catch(()=>{});},{times:1});await confirm();await arrivedPromise;
   if(viewport.width<901)await page.getByRole('button',{name:'← Settings',exact:true}).click();else await page.getByRole('button',{name:'Language',exact:true}).click();release();await open();await expect(page.getByText('Save result checked: committed',{exact:true})).toBeVisible();
   // Restart/epoch change refuses the previous review and old key/config never restores a grant.
   await prepare();const record=await permissions.snapshot();comp.dispose();permissions=new WorkspacePermissions(permissions.file);comp=createFinalOwnerComposition(f.workspaces,permissions,f.paths,{...f.options,authentication:{mode:'shared_secret',key:'c3'.repeat(32)}});
   await confirm();await expect(page.getByText('Save outcome unknown or rejected.',{exact:false})).toBeVisible();assert.deepEqual(await permissions.snapshot(),record);
   await page.getByRole('button',{name:'Read final publication state / save result',exact:true}).click();await expect(page.getByLabel('Final target')).toBeVisible();assert.equal(await page.getByLabel('Final target').locator('option').count(),1);await expect(page.getByText('inactive',{exact:false}).first()).toBeVisible();
   if(pin){const denied=await fetch(base+'/mcp/dots',{method:'POST',headers:{'x-pi-console-dots-read-key':dummyReadKey},body:'{}'});assert.equal(denied.status,401);}
   assert.equal(f.mutations(),0);assert.equal(f.runtime.controlIsolationVerified(),false);await context.close();results.push({kind:'ui',viewport,reviewCancel:true,saveLossReadback:true,pendingNavigationReadback:true,restartReviewRejected:true,noSecretOrRawTextInUi:true,workerStarts:0});
  }catch(e){console.log(JSON.stringify({fixtureTrace:trace}));throw e;}finally{await browser?.close();await pin?.cleanup();comp.dispose();legacy.dispose();baseApi.dispose();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await vite.close();await f.cleanup();}
 }
 await writeFile(join(evidence,'proof.json'),JSON.stringify({schemaVersion:1,status:'isolated_ui_composition_pin_and_revoke_accepted',results,ownedFixturesClosed:true,tempRemoved:true,actualDotsConnected:false,productionApplied:false,osEgressAuditPerformed:false})+'\n',{flag:'wx'});
});
