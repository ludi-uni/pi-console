import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fully mocked API + inert SSE: no real Pi, no provider calls.
// Covers the Attach overlay inside the textarea wrapper and the workspace
// Add/Manage disclosure separation.

const ws = { id: 'w1', name: 'demo-ws', path: 'C:/demo', pinned: false, lastOpenedAt: '1', valid: true };
const ws2 = { id: 'w2', name: 'other-ws', path: 'C:/other', pinned: false, lastOpenedAt: '2', valid: true };
const session = { id: 's1', workspaceId: 'w1', filePath: '/s1.jsonl', name: 'Chat A', updatedAt: '1' };
const emptyExec = { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 };
const snap = {
  session, runtime: 'running', activeRunId: undefined,
  chat: [{ id: 'a1', role: 'assistant', text: 'Ready.', complete: true }],
  events: [], execution: emptyExec, seq: 1, generation: 'g1',
};
const snapBusy = { ...snap, activeRunId: 'run-1', queue: [{ id: 'q1', message: 'first queued', revision: 0, queuedAt: '2026-01-01T00:00:00Z', status: 'pending', attachments: [{ name: 'note.txt', kind: 'text', mimeType: 'text/plain' }] }] };
let busyQueue = false;

test.beforeEach(async ({ page }) => {
  busyQueue = false;
  await page.addInitScript(() => { (window as any).EventSource = class { close() {} addEventListener() {} }; });
  await page.route('**/api/workspaces', route => route.request().method() === 'POST'
    ? route.fulfill({ json: { workspace: ws2 } }) : route.fulfill({ json: { workspaces: [ws, ws2] } }));
  await page.route('**/api/workspaces/update', route => route.fulfill({ json: { workspace: { ...ws, name: route.request().postDataJSON().name ?? ws.name } } }));
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session] } }));
  await page.route('**/api/sessions', route => route.fulfill({ json: { session } }));
  await page.route('**/api/activity', route => route.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/quick-prompts', route => route.fulfill({ json: { prompts: [] } }));
  await page.route('**/api/orchestrator*', route => route.fulfill({ json: { available: false } }));
  await page.route('**/api/session/options*', route => route.fulfill({ json: { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] } }));
  await page.route('**/api/session-retention', route => route.fulfill({ json: { enabled: false, days: 30 } }));
  await page.route('**/api/startup', route => route.fulfill({ json: { supported: false, enabled: false, installed: false } }));
  await page.route('**/api/pets', route => route.fulfill({ json: { pets: [] } }));
  await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: busyQueue ? snapBusy : snap } }));
  await page.route('**/api/state?*', route => route.fulfill({ json: busyQueue ? snapBusy : snap }));
  await page.route('**/api/queue/*', route => { const b = route.request().postDataJSON(); return route.fulfill({ json: route.request().url().endsWith('/edit') ? { item: { id: b.id, message: b.text, revision: b.revision + 1, queuedAt: '2026-01-01T00:00:00Z', status: 'pending' } } : { ok: true } }); });
  await page.route('**/api/events?*', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': hold\n\n' }));
});

async function openChat(page: import('@playwright/test').Page) {
  await page.goto('/');
  const mobile = (page.viewportSize()?.width ?? 1280) <= 900;
  if (mobile) await page.locator('.workspace-card').first().click();
  else await page.getByLabel('Workspace', { exact: true }).selectOption('w1');
  await page.getByLabel('Session list').getByRole('button').first().click();
  await expect(page.getByLabel('Chat output')).toContainText('Ready.');
}

test('Attach overlays the composer bottom-left and does not cover caret or text', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChat(page);
  const attach = page.getByRole('button', { name: 'Attach files' });
  const prompt = page.getByRole('textbox', { name: 'Prompt' });
  await expect(attach).toBeVisible();
  // No separate attachment-tools row under the textarea: the button lives inside the
  // relative composer-input wrapper, bottom-left.
  const a = (await attach.boundingBox())!, p = (await prompt.boundingBox())!;
  expect(a.x).toBeGreaterThanOrEqual(p.x);
  expect(a.y + a.height).toBeLessThanOrEqual(p.y + p.height);
  expect(a.y).toBeGreaterThan(p.y + p.height - 60);
  // Typing near the bottom-left never collides: caret lands on padded text area.
  await prompt.fill('line one\nline two\nline three\nline four\nline five');
  const hit = await prompt.evaluate(el => {
    const b = el.getBoundingClientRect();
    return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === el;
  });
  expect(hit).toBe(true);
  // Attach is disabled without breaking layout when no session... (session open here, so enabled)
  await expect(attach).toBeEnabled();
  // File picker still works through the label-wired hidden input.
  await page.getByLabel('Choose files').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(page.getByLabel('Attached files')).toContainText('note.txt');
});

