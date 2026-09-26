import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('mobile Execution inspects an async child after parent has settled', async ({page}) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-inspect-'));
  const id = 'pi-subagent-async:["run-123"]';
  const node = {id,kind:'agent',label:'reviewer',status:'completed',sourceKind:'pi-subagents',nativeId:'run-123',correlation:'explicit',updatedAt:new Date().toISOString()};
  await page.route('**/api/resume', route => {
    const body=route.request().postDataJSON();
    void route.fulfill({json:{snapshot:{session:{id:body.sessionId,workspaceId:body.workspaceId,filePath:'test.jsonl'},runtime:'running',chat:[],events:[],execution:{nodes:[node],rows:[{node,depth:0,unattached:false}],roots:[id],unattached:[],activeCount:0,failedCount:0,decisionCount:0},seq:0}}});
  });
  await page.route('**/api/subagents/inspect', route => {
    expect(route.request().postDataJSON().nodeId).toBe(id);
    void route.fulfill({json:{kind:'pi-subagents.inspect-reply',version:1,status:'complete',finalOutput:'CHILD_RESULT_OK'}});
  });
  try {
    await page.setViewportSize({width:390,height:780});await page.goto('/');
    await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    await page.getByRole('button',{name:'New Session'}).click();
    await page.getByRole('button',{name:/Execution ·/}).click();
    await expect(page.getByLabel('Execution Timeline')).toContainText('reviewer');
    await page.getByRole('button',{name:'Inspect background result'}).click();
    await expect(page.getByText('CHILD_RESULT_OK')).toBeVisible();
    const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:any)=>w.path===root);
    for(const s of (await(await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions)await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:s.id}});
  } finally {await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});
