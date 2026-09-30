import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function configFor(models:any[]=[]) {
  return {revision:'r0',modelSource:'legacy',modelSavePath:'models.json',routingSavePath:'routing.json',overlayPath:'console/orchestrator-models.json',maxUserModels:16,userModels:models,
    backends:{legacy:{description:'Legacy',vision:false,provider:'legacy',model:'default',status:'bound'}},
    capabilities:{'strong-code':{description:'Coding',primary:'legacy',fallback:[],status:'bound',candidates:['legacy'],placeholder:[],unbound:[]}}};
}

test('mobile arbitrary model names, permission checkboxes, routes, stable rename and deletion',async({page})=>{
  const config:any=configFor(),requests:any[]=[];
  await page.route('**/api/orchestrator/settings',route=>{
    if(route.request().method()==='POST'){
      const value=route.request().postDataJSON();requests.push(value);
      if(value.kind==='usermodel'){
        if(value.action==='create')config.userModels.push({...value,id:'stable-id',backend:'user-stable-id'});
        else if(value.action==='update')config.userModels=config.userModels.map((m:any)=>m.id===value.id?{...m,...value}:m);
        else config.userModels=config.userModels.filter((m:any)=>m.id!==value.id);
        delete config.backends['user-stable-id'];
        for(const m of config.userModels)config.backends[m.backend]={description:m.name,provider:m.provider,model:m.model,vision:m.vision,status:'bound'};
      }else config.capabilities[value.name]={...config.capabilities[value.name],...value};
      const cap=config.capabilities['strong-code'];
      cap.candidates=[cap.primary,...cap.fallback].filter((b:string)=>b==='legacy'||config.userModels.some((m:any)=>m.backend===b&&m.scopes.includes('code')));
      cap.status=cap.candidates.length?'bound':'unbound';
      config.revision=`r${requests.length}`;
    }
    void route.fulfill({status:200,json:config});
  });
  await page.setViewportSize({width:390,height:780});
  await page.goto('/?view=settings');await page.getByRole('button',{name:'Orchestrator',exact:true}).click();
  await page.getByRole('button',{name:'Add model',exact:true}).click();
  const form=page.getByLabel('Registered model form');
  await expect(form.getByRole('checkbox',{name:'Allow code'})).not.toBeChecked();
  await page.getByLabel('Model display name').fill('日本語のモデル / ⭐');
  await page.getByLabel('Registered model provider').fill('provider');
  await page.getByLabel('Registered model ID',{exact:true}).fill('custom-model');
  await page.getByLabel('Allow code',{exact:true}).check();
  await page.getByLabel('Allow review',{exact:true}).check();
  await page.getByLabel('Supports image input').check();
  await page.screenshot({path:join(tmpdir(),'pi-console-registered-models-mobile.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Save registered model'}).click();
  expect(requests.at(-1)).toMatchObject({kind:'usermodel',action:'create',name:'日本語のモデル / ⭐',scopes:['code','review'],vision:true});
  const models=page.getByRole('region',{name:'Registered orchestrator models'});
  await expect(models).toContainText('日本語のモデル / ⭐');
  await page.getByRole('button',{name:'Edit capability strong-code'}).click();
  await page.getByLabel('Capability primary model').selectOption('user-stable-id');
  await page.getByRole('button',{name:'Save capability'}).click();
  expect(requests.at(-1)).toMatchObject({kind:'capability',primary:'user-stable-id'});
  await page.getByRole('button',{name:'Edit registered model 日本語のモデル / ⭐'}).click();
  await page.getByLabel('Model display name').fill('好きな名称 🚀');
  await page.getByLabel('Allow code',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Save registered model'}).click();
  expect(requests.at(-1)).toMatchObject({id:'stable-id',name:'好きな名称 🚀',scopes:['review']});
  await expect(models).toContainText('好きな名称 🚀');
  await page.getByRole('button',{name:'Edit capability strong-code'}).click();
  await expect(page.getByLabel('Capability primary model')).toHaveValue('user-stable-id');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  const capabilities=page.getByRole('region',{name:'Orchestrator capabilities'});
  await expect(capabilities).toContainText('Permitted candidates: None');
  page.once('dialog',dialog=>void dialog.accept());
  await page.getByRole('button',{name:'Delete registered model 好きな名称 🚀'}).click();
  await expect(models).not.toContainText('好きな名称 🚀');
  expect(requests.at(-1)).toMatchObject({kind:'usermodel',action:'delete',id:'stable-id',confirmed:true});
});

test('16 registered models disable addition but allow edits and expose save errors',async({page})=>{
  const models=Array.from({length:16},(_,i)=>({id:`m${i}`,backend:`user-m${i}`,name:`Model ${i}`,provider:'p',model:`model-${i}`,vision:false,scopes:['code']}));
  await page.route('**/api/orchestrator/settings',route=>void route.fulfill(route.request().method()==='POST'?{status:409,json:{error:'settings changed elsewhere; reload before saving'}}:{status:200,json:configFor(models)}));
  await page.goto('/?view=settings');await page.getByRole('button',{name:'Orchestrator',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add model',exact:true})).toBeDisabled();
  await expect(page.getByRole('region',{name:'Registered orchestrator models'})).toContainText('16/16');
  await page.getByRole('button',{name:'Edit registered model Model 0',exact:true}).click();
  await page.getByLabel('Model display name').fill('Rename');
  await page.getByRole('button',{name:'Save registered model'}).click();
  await expect(page.getByRole('alert')).toContainText('settings changed elsewhere');
  await expect(page.getByLabel('Registered model form')).toBeVisible();
});
