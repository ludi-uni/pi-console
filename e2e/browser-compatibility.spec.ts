import { test, expect, type Page } from '@playwright/test';
import type { Snapshot, ActiveSessionSummary } from '../shared/types.ts';
import { SessionEvents } from '../server/runtime/events.ts';
import { prepareAttachments } from '../server/runtime/attachments.ts';

const workspace = { id: 'compat-w', name: 'Compatibility workspace', path: 'C:/compat-fixture', valid: true, pinned: false, lastOpenedAt: '2026-01-01T00:00:00Z' };
const session = { id: 'compat-s', workspaceId: workspace.id, name: 'Compatibility chat', filePath: '/compat.jsonl' };
const snapshot: Snapshot = {
  session, runtime: 'running',
  chat: [{ id: 'reply', role: 'assistant', text: 'Ready.', complete: true }],
  events: [], execution: { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 },
  seq: 0, generation: 'compat-g', queue: [],
};

async function setup(page: Page, initialSnapshot: Snapshot = snapshot, activity: ActiveSessionSummary[] = []) {
  const errors: string[] = [], unexpected: string[] = [], submitted: unknown[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('pi-console:preferences:v1', JSON.stringify({ language: 'en', petEnabled: false }));
    // SSE is inert and optional APIs are deliberately unavailable. All network
    // APIs are intercepted below; these tests must never reach a real Pi worker.
    const streams: EventTarget[] = [];
    Object.defineProperty(window, '__compatStreams', { value: streams });
    Object.defineProperty(window, 'EventSource', { configurable: true, value: class extends EventTarget {
      closed = false;
      constructor() { super(); streams.push(this); }
      close() { this.closed = true; }
    } });
    for (const key of ['SpeechRecognition', 'webkitSpeechRecognition', 'Notification']) {
      Object.defineProperty(window, key, { configurable: true, value: undefined });
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (path === '/api/workspaces') json = { workspaces: [workspace] };
    else if (path === '/api/workspaces/update') json = { workspace };
    else if (path === '/api/sessions') json = { sessions: [session] };
    else if (path === '/api/resume') json = { snapshot: initialSnapshot };
    else if (path === '/api/state') json = initialSnapshot;
    else if (path === '/api/session/options') json = { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] };
    else if (path === '/api/activity') json = { sessions: activity };
    else if (path === '/api/orchestrator') json = { available: false };
    else if (path === '/api/quick-prompts') json = { prompts: [] };
    else if (path === '/api/pets') json = { pets: [] };
    else if (path === '/api/session-retention') json = { enabled: false, days: 30 };
    else if (path === '/api/startup') json = { supported: false, enabled: false, installed: false };
    else if (path === '/api/prompt') { submitted.push(route.request().postDataJSON()); json = { ok: true }; }
    else { unexpected.push(path); await route.abort(); return; }
    await route.fulfill({ json });
  });
  await page.goto('/');
  if (page.viewportSize()!.width <= 900) await page.getByRole('button', { name: /Compatibility workspace.*C:\/compat-fixture/ }).click();
  else await page.getByLabel('Workspace', { exact: true }).selectOption(workspace.id);
  await page.getByLabel('Session list').getByRole('button', { name: /^Compatibility chat/ }).click();
  await expect(page.getByLabel('Chat output')).toContainText('Ready.');
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeEnabled();
  return { errors, unexpected, submitted };
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 780 }, { width: 844, height: 390 }]) {
  test(`notification list never moves or covers Send at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const activity: ActiveSessionSummary[] = Array.from({ length: 25 }, (_, i) => ({
      sessionId: i ? `other-${i}` : session.id, workspaceId: workspace.id,
      sessionName: `Session ${i} with a very long descriptive name that must remain readable`,
      workspaceName: 'Workspace with a very long descriptive name that must remain readable',
      running: i !== 0, decisionCount: 0, work: [], updatedAt: '2026-01-01T00:00:00Z',
      completion: i === 0 ? { id: 'current-finish', scope: 'conversation', status: 'completed', at: '2026-01-01T00:00:00Z' } : undefined,
    }));
    const { errors, unexpected, submitted } = await setup(page, snapshot, activity);
    const send = page.getByRole('button', { name: /^Send/ });
    await page.getByLabel('Prompt', { exact: true }).fill('Layout check');
    const before = await send.boundingBox();
    const inbox = page.getByRole('region', { name: 'Activity notifications' });
    await inbox.locator('summary').click();
    const after = await send.boundingBox();
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(after![key] - before![key])).toBeLessThan(1); // Allow subpixel font rounding.
    }
    const current = inbox.locator('.activity-card.is-current');
    await expect(current.locator('button').first()).toHaveAttribute('aria-current', 'page');
    for (const name of [current.locator('b'), current.locator('.activity-inbox-name > small').first()]) {
      expect(await name.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
      expect(await name.evaluate(el => getComputedStyle(el).textOverflow)).toBe('ellipsis');
      await expect(name).toHaveAttribute('title', (await name.textContent())!);
    }
    expect(await inbox.locator('.activity-inbox-list').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(send).toBeInViewport();
    await send.click(); // Actual hit testing: the notification overlay must not intercept Send.
    await expect.poll(() => submitted.length).toBe(1);
    await current.getByRole('button', { name: /Dismiss .* completion/ }).click();
    await expect(current).toHaveCount(0);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  });
}

async function expectComposerLayout(page: Page) {
  const prompt = await page.getByRole('textbox', { name: 'Prompt', exact: true }).boundingBox();
  const attach = await page.getByRole('button', { name: 'Attach files', exact: true }).boundingBox();
  const send = await page.getByRole('button', { name: /^Send/ }).boundingBox();
  expect(prompt).not.toBeNull(); expect(attach).not.toBeNull(); expect(send).not.toBeNull();
  expect(prompt!.height).toBeGreaterThanOrEqual(40);
  expect(prompt!.y + prompt!.height).toBeLessThanOrEqual(attach!.y + 1);
  expect(send!.y + send!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 780 }, { width: 844, height: 390 }]) {
  test(`navigation, draft restoration, attachments and optional API fallbacks at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { errors, unexpected, submitted } = await setup(page);
    await expectComposerLayout(page);
    const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
    await prompt.fill('Compatibility prompt\nSecond line');
    // Exercise the actual file chooser rather than only assigning input files.
    const chooserReady = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach files', exact: true }).click();
    await (await chooserReady).setFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByLabel('Attached files')).toContainText('note.txt');
    // Wait for the real IndexedDB commit before reloading (no timing sleeps).
    await expect.poll(() => page.evaluate(async () => {
      const modulePath = '/web/composer-drafts.ts';
      const { loadComposerDraft } = await import(modulePath);
      const draft = await loadComposerDraft(JSON.stringify(['compat-w', 'compat-s']));
      return { text: draft.text, files: draft.files.map((file: File) => file.name) };
    })).toEqual({ text: 'Compatibility prompt\nSecond line', files: ['note.txt'] });
    await page.reload();
    await expect(prompt).toHaveValue('Compatibility prompt\nSecond line');
    await expect(page.getByLabel('Attached files')).toContainText('note.txt');
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.getByRole('button', { name: 'Voice input', exact: true }).click();
    const voice = page.getByRole('dialog', { name: 'Voice input', exact: true });
    await expect(voice).toContainText('Web Speech API is unavailable');
    await expect(voice.getByRole('button', { name: 'Start listening', exact: true })).toBeDisabled();
    await expect(voice.getByRole('button', { name: 'Insert into prompt', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(voice).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Voice input', exact: true })).toBeFocused();
    await expect(prompt).toHaveValue('Compatibility prompt\nSecond line');
    expect(submitted).toEqual([]);

    await page.getByRole('button', { name: 'Copy all', exact: true }).click();
    await expect(page.getByLabel('Chat output')).toContainText('Copy failed');
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    if (viewport.width <= 900) await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    await expect(page.getByLabel('Notify when work finishes')).toBeDisabled();
    await page.goBack();
    await expect(prompt).toHaveValue('Compatibility prompt\nSecond line');
    await expectComposerLayout(page);
    await page.getByRole('button', { name: /^Send/ }).click();
    await expect.poll(() => submitted).toEqual([{
      requestId: expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
      workspaceId: workspace.id, sessionId: session.id, message: 'Compatibility prompt\nSecond line',
      attachments: [{ kind: 'text', name: 'note.txt', mimeType: 'text/plain', text: 'hello' }],
    }]);
    await expect(prompt).toHaveValue('');
    await expect(page.getByLabel('Attached files')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });
}

for (const refresh of ['stale', 'failed'] as const) {
  test(`submitted instructions remain visible when the HTTP refresh is ${refresh}`, async ({ page }) => {
    // Exercise real server normalization, not hand-authored user events. The fake
    // worker finishes before the ACK/GET, so the HTTP snapshot is overtaken by SSE.
    const state = new SessionEvents(session, () => 'running');
    state.load([{ role: 'assistant', content: 'Ready.' }]);
    const initial = state.snapshot();
    await setup(page, initial);
    let stale = initial, refreshes = 0;
    await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: state.snapshot() } }));
    await page.route('**/api/state?*', route => {
      refreshes++;
      return refresh === 'failed' ? route.fulfill({ status: 500, json: { error: 'Refresh unavailable' } })
        : route.fulfill({ json: stale });
    });
    await page.route('**/api/prompt', async route => {
      const request = route.request().postDataJSON();
      const prepared = prepareAttachments(request.message, request.attachments);
      const events: typeof state.events = [];
      const unsubscribe = state.subscribe(event => events.push(event));
      const runId = state.preparePrompt(prepared.message); state.accepted();
      stale = state.snapshot();
      // The echo is intentionally omitted, as with workers that emit only output.
      state.ingest({ type: 'message_start', message: { role: 'assistant', content: [] } });
      state.ingest({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Done.' } });
      state.ingest({ type: 'message_end', message: { role: 'assistant', content: 'Done.' } });
      state.ingest({ type: 'agent_settled' });
      unsubscribe();
      await page.evaluate(events => {
        const streams = (window as unknown as { __compatStreams: (EventTarget & { closed: boolean })[] }).__compatStreams;
        const stream = streams.filter(stream => !stream.closed).at(-1)!;
        for (const event of events) stream.dispatchEvent(new MessageEvent('execution', { data: JSON.stringify(event) }));
      }, events);
      await route.fulfill({ json: { runId } });
    });
    await page.waitForFunction(() => (window as unknown as { __compatStreams: unknown[] }).__compatStreams.length > 0);
    const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
    // Repeat while SSE is live; a failed refresh intentionally disconnects it.
    for (let count = 1; count <= (refresh === 'failed' ? 1 : 2); count++) {
      await prompt.fill('Repeated instruction');
      await page.getByLabel('Choose files', { exact: true }).setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
      await page.getByRole('button', { name: /^Send/ }).click();
      await expect(prompt).toHaveValue('');
      await expect.poll(() => refreshes).toBeGreaterThanOrEqual(count);
      if (refresh === 'failed') await expect(page.locator('.error-card')).toContainText('Message sent');
      const users = page.locator('.message[data-role="user"]');
      // Check immediately after the ACK/refresh render; waiting for reconnection
      // could hide the regression by eventually fetching the missing history.
      expect(await users.count()).toBe(count);
      await expect(users.last()).toContainText('Repeated instruction');
      await expect(users.last()).toContainText('note.txt');
      await expect.poll(() => page.getByRole('button', { name: /^Send/ }).isDisabled()).toBe(true);
      const ids = await users.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.messageId));
      expect(ids).toEqual(state.chat.filter(message => message.role === 'user').map(message => message.id));
      await page.getByRole('button', { name: 'Open prompt history', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Prompt history' })).toContainText(`Repeated instruction`);
      await page.getByRole('button', { name: 'Close prompt history', exact: true }).click();
    }
  });
}

