import {test,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm,mkdir,readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

// Real disk + isolated Console test server, no Pi/LLM process or external API.
// The only executed JS is this test's fixed fixture inside the opaque frame.
test.use({serviceWorkers:'block'});
test('real HTML and local assets require fresh consent and stop on revoke',async({page})=>{
 const root=await mkdtemp(join(tmpdir(),'pi-console-consent-live-'));let workspaceId:string|undefined;
 try{
  await writeFile(join(root,'page.html'),'<!doctype html><link rel="stylesheet" href="site.css"><h1>Local report</h1><p id="marker">pending</p><script>globalThis.inlineRan=true</script><script src="app.js"></script>');
  await writeFile(join(root,'app.js'),'document.getElementById("marker").textContent=globalThis.inlineRan?"動作しました":"inline missing";');
  await writeFile(join(root,'site.css'),'body{background:rgb(3,4,5)}');
  const registered=await page.request.post('/api/workspaces',{data:{path:root}});expect(registered.ok()).toBeTruthy();workspaceId=(await registered.json()).workspace.id;
  await page.goto(`/api/workspace/html?workspaceId=${workspaceId}&path=page.html`);
  await expect(page.locator('.preview-files')).toContainText('app.js');await expect(page.locator('.preview-frame')).toHaveCount(0);
  const enable=async()=>{await page.locator('.preview-confirm input').check();await page.getByRole('button',{name:'確認した内容で実行する',exact:true}).click();};
  await enable();
  let frame=page.frameLocator('.preview-frame');await expect(frame.locator('#marker')).toHaveText('pending');
  expect(await frame.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgb(3, 4, 5)');
  await page.getByRole('button',{name:'取り消して停止'}).first().click();await expect(page.locator('.preview-frame')).toHaveCount(0);
  await page.getByRole('button',{name:'ファイル一覧を確認し直す'}).click();await expect(page.locator('.preview-confirm input')).not.toBeChecked();
  await page.locator('.preview-consent input').nth(0).check();await enable();
  frame=page.frameLocator('.preview-frame');await expect(frame.locator('#marker')).toHaveText('pending');
  await expect.poll(()=>frame.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(3, 4, 5)');
  await page.getByRole('button',{name:'取り消して停止'}).first().click();await page.getByRole('button',{name:'ファイル一覧を確認し直す'}).click();
  await page.locator('.preview-consent input').nth(0).check();await page.locator('.preview-consent input').nth(1).check();await enable();
  await expect(page.frameLocator('.preview-frame').locator('#marker')).toHaveText('動作しました');
  await page.getByRole('button',{name:'取り消して停止'}).first().click();await expect(page.locator('.preview-frame')).toHaveCount(0);
 }finally{
  if(workspaceId)await page.request.post('/api/workspaces/remove',{data:{id:workspaceId}}).catch(()=>{});
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});

test('real binary snapshots load images and fonts through nested CSS without network asset routes',async({page})=>{
 const root=await mkdtemp(join(tmpdir(),'pi-console-assets-live-'));let workspaceId:string|undefined;
 try{
  const fontDir=resolve('node_modules/playwright-core/lib/vite/traceViewer');
  const fontName=(await readdir(fontDir)).find(name=>/^codicon.*\.ttf$/i.test(name));
  if(!fontName)throw new Error('codicon dev fixture missing');
  const wav=Buffer.alloc(3244);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);
  wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(3200,40);
  const binaries:{[name:string]:Buffer}={
   'image.png':await readFile(resolve('tests/fixtures/preview.png')),
   'sound.wav':wav,'clip.mp4':await readFile(resolve('tests/fixtures/preview.mp4')),
   'asset.ttf':await readFile(join(fontDir,fontName)),
  };
  await mkdir(join(root,'styles/nested'),{recursive:true});
  for(const [name,bytes]of Object.entries(binaries))await writeFile(join(root,name),bytes);
  await writeFile(join(root,'page.html'),'<!doctype html><link rel="stylesheet" href="site.css"><p id="font">&#xea60;</p><img id="img" src="image.png"><audio id="sound" src="sound.wav" autoplay controls></audio><video id="clip" src="clip.mp4" autoplay controls></video>');
  await writeFile(join(root,'site.css'),'@import "styles/nested/theme.css";');
  await writeFile(join(root,'styles/nested/theme.css'),'@font-face{font-family:LiveAsset;src:url("../../asset.ttf")}#font{font-family:LiveAsset;background-image:url("../../image.png")}');
  const registered=await page.request.post('/api/workspaces',{data:{path:root}});expect(registered.ok()).toBeTruthy();workspaceId=(await registered.json()).workspace.id;
  const assetGets:string[]=[];
  page.on('request',request=>{if(request.method()==='GET'&&/\.(png|wav|mp4|ttf)(?:[?#]|$)/.test(request.url()))assetGets.push(request.url());});
  await page.goto(`/api/workspace/html?workspaceId=${workspaceId}&path=page.html`);
  await expect(page.locator('.preview-files')).toContainText('asset.ttf');
  for(const index of [0,2,3,4])await page.locator('.preview-consent input').nth(index).check();
  await page.locator('.preview-confirm input').check();
  const response=page.waitForResponse(res=>res.url().endsWith('/api/workspace/preview/enable'));
  await page.getByRole('button',{name:'確認した内容で実行する',exact:true}).click();
  const grant=await(await response).json();
  expect([grant.allowScripts,grant.allowStyles,grant.allowImages,grant.allowMedia,grant.allowFonts]).toEqual([false,true,true,true,true]);
  for(const [name,bytes]of Object.entries(binaries)){
   const resource=grant.resources.find((r:{path:string})=>r.path===name);
   expect(resource.encoding).toBe('base64');expect(resource.bytes).toBe(bytes.length);
   expect(resource.content).toBe(bytes.toString('base64'));
  }
  const frame=page.frameLocator('.preview-frame');
  await expect.poll(()=>frame.locator('#img').evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBe(96);
  await expect.poll(()=>frame.locator('#font').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('data:image/png;base64,');
  await page.locator('.preview-frame').scrollIntoViewIfNeeded();
  await expect.poll(()=>frame.locator('body').evaluate(el=>{el.getBoundingClientRect();return Array.from(document.fonts).map(face=>`${face.family}:${face.status}`).join(',');})).toContain('LiveAsset:loaded');
  for(const [id,mime]of [['sound','audio/wav'],['clip','video/mp4']]){
   await expect(frame.locator(`#${id}`)).toHaveAttribute('src',`data:${mime};base64,${binaries[id==='sound'?'sound.wav':'clip.mp4'].toString('base64')}`);
   await expect(frame.locator(`#${id}`)).not.toHaveAttribute('autoplay',/.*/);
   await expect(frame.locator(`#${id}`)).toHaveAttribute('preload','none');
   expect(await frame.locator(`#${id}`).evaluate(el=>(el as HTMLMediaElement).paused)).toBe(true);
  }
  expect(assetGets).toEqual([]);
  await page.getByRole('button',{name:'取り消して停止'}).first().click();await expect(page.locator('.preview-frame')).toHaveCount(0);
  await page.getByRole('button',{name:'ファイル一覧を確認し直す'}).click();
  for(let i=0;i<5;i++)await expect(page.locator('.preview-consent input').nth(i)).not.toBeChecked();
 }finally{
  if(workspaceId)await page.request.post('/api/workspaces/remove',{data:{id:workspaceId}}).catch(()=>{});
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
