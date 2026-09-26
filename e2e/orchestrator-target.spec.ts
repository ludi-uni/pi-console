import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('selected kit target sends exact request without a Pi prompt and shows run status',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-orch-target-'));
  let job: {running:boolean;request:string;runId?:string}|undefined;
  let piPrompts=0;
  await page.route('**/api/orchestrator?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({available:true,...(job?{job}:{})})}));
  await page.route('**/api/prompt',route=>{piPrompts++;void route.abort()});
  await page.route('**/api/orchestrator/start',route=>{const b=route.request().postDataJSON();expect(b.request).toBe('Build a small plan');expect(b.workspaceId).toBeTruthy();expect(b.sessionId).toBeTruthy();job={running:true,request:b.request};void route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({job})})});
  try {
    await page.setViewportSize({width:390,height:780});await page.goto('/');
    await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    const created=page.waitForResponse(r=>r.url().includes('/api/sessions')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();
    const response=await created;expect(response.ok(),await response.text()).toBeTruthy();
    await expect(page.getByLabel('Send with')).toBeVisible();
    await page.getByLabel('Send with').selectOption('kit');
    await page.getByLabel('Prompt',{exact:true}).fill('Build a small plan');
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.getByLabel('Execution Timeline')).toBeVisible();
    const card=page.getByRole('status',{name:'Orchestrator run status'});
    await expect(card).toContainText('Waiting for the first task update');
    await expect(card).toHaveCount(1);
    expect(piPrompts).toBe(0);
    const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:any)=>w.path===root);
    for(const s of (await(await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions)await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:s.id}});
  } finally {await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});

test('long kit request stays collapsed while verified current tasks remain readable',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-orch-long-'));
  const request='# Strategy Lab — Orchestrator brief\n'+'Many detailed requirements and context. '.repeat(320);
  let job:{running:boolean;request:string;runId?:string;startedAt?:string}|undefined;
  const rootNode={id:'orchestrator:current',kind:'orchestrator',label:'Orchestrator current',status:'running',sourceKind:'orchestrator',nativeId:'current',correlation:'unknown',updatedAt:new Date().toISOString()};
  const old={...rootNode,id:'orchestrator:old',nativeId:'old',status:'completed'};
  const nodes=[old,{...rootNode,id:'old task',kind:'task',parentId:old.id,label:'Unrelated previous work',status:'completed'},rootNode,
    {...rootNode,id:'task-1',kind:'task',parentId:rootNode.id,label:'Analyze preferences and current UX',status:'running'},
    {...rootNode,id:'task-2',kind:'task',parentId:rootNode.id,label:'Inspect requested behavior',status:'completed'},
    {...rootNode,id:'agent-1',kind:'agent',parentId:'task-1',label:'scout',status:'running'}];
  await page.route('**/api/orchestrator?*',route=>route.fulfill({json:{available:true,...(job?{job}:{})}}));
  await page.route('**/api/orchestrator/start',route=>{expect(route.request().postDataJSON().request).toBe(request);job={running:true,request,runId:'current',startedAt:new Date().toISOString()};void route.fulfill({status:202,json:{job}})});
  await page.route('**/api/resume',route=>{const body=route.request().postDataJSON();void route.fulfill({json:{snapshot:{session:{id:body.sessionId,workspaceId:body.workspaceId,filePath:'test.jsonl'},runtime:'running',chat:[],events:[],execution:{nodes,rows:nodes.map(n=>({node:n,depth:n.parentId?1:0,unattached:false})),roots:[old.id,rootNode.id],unattached:[],activeCount:3,failedCount:0,decisionCount:0},seq:0}}})});
  try{
    await page.setViewportSize({width:1280,height:800});await page.goto('/');
    await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Open Workspace'}).click();
    const created=page.waitForResponse(r=>r.url().includes('/api/sessions')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();
    const response=await created;expect(response.ok(),await response.text()).toBeTruthy();
    await expect(page.getByLabel('Send with')).toBeVisible();
    await page.getByLabel('Send with').selectOption('kit');
    await page.getByLabel('Prompt',{exact:true}).fill(request);
    await page.getByRole('button',{name:'Send',exact:true}).click();
    const card=page.getByRole('status',{name:'Orchestrator run status'});
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('1/2 tasks done · 1 running · 1 agent running');
    await expect(card).toContainText('Analyze preferences and current UX');
    await expect(card).not.toContainText('Unrelated previous work');
    await expect(page.locator('.timeline .execution-node').first()).toContainText('Orchestrator current');
    await expect(page.locator('.timeline .execution-node').nth(1)).toContainText('Analyze preferences and current UX');
    await expect(card.getByText(request,{exact:true})).not.toBeVisible();
    await expect(page.getByLabel('Chat output')).not.toContainText('Many detailed requirements');
    expect((await card.boundingBox())!.height).toBeLessThanOrEqual(322);
    await page.screenshot({path:join(tmpdir(),'pi-console-kit-summary-desktop.png'),fullPage:true});
    await card.getByText('Full request').click();
    await expect(card.getByText(request,{exact:true})).toBeVisible();
    await page.setViewportSize({width:390,height:780});
    await expect(card).toBeVisible();
    await page.screenshot({path:join(tmpdir(),'pi-console-kit-summary-mobile.png'),fullPage:true});
    const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:any)=>w.path===root);
    for(const s of (await(await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions)await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:s.id}});
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});
