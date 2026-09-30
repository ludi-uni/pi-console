import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('mobile kit model assignments and capability routes can be added, reordered, disabled and restored',async({page})=>{
  const config:any={revision:'r0',modelSource:'kit defaults',modelSavePath:'user/models.local.json',routingSavePath:'kit/routing.local.json',disabledCapabilities:[],backends:{
    first:{description:'Strong model slot',vision:false,provider:'provider',model:'one',thinking:'',status:'bound'},
    second:{description:'Fallback slot',vision:false,provider:'provider',model:'two',thinking:'',status:'bound'},
    third:{description:'Extra slot',vision:false,provider:'',model:'',thinking:'',status:'placeholder'},
  },capabilities:{'strong-code':{description:'Code tasks',custom:false,primary:'first',fallback:['second'],status:'bound',candidates:['first','second'],placeholder:[],unbound:[]}}};
  const requests:any[]=[];
  await page.route('**/api/orchestrator/settings',route=>{
    if(route.request().method()==='POST'){
      const value=route.request().postDataJSON();requests.push(value);
      if(value.revision!==config.revision)return void route.fulfill({status:409,json:{error:'settings changed elsewhere; reload before saving'}});
      if(value.kind==='backend'){
        config.backends[value.name]={...config.backends[value.name],provider:value.action==='delete'?'TODO-unconfigured':value.provider,model:value.action==='delete'?'TODO-unconfigured':value.model,status:value.action==='delete'?'placeholder':'bound'};
      }else if(value.action==='create')config.capabilities[value.name]={description:value.description,custom:true,primary:value.primary,fallback:value.fallback,status:'bound',candidates:[value.primary,...value.fallback],placeholder:[],unbound:[]};
      else if(value.action==='delete'){
        if(config.capabilities[value.name].custom)delete config.capabilities[value.name];
        else{config.disabledCapabilities.push({name:value.name,description:config.capabilities[value.name].description});delete config.capabilities[value.name]}
      }else if(value.action==='restore'){
        config.disabledCapabilities=config.disabledCapabilities.filter((entry:any)=>entry.name!==value.name);
        config.capabilities[value.name]={description:'Code tasks',custom:false,primary:'first',fallback:['second'],status:'bound',candidates:['first','second'],placeholder:[],unbound:[]};
      }else config.capabilities[value.name]={...config.capabilities[value.name],description:value.description??config.capabilities[value.name].description,primary:value.primary,fallback:value.fallback,candidates:[value.primary,...value.fallback]};
      config.revision=`r${requests.length}`;
    }
    void route.fulfill({status:200,json:config});
  });
  await page.setViewportSize({width:390,height:780});await page.goto('/?view=settings');
  await page.getByRole('button',{name:'Orchestrator'}).click();
  await page.getByText('Legacy kit assignments',{exact:true}).click();
  await page.getByRole('button',{name:'Assign legacy model'}).click();
  await expect(page.getByLabel('Model backend slot')).toHaveValue('third');
  await page.getByLabel('Kit model provider').fill('openai-codex');await page.getByLabel('Kit model ID').fill('new-model');
  await page.getByRole('button',{name:'Save model'}).click();
  await expect(page.getByRole('region',{name:'Orchestrator models',exact:true})).toContainText('openai-codex / new-model');
  if(process.env.PI_CONSOLE_SCREENSHOT){await page.locator('.settings-content').evaluate(node=>node.scrollTop=0);await page.screenshot({path:join(tmpdir(),'pi-console-kit-models-mobile.png')})}
  await page.getByRole('button',{name:'Add capability'}).click();
  await page.getByLabel('New capability name').fill('custom-check');
  await page.getByLabel('Capability description').fill('Check results');
  await page.getByLabel('Capability primary model').selectOption('third');
  await page.getByLabel('Add fallback model').selectOption('first');
  await page.getByLabel('Add fallback model').selectOption('second');
  await page.getByRole('button',{name:'Move second up'}).click();
  await page.getByRole('button',{name:'Save capability'}).click();
  expect(requests.at(-1)).toMatchObject({kind:'capability',action:'create',name:'custom-check',description:'Check results',primary:'third',fallback:['second','first']});
  const capabilities=page.getByRole('region',{name:'Orchestrator capabilities'});
  await expect(capabilities).toContainText('custom-check');
  await page.getByRole('button',{name:'Edit capability custom-check'}).click();
  await page.getByLabel('Capability description').fill('Review completed results');
  await page.getByRole('button',{name:'Remove fallback first'}).click();
  await page.getByRole('button',{name:'Save capability'}).click();
  expect(requests.at(-1)).toMatchObject({kind:'capability',name:'custom-check',description:'Review completed results',fallback:['second']});
  if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-kit-settings-mobile.png')});
  page.once('dialog',dialog=>void dialog.accept());await page.getByRole('button',{name:'Delete capability custom-check'}).click();
  await expect(capabilities).not.toContainText('custom-check');
  page.once('dialog',dialog=>void dialog.accept());await page.getByRole('button',{name:'Disable capability strong-code'}).click();
  await expect(page.getByRole('button',{name:'Restore capability strong-code'})).toBeVisible();
  await page.getByRole('button',{name:'Restore capability strong-code'}).click();
  await expect(page.getByRole('button',{name:'Edit capability strong-code'})).toBeVisible();
  page.once('dialog',dialog=>void dialog.accept());await page.getByRole('button',{name:'Remove model third'}).click();
  await expect(page.getByRole('region',{name:'Orchestrator models',exact:true})).not.toContainText('openai-codex / new-model');
  expect(requests.at(-1)).toMatchObject({kind:'backend',action:'delete',name:'third',confirmed:true});
});
