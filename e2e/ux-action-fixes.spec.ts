import { test, expect, type Page } from '@playwright/test';

// Focused regression checks for the UX review fixes: hidden file input is not
// tabbable, queued-item removal is confirmed, mobile Execution counters are
// spelled out, key controls follow the selected language, and the document
// declares a dark color scheme. All APIs/SSE are mocked: no Pi, no model calls.
const workspaces = [{ id: 'A', name: 'Workspace A', path: 'C:/A', valid: true, lastOpenedAt: '2026-10-03T00:00:00Z' }];
const sessions = [
  { id: 'A', workspaceId: 'A', name: 'Chat A', filePath: '/A.jsonl' },
  { id: 'B', workspaceId: 'A', name: 'Chat B', filePath: '/B.jsonl' },
];
const executionState = (overrides: object = {}) => ({ nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0, ...overrides });
const queuedItem = (overrides: object = {}) => ({ id: 'q1', message: 'Queued follow-up', revision: 1, queuedAt: '2026-10-03T00:00:00Z', status: 'pending', ...overrides });
const snapshot = (id: string, overrides: any = {}) => {
  const base = {
    session: sessions.find(s => s.id === id)!, runtime: 'running', activeRunId: id === 'B' ? 'run-B' : undefined,
    chat: [{ id: `m-${id}`, role: 'assistant', text: `Private history ${id}.`, complete: true }], events: [], execution: executionState(), seq: 0, generation: id, queue: [],
  };
  return { ...base, ...overrides, execution: { ...base.execution, ...(overrides.execution ?? {}) } };
};
async function setup(page: Page, options: { mobile?: boolean; language?: 'en' | 'ja'; snapshotOverrides?: object } = {}) {
  if (options.mobile) await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(language => {
    (window as any).EventSource = class extends EventTarget { close() {} };
    if (language) localStorage.setItem('pi-console:preferences:v1', JSON.stringify({ language }));
  }, options.language ?? '');
  const removed: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let value: unknown;
    if (path === '/api/workspaces') value = { workspaces };
    else if (path === '/api/workspaces/update') value = { workspace: workspaces.find(w => w.id === request.postDataJSON().id) };
    else if (path === '/api/sessions') value = { sessions };
    else if (path === '/api/resume') value = { snapshot: { ...snapshot(request.postDataJSON().sessionId), ...options.snapshotOverrides } };
    else if (path === '/api/state') value = { ...snapshot(url.searchParams.get('sessionId')!), ...options.snapshotOverrides };
    else if (path === '/api/session/options') value = { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] };
    else if (path === '/api/activity') value = { sessions: [] };
    else if (path === '/api/quick-prompts') value = { prompts: [] };
    else if (path.startsWith('/api/orchestrator')) value = { available: false };
    else if (path === '/api/pets') value = { pets: [] };
    else if (path === '/api/queue/remove') { removed.push(request.postDataJSON().id); value = { ok: true }; }
    else if (path === '/api/prompt') value = { runId: 'new-run' };
    else throw Error(`Unexpected API: ${path}`);
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  if (options.mobile) {
    // The workspace select is hidden on the compact home screen; use the hub card.
    await page.getByRole('button', { name: 'Workspace A' }).click();
  } else {
    await page.getByLabel('Workspace', { exact: true }).selectOption('A');
  }
  return removed;
}
async function openSession(page: Page, id: 'A' | 'B') {
  await page.getByLabel('Session list').getByRole('button', { name: new RegExp(`^Chat ${id}`) }).click();
  await expect(page.locator('[data-message-id]').first()).toBeVisible();
}

test('the transparent file input stays out of Tab order while the visible Attach button keeps working', async ({ page }) => {
  await setup(page);
  await openSession(page, 'A');
  const input = page.getByLabel('Choose files');
  await expect(input).toHaveAttribute('tabindex', '-1');
  // Tabbing through the composer must land on the visible button, never the input.
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(input).not.toBeFocused();
  // The visible button still opens the same picker target.
  const button = page.getByRole('button', { name: 'Attach files' });
  await expect(button).toBeVisible();
  await button.click();
  await input.setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(page.getByLabel('Attached files')).toContainText('note.txt');
});

