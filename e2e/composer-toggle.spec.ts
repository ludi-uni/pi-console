import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('Send changes to Stop during a Pi run while Queue and Steer retain their delivery modes',async({page})=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-composer-toggle-'));
  let active=true,stops=0;const sent:{mode?:string;message:string}[]=[];
  try{
    await page.setViewportSize({width:390,height:780});await page.goto('/');
    await page.getByLabel('Workspace path').fill(root);await page.getByRole('button',{name:'Add & open'}).click();
    const created=page.waitForResponse(response=>response.url().includes('/api/sessions')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();
    expect((await created).ok()).toBeTruthy();
    const send=page.getByRole('button',{name:'Send',exact:true});
    await expect(send).toBeDisabled();await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
    await page.route('**/api/resume',async route=>{const response=await route.fetch(),body=await response.json();body.snapshot.activeRunId=active?'test-run':undefined;body.snapshot.runtime=active?'running':'ready';await route.fulfill({response,body:JSON.stringify(body)})});
    await page.route('**/api/state?*',async route=>{const response=await route.fetch(),body=await response.json();body.activeRunId=active?'test-run':undefined;body.runtime=active?'running':'ready';await route.fulfill({response,body:JSON.stringify(body)})});
    await page.route('**/api/prompt',route=>{sent.push(route.request().postDataJSON());void route.fulfill({json:{queued:true}})});
    await page.route('**/api/stop',route=>{stops++;active=false;void route.fulfill({json:{ok:true}})});
    await page.getByRole('button',{name:'← Sessions'}).click();await page.getByLabel('Session list').getByRole('button').first().click();
    await expect(send).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeEnabled();
    const prompt=page.getByRole('textbox',{name:'Prompt',exact:true});
    await prompt.fill('Continue after the run');
    await page.getByRole('button',{name:'Queue',exact:true}).click();
    await expect.poll(()=>sent.length).toBe(1);expect(sent[0]).toMatchObject({mode:'followUp',message:'Continue after the run'});
    await page.getByLabel('Message delivery').selectOption('steer');
    await prompt.fill('Change direction now');
    await page.getByRole('button',{name:'Steer',exact:true}).click();
    await expect.poll(()=>sent.length).toBe(2);expect(sent[1]).toMatchObject({mode:'steer',message:'Change direction now'});
    await page.screenshot({path:join(tmpdir(),'pi-console-composer-running-mobile.png')});
    for(const [width,height] of [[390,360],[320,400],[320,568],[320,780],[390,667],[390,780],[1280,780]]){
      await page.setViewportSize({width,height});
      const stop=page.getByRole('button',{name:'Stop',exact:true}),steer=page.getByRole('button',{name:'Steer',exact:true});
      await expect(stop).toBeVisible();await expect(steer).toBeVisible();
      const box=await stop.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
      if(height<=400||width===1280)await page.screenshot({path:join(tmpdir(),`pi-console-composer-running-${width}x${height}.png`)});
      if(width<900){const nav=await page.getByRole('navigation',{name:'Session views'}).boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(nav!.y);if(width===320&&height===568){await prompt.fill('Can still reach the composer');const field=await prompt.boundingBox();expect(field!.y+field!.height).toBeLessThanOrEqual(nav!.y);await expect(stop).toBeVisible();await page.screenshot({path:join(tmpdir(),'pi-console-composer-short-input.png')});await prompt.fill('')}}
    }
    await page.setViewportSize({width:320,height:568});
    await page.getByLabel('Choose files').setInputFiles(Array.from({length:4},(_,index)=>({name:`note-${index}.txt`,mimeType:'text/plain',buffer:Buffer.from(`Note ${index}`)})));
    await prompt.fill('More work with attachments');
    const field=await prompt.boundingBox(),actions=await page.locator('.composer-actions').boundingBox(),nav=await page.getByRole('navigation',{name:'Session views'}).boundingBox();
    expect(field!.y+field!.height).toBeLessThanOrEqual(actions!.y);expect(actions!.y+actions!.height).toBeLessThanOrEqual(nav!.y);
    await page.screenshot({path:join(tmpdir(),'pi-console-composer-short-attachments.png')});
    await page.setViewportSize({width:390,height:360});
    await prompt.fill('More work with attachments');
    await expect.poll(async()=>{const pet=await page.locator('.pet-widget').boundingBox(),dock=await page.locator('.composer-dock').boundingBox();return !!pet&&!!dock&&pet.y+pet.height<=dock.y+1}).toBe(true);
    const keyboardField=await prompt.boundingBox(),keyboardActions=await page.locator('.composer-actions').boundingBox(),keyboardNav=await page.getByRole('navigation',{name:'Session views'}).boundingBox();
    await page.screenshot({path:join(tmpdir(),'pi-console-composer-keyboard-sized-attachments.png')});
    expect(keyboardField!.y+keyboardField!.height).toBeLessThanOrEqual(keyboardActions!.y);
    expect(keyboardActions!.y+keyboardActions!.height).toBeLessThanOrEqual(keyboardNav!.y);
    await page.getByRole('button',{name:'Stop',exact:true}).click();await expect.poll(()=>stops).toBe(1);
    await page.setViewportSize({width:390,height:780});
    await page.getByRole('button',{name:'← Sessions'}).click();await page.getByLabel('Session list').getByRole('button').first().click();
    await expect(send).toBeVisible();await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
    for(const [width,height] of [[320,568],[390,667],[1280,780]]){
      await page.setViewportSize({width,height});
      const action=await send.boundingBox();expect(action!.x).toBeGreaterThanOrEqual(0);expect(action!.x+action!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
      if(width<900){const nav=await page.getByRole('navigation',{name:'Session views'}).boundingBox();expect(action!.y+action!.height).toBeLessThanOrEqual(nav!.y)}
    }
  }finally{
    try{const ws=(await(await page.request.get('/api/workspaces')).json()).workspaces.find((w:{path:string})=>w.path===root);
      if(ws){for(const item of (await(await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions)await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:item.id}});
        await page.request.post('/api/workspaces/remove',{data:{id:ws.id}})}}catch{/* Preserve the original test failure. */}
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
  }
});
