import { test, expect, type Route } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  if (mobile) await page.locator('.workspace-card').filter({ hasText: ws.path }).click();
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
  // The button stays inside the same visual field, but outside the textarea's
  // scroll viewport. Bottom padding alone does not protect scrolled text.
  const a = (await attach.boundingBox())!, p = (await prompt.boundingBox())!, input = (await page.locator('.composer-input').boundingBox())!;
  expect(a.x).toBeGreaterThanOrEqual(input.x);
  expect(a.y + a.height).toBeLessThanOrEqual(input.y + input.height);
  expect(a.y).toBeGreaterThan(input.y + input.height - 60);
  expect(p.y + p.height).toBeLessThanOrEqual(a.y);
  // Typing near the bottom-left never collides: text is clipped above the footer.
  await prompt.fill('line one\nline two\nline three\nline four\nline five');
  const hit = await prompt.evaluate(el => {
    const b = el.getBoundingClientRect();
    return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === el;
  });
  expect(hit).toBe(true);
  // Attach is disabled without breaking layout when no session... (session open here, so enabled)
  await expect(attach).toBeEnabled();
  // Clicking the button's icon must open the picker, not focus the prompt.
  const picker = page.waitForEvent('filechooser');
  await attach.locator('span').first().click();
  const chooser = await picker;
  await expect(prompt).not.toBeFocused();
  await chooser.setFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
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
  expect(p.height).toBeGreaterThanOrEqual(40);
  expect(p.y + p.height).toBeLessThanOrEqual((await attach.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

test('long text auto-scrolls above the Attach footer while typing and moving the caret', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChat(page);
  const prompt = page.getByRole('textbox', { name: 'Prompt' });
  await prompt.fill(Array.from({ length: 40 }, (_, i) => `テスト行 ${i + 1}`).join('\n'));
  for (const [width, height] of [[1280, 800], [390, 780], [844, 390], [390, 360], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await prompt.press('Control+End');
    await prompt.press('Shift+Enter');
    await prompt.pressSequentially('visible line');
    await expect.poll(() => prompt.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    const field = (await prompt.boundingBox())!, attach = (await page.getByRole('button', { name: 'Attach files' }).boundingBox())!;
    expect(field.y + field.height).toBeLessThanOrEqual(attach.y);
    const compact = page.getByRole('button', { name: 'Model / Thinking' });
    if (await compact.isVisible()) expect(field.y + field.height).toBeLessThanOrEqual((await compact.boundingBox())!.y);
    // The reserved footer remains an input hit area outside the actual buttons.
    const input = (await page.locator('.composer-input').boundingBox())!;
    const selection = await prompt.evaluate(el => el.selectionEnd);
    await page.getByRole('button', { name: 'Attach files' }).focus();
    await expect(prompt).not.toBeFocused();
    await page.mouse.click(input.x + input.width - 20, attach.y + attach.height / 2);
    await expect(prompt).toBeFocused();
    expect(await prompt.evaluate(el => el.selectionEnd)).toBe(selection);
    await page.keyboard.type(' clicked');
    await expect(prompt).toHaveValue(/visible line clicked$/);
    const caret = await prompt.evaluate(el => {
      const style = getComputedStyle(el), bounds = el.getBoundingClientRect();
      const line = el.value.slice(0, el.selectionEnd).split('\n').length - 1;
      const top = bounds.top + parseFloat(style.paddingTop) + line * parseFloat(style.lineHeight) - el.scrollTop;
      return { top, bottom: top + parseFloat(style.lineHeight), viewportTop: bounds.top, viewportBottom: bounds.bottom };
    });
    expect(caret.top).toBeGreaterThanOrEqual(caret.viewportTop);
    expect(caret.bottom).toBeLessThanOrEqual(caret.viewportBottom + 1);
    await page.locator('.composer-input').screenshot({ path: `test-results/composer-scroll-${width}x${height}.png` });
    await prompt.press('Control+Home');
    // Chromium can scroll away leading padding even at the first character.
    await expect.poll(() => prompt.evaluate(el => el.selectionStart)).toBe(0);
    expect(await prompt.evaluate(el => el.scrollTop < parseFloat(getComputedStyle(el).lineHeight))).toBe(true);
  }
});

test('resize handle operates at the visual field bottom-right, not above the footer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChat(page);
  const input = page.locator('.composer-input'), prompt = page.getByRole('textbox', { name: 'Prompt' });
  await prompt.fill('Resize test\nSecond line');
  for (const [width, height] of [[1280, 800], [390, 780], [844, 390]]) {
    await page.setViewportSize({ width, height });
    expect(await input.evaluate(el => getComputedStyle(el).resize)).toBe('vertical');
    expect(await prompt.evaluate(el => getComputedStyle(el).resize)).toBe('none');
    const before = (await input.boundingBox())!, textBefore = (await prompt.boundingBox())!;
    await page.mouse.move(before.x + before.width - 5, before.y + before.height - 5);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width - 5, before.y + before.height + 11, { steps: 5 });
    await page.mouse.up();
    const expanded = (await input.boundingBox())!, textExpanded = (await prompt.boundingBox())!;
    expect(expanded.height).toBeGreaterThan(before.height + 10);
    expect(expanded.width).toBe(before.width);
    expect(textExpanded.height - textBefore.height).toBeCloseTo(expanded.height - before.height, 0);
    const attach = (await page.getByRole('button', { name: 'Attach files' }).boundingBox())!;
    expect(textExpanded.y + textExpanded.height).toBeLessThanOrEqual(attach.y);
    await input.screenshot({ path: `test-results/composer-resize-${width}x${height}.png` });
    await page.mouse.move(expanded.x + expanded.width - 5, expanded.y + expanded.height - 5);
    await page.mouse.down();
    await page.mouse.move(expanded.x + expanded.width - 5, expanded.y + expanded.height - 17, { steps: 5 });
    await page.mouse.up();
    expect((await input.boundingBox())!.height).toBeLessThan(expanded.height - 5);
    // Clear the browser's inline resize height before checking another breakpoint.
    await input.evaluate(el => { el.style.height = ''; });
  }
});

async function draftSessions(page: import('@playwright/test').Page) {
  const sessionB = { ...session, id: 's2', filePath: '/s2.jsonl', name: 'Chat B' };
  await page.route('**/api/sessions?*', route => {
    const workspaceId = new URL(route.request().url()).searchParams.get('workspaceId') ?? 'w1';
    return route.fulfill({ json: { sessions: [session, sessionB].map(s => ({ ...s, workspaceId })) } });
  });
  const state = (workspaceId: string, sessionId: string) => ({ ...snap, session: { ...(sessionId === 's2' ? sessionB : session), workspaceId } });
  await page.route('**/api/resume', route => { const b = route.request().postDataJSON(); return route.fulfill({ json: { snapshot: state(b.workspaceId, b.sessionId) } }); });
  await page.route('**/api/state?*', route => { const u = new URL(route.request().url()); return route.fulfill({ json: state(u.searchParams.get('workspaceId')!, u.searchParams.get('sessionId')!) }); });
}
async function storedDraft(page: import('@playwright/test').Page, workspaceId = 'w1', sessionId = 's1') {
  return page.evaluate(async scope => new Promise<{ text: string; files: { name: string; size: number; type: string }[] } | null>((resolve, reject) => {
    const request = indexedDB.open('pi-console-composer-drafts-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('drafts', 'readonly'), read = transaction.objectStore('drafts').get(scope);
      transaction.oncomplete = () => { const d = read.result; db.close(); resolve(d ? { text: d.text, files: d.files.map((f: File) => ({ name: f.name, size: f.size, type: f.type })) } : null); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }), JSON.stringify([workspaceId, sessionId]));
}

test('composer drafts preserve full text and large attachments across scopes and reload, then clear only on ACK', async ({ page }) => {
  await draftSessions(page); await page.setViewportSize({ width: 1280, height: 800 });
  const posted: any[] = []; await page.route('**/api/prompt', route => { posted.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
  await openChat(page); const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  const text = '日本語の下書き\n添付も保持してください。', note = 'メモ\n全文を保持';
  const image = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'), Buffer.alloc(4 * 1024 * 1024)]);
  await prompt.fill(text);
  await page.locator('input[type=file]').setInputFiles([{ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from(note) }, { name: 'large.png', mimeType: 'image/png', buffer: image }]);
  await expect(page.getByLabel('Attached files')).toContainText('large.png');
  await expect.poll(() => storedDraft(page)).toEqual({ text, files: [{ name: 'note.txt', size: Buffer.byteLength(note), type: 'text/plain' }, { name: 'large.png', size: image.length, type: 'image/png' }] });
  await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).click(); await expect(prompt).toHaveValue('');
  await expect(page.getByLabel('Attached files')).toHaveCount(0); await prompt.fill('B only');
  await page.getByLabel('Workspace', { exact: true }).selectOption('w2'); await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click(); await expect(prompt).toHaveValue('');
  await prompt.fill('Other workspace only');
  await page.getByLabel('Workspace', { exact: true }).selectOption('w1'); await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click();
  await expect(prompt).toHaveValue(text); await expect(page.getByLabel('Attached files')).toContainText('large.png');
  await page.reload(); await expect(prompt).toHaveValue(text); await expect(page.getByLabel('Attached files')).toContainText('note.txt'); await expect(page.getByLabel('Attached files')).toContainText('large.png');
  expect(posted).toHaveLength(0); await page.screenshot({ path: 'test-results/composer-draft-restored.png' });
  await page.locator('.composer-actions .button-primary').click(); await expect(prompt).toHaveValue(''); await expect(page.getByLabel('Attached files')).toHaveCount(0);
  expect(posted).toHaveLength(1); expect(posted[0].message).toBe(text); expect(posted[0].attachments[0].text).toBe(note); expect(posted[0].attachments[1].data).toBe(image.toString('base64'));
  await expect.poll(() => storedDraft(page)).toBeNull(); await page.reload(); await expect(prompt).toHaveValue('');
  await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).click(); await expect(prompt).toHaveValue('B only');
});

for (const newer of [false, true]) test(`late composer ACK reconciles original scope and preserves newer input: ${newer}`, async ({ page }) => {
  await draftSessions(page); await page.setViewportSize({ width: 1280, height: 800 });
  let release: (() => void) | undefined; const response = new Promise<void>(resolve => { release = resolve; }); let received = false;
  await page.route('**/api/prompt', async route => { received = true; await response; await route.fulfill({ json: { ok: true } }); });
  await openChat(page); const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true }); await prompt.fill('submitted A');
  await page.locator('.composer-actions .button-primary').click(); await expect.poll(() => received).toBe(true);
  await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).click(); await prompt.fill('unsent B');
  if (newer) { await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click(); await prompt.fill('newer unsent A'); await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).click(); }
  release!(); await expect.poll(async () => (await storedDraft(page))?.text ?? '').toBe(newer ? 'newer unsent A' : '');
  await expect(prompt).toHaveValue('unsent B'); await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click(); await expect(prompt).toHaveValue(newer ? 'newer unsent A' : '');
});

