import { test, expect, type Page, type Route } from '@playwright/test';
const workspace = { id: 'model-w', name: 'Model fixture', path: 'C:/model-fixture', pinned: false, valid: true, lastOpenedAt: '2026-10-03T00:00:00Z' };
const session = { id: 'model-s', workspaceId: workspace.id, filePath: '/model-s.jsonl', name: 'Model conversation' };
const models = [{ provider: 'alpha', id: 'current', name: 'Current model' }, { provider: 'beta', id: 'other', name: 'Other model' }];
async function setup(page: Page, viewport = { width: 390, height: 780 }) {
  await page.setViewportSize(viewport);
  let options = { model: models[0], models, thinkingLevel: 'medium', thinkingLevels: ['off', 'medium', 'high'], contextUsage: { tokens: 26000, contextWindow: 200000, percent: 13 } };
  let activeRunId: string | undefined;
  const pending: Route[] = [], changes: string[] = [];
  await page.addInitScript(() => { (window as any).__modelSources=[]; (window as any).EventSource = class { listeners: Record<string,(event:any)=>void>={}; constructor(){(window as any).__modelSources.push(this);} close() {} addEventListener(type:string,listener:(event:any)=>void){this.listeners[type]=listener;} emit(value:unknown){this.listeners.execution?.({data:JSON.stringify(value)});} }; });
  const snapshot = () => ({ session, runtime: 'running', activeRunId, chat: [{ id: 'a', role: 'assistant', text: 'Ready for a task.', complete: true }], events: [], execution: { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 }, seq: 0, generation: 'g' });
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/prompt') { pending.push(route); return; }
    let value: unknown;
    if (path === '/api/workspaces') value = { workspaces: [workspace] };
    else if (path === '/api/workspaces/update') value = { workspace };
    else if (path === '/api/sessions') value = { sessions: [session] };
    else if (path === '/api/resume') value = { snapshot: snapshot() };
    else if (path === '/api/state') value = snapshot();
    else if (path === '/api/session/options') value = options;
    else if (path === '/api/session/model') { changes.push('model'); options = { ...options, model: models.find(m => m.provider === request.postDataJSON().provider && m.id === request.postDataJSON().modelId)! }; value = options; }
    else if (path === '/api/session/thinking') { changes.push('thinking'); options = { ...options, thinkingLevel: request.postDataJSON().level }; value = options; }
    else if (path === '/api/activity') value = { sessions: [] };
    else if (path === '/api/quick-prompts') value = { prompts: [] };
    else if (path === '/api/orchestrator/decisions') value = { decisions: [], canResume: false };
    else if (path.startsWith('/api/orchestrator')) value = { available: false };
    else if (path === '/api/pets') value = { pets: [] };
    else if (path === '/api/startup') value = { supported: false, enabled: false, installed: false };
    else if (path === '/api/session-retention') value = { enabled: false, days: 30 };
    else throw Error(`Unmocked API: ${path}`);
    await route.fulfill({ json: value });
  });
  await page.goto('/'); await page.locator('.workspace-card').first().click();
  await page.getByLabel('Session list').getByRole('button', { name: /^Model conversation/ }).click();
  await expect(page.locator('.model-summary-bar')).toContainText('Current model');
  return { pending, changes, run: () => { activeRunId = 'run'; } };
}
for (const language of ['en','ja']) test(`empty assistant bubble shows waiting until text arrives, but not after interruption: ${language}`, async ({page})=>{
  await page.addInitScript(language=>localStorage.setItem('pi-console:preferences:v1',JSON.stringify({language})),language);
  await setup(page);
  const snapshot={session,runtime:'running',activeRunId:'run-wait',chat:[{id:'waiting',role:'assistant',text:' \n ',thinking:'  ',complete:false}],events:[],execution:{nodes:[],roots:[],unattached:[],rows:[],activeCount:0,failedCount:0,decisionCount:0},seq:0,generation:'g'};
  await page.route('**/api/resume',route=>route.fulfill({json:{snapshot}})); await page.route('**/api/state?**',route=>route.fulfill({json:snapshot})); await page.reload();
  const bubble=page.locator('[data-message-id="waiting"]'),label=language==='ja'?'Piの出力を待っています…':'Waiting for Pi output…';
  await expect(bubble.getByRole('status')).toHaveText(label); await expect(bubble.locator('.message-bubble')).toHaveAttribute('aria-busy','true'); await expect(bubble.getByRole('button',{name:'Copy all'})).toHaveCount(0); await expect(bubble.locator('.message-thinking')).toHaveCount(0); await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
  if(language==='ja') await page.screenshot({path:'.pi-console/waiting-output-mobile.png'});
  const emit=async(type:string,seq:number,payload:Record<string,unknown>={})=>page.evaluate(value=>(window as any).__modelSources.at(-1).emit(value),{type,seq,payload,generation:'g',workspaceId:workspace.id,sessionId:session.id,entityId:'waiting',runId:'run-wait',source:'pi-rpc'});
  await emit('MessageDelta',1,{delta:'First visible output'}); await expect(bubble).toContainText('First visible output'); await expect(bubble.getByText(label,{exact:true})).toHaveCount(0); await expect(bubble.getByRole('button',{name:'Copy all'})).toBeEnabled();
  await emit('MessageCompleted',2,{text:'Finished output'}); await expect(bubble.locator('.message-bubble')).toHaveAttribute('aria-busy','false'); await expect(bubble.getByRole('status')).toHaveCount(0);
  await page.reload(); await expect(bubble.getByRole('status')).toHaveText(label); snapshot.activeRunId=''; snapshot.seq=1; await emit('RunFailed',1,{summary:'Interrupted'}); await expect(bubble.getByRole('status')).toHaveText(language==='ja'?'出力がないまま実行が終了しました':'No output received · run ended');
});

