import { test, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('first-model setup works without opening advanced settings', async ({ page }) => {
  const config = {
    modelSource: 'defaults', modelSavePath: 'user override',
    capabilities: { 'strong-code': { description: 'Code tasks', primary: 'first', fallback: [], status: 'placeholder', candidates: [], placeholder: ['first'], unbound: [] } },
    backends: { first: { description: 'Code model', vision: false, provider: '', model: '', thinking: '', status: 'placeholder' } },
  };
  let saved: any;
  await page.route('**/api/orchestrator/settings', route => {
    if (route.request().method() === 'POST') {
      saved = route.request().postDataJSON();
      config.backends.first = { ...config.backends.first, provider: saved.provider, model: saved.model, status: 'bound' };
      config.capabilities['strong-code'] = { ...config.capabilities['strong-code'], status: 'bound', candidates: ['first'], placeholder: [] };
    }
    void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) });
  });
  await page.goto('/?view=settings');
  await page.getByRole('button', { name: 'Orchestrator' }).click();
  await expect(page.getByText('Connect your first model')).toBeVisible();
  await page.getByLabel('Starter provider').fill('openai-codex');
  await page.getByLabel('Starter model').fill('test-model');
  await page.getByRole('button', { name: 'Connect model' }).click();
  expect(saved).toEqual({ kind: 'backend', name: 'first', provider: 'openai-codex', model: 'test-model' });
  await expect(page.getByText('Configured routes: 1/1')).toBeVisible();
  await expect(page.getByText('Provider access: Not verified')).toBeVisible();
  await expect(page.getByLabel('first provider')).not.toBeVisible();
});

test('Pi session catalog fills provider and ID without changing the session model', async ({ page }) => {
  const config = {
    modelSource: 'defaults', modelSavePath: 'user override',
    capabilities: { 'strong-code': { description: 'Code tasks', primary: 'first', fallback: [], status: 'placeholder', candidates: [], placeholder: ['first'], unbound: [] } },
    backends: { first: { description: 'Code model', vision: false, provider: '', model: '', thinking: '', status: 'placeholder' } },
  };
  const catalog = [{ provider: 'p1', id: 'shared', name: 'Same name' }, { provider: 'p2', id: 'shared', name: 'Same name' }, { provider: 'p2', id: 'newer', name: 'Newer model' }];
  let saved: any;
  let sessionModelChanges = 0;
  await page.addInitScript(() => history.replaceState({ piConsoleNav: true, view: 'settings', workspace: 'workspace', session: 'session' }, '', location.href));
  await page.route('**/api/session/options?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: catalog, model: { provider: 'p1', id: 'shared' }, thinkingLevel: 'off', thinkingLevels: ['off'] }) }));
  await page.route('**/api/session/model', route => { sessionModelChanges++; void route.fulfill({ status: 500 }); });
  await page.route('**/api/orchestrator/settings', route => {
    if (route.request().method() === 'POST') {
      saved = route.request().postDataJSON();
      config.backends.first = { ...config.backends.first, provider: saved.provider, model: saved.model, status: 'bound' };
      config.capabilities['strong-code'] = { ...config.capabilities['strong-code'], status: 'bound', candidates: ['first'], placeholder: [] };
    }
    void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) });
  });
  await page.goto('/?view=settings');
  await page.getByRole('button', { name: 'Orchestrator' }).click();
  await page.getByLabel('Starter available Pi model search').fill('shared');
  await page.getByLabel('Starter available Pi model provider').selectOption('p2');
  await expect(page.getByLabel('Starter available Pi model',{exact:true}).locator('option')).toHaveCount(2);
  await page.getByLabel('Starter available Pi model',{exact:true}).selectOption(JSON.stringify(['p2', 'shared']));
  await expect(page.getByLabel('Starter provider')).toHaveValue('p2');
  await expect(page.getByLabel('Starter model')).toHaveValue('shared');
  expect(saved).toBeUndefined();
  await page.getByRole('button', { name: 'Connect model' }).click();
  expect(saved).toEqual({ kind: 'backend', name: 'first', provider: 'p2', model: 'shared' });
  await page.locator('.orchestrator-advanced summary').click();
  await page.getByLabel('first available Pi model',{exact:true}).selectOption(JSON.stringify(['p2', 'newer']));
  await expect(page.getByLabel('first model', { exact: true })).toHaveValue('newer');
  await page.getByRole('button', { name: 'Save model' }).click();
  expect(saved).toEqual({ kind: 'backend', name: 'first', provider: 'p2', model: 'newer' });
  expect(sessionModelChanges).toBe(0);
});

test('quick setup prioritizes a configured model while preserving fallbacks; advanced controls stay optional', async ({ page }) => {
  const config = {
    modelSource: 'kit models', modelSavePath: 'user override',
    capabilities: {
      'strong-code': { description: 'Code tasks', primary: 'first', fallback: ['second'], status: 'bound', candidates: ['first', 'second'], placeholder: [], unbound: [] },
      orchestration: { description: 'Planner', primary: 'second', fallback: ['first'], status: 'bound', candidates: ['second', 'first'], placeholder: [], unbound: [] },
    },
    backends: Object.fromEntries(['first', 'second', 'third'].map(name => [name, { description: name, vision: false, provider: 'provider', model: `model-${name}`, thinking: '', status: 'bound' }])),
  };
  let saved: any;
  await page.route('**/api/orchestrator/settings', route => {
    if (route.request().method() === 'POST') {
      saved = route.request().postDataJSON();
      config.capabilities['strong-code'] = { ...config.capabilities['strong-code'], primary: saved.primary, fallback: saved.fallback, candidates: [saved.primary, ...saved.fallback] };
    }
    void route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) });
  });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/?view=settings');
  await page.getByRole('button', { name: 'Orchestrator' }).click();
  await expect(page.getByText('Configured routes: 2/2')).toBeVisible();
  await expect(page.getByText('Provider access: Not verified')).toBeVisible();
  if(process.env.PI_CONSOLE_SCREENSHOT)await page.screenshot({path:join(tmpdir(),'pi-console-ux-access-status.png')});
  await expect(page.getByLabel('first provider')).not.toBeVisible();
  await page.getByLabel('strong-code preferred model').selectOption('third');
  const quick = page.locator('.orchestrator-quick-route').filter({ has: page.getByLabel('strong-code preferred model') });
  await expect(quick).toContainText('third → first → second');
  await quick.getByRole('button', { name: 'Use this model' }).click();
  await expect(page.getByText('Saved. New runs use these settings.')).toBeVisible();
  expect(saved).toEqual({ kind: 'capability', name: 'strong-code', primary: 'third', fallback: ['first', 'second'] });
  await page.locator('.orchestrator-advanced summary').click();
  await expect(page.getByLabel('first provider')).toBeVisible();
});
