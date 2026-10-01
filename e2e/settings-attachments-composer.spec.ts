import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Fully mocked API + inert SSE: no real Pi process, no model calls.
// Covers: single-click Settings back on desktop, attachment bubbles showing
// filename/kind instead of raw bodies, and the compact composer layout.
const shots = join(process.cwd(), 'test-results', 'settings-attachments-composer');

const ws = { id: 'w1', name: 'demo', path: 'C:/demo', pinned: true, lastOpenedAt: '1', valid: true };
const session = { id: 's1', workspaceId: 'w1', filePath: '/s1.jsonl', name: 'Chat A', updatedAt: '1' };
const emptyExec = { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 };
const attachedChat = [
  { id: 'u1', role: 'user', text: 'Please review', complete: true,
    attachments: [
      { name: 'spec.md', kind: 'text', mimeType: 'text/plain', bytes: 9, preview: 'SECRET_SPEC_BODY' },
      { name: 'shot.png', kind: 'image', mimeType: 'image/png', bytes: 2048 },
    ] },
  { id: 'a1', role: 'assistant', text: 'Looks good.', complete: true },
];
const snap = (chat: unknown[] = attachedChat) => ({
  session, runtime: 'running', activeRunId: undefined, chat,
  events: [], execution: emptyExec, seq: 1, generation: 'g1',
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as any).EventSource = class { close() {} addEventListener() {} }; });
  await page.route('**/api/workspaces', route => route.request().method() === 'POST'
    ? route.fulfill({ json: { workspace: ws } }) : route.fulfill({ json: { workspaces: [ws] } }));
  await page.route('**/api/workspaces/update', route => route.fulfill({ json: { workspace: ws } }));
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session] } }));
  await page.route('**/api/sessions', route => route.fulfill({ json: { session } }));
  await page.route('**/api/activity', route => route.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/quick-prompts', route => route.fulfill({ json: { prompts: ['続きを実装して', 'テストして', '原因を調べて'] } }));
  await page.route('**/api/orchestrator*', route => route.fulfill({ json: { available: false } }));
  await page.route('**/api/session/options*', route => route.fulfill({ json: { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] } }));
  await page.route('**/api/session-retention', route => route.fulfill({ json: { enabled: false, days: 30 } }));
  await page.route('**/api/startup', route => route.fulfill({ json: { supported: false, enabled: false, installed: false } }));
  await page.route('**/api/pets', route => route.fulfill({ json: { pets: [] } }));
  await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: snap() } }));
  await page.route('**/api/state?*', route => route.fulfill({ json: snap() }));
  await page.route('**/api/events?*', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': hold\n\n' }));
});

async function openChat(page: import('@playwright/test').Page) {
  await page.goto('/');
  const mobile = (page.viewportSize()?.width ?? 1280) <= 900;
  if (mobile) await page.locator('.workspace-card').first().click();
  else await page.getByLabel('Workspace', { exact: true }).selectOption('w1');
  await page.getByLabel('Session list').getByRole('button').first().click();
  await expect(page.getByLabel('Chat output')).toContainText('Looks good.');
}