async function mockSpeech(page: import('@playwright/test').Page, prefixed = false) {
  await page.addInitScript(prefixed => {
    const w = window as any; w.__speechStarts = 0; w.__speechStops = 0; w.__speechAborts = 0;
    class Recognition {
      onstart: any; onend: any; onresult: any; onerror: any; lang = ''; continuous = false; interimResults = false;
      constructor() { w.__recognition = this; }
      start() { w.__speechStarts++; this.onstart?.(); }
      stop() { w.__speechStops++; this.onend?.(); }
      abort() { w.__speechAborts++; }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: prefixed ? undefined : Recognition });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: prefixed ? Recognition : undefined });
  }, prefixed);
}
async function startVoice(page: import('@playwright/test').Page) {
  await page.locator('.voice-button').click();
  await page.getByRole('dialog').getByRole('combobox').selectOption('ja-JP');
  await page.getByRole('dialog').getByRole('button', { name: /^(開始|Start listening)$/ }).click();
  expect(await page.evaluate(() => (window as any).__recognition.lang)).toBe('ja-JP');
}

for (const prefixed of [false, true]) test(`voice recognition previews finals without duplicate insertion or automatic send: prefixed=${prefixed}`, async ({ page }) => {
  await mockSpeech(page, prefixed); await page.setViewportSize({ width: 390, height: 780 });
  let posts = 0; await page.route('**/api/prompt', r => { posts++; return r.fulfill({ json: { ok: true } }); });
  await openChat(page); const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true }); await prompt.fill('before after');
  await prompt.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(7, 12)); await startVoice(page);
  const insert = page.getByRole('dialog').getByRole('button', { name: /入力欄へ挿入|Insert into prompt/ });
  await page.evaluate(() => { const r = (window as any).__recognition; r.onresult({ results: [{ isFinal: true, 0: { transcript: 'こんにちは' } }, { isFinal: false, 0: { transcript: '世' } }] }); });
  await expect(insert).toBeDisabled(); await expect(prompt).toHaveValue('before after');
  await page.evaluate(() => { const r = (window as any).__recognition; const results = [{ isFinal: true, 0: { transcript: 'こんにちは' } }, { isFinal: true, 0: { transcript: '世界' } }]; r.onresult({ results }); r.onresult({ results }); });
  await expect(page.locator('.voice-transcript')).toHaveText('こんにちは世界');
  await page.screenshot({ path: `test-results/voice-listening-${prefixed}.png` });
  await page.getByRole('dialog').getByRole('button', { name: /^(停止|Stop listening)$/ }).click(); await expect(insert).toBeEnabled(); await insert.click();
  await expect(prompt).toHaveValue('before こんにちは世界after'); expect(posts).toBe(0);
  await expect(prompt).toBeFocused(); expect(await prompt.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(14);
  await expect.poll(async () => (await storedDraft(page))?.text).toBe('before こんにちは世界after');
  await page.reload(); await expect(prompt).toHaveValue('before こんにちは世界after');
});

