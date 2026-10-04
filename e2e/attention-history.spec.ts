import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('observed active sessions appear across workspaces and open exact session',async({page})=>{
  await page.setViewportSize({width:390,height:780});
  const root=await mkdtemp(join(tmpdir(),'pi-console-attention-'));const a=join(root,'first'),b=join(root,'second');await mkdir(a);await mkdir(b);
  let reported:any[]=[];
  await page.route('**/api/activity',route=>route.fulfill({json:{sessions:reported}}));
  try{
    await page.goto('/');
    const w1=(await (await page.request.post('/api/workspaces',{data:{path:a}})).json()).workspace;
    const w2=(await (await page.request.post('/api/workspaces',{data:{path:b}})).json()).workspace;
    const s1=(await (await page.request.post('/api/sessions',{data:{workspaceId:w1.id}})).json()).session;
    const s2=(await (await page.request.post('/api/sessions',{data:{workspaceId:w2.id}})).json()).session;
    reported=[{sessionId:s1.id,workspaceId:w1.id,workspaceName:w1.name,sessionName:'Review needed',running:false,decisionCount:1,work:[],updatedAt:new Date().toISOString()},
      {sessionId:s2.id,workspaceId:w2.id,workspaceName:w2.name,sessionName:'Working task',running:true,decisionCount:0,work:[],updatedAt:new Date().toISOString()}];
    await page.reload();
    const inbox=page.getByRole('region',{name:'Activity notifications'});
    await expect(inbox).toContainText('1 need input');
    await expect(inbox.getByRole('button',{name:/Review needed/})).not.toBeVisible();
    await inbox.locator('summary').click();
    await expect(inbox.getByRole('button',{name:/Review needed/})).toBeVisible();
    await expect(inbox).toContainText('Working task');
    await inbox.locator('summary').click();
    await expect(inbox.getByRole('button',{name:/Review needed/})).not.toBeVisible();
    await page.getByRole('button',{name:'Active session alerts'}).click();
    await expect(inbox.getByRole('button',{name:/Review needed/})).toBeVisible();
    await page.screenshot({path:join(tmpdir(),'pi-console-active-sessions-mobile.png'),fullPage:true});
    await inbox.getByRole('button',{name:/Review needed/}).click();
    await expect(page.locator('.app-shell')).toHaveClass(/view-chat/);
    await expect(page.getByLabel('Chat output')).toBeVisible();
    await page.getByRole('button',{name:'← Workspaces'}).click();
    await expect(page.getByLabel('Find workspace')).toBeVisible();
    for(const [w,s] of [[w1,s1],[w2,s2]])await page.request.post('/api/close',{data:{workspaceId:w.id,sessionId:s.id}});
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});

test('tool-only reply shows observed command, copy below bubble, and instruction history jumps to source',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await page.setViewportSize({width:390,height:780});
  const root=await mkdtemp(join(tmpdir(),'pi-console-instructions-'));
  try{
    await page.goto('/');
    const w=(await (await page.request.post('/api/workspaces',{data:{path:root}})).json()).workspace;
    const s=(await (await page.request.post('/api/sessions',{data:{workspaceId:w.id}})).json()).session;
    await page.route('**/api/resume',async route=>{
      const response=await route.fetch();const body=await response.json();
      if(body.snapshot.session.id!==s.id)return route.fulfill({response});
      const node={id:'pi-tool:run:test',kind:'tool',label:'powershell',status:'running',parentId:'run',correlation:'derived-safe',sourceKind:'pi',updatedAt:new Date().toISOString(),action:'Write-Output CHECK_OK'};
      body.snapshot.chat=[...Array.from({length:95},(_,i)=>[{id:`u-${i}`,role:'user',text:`Instruction ${i} for checking`,complete:true},{id:`a-${i}`,role:'assistant',text:`Reply ${i}`,complete:true}]).flat(),{id:'u-live',role:'user',text:'Run the command',complete:true},{id:'a-live',role:'assistant',text:'',complete:false}];
      body.snapshot.activeRunId='run';body.snapshot.execution={nodes:[node],roots:['run'],unattached:[],rows:[{node,depth:1,unattached:false}],activeCount:1,failedCount:0,decisionCount:0};
      await route.fulfill({response,body:JSON.stringify(body)});
    });
    await page.reload();await page.locator('.workspace-card').filter({hasText:root}).click();await page.getByLabel('Session list').getByRole('button').first().click();
    const live=page.locator('.message[data-message-id="a-live"]');await expect(live.locator('.message-bubble')).toHaveAttribute('aria-busy','true');
    await expect(page.getByRole('status',{name:'Current conversation status'})).toHaveText('Running');
    await page.getByLabel('Conversation status details').click();
    await expect(page.locator('.conversation-status-body')).toContainText('powershell · Write-Output CHECK_OK');
    await page.getByLabel('Conversation status details').press('Escape');
    const prior=page.locator('.message[data-message-id="a-94"]');
    const bubble=(await prior.locator('.message-bubble').boundingBox())!;const copy=(await prior.getByRole('button',{name:'Copy all'}).boundingBox())!;
    expect(copy.y).toBeGreaterThanOrEqual(bubble.y+bubble.height);
    await prior.getByRole('button',{name:'Copy all'}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('Reply 94');
    await page.getByRole('button',{name:'Open prompt history'}).click();
    const history=page.getByRole('region',{name:'Prompt history'});await expect(history).not.toContainText('Instruction 0 for checking');
    await history.getByRole('button',{name:'Show earlier instructions'}).click();await expect(history).toContainText('Instruction 0 for checking');
    await page.screenshot({path:join(tmpdir(),'pi-console-history-list-mobile.png'),fullPage:true});
    await history.getByRole('button',{name:/Instruction 0 for checking/}).click();
    const target=page.locator('.message[data-message-id="u-0"]');await expect(target).toBeFocused();
    await expect.poll(()=>target.evaluate(el=>{const box=el.closest('.chat')!.getBoundingClientRect(),row=el.getBoundingClientRect();return row.top>=box.top&&row.top<box.bottom-20})).toBe(true);
    await expect(history).not.toBeVisible();
    await page.screenshot({path:join(tmpdir(),'pi-console-history-mobile.png'),fullPage:true});
    await page.request.post('/api/close',{data:{workspaceId:w.id,sessionId:s.id}});
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});