test('desktop settings returns to the chat in one click and attachments stay compact', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChat(page);
  // Attachment bodies are not expanded in the bubble; metadata is shown instead.
  const userBubble = page.locator('.message[data-role="user"]');
  await expect(userBubble).toContainText('Please review');
  await expect(userBubble).toContainText('spec.md');
  await expect(userBubble).toContainText('shot.png');
  await expect(userBubble.getByText('SECRET_SPEC_BODY')).toBeHidden();
  await userBubble.getByText('Show attached text').click();
  await expect(userBubble.getByText('SECRET_SPEC_BODY')).toBeVisible();
  // Suggested prompts are collapsed by default, the textarea stays wide.
  await expect(page.getByRole('button', { name: 'Continue implementing' })).toBeHidden();
  await page.locator('.quick-details > summary').click();
  await expect(page.getByRole('button', { name: 'Continue implementing' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue implementing' }).click();
  const prompt = page.getByRole('textbox', { name: 'Prompt' });
  await expect(prompt).toHaveValue('Continue implementing');
  await prompt.fill('');
  const promptBox = (await prompt.boundingBox())!;
  const dockBox = (await page.locator('.composer-dock').boundingBox())!;
  expect(promptBox.width).toBeGreaterThanOrEqual(dockBox.width * 0.8, 'prompt should span most of the dock width');
  expect(promptBox.height).toBeGreaterThanOrEqual(85, 'desktop prompt keeps a generous min height');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  // Settings: section click keeps both panes; Back leaves settings in one click.
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
  await expect(page.getByLabel('Color palette')).toBeVisible();
  await page.screenshot({ path: join(shots, 'settings-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByLabel('Chat output')).toBeVisible();
  await page.screenshot({ path: join(shots, 'composer-desktop.png'), fullPage: true });
});

test('mobile keeps menu → section → back hierarchy and composer fits narrow viewports', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 390, height: 780 });
  await openChat(page);
  const userBubble = page.locator('.message[data-role="user"]');
  await expect(userBubble).toContainText('spec.md');
  await expect(userBubble.getByText('SECRET_SPEC_BODY')).toBeHidden();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Language' }).click();
  await expect(page.getByLabel('Display language')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeHidden();
  await page.screenshot({ path: join(shots, 'settings-mobile-detail.png'), fullPage: true });
  await page.getByRole('button', { name: '← Settings' }).click();
  await expect(page.getByRole('button', { name: 'Appearance' })).toBeVisible();
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByLabel('Chat output')).toBeVisible();
  // Composer: attach button and prompt fit at 320px with no horizontal overflow.
  await page.setViewportSize({ width: 320, height: 568 });
  const prompt = page.getByRole('textbox', { name: 'Prompt' });
  await expect(page.getByRole('button', { name: 'Attach files' })).toBeVisible();
  const promptBox = (await prompt.boundingBox())!;
  const dockBox = (await page.locator('.composer-dock').boundingBox())!;
  expect(promptBox.x).toBeGreaterThanOrEqual(0);
  expect(promptBox.width).toBeGreaterThanOrEqual(dockBox.width * 0.8, 'mobile prompt keeps most of the dock width');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.getByLabel('Choose files').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello file') });
  await expect(page.getByLabel('Attached files')).toContainText('note.txt');
  await page.screenshot({ path: join(shots, 'composer-mobile-320.png'), fullPage: true });
  // Short landscape: prompt still spans most of the width.
  await page.setViewportSize({ width: 844, height: 390 });
  const wideBox = (await prompt.boundingBox())!;
  expect(wideBox.width).toBeGreaterThanOrEqual(240);
  expect(wideBox.width).toBeGreaterThanOrEqual((await page.locator('.composer-dock').boundingBox())!.width * 0.75);
  await page.screenshot({ path: join(shots, 'composer-landscape.png'), fullPage: true });
});

test('desktop settings restores the workspace in one click, including after resize', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/view-workspaces/);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Language' }).click();
  await expect(page.getByRole('button', { name: '← Settings' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/view-workspaces/);
});

test('sending attachments posts metadata and keeps typed tags intact', async ({ page }) => {
  const sent: { message?: string; attachments?: unknown[] }[] = [];
  await page.route('**/api/prompt', route => { sent.push(route.request().postDataJSON()); return route.fulfill({ json: { runId: 'r1' } }); });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChat(page);
  await page.getByLabel('Choose files').setInputFiles([
    { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('file body') },
    { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('second') },
  ]);
  await expect(page.getByLabel('Attached files')).toContainText('b.txt');
  await page.getByRole('button', { name: 'Remove a.txt' }).click();
  await expect(page.getByLabel('Attached files')).not.toContainText('a.txt');
  await page.getByRole('textbox', { name: 'Prompt' }).fill('Check <attached_file name="mine"> literal');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].message).toBe('Check <attached_file name="mine"> literal');
  expect(sent[0].attachments).toHaveLength(1);
  await expect(page.getByLabel('Attached files')).toHaveCount(0);
});