test('voice cancel and navigation abort reject late results from retired recognition', async ({ page }) => {
  await mockSpeech(page); await draftSessions(page); await page.setViewportSize({ width: 1280, height: 800 }); await openChat(page);
  await startVoice(page);
  await page.evaluate(() => { const w = window as any; w.__lateResult = w.__recognition.onresult; w.__lateEnd = w.__recognition.onend; });
  await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => { const w = window as any; w.__lateResult({ results: [{ isFinal: true, 0: { transcript: 'must not leak' } }] }); w.__lateEnd(); });
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true }); await prompt.fill('B protected'); await startVoice(page);
  await page.evaluate(() => (window as any).__recognition.onresult({ results: [{ isFinal: true, 0: { transcript: 'discarded' } }] }));
  await page.getByRole('dialog').getByRole('button', { name: /^(キャンセル|Cancel)$/ }).click(); await expect(prompt).toHaveValue('B protected');
  expect(await page.evaluate(() => (window as any).__speechAborts)).toBe(2);
});

test('voice handles permission rejection and unsupported browsers without changing the draft', async ({ page }) => {
  await mockSpeech(page); await page.setViewportSize({ width: 1280, height: 800 }); await openChat(page); await startVoice(page);
  await page.evaluate(() => (window as any).__recognition.onerror({ error: 'not-allowed' }));
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/拒否|denied/);
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('');
  await page.getByRole('dialog').getByRole('button', { name: /^(キャンセル|Cancel)$/ }).click();
  await page.evaluate(() => { Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true }); Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true }); });
  await page.locator('.voice-button').click(); await expect(page.getByRole('dialog')).toContainText(/キーボード|keyboard/);
  await expect(page.getByRole('dialog').getByRole('button', { name: /^(開始|Start listening)$/ })).toBeDisabled();
});

