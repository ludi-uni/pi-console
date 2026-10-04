import { test, expect, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// All APIs/SSE are mocked: these checks never start Pi or call a model.
const workspaces = ['A', 'B', 'C'].map(id => ({ id, name: `Workspace ${id}`, path: `C:/${id}`, valid: true, lastOpenedAt: '2026-10-03T00:00:00Z' }));
const sessions = ['A', 'B'].map(id => ({ id, workspaceId: 'A', name: `Chat ${id}`, filePath: `/${id}.jsonl` }));
const execution = { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 };
const snapshot = (id: string, long = false) => ({ session: sessions.find(s => s.id === id)!, runtime: 'running', activeRunId: id === 'B' ? 'run-B' : undefined,
  chat: long ? Array.from({ length: 60 }, (_, i) => ({ id: `m-${i}`, role: 'assistant', text: (`History ${i}.\n`).repeat(8), complete: true })) : [{ id: `m-${id}`, role: 'assistant', text: `Private history ${id}. [Video](clip.mp4)`, complete: true }], events: [], execution, seq: 0, generation: id, queue: [] });
async function setup(page: Page, long = false) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => { (window as any).EventSource = class extends EventTarget { close() {} }; });
  const prompts: unknown[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let value: unknown;
    if (path === '/api/workspaces') value = { workspaces };
    else if (path === '/api/workspaces/update') value = { workspace: workspaces.find(w => w.id === request.postDataJSON().id) };
    else if (path === '/api/sessions') value = { sessions: url.searchParams.get('workspaceId') === 'A' ? sessions : [] };
    else if (path === '/api/resume') value = { snapshot: snapshot(request.postDataJSON().sessionId, long) };
    else if (path === '/api/state') value = snapshot(url.searchParams.get('sessionId')!, long);
    else if (path === '/api/session/options') value = { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] };
    else if (path === '/api/activity') value = { sessions: [] };
    else if (path === '/api/quick-prompts') value = { prompts: [] };
    else if (path.startsWith('/api/orchestrator')) value = { available: false };
    else if (path === '/api/pets') value = { pets: [] };
    else if (path === '/api/workspace/media/info') value = { path: 'clip.mp4', format: 'video' };
    else if (path === '/api/workspace/media') { await route.fulfill({ contentType: 'video/mp4', body: await readFile('tests/fixtures/preview.mp4') }); return; }
    else if (path === '/api/prompt') { prompts.push(request.postDataJSON()); value = { runId: 'new-run' }; }
    else throw Error(`Unexpected API: ${path}`);
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await page.getByLabel('Workspace', { exact: true }).selectOption('A');
  await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click();
  await expect(page.locator('[data-message-id]').first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeEnabled();
  return prompts;
}
async function savedText(page: Page, scope = JSON.stringify(['A', 'A'])) {
  return page.evaluate(async scope => {
    const path = '/web/composer-drafts.ts';
    return (await (await import(path)).readComposerDraft(scope)).draft.text;
  }, scope);
}

test('back/forward hides foreign history and blocks sending until the selected snapshot loads', async ({ page }) => {
  const prompts = await setup(page);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.fill('Keep A draft');
  await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).click();
  await expect(page.getByLabel('Chat output')).toContainText('Private history B');
  let pending: Route | undefined;
  await page.route('**/api/resume', route => { pending = route; });
  await page.goBack();
  await expect(prompt).toHaveValue('Keep A draft');
  await expect(page.getByLabel('Chat output')).not.toContainText('Private history B');
  await expect(page.getByRole('button', { name: /^Queue/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Send/ })).toBeDisabled();
  await prompt.press('Control+Enter');
  expect(prompts).toHaveLength(0);
  await expect.poll(() => !!pending).toBe(true);
  await pending!.fulfill({ json: { snapshot: snapshot('A') } });
  await expect(page.getByLabel('Chat output')).toContainText('Private history A');
  await expect(page.getByRole('button', { name: /^Send/ })).toBeEnabled();
  pending = undefined;
  await page.goForward();
  await expect(page.getByLabel('Chat output')).not.toContainText('Private history A');
  await expect(page.getByRole('button', { name: /^Send/ })).toBeDisabled();
  await expect.poll(() => !!pending).toBe(true);
  await pending!.fulfill({ json: { snapshot: snapshot('B') } });
  await expect(page.getByLabel('Chat output')).toContainText('Private history B');
  await prompt.fill('Follow up B');
  await page.getByRole('button', { name: /^Queue/ }).click();
  await expect.poll(() => prompts.length).toBe(1);
  expect(prompts[0]).toMatchObject({ sessionId: 'B', mode: 'followUp', message: 'Follow up B' });
});

