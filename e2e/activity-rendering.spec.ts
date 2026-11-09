import { test, expect, type Page } from '@playwright/test';
import type { ActiveSessionSummary } from '../shared/types.ts';

// All API traffic is mocked, including resume and SSE: no SDK/model/user data.
// Count real card work instead of asserting unstable wall-clock timings.
test.use({ serviceWorkers: 'block' });
const at = '2026-10-28T00:00:00.000Z';
const notifications = (): ActiveSessionSummary[] => Array.from({ length: 100 }, (_, i) => ({
  workspaceId: 'w', workspaceName: 'Fixture workspace', sessionId: `s${i}`, sessionName: `Notification ${i}`,
  running: false, decisionCount: 0, updatedAt: at, work: [],
  completion: { id: `completion-${i}`, status: 'completed', scope: 'conversation', at },
}));

async function fixture(page: Page, withWorkspace = false) {
  let sessions = notifications(), activityReads = 0;
  let activityResponse: 'ok' | 'error' | 'malformed' = 'ok';
  const resumed: string[] = [];
  const workspace = { id: 'w', name: 'Fixture workspace', path: 'C:/fixture', valid: true, pinned: false, lastOpenedAt: at };
  const session = (id: string) => ({ id, workspaceId: 'w', filePath: `C:/fixture/${id}.jsonl`, name: `Notification ${id.slice(1)}` });
  const snapshot = (id: string) => ({ session: session(id), runtime: 'stopped', generation: 'fixture', seq: 0, events: [],
    execution: { nodes: [], rows: [], roots: [], unattached: [], activeCount: 0, failedCount: 0, decisionCount: 0 },
    chat: [{ id: 'history', role: 'assistant', complete: true, text: `History ${id}` }],
  });
  await page.addInitScript(() => {
    (window as any).__activityFormats = 0;
    const original = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function (...args) {
      (window as any).__activityFormats++;
      return original.apply(this, args);
    };
    (window as any).EventSource = class {
      onopen?: () => void;
      constructor() { queueMicrotask(() => this.onopen?.()); }
      addEventListener() {}
      close() {}
    };
  });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let body: unknown = {};
    if (path === '/api/activity') {
      activityReads++;
      if (activityResponse === 'error') { await route.fulfill({ status: 503, json: { error: 'temporary failure' } }); return; }
      body = activityResponse === 'malformed' ? { error: 'invalid snapshot' } : { sessions };
    }
    else if (path === '/api/workspaces') body = { workspaces: withWorkspace ? [workspace] : [] };
    else if (path === '/api/workspaces/open') body = { workspace };
    else if (path === '/api/sessions') body = { sessions: ['s0', 's1', 's99'].map(session) };
    else if (path === '/api/resume') { const id = request.postDataJSON().sessionId; resumed.push(id); body = { snapshot: snapshot(id) }; }
    else if (path === '/api/state') body = snapshot(url.searchParams.get('sessionId') ?? 's0');
    else if (path === '/api/session/options') body = { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] };
    else if (path === '/api/quick-prompts') body = { prompts: [] };
    else if (path === '/api/orchestrator' || path === '/api/orchestrator/decisions') body = { available: false };
    else if (path === '/api/pets') body = { pets: [] };
    else if (path === '/api/voice/status') body = { enabled: false, available: false, phase: 'off' };
    await route.fulfill({ json: body });
  });
  return { reads: () => activityReads, update: (next: ActiveSessionSummary[]) => { sessions = next; }, response: (next: typeof activityResponse) => { activityResponse = next; }, resumed };
}
const formats = (page: Page) => page.evaluate(() => (window as any).__activityFormats as number);
const resetFormats = (page: Page) => page.evaluate(() => { (window as any).__activityFormats = 0; });