test('voice automatically stops at sixty seconds and keeps only confirmed text', async ({ page }) => {
  await mockSpeech(page); await page.setViewportSize({ width: 844, height: 390 }); await openChat(page); await page.clock.install(); await startVoice(page);
  await page.evaluate(() => (window as any).__recognition.onresult({ results: [{ isFinal: true, 0: { transcript: 'confirmed' } }, { isFinal: false, 0: { transcript: 'unfinished' } }] }));
  await page.clock.fastForward(60000); expect(await page.evaluate(() => (window as any).__speechStops)).toBe(1);
  await expect(page.locator('.voice-transcript')).toHaveText('confirmed');
  await expect(page.getByRole('dialog').getByRole('button', { name: /入力欄へ挿入|Insert into prompt/ })).toBeEnabled();
  await page.screenshot({ path: 'test-results/voice-stopped-short.png' });
});

test('voice stop timeout retires callbacks and retains confirmed text; pagehide aborts', async ({ page }) => {
  await mockSpeech(page); await page.setViewportSize({ width: 1280, height: 800 }); await openChat(page); await page.clock.install(); await startVoice(page);
  await page.evaluate(() => { const w = window as any, r = w.__recognition; w.__lateResult = r.onresult; r.stop = () => { w.__speechStops++; }; r.onresult({ results: [{ isFinal: true, 0: { transcript: 'keep final' } }] }); });
  await page.getByRole('dialog').getByRole('button', { name: /^(停止|Stop listening)$/ }).click(); await page.clock.fastForward(3000);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/確認できません|did not confirm/);
  await page.evaluate(() => (window as any).__lateResult({ results: [{ isFinal: true, 0: { transcript: 'stale replacement' } }] }));
  await expect(page.locator('.voice-transcript')).toHaveText('keep final');
  await page.getByRole('dialog').getByRole('button', { name: /^(再録音|Record again)$/ }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(await page.evaluate(() => (window as any).__speechAborts)).toBe(2);
});

test('voice dialog traps keyboard focus, Escape cancels, and short-screen footer controls do not overlap', async ({ page }) => {
  await mockSpeech(page); await page.setViewportSize({ width: 390, height: 360 }); await openChat(page);
  for (const selector of ['.attach-button', '.voice-button', '.compact-controls-trigger']) {
    const button = page.locator(selector);
    expect(await button.evaluate(el => { const b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return hit === el || el.contains(hit); })).toBe(true);
  }
  await startVoice(page); await page.getByRole('dialog').getByRole('button', { name: /音声入力を閉じる|Close voice input/ }).focus();
  await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('dialog').getByRole('button', { name: /^(キャンセル|Cancel)$/ })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('dialog').getByRole('button', { name: /音声入力を閉じる|Close voice input/ })).toBeFocused();
  await page.screenshot({ path: 'test-results/voice-dialog-mobile-short.png' });
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.voice-button')).toBeFocused();
});

test('desktop hint matches Enter, Shift+Enter, Ctrl+Enter and IME behavior', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); const posted: any[] = [];
  await page.route('**/api/prompt', route => { posted.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
  await openChat(page); const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await expect(page.locator('#composer-send-hint')).toContainText('Enter to send');
  await prompt.fill('first'); await prompt.press('Shift+Enter'); await expect(prompt).toHaveValue('first\n'); expect(posted).toHaveLength(0);
  await prompt.dispatchEvent('keydown', { key: 'Enter', isComposing: true }); expect(posted).toHaveLength(0);
  await prompt.press('Enter'); await expect(prompt).toHaveValue(''); expect(posted).toHaveLength(1);
  await prompt.fill('second'); await prompt.press('Control+Enter'); await expect(prompt).toHaveValue(''); expect(posted).toHaveLength(2);
});

test.describe('touch composer', () => {
  test.use({ hasTouch: true });
  test('touch hint matches newline and explicit send, with Ctrl/Meta+Enter still supported', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 }); const posted: any[] = [];
    await page.route('**/api/prompt', route => { posted.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
    await openChat(page); const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
    await expect(page.locator('#composer-send-hint')).toContainText('Enter for a line break');
    await expect(page.locator('#composer-send-hint')).toContainText('tap Send');
    await prompt.fill('mobile first'); await prompt.press('Enter'); await expect(prompt).toHaveValue('mobile first\n'); expect(posted).toHaveLength(0);
    await page.screenshot({ path: 'test-results/composer-touch-hint.png' });
    await page.locator('.composer-actions .button-primary').tap(); await expect(prompt).toHaveValue(''); expect(posted).toHaveLength(1);
    for (const shortcut of ['Control+Enter', 'Meta+Enter']) { await prompt.fill(shortcut); await prompt.press(shortcut); await expect(prompt).toHaveValue(''); }
    expect(posted).toHaveLength(3);
  });
});

