import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('Windows Startup shortcut can be installed and disabled from mobile settings',async({page})=>{
  await page.setViewportSize({width:390,height:780});
  let state={supported:true,enabled:true,installed:false,conflict:false};
  await page.route('**/api/startup',async route=>{
    if(route.request().method()==='POST'){const enabled=route.request().postDataJSON().enabled;state={...state,enabled,installed:enabled}}
    await route.fulfill({json:state});
  });
  await page.goto('/');await page.getByRole('button',{name:'Open settings'}).click();
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Start with Windows'}).click();
  await expect(page.getByLabel('Start with Windows',{exact:true})).toBeChecked();
  await expect(page.getByText('Startup shortcut not yet installed')).toBeVisible();
  await page.getByRole('button',{name:'Install now'}).click();await expect(page.getByText('Startup shortcut installed')).toBeVisible();
  await page.getByLabel('Start with Windows',{exact:true}).click();await expect(page.getByLabel('Start with Windows',{exact:true})).not.toBeChecked();
  await page.getByLabel('Start with Windows',{exact:true}).click();await expect(page.getByText('Startup shortcut installed')).toBeVisible();
  await page.screenshot({path:join(tmpdir(),'pi-console-startup-settings-mobile.png'),fullPage:true});
});