test('attachment storage preserves bytes and metadata without persisting File objects', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const modulePath = '/web/composer-drafts.ts';
    const { saveComposerDraft, loadComposerDraft } = await import(modulePath);
    const files = [new File(['日本語\nhello'], 'メモ.txt', { type: 'text/plain', lastModified: 123456 }),
      new File([new Uint8Array([0, 255, 1, 128])], 'image.png', { type: 'image/png', lastModified: 789012 })];
    await saveComposerDraft('roundtrip', { text: 'Full draft', files });
    const draft = await loadComposerDraft('roundtrip');
    return { text: draft.text, files: await Promise.all(draft.files.map(async (file: File) => ({
      name: file.name, type: file.type, size: file.size, lastModified: file.lastModified,
      isFile: file instanceof File, bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    }))) };
  });
  expect(result).toEqual({ text: 'Full draft', files: [
    { name: 'メモ.txt', type: 'text/plain', size: Buffer.byteLength('日本語\nhello'), lastModified: 123456,
      isFile: true, bytes: Array.from(Buffer.from('日本語\nhello')) },
    { name: 'image.png', type: 'image/png', size: 4, lastModified: 789012,
      isFile: true, bytes: [0, 255, 1, 128] },
  ] });
  const stored = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('pi-console-composer-drafts-v1', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('drafts', 'readonly'), request = tx.objectStore('drafts').get('roundtrip');
      tx.oncomplete = () => { db.close(); resolve(request.result.files.map((file: { bytes: ArrayBuffer }) => ({
        isBlob: file instanceof Blob, isBuffer: file.bytes instanceof ArrayBuffer, size: file.bytes.byteLength,
      }))); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  expect(stored).toEqual([{ isBlob: false, isBuffer: true, size: Buffer.byteLength('日本語\nhello') },
    { isBlob: false, isBuffer: true, size: 4 }]);
});