test('draft quota failures warn and guard unload without deleting input, and recover after storage works', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__draftPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = () => { throw new DOMException('quota exhausted', 'QuotaExceededError'); }; });
  await page.setViewportSize({ width: 1280, height: 800 }); await openChat(page); const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.fill('keep unsaved draft'); await expect(page.getByRole('alert')).toContainText('Draft could not be saved'); await expect(prompt).toHaveValue('keep unsaved draft');
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as any).__draftPut; });
  await prompt.fill('recovered full draft'); await expect.poll(async () => (await storedDraft(page))?.text).toBe('recovered full draft'); await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
});

test('sixteen queued items scroll independently without hiding prompt, Queue or Stop', async ({ page }) => {
  const longQueue = { ...snapBusy, queue: Array.from({ length: 16 }, (_, i) => ({ ...snapBusy.queue[0], id: `many-${i}`, message: `Queued request ${i + 1}: check implementation and report the result` })) };
  await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: longQueue } }));
  await page.route('**/api/state?*', route => route.fulfill({ json: longQueue }));
  await page.setViewportSize({ width: 1280, height: 800 }); await openChat(page);
  for (const [width, height] of [[1280, 800], [390, 780], [844, 390], [390, 360]]) {
    await page.setViewportSize({ width, height });
    const queue = page.getByLabel('Queued follow-ups');
    await expect(queue).toHaveAttribute('data-compact', String(width <= 900));
    if (width <= 900 && !await queue.locator('details').evaluate(el => (el as HTMLDetailsElement).open)) await queue.locator('summary').click();
    expect(await queue.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    const prompt = (await page.locator('.composer-input').boundingBox())!, panel = (await page.locator('.chat-panel').boundingBox())!;
    expect(prompt.y + prompt.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('next instruction');
    for (const name of ['Queue', 'Stop']) {
      const actual = name === 'Queue' ? page.locator('.composer-actions .button-primary') : page.getByRole('button', { name: 'Stop', exact: true });
      const bounds = (await actual.boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
      expect(await actual.evaluate(el => { const b = el.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === el || el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })).toBe(true);
    }
    await queue.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(queue).toContainText('Queued request 16');
    await page.screenshot({ path: `test-results/queue-many-${width}x${height}.png` });
  }
});

for (const [width, height] of [[390, 780], [320, 568], [844, 390], [390, 360]]) {
  test(`compact queue defaults to a count and keeps warning, Resume, Prompt and Stop reachable: ${width}x${height}`, async ({ page }) => {
    const held = { ...snapBusy, queueHeld: true, queue: Array.from({ length: 16 }, (_, i) => ({ ...snapBusy.queue[0], id: `held-${i}`, status: i === 0 ? 'held' : 'pending', error: i === 0 ? 'delivery uncertain' : undefined })) };
    await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: held } }));
    await page.route('**/api/state?*', route => route.fulfill({ json: held }));
    let resumed = 0; await page.route('**/api/queue/resume', route => { resumed++; return route.fulfill({ json: { ok: true } }); });
    await page.setViewportSize({ width, height }); await openChat(page);
    const queue = page.getByLabel('Queued follow-ups'), summary = queue.locator('summary');
    await expect(summary).toHaveText('Queued · 16 ▾'); await expect(page.getByRole('button', { name: 'Edit queued message 2', exact: true })).not.toBeVisible();
    const resume = page.getByRole('button', { name: 'Resume queued', exact: true }); await expect(resume).toBeVisible();
    const warning = queue.locator('.queue-held-notice'); await expect(warning).toContainText('delivery unconfirmed');
    await summary.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('button', { name: 'Edit queued message 2', exact: true })).toBeVisible();
    await queue.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const panel = (await page.locator('.chat-panel').boundingBox())!;
    for (const button of [resume, page.getByRole('button', { name: 'Stop', exact: true })]) {
      const box = (await button.boundingBox())!; expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
      expect(await button.evaluate(el => { const b = el.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return hit === el || el.contains(hit); })).toBe(true);
    }
    await page.keyboard.press('Escape'); await expect(summary).toBeFocused(); await expect(queue.locator('details')).not.toHaveAttribute('open'); await expect(warning).toBeVisible();
    page.once('dialog', async dialog => { expect(dialog.message()).toContain('twice'); await dialog.dismiss(); }); await resume.click(); expect(resumed).toBe(0);
    page.once('dialog', dialog => dialog.accept()); await resume.click(); await expect.poll(() => resumed).toBe(1);
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Keep reading and sending');
    await expect(page.getByRole('button', { name: 'Queue', exact: true })).toBeEnabled(); await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  });
}
test('compact failed delivery warning remains visible even without queueHeld', async ({ page }) => {
  const failed = { ...snapBusy, queueHeld: false, queue: [{ ...snapBusy.queue[0], status: 'failed', error: 'delivery refused' }] };
  await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: failed } })); await page.route('**/api/state?*', route => route.fulfill({ json: failed }));
  await page.setViewportSize({ width: 390, height: 780 }); await openChat(page);
  await expect(page.getByLabel('Queued follow-ups').locator('.queue-held-notice')).toBeVisible(); await expect(page.getByLabel('Queued follow-ups')).toContainText('failed/unconfirmed delivery');
  await expect(page.getByRole('button', { name: 'Remove queued message 1', exact: true })).not.toBeVisible();
  await page.getByLabel('Queued follow-ups').locator('summary').click(); await expect(page.getByRole('button', { name: 'Remove queued message 1', exact: true })).toBeVisible();
});
test('queue editing survives rotation and scope changes; Queue and Steer now describe different delivery', async ({ page }) => {
  const sessionB = { ...session, id: 's2', name: 'Chat B' };
  const snapshotFor = (id: string) => ({ ...snapBusy, session: id === 's2' ? sessionB : session, queue: id === 's2' ? [{ ...snapBusy.queue[0], id: 'b-q', message: 'B queue only' }] : snapBusy.queue });
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session, sessionB] } }));
  await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: snapshotFor(route.request().postDataJSON().sessionId) } }));
  await page.route('**/api/state?*', route => route.fulfill({ json: snapshotFor(new URL(route.request().url()).searchParams.get('sessionId')!) }));
  await page.setViewportSize({ width: 1280, height: 800 }); await openChat(page);
  await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click(); const editor = page.getByRole('textbox', { name: 'Edit queued message 1', exact: true }); await editor.fill('Retain edit through resize'); await editor.focus();
  await page.setViewportSize({ width: 390, height: 780 }); await expect(editor).toBeFocused(); await expect(editor).toHaveValue('Retain edit through resize');
  await expect(page.getByLabel('Queued follow-ups').locator('summary')).toHaveAttribute('aria-disabled', 'true'); await expect(editor).toBeVisible();
  await page.getByRole('button', { name: 'Switch session', exact: true }).click(); await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).click();
  await expect(page.getByLabel('Queued follow-ups').locator('details')).not.toHaveAttribute('open'); await expect(editor).not.toBeVisible();
  await page.getByLabel('Queued follow-ups').locator('summary').click(); await expect(page.locator('.queue-item')).toContainText('B queue only');
  await page.getByRole('button', { name: 'Switch session', exact: true }).click(); await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click();
  await expect(editor).toHaveValue('Retain edit through resize'); await expect(page.getByLabel('Queued follow-ups')).toContainText('note.txt');
  const save = page.waitForRequest(request => request.url().endsWith('/api/queue/edit')); await page.getByRole('button', { name: 'Save', exact: true }).click(); expect((await save).postDataJSON()).toMatchObject({ sessionId: 's1', id: 'q1', revision: 0, text: 'Retain edit through resize' });
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Delivery intent');
  await expect(page.locator('#composer-send-hint')).toContainText('sends after Pi finishes'); await page.getByLabel('Message delivery').selectOption('steer');
  await expect(page.locator('#composer-send-hint')).toContainText('Immediate steering'); await expect(page.getByRole('button', { name: 'Steer now', exact: true })).toBeEnabled();
  const posted: any[] = []; await page.route('**/api/prompt', route => { posted.push(route.request().postDataJSON()); return route.fulfill({ json: { runId: 'ack-only' } }); });
  await page.getByRole('button', { name: 'Steer now', exact: true }).click(); await expect.poll(() => posted.length).toBe(1); expect(posted[0]).toMatchObject({ sessionId: 's1', mode: 'steer', message: 'Delivery intent' });
});