test('removing a queued item asks first; cancelling sends no request', async ({ page }) => {
  const removed = await setup(page, { snapshotOverrides: { queue: [queuedItem()] } });
  await openSession(page, 'A');
  const remove = page.getByRole('button', { name: 'Remove queued message 1' });
  await expect(remove).toBeVisible();
  page.once('dialog', dialog => void dialog.dismiss());
  await remove.click();
  await expect.poll(() => removed.length).toBe(0);
  await expect(remove).toBeVisible();
  page.once('dialog', dialog => void dialog.accept());
  await remove.click();
  await expect.poll(() => removed.length).toBe(1);
  expect(removed[0]).toBe('q1');
});

test('removing a held item warns that delivery is unconfirmed and removal is not a send cancellation', async ({ page }) => {
  const removed = await setup(page, { snapshotOverrides: { queue: [queuedItem({ status: 'held', error: 'interrupted' })], queueHeld: true } });
  await openSession(page, 'A');
  const remove = page.getByRole('button', { name: 'Remove queued message 1' });
  let message = '';
  page.once('dialog', dialog => { message = dialog.message(); void dialog.dismiss(); });
  await remove.click();
  expect(message).toMatch(/delivery to Pi was never confirmed/);
  expect(message).toMatch(/does not cancel a send/);
  await expect.poll(() => removed.length).toBe(0);
});

test('mobile Execution nav spells out failed and waiting counts with a matching accessible name', async ({ page }) => {
  await setup(page, { mobile: true, snapshotOverrides: { execution: executionState({ failedCount: 2, decisionCount: 1 }), activeRunId: 'run-A' } });
  await openSession(page, 'A');
  const nav = page.getByRole('navigation', { name: 'Session views' });
  const execution = nav.getByRole('button', { name: /Execution/ });
  await expect(execution).toContainText('2 failed');
  await expect(execution).toContainText('1 need input');
  const label = await execution.getAttribute('aria-label');
  expect(label).toContain('2 failed');
  expect(label).toContain('1 need input');
  expect(label).not.toContain('!');
  expect(label).not.toContain('?');
  // Short labels keep the bar within the viewport.
  await expect(nav).toBeInViewport();
});

test('Japanese keeps the same controls: send/stop/queue labels, queue actions and the held-removal warning', async ({ page }) => {
  const removed = await setup(page, { language: 'ja', snapshotOverrides: { queue: [queuedItem({ status: 'held', error: 'interrupted' })], queueHeld: true } });
  await openSession(page, 'B');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('button', { name: 'キュー', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await expect(page.getByLabel('メッセージの配信方法')).toBeVisible();
  await expect(page.getByRole('button', { name: 'キューを再開' })).toBeVisible();
  const remove = page.getByRole('button', { name: 'キュー項目 1 を削除' });
  let message = '';
  page.once('dialog', dialog => { message = dialog.message(); void dialog.dismiss(); });
  await remove.click();
  expect(message).toContain('配信は未確認');
  expect(message).toContain('取り消せません');
  await expect.poll(() => removed.length).toBe(0);
});

test('English remains the default wording for the same controls', async ({ page }) => {
  await setup(page);
  await openSession(page, 'B');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Queue', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(page.getByLabel('Message delivery')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach files' })).toBeVisible();
});

test('Japanese send and immediate steering remain available, including a narrow mobile status bar', async ({ page }) => {
  await setup(page, { language: 'ja', mobile: true, snapshotOverrides: { execution: executionState({ failedCount: 2, decisionCount: 1 }) } });
  await page.setViewportSize({ width: 320, height: 844 });
  await openSession(page, 'A');
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Session views' });
  await expect(nav.getByRole('button', { name: /実行.*2件 失敗.*1件 応答待ち/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const send = await page.getByRole('button', { name: '送信', exact: true }).boundingBox();
  const bar = await nav.boundingBox();
  expect(send!.y + send!.height).toBeLessThanOrEqual(bar!.y + 1);
  await page.getByRole('button', { name: 'Switch session' }).first().click();
  await openSession(page, 'B');
  await page.getByLabel('メッセージの配信方法').selectOption('steer');
  await expect(page.getByRole('button', { name: '今すぐ指示', exact: true })).toBeVisible();
  await expect(page.locator('#composer-send-hint')).toContainText('即時指示');
});

test('the document opts into dark native control rendering', async ({ page }) => {
  await setup(page);
  await openSession(page, 'A');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
});
