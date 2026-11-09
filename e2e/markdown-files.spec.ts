import { test, expect } from '@playwright/test';
import { openWorkspaceAdd } from './workspace-setup.ts';
test.use({serviceWorkers:'block'});
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('assistant Markdown links open safe workspace text and code at referenced lines', async ({page}) => {
  const root=await mkdtemp(join(tmpdir(),'pi-console-markdown-'));
  const workspace=join(root,'workspace');await mkdir(workspace);await mkdir(join(workspace,'docs'));await mkdir(join(workspace,'src'));await mkdir(join(workspace,'media'));
  const notes='# Notes\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Text file](note.txt) and [relative](sub/deep.md#deep-section)\n\nJump to [the end](#notes-end).\n\n'+'Padding paragraph for scroll depth.\n\n'.repeat(80)+'## Notes End\n\nReached via same-file fragment.';
  await writeFile(join(workspace,'docs','notes.md'),notes);
  const source=Array.from({length:55},(_,i)=>i===41?'export const value = 42;':`// line ${i+1}`).join('\n')+'\n';
  await writeFile(join(workspace,'src','main.ts'),source);
  await writeFile(join(workspace,'note.txt'),'Plain <script>text</script>');
  // A different file at the preview-relative path proves relative resolution.
  await writeFile(join(workspace,'docs','note.txt'),'Docs sibling <b>note</b>');
  await mkdir(join(workspace,'docs','sub'));
  await writeFile(join(workspace,'docs','sub','deep.md'),'# Deep\n\n'+'Padding paragraph for scroll depth.\n\n'.repeat(80)+'## Deep Section\n\nReached via fragment.');
  await writeFile(join(workspace,'docs','sub','sibling.txt'),'sibling content');
  const image=await readFile(join('tests','fixtures','preview.png'));
  await writeFile(join(workspace,'media','portrait.png'),image);
  const video=await readFile(join('tests','fixtures','preview.mp4'));
  await writeFile(join(workspace,'media','clip.mp4'),video);
  await writeFile(join(workspace,'report.html'),'<!doctype html><title>Workspace report</title><h1>Workspace report</h1><p id="marker">pending</p><script>document.getElementById("marker").textContent="ran";</script>');
  await writeFile(join(root,'secret.md'),'secret outside');
  await writeFile(join(root,'secret.html'),'secret outside');
  try {
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await page.setViewportSize({width:390,height:844});await page.goto('/');
    await openWorkspaceAdd(page);await page.getByLabel('Workspace path').fill(workspace);
    await page.getByRole('button',{name:'Add & open'}).click();
    const ws=(await (await page.request.get('/api/workspaces')).json()).workspaces.find((w:{path:string})=>w.path===workspace);
    const rejected=await page.request.get(`/api/workspace/text?workspaceId=${ws.id}&path=${encodeURIComponent('../secret.md')}`);
    expect(rejected.status()).toBe(400);
    const outsideMedia=await page.request.get(`/api/workspace/media?workspaceId=${ws.id}&path=${encodeURIComponent('../secret.md')}`);
    expect(outsideMedia.status()).toBe(400);
    const outsideHtml=await page.request.get(`/api/workspace/html?workspaceId=${ws.id}&path=${encodeURIComponent('../secret.html')}`);
    expect(outsideHtml.status()).toBe(400);
    const notHtml=await page.request.get(`/api/workspace/html?workspaceId=${ws.id}&path=${encodeURIComponent('note.txt')}`);
    expect(notHtml.status()).toBe(400);
    const htmlResponse=await page.request.get(`/api/workspace/html?workspaceId=${ws.id}&path=report.html`);
    expect(htmlResponse.headers()['content-type']).toBe('text/html; charset=utf-8');
    expect(htmlResponse.headers()['content-security-policy']).toContain("frame-src 'none'");
    const imageResponse=await page.request.get(`/api/workspace/media?workspaceId=${ws.id}&path=media%2Fportrait.png`);
    expect(imageResponse.headers()['content-type']).toBe('image/png');expect(await imageResponse.body()).toEqual(image);
    const seek=await page.request.get(`/api/workspace/media?workspaceId=${ws.id}&path=media%2Fclip.mp4`,{headers:{Range:'bytes=4-7'}});
    expect(seek.status()).toBe(206);expect(seek.headers()['content-range']).toBe(`bytes 4-7/${video.length}`);expect((await seek.body()).toString()).toBe('ftyp');
    const invalidRange=await page.request.get(`/api/workspace/media?workspaceId=${ws.id}&path=media%2Fclip.mp4`,{headers:{Range:`bytes=${video.length}-`}});
    expect(invalidRange.status()).toBe(416);
    const padding='Padding paragraph for scroll depth.\n\n'.repeat(80);
    const message={id:'markdown-answer',role:'assistant',complete:true,text:'# Result\n\n**Finished**. See docs/notes.md, src/main.ts:42, [source](src/main.ts#L42) and `note.txt`.\n\n- [x] checked\n\n```ts\nconst x = 1;\n```\n\n![Portrait](media/portrait.png) and media/clip.mp4. [External image](https://example.com/image.png) must not load automatically.\n\n[unsafe](javascript:alert(1)) and [Report](report.html). [Section](docs/notes.md#deep-dive) and [broken](media/clip.mp4:2) and [`src/main.ts`](docs/notes.md)'};
    // A same-slug heading in another message proves the chat `#fragment` jump
    // is scoped to its own message root, never a document-wide first match.
    const fragmentTarget={id:'fragment-target',role:'assistant',complete:true,text:'## 123 詳細\n\nDecoy heading in another message.'};
    const fragmentLink={id:'fragment-link',role:'assistant',complete:true,text:'Open [the details](#123-詳細) below. [No file context](#L12)\n\n'+padding+'## 123 詳細\n\nTarget reached inside this message.'};
    const chat=[message,fragmentTarget,fragmentLink];
    await page.route('**/api/resume',async route=>{
      const response=await route.fetch(),body=await response.json();body.snapshot.chat=chat;body.snapshot.seq=1000000;
      await route.fulfill({response,body:JSON.stringify(body)});
    });
    await page.route('**/api/state?*',async route=>{
      const response=await route.fetch(),body=await response.json();body.chat=chat;body.seq=1000000;
      await route.fulfill({response,body:JSON.stringify(body)});
    });
    const created=page.waitForResponse(r=>r.url().endsWith('/api/sessions')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'New Session'}).click();
    const response=await created;expect(response.ok(),await response.text()).toBeTruthy();
    const answer=page.locator('[data-message-id="markdown-answer"]');
    await expect(answer.getByRole('heading',{name:'Result'})).toBeVisible();
    await expect(answer.locator('.markdown-content strong')).toHaveText('Finished');
    await expect(answer.getByRole('button',{name:'Copy code'})).toBeVisible();
    await answer.getByRole('button',{name:'docs/notes.md'}).click();
    const dialog=page.getByRole('dialog',{name:'Workspace file preview'});
    await expect(dialog.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
    await expect(dialog.locator('table')).toBeVisible();
    await dialog.getByRole('button',{name:'Copy file contents'}).click();
    await expect(dialog.getByRole('status')).toHaveText('Copied');
    expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n')).toBe(notes);
    await dialog.getByRole('button',{name:'Text file'}).click();
    // The link is relative to docs/notes.md, so the docs sibling is shown —
    // not the workspace-root note.txt.
    await expect(dialog).toContainText('Docs sibling <b>note</b>');
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-file-back.png')});
    await dialog.getByRole('button',{name:'Back to previous file'}).click();
    await expect(dialog.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-markdown-preview.png')});
    await dialog.getByRole('button',{name:'Close file preview'}).click();
    await answer.getByRole('button',{name:'note.txt'}).click();
    await expect(dialog).toContainText('Plain <script>text</script>');
    await expect(dialog.locator('script')).toHaveCount(0);
    await dialog.getByRole('button',{name:'Close file preview'}).click();
    await answer.getByRole('button',{name:'src/main.ts:42'}).click();
    await expect(dialog).toContainText('WORKSPACE FILE · Code');
    await expect(dialog.locator('.source-line-target')).toHaveAttribute('data-line','42');
    await expect(dialog.locator('.source-line-target')).toContainText('export const value = 42;');
    await expect.poll(()=>dialog.locator('.file-preview-body').evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-code-line-preview.png')});
    await dialog.getByRole('button',{name:'Copy file contents'}).click();
    expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n')).toBe(source);
    await dialog.getByRole('button',{name:'Close file preview'}).click();
    await answer.getByRole('button',{name:'Preview image: Portrait'}).click();
    await expect(dialog.locator('img.file-preview-media')).toBeVisible();
    await expect(dialog.locator('img.file-preview-media')).toHaveJSProperty('naturalWidth',96);
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-image-preview.png')});
    await expect(dialog.getByRole('button',{name:'Copy file contents'})).toBeDisabled();
    await dialog.getByRole('button',{name:'Close file preview'}).click();
    await answer.getByRole('button',{name:'media/clip.mp4'}).click();
    await expect(dialog.locator('video.file-preview-media')).toBeVisible();
    await expect(dialog.locator('video.file-preview-media')).toHaveAttribute('controls','');
    await expect.poll(()=>dialog.locator('video.file-preview-media').evaluate((node:HTMLVideoElement)=>node.videoWidth)).toBe(16);
    if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-video-preview.png')});
    await dialog.getByRole('button',{name:'Close file preview'}).click();
    await answer.getByRole('button',{name:'source'}).click();
    await expect(dialog.locator('.source-line-target')).toHaveAttribute('data-line','42');
    await dialog.getByRole('button',{name:'Close file preview'}).click();
    // Relative links inside a previewed markdown resolve against its own dir,
    // and a cross-file `#section` actually scrolls the preview body — the
    // target heading sits below a long padding block, not in the viewport.
    await answer.getByRole('button',{name:'docs/notes.md'}).click();
    await dialog.getByRole('button',{name:'relative'}).click();
    await expect(dialog.getByRole('heading',{name:'Deep',exact:true})).toBeVisible();
    await expect(dialog.locator('#deep-section')).toHaveText('Deep Section');
    const deepTarget=dialog.locator('#deep-section'),previewBody=dialog.locator('.file-preview-body');
    await expect.poll(async()=>{const box=await deepTarget.boundingBox(),body=await previewBody.boundingBox();return box&&body&&box.y>=body.y&&box.y<=body.y+body.height}).toBe(true);
    expect(await previewBody.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
    await dialog.getByRole('button',{name:'Close file preview'}).click();
    // A same-file `#section` link scrolls the open preview to the heading.
    await answer.getByRole('button',{name:'docs/notes.md'}).click();
    const notesEnd=dialog.locator('#notes-end');
    await expect.poll(async()=>{const box=await notesEnd.boundingBox(),body=await previewBody.boundingBox();return box&&body&&box.y>=body.y&&box.y<=body.y+body.height}).toBe(false);
    await dialog.getByRole('button',{name:'the end'}).click();
    await expect.poll(async()=>{const box=await notesEnd.boundingBox(),body=await previewBody.boundingBox();return box&&body&&box.y>=body.y&&box.y<=body.y+body.height}).toBe(true);
    await dialog.getByRole('button',{name:'Close file preview'}).click();
    // A `#section` link scrolls within the preview instead of opening a 404,
    // and a media path with a line suffix never becomes an empty-href tab.
    await answer.getByRole('button',{name:'Section'}).click();
    await expect(dialog.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.querySelectorAll('.markdown-content a[href=""]').length)).toBe(0);
    await dialog.getByRole('button',{name:'Close file preview'}).click();
    // Link label code stays non-interactive: exactly one button, no nesting.
    const linkedCode=answer.getByRole('button',{name:'src/main.ts',exact:true});
    await expect(linkedCode).toHaveCount(1);
    expect(await linkedCode.evaluate(el=>el.querySelectorAll('button').length)).toBe(0);
    const [popup]=await Promise.all([page.waitForEvent('popup'),answer.getByRole('button',{name:'Report'}).click()]);
    await popup.waitForLoadState();
    await expect(popup.getByRole('heading',{name:'HTML プレビュー（明示的同意）'})).toBeVisible();
    await expect(popup.locator('.preview-frame')).toHaveCount(0);
    await popup.locator('.preview-consent input').nth(1).check();
    await popup.locator('.preview-confirm input').check();
    await popup.getByRole('button',{name:'確認した内容で実行する',exact:true}).click();
    const report=popup.frameLocator('.preview-frame');
    await expect(report.getByRole('heading',{name:'Workspace report'})).toBeVisible();
    await expect(report.locator('#marker')).toHaveText('ran');
    expect(await popup.evaluate(()=>window.opener)).toBeNull();
    expect(await report.locator('body').evaluate(async()=>{try{await fetch('/api/workspaces');return 'allowed'}catch{return 'blocked'}})).toBe('blocked');
    await popup.close();
    await expect(page.getByRole('dialog',{name:'Workspace file preview'})).toHaveCount(0);
    // A chat `#fragment` link scrolls inside its own message only: the link
    // message and an earlier message both carry a `## Details` heading, and
    // the jump must land on the link message's own duplicate heading — never
    // the other message's, never a _blank navigation.
    const linkMessage=page.locator('[data-message-id="fragment-link"]'),otherMessage=page.locator('[data-message-id="fragment-target"]');
    // Both messages render a `## Details` heading with id="details"; the
    // decoy precedes the link message in DOM order, so a document-wide lookup
    // would scroll the wrong message. The jump stays inside its own root.
    const ownHeading=linkMessage.locator('[id="123-詳細"]'),decoyHeading=otherMessage.locator('[id="123-詳細"]');
    await expect(linkMessage.getByRole('button',{name:'No file context'})).toHaveCount(0);
    await expect(ownHeading).toHaveCount(1);
    await expect(decoyHeading).toHaveCount(1);
    const link=linkMessage.getByRole('button',{name:'the details'});
    await expect(link).toHaveCount(1);
    const pagesBefore=page.context().pages().length;
    // The own heading starts far below the chat viewport (padding block).
    const chatScroll=page.locator('.chat'),chatTop=await chatScroll.evaluate(el=>el.getBoundingClientRect().top);
    const before=await ownHeading.boundingBox();
    expect(before!.y-chatTop).toBeGreaterThan(844);
    await link.click();
    expect(page.context().pages().length).toBe(pagesBefore);
    // Own message's heading landed inside the chat viewport (the chat pads
    // scroll room below, so 'start' is honored only up to the scrollable end).
    const chatHeight=await chatScroll.evaluate(el=>el.clientHeight);
    await expect.poll(async()=>{const box=await ownHeading.boundingBox();return box&&box.y-chatTop>=0&&box.y-chatTop<chatHeight}).toBe(true);
    // The decoy's identical slug was never the scroll target.
    expect((await decoyHeading.boundingBox())!.y).toBeLessThan(chatTop);
  } finally { await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{}); }
});