test('100 notifications stay lazy, page fully, and skip equal polls and unrelated input', async ({ page }) => {
  await page.clock.install();
  const mock = await fixture(page);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  const inbox = page.getByRole('region', { name: 'Activity notifications' });
  await expect(inbox).toContainText('100 finished');
  await expect(inbox.locator('.activity-card')).toHaveCount(0);
  await resetFormats(page);
  await page.getByRole('textbox', { name: 'Find workspace', exact: true }).fill('unrelated input');
  await page.clock.runFor(50);
  expect(await formats(page)).toBe(0);

  const readsBeforeOpen = mock.reads();
  await inbox.locator('summary').click();
  await expect(inbox.locator('.activity-card')).toHaveCount(20);
  expect(mock.reads()).toBe(readsBeforeOpen); // Opening never fetches/resumes.
  await resetFormats(page);
  await page.getByRole('textbox', { name: 'Find workspace', exact: true }).fill('another input');
  await page.clock.runFor(50);
  expect(await formats(page)).toBe(0);

  const reads = mock.reads();
  await page.clock.fastForward(5100);
  await expect.poll(mock.reads).toBeGreaterThan(reads);
  await page.clock.runFor(50);
  expect(await formats(page)).toBe(0);
  // New event timestamps alone must not force unchanged cards to render.
  mock.update(notifications().map(item => ({ ...item, updatedAt: '2026-10-28T00:01:00.000Z' })));
  await page.clock.fastForward(5100);
  await page.clock.runFor(50);
  expect(await formats(page)).toBe(0);

  const changed = notifications();
  changed[0] = { ...changed[0], sessionName: 'Changed notification', completion: { ...changed[0].completion!, status: 'failed' } };
  mock.update(changed);
  await page.clock.fastForward(5100);
  await expect(inbox.locator('.activity-card').first()).toContainText('Changed notification');
  await expect(inbox.locator('.activity-card').first()).toContainText('Conversation failed');
  expect(await formats(page)).toBe(1); // Only the changed card does formatting.

  for (const count of [40, 60, 80, 100]) {
    await inbox.locator('.activity-show-more').click();
    await expect(inbox.locator('.activity-card')).toHaveCount(count);
  }
  await expect(inbox.getByText('Notification 99', { exact: true })).toBeVisible();
  await expect(inbox.locator('.activity-show-more')).toHaveCount(0);
  await inbox.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(inbox.locator('.activity-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Active session alerts' }).click();
  await expect(inbox.locator('.activity-card')).toHaveCount(20);
  expect(mock.resumed).toEqual([]);
});

test('paged notifications retain navigation, current-session state, dismissal and overlay layout', async ({ page }) => {
  const mock = await fixture(page, true);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  const inbox = page.getByRole('region', { name: 'Activity notifications' });
  await page.getByRole('button', { name: 'Active session alerts' }).click();
  await expect(inbox.locator('.activity-card')).toHaveCount(20);
  await inbox.locator('.activity-card').first().locator('button').first().click();
  await expect(page.getByLabel('Chat output')).toContainText('History s0');
  await expect(inbox.locator('.activity-card')).toHaveCount(0);
  await inbox.locator('summary').click();
  await expect(inbox.locator('.activity-card.is-current > button').first()).toHaveAttribute('aria-current', 'page');
  await inbox.getByRole('button', { name: 'Dismiss Notification 1 completion', exact: true }).click();
  await expect(inbox.getByText('Notification 1', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Chat output')).toContainText('History s0');
  await expect(inbox).toContainText('99 finished');
  for (const count of [40, 60, 80, 99]) {
    await inbox.locator('.activity-show-more').click();
    await expect(inbox.locator('.activity-card')).toHaveCount(count);
  }
  await inbox.locator('.activity-card').filter({ has: page.getByText('Notification 99', { exact: true }) }).locator('button').first().click();
  await expect(page.getByLabel('Chat output')).toContainText('History s99');
  await expect(inbox.locator('.activity-card')).toHaveCount(0);
  expect(mock.resumed).toContain('s99');

  await page.setViewportSize({ width: 1280, height: 800 });
  const before = await page.locator('.chat-panel').boundingBox();
  await inbox.locator('summary').click();
  await expect(inbox.locator('.activity-card')).toHaveCount(20);
  const after = await page.locator('.chat-panel').boundingBox();
  expect(after!.height).toBeCloseTo(before!.height, 0);
  expect(after!.y).toBeCloseTo(before!.y, 0);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await page.reload();
  await expect(inbox).toContainText('99 finished');
  await inbox.locator('summary').click();
  await expect(inbox.getByText('Notification 1', { exact: true })).toHaveCount(0);
});

test('unread notifications survive failed or malformed polls and disappear only after dismissal or a valid update', async ({ page }) => {
  await page.clock.install();
  const mock = await fixture(page);
  mock.update(notifications().slice(0, 2));
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  const inbox = page.getByRole('region', { name: 'Activity notifications' });
  await inbox.locator('summary').click();
  await expect(inbox.locator('.activity-card')).toHaveCount(2);
  for (const failure of ['error', 'malformed'] as const) {
    mock.response(failure);
    const before = mock.reads();
    await page.clock.fastForward(16 * 60 * 1000);
    await expect.poll(mock.reads).toBeGreaterThan(before);
    await expect(inbox.locator('.activity-card')).toHaveCount(2);
    await expect(inbox.getByText('Notification 0', { exact: true })).toBeVisible();
  }
  mock.response('ok');
  await inbox.getByRole('button', { name: 'Dismiss Notification 0 completion', exact: true }).click();
  await expect(inbox.locator('.activity-card')).toHaveCount(1);
  await page.clock.fastForward(5100);
  await expect(inbox.getByText('Notification 0', { exact: true })).toHaveCount(0);
  mock.update([]);
  await page.clock.fastForward(5100);
  // A poll that removes every notification cannot unmount the open inbox
  // under the pointer: the last card's slot stays as an inert tombstone and
  // the section is released only when the user closes it.
  await expect(inbox.locator('.activity-card.is-removed')).toHaveCount(1);
  await inbox.locator('summary').click();
  await expect(inbox).toHaveCount(0);
});
