import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('short landscape keeps the conversation visible while the composer remains usable',async({page})=>{
  const cwd=await mkdtemp(join(tmpdir(),'pi-console-landscape-'));
  try{
    await page.setViewportSize({width:844,height:390});
    await page.goto('/');
    const ws=(await (await page.request.post('/api/workspaces',{data:{path:cwd}})).json()).workspace;
    const creation=await page.request.post('/api/sessions',{data:{workspaceId:ws.id}});
    expect(creation.ok(),await creation.text()).toBeTruthy();
    const sid=(await creation.json()).session.id;
    await page.reload();
    await page.locator('.workspace-card').filter({hasText:cwd}).click();
    await page.getByLabel('Session list').locator('.session-row > button:first-child').first().click();
    await expect(page.getByText('Sending calls the selected Pi model · charges may apply.')).toBeVisible();
    await page.screenshot({path:join(tmpdir(),'pi-console-landscape-cost-verified.png')});
    await page.route('**/api/resume',async route=>{
      const response=await route.fetch(),body=await response.json();
      body.snapshot.chat=[{id:'landscape-answer',role:'assistant',text:'LANDSCAPE_HISTORY_VISIBLE',complete:true}];
      await route.fulfill({response,body:JSON.stringify(body)});
    });
    await page.reload();
    const chat=page.getByLabel('Chat output');
    await expect(chat.getByText('LANDSCAPE_HISTORY_VISIBLE')).toBeVisible();
    const box=await chat.boundingBox();
    expect(box?.height).toBeGreaterThan(40);
    const prompt=page.getByRole('textbox',{name:'Prompt',exact:true}),send=page.getByRole('button',{name:'Send',exact:true});
    await expect(prompt).toBeVisible();await expect(send).toBeVisible();
    const controls=page.getByRole('button',{name:'Model / Thinking'});
    await controls.click();
    await expect(page.getByLabel('Model',{exact:true})).toBeEnabled({timeout:15000});
    await expect(page.getByLabel('Model',{exact:true})).toBeFocused();
    await expect(page.getByLabel('Thinking',{exact:true})).toBeVisible();
    await page.screenshot({path:join(tmpdir(),'pi-console-landscape-controls-verified.png')});
    await page.getByLabel('Thinking',{exact:true}).selectOption('high');
    await expect(page.getByLabel('Thinking',{exact:true})).toHaveValue('high');
    await page.getByLabel('Thinking',{exact:true}).press('Escape');
    await expect(controls).toHaveAttribute('aria-expanded','false');
    await expect(controls).toBeFocused();
    const chooser=page.waitForEvent('filechooser');
    await page.getByRole('button',{name:'Attach files'}).click();
    await (await chooser).setFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('landscape attachment')});
    await expect(page.getByLabel('Attached files')).toContainText('note.txt');
    expect(await prompt.evaluate(el=>{const box=el.getBoundingClientRect();return document.elementFromPoint(box.left+box.width/2,box.top+Math.min(22,box.height/2))===el})).toBe(true);
    const sendBox=(await send.boundingBox())!,navBox=(await page.getByRole('navigation',{name:'Session views'}).boundingBox())!;
    expect(sendBox.y+sendBox.height).toBeLessThanOrEqual(navBox.y);
    await page.screenshot({path:join(tmpdir(),'pi-console-landscape-chat-verified.png')});
    await page.request.post('/api/close',{data:{workspaceId:ws.id,sessionId:sid}});
  }finally{await rm(cwd,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{})}
});