for (const operation of ['edit', 'remove', 'resume'] as const) {
  test(`queue ${operation} stays session-scoped across navigation and late success/failure`, async ({ page }) => {
    const sessionB = { ...session, id: 's2', name: 'Chat B' };
    const snapshotFor = (id: string) => ({ ...snap, session: id === 's2' ? sessionB : session,
      queueHeld: operation === 'resume', queue: [{ id: `${id}-q`, message: `Queued for ${id}`, revision: 0,
        queuedAt: '2026-01-01T00:00:00Z', status: operation === 'resume' ? 'held' : 'pending',
        ...(operation === 'resume' ? { error: 'restored after restart' } : {}) }] });
    await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session, sessionB] } }));
    await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: snapshotFor(route.request().postDataJSON().sessionId) } }));
    await page.route('**/api/state?*', route => route.fulfill({ json: snapshotFor(new URL(route.request().url()).searchParams.get('sessionId')!) }));
    const pending: Route[] = [];
    await page.route(`**/api/queue/${operation}`, route => { pending.push(route); });
    await page.setViewportSize({ width: 1280, height: 800 }); await openChat(page);
    const action = () => operation === 'edit' ? page.getByRole('button', { name: 'Save', exact: true })
      : operation === 'remove' ? page.getByRole('button', { name: 'Remove queued message 1', exact: true })
      : page.getByRole('button', { name: 'Resume queued', exact: true });
    const begin = async () => {
      if (operation === 'edit') {
        await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click();
        await page.getByRole('textbox', { name: 'Edit queued message 1', exact: true }).fill('edited');
      }
      await action().click(); await expect(action()).toBeDisabled();
    };
    await begin(); await expect.poll(() => pending.length).toBe(1);
    await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).click();
    await expect(page.getByRole('button', { name: operation === 'edit' ? 'Edit queued message 1' : operation === 'remove' ? 'Remove queued message 1' : 'Resume queued', exact: true })).toBeEnabled();
    await begin(); await expect.poll(() => pending.length).toBe(2);
    expect(pending.map(route => route.request().postDataJSON().sessionId)).toEqual(['s1', 's2']);
    // A fails late; it must neither unlock B's in-flight operation nor show A's error in B.
    await pending[0].fulfill({ status: 500, json: { error: 'A queue save failed' } });
    await expect(action()).toBeDisabled();
    await expect(page.getByText('A queue save failed', { exact: true })).toHaveCount(0);
    await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click();
    await expect(action()).toBeEnabled();
    await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).click();
    await expect(action()).toBeDisabled();
    await pending[1].fulfill({ json: operation === 'edit' ? { item: { ...snapshotFor('s2').queue[0], message: 'edited', revision: 1 } } : { ok: true } });
    await expect(operation === 'edit' ? page.getByRole('button', { name: 'Edit queued message 1', exact: true }) : action()).toBeEnabled();
    await page.screenshot({ path: `test-results/queue-scope-${operation}.png` });
  });
}

