import { test, expect } from '@playwright/test';

// Fully mocked API + inert SSE: no real Pi, no provider calls.
// Covers the "Discard queued" paused-queue action: visibility in compact and
// desktop layouts, confirm-cancel sends nothing, confirm-accept POSTs
// /api/queue/clear (never /api/queue/resume), and the cleared projection after
// a reload — the mocked SSE stream never delivers QueueChanged.

const ws = { id: 'w1', name: 'demo-ws', path: 'C:/demo', pinned: false, lastOpenedAt: '1', valid: true };
const session = { id: 's1', workspaceId: 'w1', filePath: '/s1.jsonl', name: 'Chat A', updatedAt: '1' };
const emptyExec = { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 };
const base = {
  session, runtime: 'running', activeRunId: 'run-1',
  chat: [{ id: 'a1', role: 'assistant', text: 'Ready.', complete: true }],
  events: [], execution: emptyExec, seq: 1, generation: 'g1',
};
const heldItem = { id: 'q-held', message: 'held work item', revision: 0, queuedAt: '2026-01-01T00:00:00Z', status: 'held', error: 'delivery to Pi unconfirmed' };
const pendingItem = { id: 'q-pending', message: 'still pending', revision: 0, queuedAt: '2026-01-01T00:00:01Z', status: 'pending' };
const paused = { ...base, queueHeld: true, queue: [heldItem, pendingItem] };
const pausedEmpty = { ...base, queueHeld: true, queue: [] };
const cleared = { ...base, queueHeld: false, queue: [] };
let snapshot: typeof paused;
let clearPosts: Record<string, unknown>[];
let resumePosts = 0;

test.beforeEach(async ({ page }) => {
  snapshot = paused;
  clearPosts = [];
  resumePosts = 0;
  await page.addInitScript(() => { (window as any).EventSource = class { close() {} addEventListener() {} }; });
  await page.route('**/api/workspaces', route => route.fulfill({ json: { workspaces: [ws] } }));
  await page.route('**/api/workspaces/update', route => route.fulfill({ json: { workspace: ws } }));
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session] } }));
  await page.route('**/api/sessions', route => route.fulfill({ json: { session } }));
  await page.route('**/api/activity', route => route.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/quick-prompts', route => route.fulfill({ json: { prompts: [] } }));
  await page.route('**/api/orchestrator*', route => route.fulfill({ json: { available: false } }));
  await page.route('**/api/session/options*', route => route.fulfill({ json: { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] } }));
  await page.route('**/api/session-retention', route => route.fulfill({ json: { enabled: false, days: 30 } }));
  await page.route('**/api/startup', route => route.fulfill({ json: { supported: false, enabled: false, installed: false } }));
  await page.route('**/api/pets', route => route.fulfill({ json: { pets: [] } }));
  await page.route('**/api/resume', route => route.fulfill({ json: { snapshot } }));
  await page.route('**/api/state?*', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/queue/clear', route => { clearPosts.push(route.request().postDataJSON()); return route.fulfill({ json: { queue: [] } }); });
  await page.route('**/api/queue/resume', route => { resumePosts++; return route.fulfill({ json: { queue: [] } }); });
  await page.route('**/api/events?*', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': hold\n\n' }));
});

async function openChat(page: import('@playwright/test').Page) {
  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1280) <= 900) await page.locator('.workspace-card').filter({ hasText: ws.path }).click();
  else await page.getByLabel('Workspace', { exact: true }).selectOption('w1');
  await page.getByLabel('Session list').getByRole('button').first().click();
  await expect(page.getByLabel('Chat output')).toContainText('Ready.');
}

for (const [width, height, label] of [[1280, 800, 'desktop'], [390, 780, 'compact']] as const) {
  test(`paused nonempty queue shows Discard queued next to Resume (${label}); cancel sends nothing`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openChat(page);
    const notice = page.getByLabel('Queued follow-ups').locator('.queue-held-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/delivery (unconfirmed|to Pi was not confirmed)/);
    const resume = page.getByRole('button', { name: 'Resume queued', exact: true });
    const discard = page.getByRole('button', { name: 'Discard queued', exact: true });
    await expect(resume).toBeVisible();
    await expect(discard).toBeVisible();
    await expect(discard).toBeEnabled();
    // Cancelling the confirm must not reach the server at all.
    page.once('dialog', async dialog => { expect(dialog.message()).toContain('cannot be undone'); await dialog.dismiss(); });
    await discard.click();
    expect(clearPosts).toHaveLength(0);
    expect(resumePosts).toBe(0);
    await expect(discard).toBeEnabled();
  });

  test(`paused empty queue still shows Discard queued (${label}) so the pause can be lifted`, async ({ page }) => {
    snapshot = pausedEmpty;
    await page.setViewportSize({ width, height });
    await openChat(page);
    const discard = page.getByRole('button', { name: 'Discard queued', exact: true });
    await expect(page.getByRole('button', { name: 'Resume queued', exact: true })).toBeVisible();
    await expect(discard).toBeVisible();
    await expect(discard).toBeEnabled();
    page.once('dialog', dialog => dialog.accept());
    await discard.click();
    await expect.poll(() => clearPosts.length).toBe(1);
    expect(resumePosts).toBe(0);
  });
}

test('confirm accept POSTs /api/queue/clear — not resume — and reload projects an empty unpaused queue', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChat(page);
  await expect(page.getByLabel('Queued follow-ups')).toContainText('held work item');
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('held item may already have reached Pi'); await dialog.accept(); });
  await page.getByRole('button', { name: 'Discard queued', exact: true }).click();
  await expect.poll(() => clearPosts.length).toBe(1);
  expect(clearPosts[0]).toMatchObject({ workspaceId: 'w1', sessionId: 's1' });
  expect(resumePosts).toBe(0);
  // The inert SSE never projects the clear locally; a reload reflects the
  // server state (the app restores workspace+session from history.state).
  snapshot = cleared;
  await page.reload();
  await expect(page.getByLabel('Chat output')).toContainText('Ready.');
  await expect(page.getByLabel('Queued follow-ups')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Discard queued', exact: true })).toHaveCount(0);
});

test('dispatching item disables Discard queued without blocking Resume', async ({ page }) => {
  snapshot = { ...paused, queue: [pendingItem, { ...heldItem, id: 'q-out', status: 'dispatching', error: undefined }] };
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChat(page);
  await expect(page.getByRole('button', { name: 'Discard queued', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Resume queued', exact: true })).toBeEnabled();
});