test('custom tool-only output appears live and after reload without an empty Thinking panel', async ({ page }) => {
  await setup(page);
  let output: string | undefined;
  const snapshot=()=>({session,runtime:'running',chat:[{id:'tool-only',role:'assistant',text:'',thinking:' \n ',tools:[{id:'goal-call',name:'update_goal',input:'{"status":"complete"}',status:output===undefined?'running':'completed',...(output===undefined?{}:{output})}],complete:true}],events:[],execution:{nodes:[],roots:[],unattached:[],rows:[],activeCount:0,failedCount:0,decisionCount:0},seq:output===undefined?0:1,generation:'g'});
  await page.route('**/api/resume',route=>route.fulfill({json:{snapshot:snapshot()}})); await page.route('**/api/state?**',route=>route.fulfill({json:snapshot()}));
  await page.reload(); const bubble=page.locator('[data-message-id="tool-only"]'); await expect(bubble).toContainText('Waiting for tool output'); await expect(bubble.locator('.message-thinking')).toHaveCount(0);
  output='Goal audit approved.\nGoal complete.';
  await page.evaluate(({workspaceId,sessionId,output})=>(window as any).__modelSources.at(-1).emit({type:'ToolCompleted',generation:'g',seq:1,workspaceId,sessionId,toolCallId:'goal-call',entityId:'tool',source:'pi-rpc',payload:{chatMessageId:'tool-only',chatTool:{id:'goal-call',name:'update_goal',input:'{"status":"complete"}',status:'completed',output}}}),{workspaceId:workspace.id,sessionId:session.id,output});
  await expect(bubble.getByText('Goal audit approved.',{exact:false})).toBeVisible(); await expect(bubble.getByRole('button',{name:'Copy all'})).toBeEnabled(); await expect(bubble).not.toContainText('Command text was not provided');
  await page.reload(); await expect(bubble.getByText('Goal audit approved.',{exact:false})).toBeVisible(); await expect(bubble.locator('.message-thinking')).toHaveCount(0);
});
for (const viewport of [{width:390,height:780},{width:320,height:568},{width:844,height:390},{width:390,height:360}]) test(`context amount stays visible without opening settings: ${viewport.width}x${viewport.height}`, async ({page})=>{
  await setup(page,viewport); const context=page.getByLabel('Current context usage',{exact:true}); await expect(context).toHaveCount(1); await expect(context).toBeVisible(); await expect(context).toHaveText('Context 13% · 26k/200k'); await expect(context).toHaveAttribute('title',/26,000 \/ 200,000 tokens/);
  const box=(await context.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
  await expect(page.getByRole('dialog',{name:'Model settings',exact:true})).not.toBeVisible();
  const send=(await page.getByRole('button',{name:/^Send/}).boundingBox())!,nav=(await page.getByRole('navigation',{name:'Session views'}).boundingBox())!; expect(send.y+send.height).toBeLessThanOrEqual(nav.y);
  await page.screenshot({path:`.pi-console/context-default-${viewport.width}x${viewport.height}.png`});
});

test('media query subscription resynchronizes a resize missed during initial render', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window), seen = new Set<string>();
    window.matchMedia = query => {
      const media = original(query);
      if (!['(max-width:900px)', '(max-width:900px) and (max-height:480px)'].includes(query) || seen.has(query)) return media;
      seen.add(query);
      return new Proxy(media, { get(target, key) { if (key === 'matches') return false; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
    };
  });
  await setup(page, { width: 844, height: 390 });
  await expect(page.locator('.session-toolbar .conversation-status')).toBeVisible();
  await page.getByRole('button', { name: 'Model / Thinking', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Model settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close model settings', exact: true }).click();
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/view-sessions/);
});

test('mobile model summary opens one modal with filtering, thinking, context and native focus containment', async ({ page }) => {
  const { changes } = await setup(page);
  const trigger = page.getByRole('button', { name: 'Model settings', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Model settings', exact: true });
  await expect(page.getByLabel('Model', { exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Context usage', { exact: true })).not.toBeVisible();
  const before = (await page.getByLabel('Chat output').boundingBox())!;
  await trigger.click(); await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Model', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('Model', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Context usage', { exact: true })).toContainText('13%');
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#model-settings-dialog'))).toBe(true);
  }
  const after = (await page.getByLabel('Chat output').boundingBox())!;
  expect(after.height).toBe(before.height);
  await page.getByRole('button', { name: 'Find models', exact: true }).click();
  await page.getByLabel('Model provider').selectOption('beta');
  await page.getByLabel('Search models').fill('other');
  await page.getByLabel('Model', { exact: true }).selectOption('beta::other');
  await page.getByLabel('Thinking', { exact: true }).selectOption('high');
  await expect(page.getByLabel('Thinking', { exact: true })).toHaveValue('high');
  await page.getByLabel('Thinking', { exact: true }).press('Escape');
  await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await expect(page.locator('.model-summary-bar')).toContainText('Other model');
  expect(changes).toEqual(['model', 'thinking']);
  await trigger.click(); await expect(page.getByLabel('Model', { exact: true })).toHaveValue('beta::other');
  await page.getByRole('button', { name: 'Close model settings', exact: true }).click();
  await expect(trigger).toBeFocused();
});
test('settings remain inspectable but model changes stay locked while sending and running', async ({ page }) => {
  const { pending, changes, run } = await setup(page);
  const trigger = page.getByRole('button', { name: 'Model settings', exact: true });
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Run task');
  await page.getByRole('button', { name: /^Send/ }).click(); await expect.poll(() => pending.length).toBe(1);
  for (const stage of ['sending', 'running']) {
    await trigger.click(); await expect(page.getByLabel('Model', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Thinking', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Context usage', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close model settings', exact: true }).click();
    if (stage === 'sending') { run(); await pending[0].fulfill({ json: { runId: 'run' } }); await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled(); }
  }
  expect(changes).toEqual([]);
});
test('orientation and desktop resize do not leave modal focus or an overlay blocking chat', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByLabel('Context usage', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close model settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Model / Thinking', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Model / Thinking', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('dialog', { name: 'Model settings', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Model', { exact: true })).toBeVisible();
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true }); await prompt.fill('desktop draft');
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(page.getByRole('dialog', { name: 'Model settings', exact: true })).not.toBeVisible();
  await expect(prompt).toHaveValue('desktop draft');
  await page.getByRole('button', { name: 'Model settings', exact: true }).click();
  await page.goBack();
  await expect(page.getByLabel('Session list')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Model settings', exact: true })).not.toBeVisible();
});
