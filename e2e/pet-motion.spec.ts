import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function waitForMotion(page:Page,wanted:string,timeout=10000){
  return page.evaluate(({wanted,timeout})=>new Promise<boolean>(resolve=>{
    const el=document.querySelector('.pet-widget');if(!el)return resolve(false);
    let timer:ReturnType<typeof setTimeout>;
    const observer=new MutationObserver(()=>check());
    const check=()=>{const mode=el.getAttribute('data-motion')??'';if(mode===wanted||wanted==='walk'&&mode.startsWith('walk-')){clearTimeout(timer);observer.disconnect();resolve(true)}};
    observer.observe(el,{attributes:true,attributeFilter:['data-motion']});timer=setTimeout(()=>{observer.disconnect();resolve(false)},timeout);check();
  }),{wanted,timeout});
}

test('pet roams, touch-drags, stays within viewport and restores its position',async({page,context})=>{
  await page.setViewportSize({width:390,height:780});
  await page.goto('/');
  await page.bringToFront();
  const pets=(await (await page.request.get('/api/pets')).json()).pets;
  test.skip(!pets.length,'No Codex-compatible pet package on this server');
  await page.getByRole('button',{name:'Open settings'}).click();
  await page.getByRole('button',{name:'Pet',exact:true}).click();
  await page.getByLabel('Show companion').check();
  const widget=page.locator('.pet-widget');await expect(widget).toBeVisible();
  await expect.poll(()=>widget.evaluate(el=>{const c=el.querySelector('canvas')!;const p=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;for(let i=3;i<p.length;i+=4)if(p[i])return true;return false})).toBe(true);
  await expect.poll(()=>widget.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.left+2,r.top+2)?.closest('.pet-widget')===null})).toBe(true);
  await expect.poll(()=>widget.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.pet-widget')===el})).toBe(true);
  expect(await waitForMotion(page,'walk')).toBe(true);
  const first=await widget.boundingBox();expect(first).not.toBeNull();
  await expect.poll(async()=>{const box=await widget.boundingBox();return Math.abs(box!.x-first!.x)+Math.abs(box!.y-first!.y)},{timeout:10000}).toBeGreaterThan(5);
  expect(await waitForMotion(page,'idle',6000)).toBe(true);
  const idleFrame=await widget.getAttribute('data-frame');
  await expect.poll(()=>widget.getAttribute('data-frame'),{timeout:3500}).not.toBe(idleFrame);
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  let box=(await widget.boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:0}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:55,y:95,id:0}]});
  expect(await waitForMotion(page,'walk-left',2500)).toBe(true);
  await expect.poll(async()=>Number(await widget.getAttribute('data-frame')),{timeout:1200}).toBeGreaterThan(0);
  await page.screenshot({path:join(tmpdir(),'pi-console-pet-walking-touch.png'),fullPage:true});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(await waitForMotion(page,'idle',2500)).toBe(true);
  await expect.poll(async()=>Math.round((await widget.boundingBox())!.x)).toBeLessThan(50);
  box=(await widget.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(3);expect(box.y).toBeGreaterThanOrEqual(3);
  await page.screenshot({path:join(tmpdir(),'pi-console-pet-drag-mobile.png'),fullPage:true});
  box=(await widget.boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:0}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:385,y:776,id:0}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  box=(await widget.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(3);expect(box.y).toBeGreaterThanOrEqual(3);
  expect(box.x+box.width).toBeLessThanOrEqual(387);expect(box.y+box.height).toBeLessThanOrEqual(777);
  await page.reload();
  await expect(widget).toBeVisible();
  const restored=(await widget.boundingBox())!;
  expect(Math.abs(restored.x-box.x)).toBeLessThan(10);expect(Math.abs(restored.y-box.y)).toBeLessThan(10);
  await page.setViewportSize({width:320,height:600});
  await expect.poll(async()=>{const b=(await widget.boundingBox())!;return b.x+b.width<=317&&b.y+b.height<=597}).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});
  const still=(await widget.boundingBox())!;
  await page.waitForTimeout(900); // A bounded interval distinguishes stillness from the ordinary 13px/s roam.
  const reduced=(await widget.boundingBox())!;
  expect(Math.abs(reduced.x-still.x)+Math.abs(reduced.y-still.y)).toBeLessThan(2);
  await cdp.detach();
});