test('slow or failed attachment reads cannot overwrite newer drafts or an ACK clear', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const modulePath = '/web/composer-drafts.ts';
    const { saveComposerDraft, loadComposerDraft } = await import(modulePath);
    const file = new File(['old bytes'], 'old.txt');
    let release!: (buffer: ArrayBuffer) => void, started!: () => void;
    const readStarted = new Promise<void>(resolve => { started = resolve; });
    const bytes = new Promise<ArrayBuffer>(resolve => { release = resolve; });
    Object.defineProperty(file, 'arrayBuffer', { value: () => { started(); return bytes; } });
    const older = saveComposerDraft('ordered', { text: 'old', files: [file] });
    const newer = saveComposerDraft('ordered', { text: 'new', files: [] });
    await readStarted;
    release(new TextEncoder().encode('old bytes').buffer);
    await Promise.all([older, newer]);
    const newestText = (await loadComposerDraft('ordered')).text;

    const pending = saveComposerDraft('ordered', { text: 'sent', files: [file] });
    const clear = saveComposerDraft('ordered', { text: '', files: [] });
    await Promise.all([pending, clear]);
    const cleared = await loadComposerDraft('ordered');

    const unreadable = new File(['bad'], 'bad.txt');
    Object.defineProperty(unreadable, 'arrayBuffer', { value: () => Promise.reject(Error('File read failed')) });
    const failed = saveComposerDraft('ordered', { text: 'bad', files: [unreadable] }).then(() => false, () => true);
    const recovery = saveComposerDraft('ordered', { text: 'recovered', files: [] });
    const rejected = await failed; await recovery;
    return { newestText, cleared, rejected, recoveredText: (await loadComposerDraft('ordered')).text };
  });
  expect(result).toEqual({ newestText: 'new', cleared: { text: '', files: [] }, rejected: true, recoveredText: 'recovered' });
});

test('legacy File drafts remain readable and migrate only when saved', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'This WebKit port cannot seed legacy File records in IndexedDB');
  await setup(page);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('pi-console-composer-drafts-v1', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put({ text: 'Legacy draft', files: [new File(['legacy bytes'], 'legacy.txt', { type: 'text/plain', lastModified: 123 })] }, 'legacy');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  const result = await page.evaluate(async () => {
    const modulePath = '/web/composer-drafts.ts';
    const { loadComposerDraft, saveComposerDraft } = await import(modulePath);
    const legacy = await loadComposerDraft('legacy');
    await saveComposerDraft('legacy', legacy);
    const migrated = await loadComposerDraft('legacy');
    return { text: migrated.text, name: migrated.files[0].name, type: migrated.files[0].type,
      lastModified: migrated.files[0].lastModified, content: await migrated.files[0].text() };
  });
  expect(result).toEqual({ text: 'Legacy draft', name: 'legacy.txt', type: 'text/plain', lastModified: 123, content: 'legacy bytes' });
});