for (const outcome of ['success', 'failure'] as const) test(`latest workspace selection wins over a delayed ${outcome}`, async ({ page }) => {
  await setup(page);
  let pending: Route | undefined;
  await page.route('**/api/workspaces/update', async route => {
    if (route.request().postDataJSON().id === 'B') pending = route;
    else await route.fulfill({ json: { workspace: workspaces[2] } });
  });
  const select = page.getByLabel('Workspace', { exact: true });
  await select.selectOption('B');
  await expect.poll(() => !!pending).toBe(true);
  await select.selectOption('C');
  await expect(select).toHaveValue('C');
  const response = page.waitForResponse(r => r.url().endsWith('/api/workspaces/update') && r.request().postDataJSON().id === 'B');
  await pending!.fulfill(outcome === 'success' ? { json: { workspace: workspaces[1] } } : { status: 500, json: { error: 'Old selection failed' } });
  await response;
  // Drain the async response continuation, not a timing-dependent sleep.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(select).toHaveValue('C');
  await expect(page.getByText('Old selection failed', { exact: true })).toHaveCount(0);
});

test('focus, pageshow and visibility restoration preserve history position and keep the tail in view', async ({ page }) => {
  await setup(page, true);
  const chat = page.getByLabel('Chat output');
  await expect.poll(() => chat.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(1000);
  await chat.evaluate(el => { el.scrollTop = 120; el.dispatchEvent(new Event('scroll')); });
  const before = await chat.evaluate(el => el.scrollTop);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await chat.evaluate(el => el.scrollTop)).toBe(before);
  await chat.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => chat.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
});