test('attach overlay stays usable on 390px mobile and 844x390 landscape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await openChat(page);
  const prompt = page.getByRole('textbox', { name: 'Prompt' });
  const attach = page.getByRole('button', { name: 'Attach files' });
  await expect(attach).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(attach).toBeVisible();
  await expect(page.getByRole('button', { name: 'Model / Thinking' })).toBeVisible();
  const p = (await prompt.boundingBox())!;
  // Text and caret must not sit under the overlay buttons.
  expect(p.height).toBeGreaterThanOrEqual(60);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

test('mobile moves assistant Copy all to the right edge; desktop keeps it left', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await openChat(page);
  const copy = page.getByRole('button', { name: 'Copy all' });
  await expect(copy).toBeVisible();
  const bubble = page.locator('.message[data-role="assistant"] .message-bubble');
  const cb = (await copy.boundingBox())!, bb = (await bubble.boundingBox())!, article = (await page.locator('.message[data-role="assistant"]').boundingBox())!;
  // Right edge of the button sits at the right edge of the message row on mobile.
  expect(cb.x + cb.width).toBeGreaterThan(article.x + article.width / 2);
  expect(Math.abs(cb.x + cb.width - (article.x + article.width))).toBeLessThanOrEqual(14);
  // Left of the bubble, not pushed under it or off-screen; ~44px touch target.
  expect(cb.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  // Copy feedback must not push the button off screen even with a long label.
  await copy.click();
  const feedback = page.locator('.copy-feedback');
  if (await feedback.count()) {
    const fb = (await feedback.boundingBox())!;
    expect(fb.x + fb.width).toBeLessThanOrEqual(article.x + article.width + 1);
  }
  await page.screenshot({ path: 'test-results/mobile-composer-copy.png' });
  // Desktop: unchanged left placement.
  await page.setViewportSize({ width: 1280, height: 800 });
  const cb2 = (await copy.boundingBox())!, art2 = (await page.locator('.message[data-role="assistant"]').boundingBox())!;
  expect(cb2.x - art2.x).toBeLessThanOrEqual(14);
});

test('workspace screen separates Add from Manage and keeps the selected workspace visible under filter', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByLabel('Workspace', { exact: true }).selectOption('w1');
  await page.getByLabel('Session list').getByRole('button').first().click();
  // Desktop keeps the workspace sidebar visible while Chat is open.
  // Selected workspace stays in the select even when the query does not match it.
  await page.getByLabel('Filter workspaces').fill('zzz-no-match');
  await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue('w1');
  // Manage selected is a separate disclosure; Add workspace stays independent.
  const manage = page.getByRole('button', { name: 'Manage workspace' });
  await expect(manage).toBeVisible();
  await expect(page.getByLabel('Rename workspace')).toHaveCount(0);
  await manage.click();
  const rename = page.getByLabel('Rename workspace');
  await expect(rename).toBeVisible();
  await expect(rename).toHaveValue('demo-ws');
  // Empty/unchanged rename is disabled; change enables it.
  await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
  await rename.fill('renamed-demo');
  await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeEnabled();
  await rename.fill('   ');
  await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
  // Remove wording explains retention.
  await expect(page.getByRole('button', { name: 'Remove from Console' })).toBeVisible();
  await expect(page.locator('.workspace-management')).toContainText('stay on disk');
  await page.screenshot({ path: 'test-results/workspace-management.png' });
});

test('queued follow-ups list with edit draft, Save/Cancel and steer labelled not editable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  busyQueue = true;
  await openChat(page);
  // Queue list renders the pending item with attachment metadata.
  const item = page.locator('.queue-item');
  await expect(item).toContainText('first queued');
  await expect(item).toContainText('note.txt');
  // Steer mode is clearly labelled immediate + not editable.
  await expect(page.getByLabel('Message delivery').locator('option[value=steer]')).toContainText('cannot edit');
  // Edit → draft textarea; Cancel leaves the original.
  await page.getByRole('button', { name: 'Edit queued message 1' }).click();
  const draft = page.getByLabel('Edit queued message 1');
  await expect(draft).toHaveValue('first queued');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(item).toContainText('first queued');
  // Save posts the CAS revision.
  const edited = page.waitForRequest(r => r.url().endsWith('/api/queue/edit'));
  await page.getByRole('button', { name: 'Edit queued message 1' }).click();
  await page.getByLabel('Edit queued message 1').fill('revised text');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await edited).postDataJSON()).toMatchObject({ id: 'q1', revision: 0, text: 'revised text' });
  // Remove posts the item id.
  const removed = page.waitForRequest(r => r.url().endsWith('/api/queue/remove'));
  await page.getByRole('button', { name: 'Remove queued message 1' }).click();
  expect((await removed).postDataJSON()).toMatchObject({ id: 'q1' });
});

test('add-workspace disclosure toggles independently and Add & open is disabled while busy/empty', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const addToggle = page.locator('.workspace-add .add-toggle');
  await expect(addToggle).toBeVisible();
  await expect(page.getByLabel('Workspace path')).toBeVisible();
  await addToggle.click();
  await expect(page.getByLabel('Workspace path')).toHaveCount(0);
  await addToggle.click();
  const add = page.getByRole('button', { name: 'Add & open' });
  await expect(add).toBeDisabled();
  await page.getByLabel('Workspace path').fill('C:/demo');
  await expect(add).toBeEnabled();
});