for (const scenario of ['stay-new', 'leave-new', 'leave-unchanged'] as const) {
  test(`queue save preserves newer typing and reconciles the original draft: ${scenario}`, async ({ page }) => {
    const sessionB = { ...session, id: 's2', name: 'Chat B' };
    let stored = { id: 'save-q', message: 'original queue', revision: 0, queuedAt: '2026-01-01T00:00:00Z', status: 'pending' };
    const snapshotFor = (id: string) => ({ ...snap, session: id === 's2' ? sessionB : session,
      queue: [id === 's2' ? { ...stored, id: 'b-q', message: 'B queue', revision: 0 } : stored] });
    await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session, sessionB] } }));
    await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: snapshotFor(route.request().postDataJSON().sessionId) } }));
    await page.route('**/api/state?*', route => route.fulfill({ json: snapshotFor(new URL(route.request().url()).searchParams.get('sessionId')!) }));
    const requests: { sessionId: string; revision: number; text: string }[] = [];
    let first: Route | undefined;
    await page.route('**/api/queue/edit', async route => {
      const body = route.request().postDataJSON(); requests.push(body);
      if (requests.length === 1) { first = route; return; }
      if (body.revision !== stored.revision) return route.fulfill({ status: 409, json: { error: 'stale revision' } });
      stored = { ...stored, revision: stored.revision + 1, message: body.text };
      await route.fulfill({ json: { item: stored } });
    });
    await page.setViewportSize({ width: 1280, height: 800 }); await openChat(page);
    await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Edit queued message 1', exact: true });
    await editor.fill('submitted edit'); await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => !!first).toBe(true);
    if (scenario !== 'leave-unchanged') await editor.fill('newer unsaved typing');
    if (scenario.startsWith('leave')) await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).click();
    stored = { ...stored, message: requests[0].text, revision: 1 };
    await first!.fulfill({ json: { item: stored } });
    if (scenario.startsWith('leave')) {
      await expect(page.locator('.chat-heading h2')).toHaveText('Chat B');
      await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('');
      await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click();
    }
    if (scenario === 'leave-unchanged') {
      await expect(editor).toHaveCount(0);
      await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click();
      await expect(editor).toHaveValue('submitted edit');
      await editor.fill('next change');
    } else await expect(editor).toHaveValue('newer unsaved typing');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await page.screenshot({ path: `test-results/queue-draft-${scenario}.png` });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(requests[1]).toMatchObject({ sessionId: 's1', revision: 1, text: scenario === 'leave-unchanged' ? 'next change' : 'newer unsaved typing' });
    expect(stored.revision).toBe(2);
    await expect(page.getByText('stale revision', { exact: true })).toHaveCount(0);
    // Re-edit immediately, without SSE or a reload: the HTTP result is sufficient.
    await page.getByRole('button', { name: 'Edit queued message 1', exact: true }).click();
    await expect(editor).toHaveValue(stored.message);
    await editor.fill('immediate third change');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(requests[2]).toMatchObject({ revision: 2, text: 'immediate third change' });
    expect(stored.revision).toBe(3);
  });
}