test('native file modal lets keyboard reach video controls and restores focus on Escape', async ({ page }) => {
  await setup(page);
  const trigger = page.getByRole('button', { name: 'Video', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Workspace file preview' });
  const video = dialog.locator('video');
  await expect(video).toBeVisible();
  await dialog.getByRole('button', { name: 'Close file preview' }).focus();
  await page.keyboard.press('Tab');
  await expect(video).toBeFocused();
  // Chrome supports this fixture's codec and Space on the native video control.
  // Other engines still verify keyboard reachability, modal exit and restoration.
  if (test.info().project.name === 'chromium') {
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(16);
    await page.keyboard.press('Space');
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('lost HTTP ACK survives reload and retries the exact same submission ID and files', async ({ page }) => {
  await setup(page);
  const requests: unknown[] = [];
  await page.route('**/api/prompt', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await route.abort('connectionreset');
    else await route.fulfill({ json: { runId: 'original-run' } });
  });
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.fill('Execute once');
  await page.getByLabel('Choose files').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('original file') });
  await page.getByRole('button', { name: /^Send/ }).click();
  await expect(page.getByRole('button', { name: 'Check delivery · same request' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /^Send/ })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check delivery · same request' })).toBeEnabled();
  await expect(prompt).toHaveValue('Execute once');
  await prompt.fill('Newer local input');
  await page.getByRole('button', { name: 'Check delivery · same request' }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ requestId: expect.stringMatching(/^[a-f0-9-]{36}$/), message: 'Execute once' });
  await expect(page.getByRole('button', { name: 'Check delivery · same request' })).toHaveCount(0);
  await expect(prompt).toHaveValue('Newer local input');
  await expect(page.getByLabel('Attached files')).toHaveCount(0);
});

test('clean tabs synchronize an acknowledged draft clear rather than offer the sent text again', async ({ page }) => {
  await setup(page);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.fill('Shared instruction');
  await expect.poll(() => savedText(page)).toBe('Shared instruction');
  const other = await page.context().newPage();
  try {
    await setup(other);
    const otherPrompt = other.getByRole('textbox', { name: 'Prompt', exact: true });
    await expect(otherPrompt).toHaveValue('Shared instruction');
    await page.getByRole('button', { name: /^Send/ }).click();
    await expect(prompt).toHaveValue('');
    await expect(otherPrompt).toHaveValue('');
    await expect(other.getByRole('button', { name: /^Send/ })).toBeDisabled();
    await expect(other.getByRole('button', { name: 'Check delivery · same request' })).toHaveCount(0);
  } finally { await other.close(); }
});

test('a stale tab keeps unsaved input and files, cannot overwrite storage, and resolves only explicitly', async ({ page }) => {
  await setup(page);
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Shared draft');
  await expect.poll(() => savedText(page)).toBe('Shared draft');
  const other = await page.context().newPage();
  try {
    await setup(other);
    await expect(other.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('Shared draft');
    await other.evaluate(() => {
      const native = File.prototype.arrayBuffer;
      let release!: () => void;
      const wait = new Promise<void>(resolve => { release = resolve; });
      (window as any).__releaseDraftRead = release;
      File.prototype.arrayBuffer = async function () { if (this.name === 'local.txt') await wait; return native.call(this); };
    });
    await other.getByLabel('Choose files').setInputFiles({ name: 'local.txt', mimeType: 'text/plain', buffer: Buffer.from('local bytes') });
    await other.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Unsaved local input');
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('New saved draft');
    await expect.poll(() => savedText(page)).toBe('New saved draft');
    await other.evaluate(() => (window as any).__releaseDraftRead());
    await expect(other.getByText(/Draft changed in another tab/)).toBeVisible();
    await expect(other.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('Unsaved local input');
    await expect(other.getByLabel('Attached files')).toContainText('local.txt');
    await expect(other.getByRole('button', { name: /^Send/ })).toBeDisabled();
    expect(await savedText(page)).toBe('New saved draft');
    other.once('dialog', dialog => dialog.accept());
    await other.getByRole('button', { name: 'Load saved draft' }).click();
    await expect(other.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('New saved draft');
    await expect(other.getByLabel('Attached files')).toHaveCount(0);
    await expect(other.getByRole('button', { name: /^Send/ })).toBeEnabled();
  } finally { await other.close(); }
});

for (const editBeforeRecovery of [false, true]) test(`temporary draft read failure recovers without losing input or inventing delivery: earlyEdit=${editBeforeRecovery}`, async ({ page }) => {
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    (window as any).__draftStorageUnavailable = true;
    indexedDB.open = function (name, ...args) {
      if (name === 'pi-console-composer-drafts-v1' && (window as any).__draftStorageUnavailable) throw Error('Temporary draft storage failure');
      return original(name, ...args);
    };
  });
  const requests = await setup(page);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await expect(page.getByText(/Stored draft could not be loaded/)).toBeVisible();
  if (editBeforeRecovery) {
    await prompt.fill('Keep input entered during the outage');
    await page.getByRole('button', { name: /^Send/ }).click();
    await expect(page.getByText(/Message was not sent:/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check delivery · same request' })).toHaveCount(0);
    expect(requests).toHaveLength(0);
  }
  await page.evaluate(() => { (window as any).__draftStorageUnavailable = false; window.dispatchEvent(new Event('focus')); });
  if (!editBeforeRecovery) {
    await expect(page.getByText(/Stored draft could not be loaded/)).toHaveCount(0);
    await prompt.fill('Input after storage recovery');
  }
  const text = editBeforeRecovery ? 'Keep input entered during the outage' : 'Input after storage recovery';
  await expect.poll(() => savedText(page)).toBe(text);
  await expect(prompt).toHaveValue(text);
  await page.getByRole('button', { name: /^Send/ }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ message: text });
  await expect(prompt).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Check delivery · same request' })).toHaveCount(0);
});

test('recovering a previously unreadable nonempty draft keeps local input until conflict resolution', async ({ page }) => {
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    (window as any).__draftStorageUnavailable = true;
    indexedDB.open = function (name, ...args) {
      if (name === 'pi-console-composer-drafts-v1' && (window as any).__draftStorageUnavailable) throw Error('Temporary draft storage failure');
      return original(name, ...args);
    };
  });
  const requests = await setup(page);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.fill('Local input that must survive');
  await expect(page.getByText(/Draft could not be saved/)).toBeVisible();
  await page.evaluate(() => {
    (window as any).__draftStorageUnavailable = false;
    return new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('pi-console-composer-drafts-v1', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('drafts');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put({ text: 'Recovered saved draft', files: [], revision: 4 }, JSON.stringify(['A', 'A']));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(/Draft changed in another tab/)).toBeVisible();
  await expect(prompt).toHaveValue('Local input that must survive');
  expect(await savedText(page)).toBe('Recovered saved draft');
  expect(requests).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Load saved draft' }).click();
  await expect(prompt).toHaveValue('Recovered saved draft');
  await prompt.fill('Edit recovered draft');
  await expect.poll(() => savedText(page)).toBe('Edit recovered draft');
  await page.getByRole('button', { name: /^Send/ }).click();
  await expect.poll(() => requests.length).toBe(1);
});

for (const outcome of ['success', 'failure'] as const) test(`removing an old workspace preserves the new selection after a delayed ${outcome}`, async ({ page }) => {
  await setup(page);
  let pending: Route | undefined;
  await page.route('**/api/workspaces/remove', route => { pending = route; });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Manage workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from Console', exact: true }).click();
  await expect.poll(() => !!pending).toBe(true);
  await page.getByLabel('Workspace', { exact: true }).selectOption('B');
  await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue('B');
  const response = page.waitForResponse(r => r.url().endsWith('/api/workspaces/remove'));
  await pending!.fulfill(outcome === 'success' ? { json: { ok: true } } : { status: 500, json: { error: 'Old remove failed' } });
  await response;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue('B');
  await expect(page.getByText('Old remove failed', { exact: true })).toHaveCount(0);
});
