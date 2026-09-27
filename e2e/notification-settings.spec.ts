import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('browser notification permission is requested only when enabling in settings',async({page})=>{
  await page.addInitScript(()=>{
    (window as any).__permissionRequests=0;
    (window as any).Notification=class {static permission='default';static async requestPermission(){(window as any).__permissionRequests++;this.permission='granted';return 'granted'}};
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('/?view=settings');
  await page.getByRole('button',{name:'Sessions',exact:true}).click();
  const toggle=page.getByLabel('Notify when work finishes');
  await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(()=>(window as any).__permissionRequests)).toBe(0);
  await toggle.check();
  await expect(toggle).toBeChecked();
  if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-notification-settings.png')});
  expect(await page.evaluate(()=>(window as any).__permissionRequests)).toBe(1);
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(()=>(window as any).__permissionRequests)).toBe(1);
});