test('Windows alias references preserve the full path in plain text, code, links and media previews', async ({ page }) => {
  const text = '%TEMP%\\notes.md\n\n$env:TEMP/notes.md\n\n`${env:TEMP}/notes.md`\n\n~/notes.md\n\n`%temp%/notes.md`\n\n[TEMP link](%TEMP%/notes.md)\n\n%TEMP%/portrait.png\n\n![Temp image](%TEMP%/portrait.png)';
  const aliasSnap = { ...snap, chat: [{ id: 'alias-answer', role: 'assistant', complete: true, text: `Ready.\n\n${text}` }] };
  await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: aliasSnap } }));
  await page.route('**/api/state?*', route => route.fulfill({ json: aliasSnap }));
  const requested: string[] = [];
  await page.route('**/api/workspace/text?*', route => {
    requested.push(new URL(route.request().url()).searchParams.get('path')!);
    return route.fulfill({ json: { path: 'notes.md', format: 'markdown', content: '# Alias preview\nResolved on the server.' } });
  });
  await page.route('**/api/workspace/media/info?*', route => {
    requested.push(new URL(route.request().url()).searchParams.get('path')!);
    return route.fulfill({ json: { path: 'portrait.png', format: 'image' } });
  });
  await page.route('**/api/workspace/media?*', async route => route.fulfill({ contentType: 'image/png', body: await readFile('tests/fixtures/preview.png') }));
  await page.setViewportSize({ width: 390, height: 780 });
  await openChat(page);
  const answer = page.locator('[data-message-id="alias-answer"]'), dialog = page.getByRole('dialog', { name: 'Workspace file preview' });
  for (const [label, path] of [['%TEMP%\\notes.md', '%TEMP%\\notes.md'], ['$env:TEMP/notes.md', '$env:TEMP/notes.md'], ['${env:TEMP}/notes.md', '${env:TEMP}/notes.md'], ['~/notes.md', '~/notes.md'], ['%temp%/notes.md', '%temp%/notes.md'], ['TEMP link', '%TEMP%/notes.md']]) {
    await answer.getByRole('button', { name: label, exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Alias preview' })).toBeVisible();
    expect(requested.at(-1)).toBe(path);
    await dialog.getByRole('button', { name: 'Close file preview' }).click();
  }
  await answer.getByRole('button', { name: '%TEMP%/portrait.png', exact: true }).click();
  await expect(dialog.locator('img.file-preview-media')).toHaveJSProperty('naturalWidth', 96);
  expect(requested.at(-1)).toBe('%TEMP%/portrait.png');
  await dialog.getByRole('button', { name: 'Close file preview' }).click();
  await answer.getByRole('button', { name: 'Preview image: Temp image', exact: true }).click();
  await expect(dialog.locator('img.file-preview-media')).toHaveJSProperty('naturalWidth', 96);
  expect(requested.at(-1)).toBe('%TEMP%/portrait.png');
  await page.screenshot({ path: 'test-results/windows-alias-preview-mobile.png' });
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
  await expect(page.getByLabel('Workspace path')).toHaveCount(0);
  await addToggle.click();
  await expect(page.getByLabel('Workspace path')).toBeVisible();
  await addToggle.click();
  await expect(page.getByLabel('Workspace path')).toHaveCount(0);
  await addToggle.click();
  const add = page.getByRole('button', { name: 'Add & open' });
  await expect(add).toBeDisabled();
  await page.getByLabel('Workspace path').fill('C:/demo');
  await expect(add).toBeEnabled();
});

for (const mobile of [false, true]) for (const existing of [false, true]) {
  test(`workspace Add is opt-in, retains cancelled path and completes safely: mobile=${mobile}, existing=${existing}`, async ({ page }) => {
    let listed = existing ? [ws, ws2] : [];
    const pending: Route[] = [];
    await page.route('**/api/workspaces', route => {
      if (route.request().method() === 'POST') { pending.push(route); return; }
      return route.fulfill({ json: { workspaces: listed } });
    });
    await page.setViewportSize(mobile ? { width: 390, height: 780 } : { width: 1280, height: 800 });
    await page.goto('/');
    const path = page.getByLabel('Workspace path');
    const trigger = page.locator('.workspace-add-shortcut:visible,.add-toggle:visible');
    await expect(path).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    if (mobile) await expect(page.locator('.workspace-bar')).not.toBeVisible();
    if (mobile && existing) {
      const card = (await page.locator('.workspace-card').first().boundingBox())!, button = (await trigger.boundingBox())!;
      expect(card.y).toBeLessThan(button.y);
    }
    await trigger.click();
    await expect(page.getByRole('heading', { name: 'Add a workspace' })).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'Add & open', exact: true })).toBeDisabled();
    await path.fill('C:/preserved-draft');
    await page.getByRole('button', { name: 'Cancel adding workspace', exact: true }).click();
    await expect(path).toHaveCount(0); await expect(trigger).toBeFocused();
    await trigger.click(); await expect(path).toHaveValue('C:/preserved-draft');
    const add = page.getByRole('button', { name: 'Add & open', exact: true });
    await add.click(); await expect.poll(() => pending.length).toBe(1);
    await expect(add).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel adding workspace', exact: true })).toBeDisabled();
    expect(pending[0].request().postDataJSON()).toEqual({ path: 'C:/preserved-draft' });
    listed = [ws, ws2]; await pending[0].fulfill({ json: { workspace: ws2 } });
    await expect(page.locator('main')).toHaveClass(/view-sessions/);
    await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue('w2');
    await expect(path).toHaveCount(0);
    expect(pending).toHaveLength(1);
  });
}

test('failed workspace Add leaves the disclosure and path available for correction', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 }); await page.goto('/');
  await page.locator('.workspace-add-shortcut').click();
  await page.getByLabel('Workspace path').fill('C:/missing');
  await page.route('**/api/workspaces', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 400, json: { error: 'Workspace path does not exist' } })
    : route.fulfill({ json: { workspaces: [ws, ws2] } }));
  await page.getByRole('button', { name: 'Add & open', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Workspace path does not exist');
  await expect(page.getByLabel('Workspace path')).toHaveValue('C:/missing');
  await expect(page.getByRole('button', { name: 'Add & open', exact: true })).toBeEnabled();
});
