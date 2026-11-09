import { test, expect } from '@playwright/test';
import type { ChatMessage, ExecutionEvent, Snapshot } from '../shared/types.ts';

// Fully mocked API + inert SDK/SSE. No real sessions, providers or live server
// mutations. DOM identity of Markdown headings detects historical re-renders:
// the Markdown heading renderer is recreated whenever a chat item renders.
test.use({serviceWorkers:'block'});
test('typing, polling and fresh snapshots preserve unchanged Markdown while live results and workspace links stay fresh',async({page})=>{
 const workspaces=['w1','w2'].map(id=>({id,name:id,path:`C:/fixture/${id}`,pinned:false,lastOpenedAt:'1',valid:true}));
 const session=(id:string)=>({id:`s-${id}`,workspaceId:id,name:`Conversation ${id}`,filePath:`/${id}.jsonl`,updatedAt:'1'});
 const history:ChatMessage[]=Array.from({length:30},(_,i)=>({id:`history-${i}`,role:'assistant',complete:true,text:`## History ${i}\n\nFinished **result** with [note](note.txt).\n\n\`\`\`ts\nconst value = ${i};\n\`\`\``}));
 let snapshot:Snapshot={session:session('w1'),runtime:'running',activeRunId:'run',generation:'g',seq:1,events:[],execution:{nodes:[],rows:[],roots:[],unattached:[],activeCount:0,failedCount:0,decisionCount:0},chat:[...history,{id:'live',role:'assistant',text:'Live result',complete:false,tools:[{id:'tool',name:'read',status:'running',output:'Before'}]},{id:'user',role:'user',text:'Attached input',complete:true,attachments:[{kind:'text',name:'before.txt',mimeType:'text/plain',preview:'Before attachment'}]}]};
 let stateReads=0,activityReads=0,sessionReads=0;
 const opened:string[]=[];
 await page.addInitScript(()=>{
  (window as any).EventSource=class{
   onopen?:()=>void; listeners=new Map<string,(event:{data:string})=>void>();
   constructor(){(window as any).__execution=this;queueMicrotask(()=>this.onopen?.());}
   addEventListener(name:string,listener:(event:{data:string})=>void){this.listeners.set(name,listener);}
   close(){}
  };
 });
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  let body:unknown={};
  if(path==='/api/workspaces')body={workspaces};
  else if(path==='/api/workspaces/update')body={workspace:workspaces.find(w=>w.id===request.postDataJSON().id)};
  else if(path==='/api/sessions'){sessionReads++;body={sessions:[session(url.searchParams.get('workspaceId')??'w1')]};}
  else if(path==='/api/activity'){activityReads++;body={sessions:[]};}
  else if(path==='/api/quick-prompts')body={prompts:[]};
  else if(path==='/api/orchestrator'||path==='/api/orchestrator/decisions')body={available:false};
  else if(path==='/api/session/options')body={models:[],thinkingLevel:'off',thinkingLevels:['off']};
  else if(path==='/api/resume'){const id=request.postDataJSON().workspaceId;body={snapshot:{...snapshot,session:session(id)}};}
  else if(path==='/api/state'){stateReads++;body=snapshot;}
  else if(path==='/api/workspace/text'){const id=url.searchParams.get('workspaceId')!;opened.push(id);body={path:'note.txt',format:'text',content:`Opened ${id}`};}
  else if(path==='/api/voice/status')body={enabled:false,available:false,phase:'off',providerId:'speech-cpp'};
  else if(path==='/api/pets')body={pets:[]};
  await route.fulfill({json:body});
 });
 await page.clock.install();await page.setViewportSize({width:1280,height:800});await page.goto('/');
 await page.getByLabel('Workspace',{exact:true}).selectOption('w1');
 await page.getByLabel('Session list').getByRole('button').first().click();
 const historical=page.locator('[data-message-id="history-0"]');
 await expect(historical.getByRole('heading',{name:'History 0',exact:true})).toBeVisible();
 await historical.getByRole('heading').evaluate(element=>{(window as any).__historyHeading=element;});
 const unchanged=()=>page.evaluate(()=>document.querySelector('[data-message-id="history-0"] h2')===(window as any).__historyHeading);
 const prompt=page.getByRole('textbox',{name:'Prompt',exact:true});
 await prompt.fill('Keep this unsent draft');await expect(prompt).toHaveValue('Keep this unsent draft');
 expect(await unchanged(),'typing must not re-render historical Markdown').toBe(true);
 const beforeActivity=activityReads,beforeSessions=sessionReads;
 await page.clock.fastForward(11000);
 await expect.poll(()=>activityReads).toBeGreaterThan(beforeActivity);await expect.poll(()=>sessionReads).toBeGreaterThan(beforeSessions);
 expect(await unchanged(),'background polling must not re-render history').toBe(true);
 const emit=async(type:ExecutionEvent['type'],seq:number,payload:Record<string,unknown>)=>{
  const event:ExecutionEvent={schemaVersion:1,eventId:`event-${seq}`,seq,timestamp:new Date().toISOString(),generation:'g',workspaceId:'w1',sessionId:'s-w1',runId:'run',type,entityId:'live',source:'pi-rpc',certainty:'observed',payload};
  await page.evaluate(event=>(window as any).__execution.listeners.get('execution')({data:JSON.stringify(event)}),event);
 };
 await emit('MessageDelta',2,{delta:' streamed'});
 await expect(page.locator('[data-message-id="live"]')).toContainText('Live result streamed');
 expect(await unchanged(),'a streaming sibling must not re-render history').toBe(true);
 snapshot={...snapshot,seq:3,chat:snapshot.chat.map(message=>message.id==='live'?{...message,text:'Fresh snapshot result',thinking:'Fresh thinking',tools:[{id:'tool',name:'read',status:'completed',output:'Fresh tool output'}]}:message.id==='user'?{...message,attachments:[{kind:'text',name:'after.txt',mimeType:'text/plain',preview:'Fresh attachment'}]}:message)};
 await emit('ToolCompleted',3,{});await page.clock.runFor(200);
 await expect.poll(()=>stateReads).toBeGreaterThan(0);
 const live=page.locator('[data-message-id="live"]');
 await expect(live).toContainText('Fresh snapshot result');await expect(live.locator('.message-thinking pre')).toHaveText('Fresh thinking');
 await expect(live.locator('.message-tools')).toContainText('Fresh tool output');
 await expect(page.locator('[data-message-id="user"]')).toContainText('after.txt');
 expect(await unchanged(),'equal messages from a freshly parsed snapshot must keep their Markdown nodes').toBe(true);
 await historical.getByRole('button',{name:'note',exact:true}).click();
 const preview=page.getByRole('dialog',{name:'Workspace file preview'});await expect(preview).toContainText('Opened w1');
 await preview.getByRole('button',{name:'Close file preview'}).click();
 await page.getByLabel('Workspace',{exact:true}).selectOption('w2');
 await page.getByLabel('Session list').getByRole('button').first().click();
 await page.locator('[data-message-id="history-0"]').getByRole('button',{name:'note',exact:true}).click();
 await expect(preview).toContainText('Opened w2');expect(opened).toEqual(['w1','w2']);
});
