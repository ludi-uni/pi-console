import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('assistant Markdown renders and workspace paths preview only text/Markdown inside the selected workspace', async ({page}) => {
  const root=await mkdtemp(join(tmpdir(),'pi-console-markdown-'));
  const workspace=join(root,'workspace');await mkdir(workspace);await mkdir(join(workspace,'docs'));
  await writeFile(join(workspace,'docs','notes.md'),'# Notes\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Text file](note.txt)');
  await writeFile(join(workspace,'note.txt'),'Plain <script>text</script>');
  await writeFile(join(root,'secret.md'),'secret outside');
  try {
    await page.setViewportSize({width:390,height:844});await page.goto('/');
    await page.getByLabel('Workspace path').fill(workspace);
    await page.getByRole('button',{name:'Add & open'}).click();
    const ws=(await (await page.request.get('/api/workspaces')).json()).workspaces.find((w:{path:string})=>w.path===workspace);
    const rejected=await page.request.get(`/api/workspace/text?workspaceId=${ws.id}&path=${encodeURIComponent('../secret.md')}`);
    expect(rejected.status()).toBe(400);
    const message={id:'markdown-answer',role:'assistant',complete:true,text:'# Result\n\n**Finished**. See docs/notes.md and `note.txt`.\n\n- [x] checked\n\n```ts\nconst x = 1;\n```\n\n[unsafe](javascript:alert(1))'};
    await page.route('**/api/resume',async route=>{
      const response=await route.fetch(),body=await response.json();body.snapshot.chat=[message];body.snapshot.seq=1000000;
      await route.fulfill({response,body:JSON.stringify(body)});
    });
    await page.route('**/api/state?*',async route=>{
      const response=await route.fetch(),body=await response.json();body.chat=[message];body.seq=1000000;
      await route.fulfill({response,body:JSON.stringify(body)});
    });
    await page.getByRole('button',{name:'New Session'}).click();
    const answer=page.locator('[data-message-id="markdown-answer"]');
    await expect(answer.getByRole('heading',{name:'Result'})).toBeVisible();
    await expect(answer.locator('.markdown-content strong')).toHaveText('Finished');
    await expect(answer.getByRole('button',{name:'Copy code'})).toBeVisible();
    await answer.getByRole('button',{name:'docs/notes.md'}).click();
    const dialog=page.getByRole('dialog',{name:'Workspace file preview'});
    await expect(dialog.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
    await expect(dialog.locator('table')).toBeVisible();
    await dialog.getByRole('button',{name:'Text file'}).click();
    await expect(dialog).toContainText('Plain <script>text</script>');
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-file-back.png')});
    await dialog.getByRole('button',{name:'Back to previous file'}).click();
    await expect(dialog.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-markdown-preview.png')});
    await dialog.getByRole('button',{name:'Close file preview'}).click();
    await answer.getByRole('button',{name:'note.txt'}).click();
    await expect(dialog).toContainText('Plain <script>text</script>');
    await expect(dialog.locator('script')).toHaveCount(0);
  } finally { await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{}); }
});
