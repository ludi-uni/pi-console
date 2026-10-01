import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fully mocked API + fake EventSource: no real Pi process, no model calls.
// Covers three regressions:
//  1. popstate must not bump the nav generation when history.back returns to the
//     SAME workspace:session scope (settings -> chat), or the live SSE effect would
//     restart and discard the current snapshot; a gap SSE event must then refresh
//     and display the server's data.
//  2. popstate to a DIFFERENT scope still bumps, so a delayed request from the old
//     scope is rejected and cannot overwrite the new screen.
//  3. send() clears the submitted prompt/attachments as soon as the POST is
//     accepted — even when the following state GET fails — while a failed POST
//     keeps the input, a mid-send scope change cannot clear session B's composer,
//     and edits made while the POST was in flight are preserved.

const FAKE_ES = `
window.__streams = [];
window.EventSource = class {
  constructor(url){ this.url = url; this.listeners = {}; this.closed = false; window.__streams.push(this); }
  addEventListener(t, f){ (this.listeners[t] ??= []).push(f); }
  close(){ this.closed = true; }
};
window.__emit = (ev) => { const s = window.__streams.at(-1); for (const f of s?.listeners['execution'] ?? []) f(new MessageEvent('execution', { data: JSON.stringify(ev) })); };
window.__open = () => { const s = window.__streams.at(-1); s?.onopen && s.onopen(); };
`;

const session = (id: string, name: string) => ({ id, workspaceId: 'w1', filePath: `/${id}.jsonl`, name, updatedAt: '1' });
const snap = (wsId: string, id: string, text: string, seq = 1, generation = `gen-${id}`) => ({
  session: session(id, `s-${id}`), runtime: 'running', activeRunId: undefined,
  chat: [{ id: `${id}-m`, role: 'assistant', text, complete: true }],
  events: [], execution: { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 },
  seq, generation,
});
const ev = (id: string, seq: number, text: string) => ({
  schemaVersion: 1, eventId: `ev-${id}-${seq}`, seq, generation: `gen-${id}`, timestamp: new Date().toISOString(),
  workspaceId: 'w1', sessionId: id, runId: 'r', type: 'MessageCompleted', entityId: `e-${seq}`,
  source: 'pi-rpc', certainty: 'observed', payload: { role: 'user', text },
});

function makeGates() {
  const gates = new Map<string, { arrived: Promise<void>; response: Promise<void>; mark: () => void; release: () => void }>();
  const get = (id: string) => {
    if (!gates.has(id)) {
      let mark!: () => void, release!: () => void;
      const arrived = new Promise<void>(resolve => { mark = resolve; });
      const response = new Promise<void>(resolve => { release = resolve; });
      gates.set(id, { arrived, response, mark, release });
    }
    return gates.get(id)!;
  };
  return {
    wait: (id: string) => { const gate = get(id); gate.mark(); return gate.response; },
    observed: (id: string) => get(id).arrived,
    release: (id: string) => get(id).release(),
  };
}

async function openChat(page: import('@playwright/test').Page, label = 'Session A') {
  await page.goto('/');
  await page.getByLabel('Workspace', { exact: true }).selectOption('w1');
  await page.getByLabel('Session list').getByRole('button', { name: new RegExp(`^${label} `) }).click();
}

test.setTimeout(45000);
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(10000);
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.addInitScript(FAKE_ES);
});

test('settings -> browser back to the same session keeps the snapshot and a gap SSE event refreshes it', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-pop-'));
  try {
    const ws = { id: 'w1', name: 'ws', path: root, pinned: true, lastOpenedAt: '1', valid: true };
    let stateCalls = 0;
    await page.route('**/api/workspaces', route => route.fulfill({ json: { workspaces: [ws] } }));
    await page.route('**/api/workspaces/update', route => route.fulfill({ json: { workspace: ws } }));
    await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session('a', 'Session A')] } }));
    await page.route('**/api/activity', route => route.fulfill({ json: { sessions: [] } }));
    await page.route('**/api/quick-prompts', route => route.fulfill({ json: { prompts: [] } }));
    await page.route('**/api/orchestrator*', route => route.fulfill({ json: { available: false } }));
    await page.route('**/api/session/options*', route => route.fulfill({ json: { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] } }));
    await page.route('**/api/session-retention', route => route.fulfill({ json: { enabled: false, days: 30 } }));
    await page.route('**/api/startup', route => route.fulfill({ json: { supported: false, enabled: false, installed: false } }));
    await page.route('**/api/pets', route => route.fulfill({ json: { pets: [] } }));
    await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: snap('w1', 'a', 'BASE') } }));
    // The refresh after the seq gap must return the server's CURRENT data; counting
    // proves the live effect was not restarted (an effect restart would resume again
    // and a discarded refresh would leave BASE on screen).
    await page.route('**/api/state?*', route => { stateCalls++; return route.fulfill({ json: snap('w1', 'a', 'REFRESHED-DATA', 3) }); });
    await page.route('**/api/events?*', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': hold\n\n' }));

    await openChat(page);
    await expect(page.locator('.chat')).toContainText('BASE', { timeout: 15000 });
    await page.waitForFunction(() => (window as any).__streams.length >= 1);
    await page.evaluate(() => (window as any).__open());

    // Open settings then use the real browser back button — same workspace:session
    // scope, so the live connection must survive and no generation bump may occur.
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByRole('region', { name: 'Settings' })).toBeVisible();
    const streamsBefore = await page.evaluate(() => (window as any).__streams.length);
    await page.goBack();
    await expect(page.locator('.chat')).toContainText('BASE', { timeout: 15000 });
    await page.waitForTimeout(300); // any misrouted effect restart would show now
    await expect(page.locator('.chat'), 'the existing snapshot must not be discarded by a scopeless popstate bump').toContainText('BASE');
    expect(await page.evaluate(() => (window as any).__streams.length)).toBe(streamsBefore, 'returning to the same scope must not restart the SSE stream');

    // A gap event (seq 3 while our snapshot is at seq 1) forces a state refresh and
    // the server's newer snapshot must actually be rendered.
    const refreshed = page.waitForResponse(r => r.url().includes('/api/state?'));
    await page.evaluate(event => (window as any).__emit(event), ev('a', 3, 'gap-event'));
    await refreshed;
    await expect(page.locator('.chat')).toContainText('REFRESHED-DATA');
    expect(stateCalls).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: 'test-results/additional-three-fixes/settings-back-resynced.png', fullPage: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('browser back to a different session still rejects a delayed old-scope response', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-popscope-'));
  try {
    const gates = makeGates();
    const ws = { id: 'w1', name: 'ws', path: root, pinned: true, lastOpenedAt: '1', valid: true };
    await page.route('**/api/workspaces', route => route.fulfill({ json: { workspaces: [ws] } }));
    await page.route('**/api/workspaces/update', route => route.fulfill({ json: { workspace: ws } }));
    await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session('a', 'Session A'), session('b', 'Session B')] } }));
    await page.route('**/api/activity', route => route.fulfill({ json: { sessions: [] } }));
    await page.route('**/api/quick-prompts', route => route.fulfill({ json: { prompts: [] } }));
    await page.route('**/api/orchestrator*', route => route.fulfill({ json: { available: false } }));
    await page.route('**/api/session/options*', route => route.fulfill({ json: { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] } }));
    await page.route('**/api/resume', route => { const b = route.request().postDataJSON(); return route.fulfill({ json: { snapshot: snap(b.workspaceId, b.sessionId, `chat-${b.sessionId}`) } }); });
    // Session A's state request is held until released: a delayed old-scope response.
    await page.route('**/api/state?*', async route => {
      const sid = new URL(route.request().url()).searchParams.get('sessionId')!;
      if (sid === 'a') { await gates.wait('state-a'); return route.fulfill({ json: snap('w1', 'a', 'A-STALE-MUST-NOT-APPEAR', 2) }); }
      return route.fulfill({ json: snap('w1', sid, `updated-${sid}`, 2) });
    });
    await page.route('**/api/prompt', route => route.fulfill({ json: { runId: 'r' } }));
    await page.route('**/api/events?*', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': hold\n\n' }));

    await page.goto('/');
    await page.getByLabel('Workspace', { exact: true }).selectOption('w1');
    // Navigate A -> B -> A so that history.back lands on B (a different scope).
    await page.getByLabel('Session list').getByRole('button', { name: /^Session A / }).click();
    await expect(page.locator('.chat')).toContainText('chat-a', { timeout: 15000 });
    await page.getByLabel('Session list').getByRole('button', { name: /^Session B / }).click();
    await expect(page.locator('.chat')).toContainText('chat-b', { timeout: 15000 });
    await page.getByLabel('Session list').getByRole('button', { name: /^Session A / }).click();
    await expect(page.locator('.chat')).toContainText('chat-a', { timeout: 15000 });
    // Send from A but hold A's state refresh; then go back to B.
    await page.getByRole('textbox', { name: 'Prompt' }).fill('from A');
    const sent = page.getByRole('button', { name: 'Send' }).click();
    await gates.observed('state-a');
    await page.goBack();
    await expect(page.locator('.chat')).toContainText('chat-b', { timeout: 15000 });
    gates.release('state-a');
    await sent.catch(() => {});
    await page.waitForTimeout(400); // let the stale A state reply attempt to land
    await expect(page.locator('.chat')).toContainText('chat-b');
    await expect(page.locator('.chat')).not.toContainText('A-STALE-MUST-NOT-APPEAR');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('send clears the submitted input once the POST is accepted even when the state GET fails', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-send-'));
  try {
    const ws = { id: 'w1', name: 'ws', path: root, pinned: true, lastOpenedAt: '1', valid: true };
    let posts = 0, state500 = true;
    await page.route('**/api/workspaces', route => route.fulfill({ json: { workspaces: [ws] } }));
    await page.route('**/api/workspaces/update', route => route.fulfill({ json: { workspace: ws } }));
    await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session('a', 'Session A')] } }));
    await page.route('**/api/activity', route => route.fulfill({ json: { sessions: [] } }));
    await page.route('**/api/quick-prompts', route => route.fulfill({ json: { prompts: [] } }));
    await page.route('**/api/orchestrator*', route => route.fulfill({ json: { available: false } }));
    await page.route('**/api/session/options*', route => route.fulfill({ json: { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] } }));
    await page.route('**/api/resume', route => route.fulfill({ json: { snapshot: snap('w1', 'a', 'BASE') } }));
    await page.route('**/api/prompt', route => { posts++; return route.fulfill({ json: { runId: `run-${posts}` } }); });
    await page.route('**/api/state?*', route => state500
      ? route.fulfill({ status: 500, json: { error: 'state exploded' } })
      : route.fulfill({ json: snap('w1', 'a', 'AFTER-SEND', 2) }));
    await page.route('**/api/events?*', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': hold\n\n' }));

    await openChat(page);
    await expect(page.locator('.chat')).toContainText('BASE', { timeout: 15000 });
    const prompt = page.getByRole('textbox', { name: 'Prompt' });
    await prompt.fill('sent once');
    await page.getByLabel('Choose files').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello file') });
    await expect(page.getByLabel('Attached files')).toContainText('note.txt');
    await page.getByRole('button', { name: 'Send' }).click();
    // POST succeeded, GET failed: the submitted input is cleared and the error is specific.
    await expect(prompt).toHaveValue('', { timeout: 15000 });
    await expect(page.getByLabel('Attached files')).toHaveCount(0);
    await expect(page.locator('.error-card')).toContainText('sent', { timeout: 15000 });
    // Sending has settled. Empty input disables the button and Enter cannot
    // resubmit the accepted prompt either.
    await expect(prompt).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
    await prompt.press('Enter');
    await page.waitForTimeout(400);
    expect(posts).toBe(1);
    await page.screenshot({ path: 'test-results/additional-three-fixes/send-state-failure.png', fullPage: true });
    // Restoration is offered inside the recent-issue details, not the HTTP error
    // card. Deliver a real-shaped failure event to expose that existing control.
    state500 = false;
    await page.evaluate(event => (window as any).__emit(event), {
      ...ev('a', 2, ''), type: 'ErrorEvent', status: 'failed',
      payload: { summary: 'Mock run issue' },
    });
    await page.getByRole('alert', { name: 'Recent tool or run issue' }).locator('details > summary').first().click();
    await page.getByRole('button', { name: 'Restore last prompt' }).click();
    await expect(prompt).toHaveValue('sent once');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => posts).toBe(2);
    await expect(prompt).toHaveValue('');
    await expect(page.locator('.chat')).toContainText('AFTER-SEND');

    // A failed POST keeps the typed prompt and attachments untouched.
    await page.unroute('**/api/prompt');
    let failedPosts = 0;
    await page.route('**/api/prompt', route => { failedPosts++; return route.fulfill({ status: 400, json: { error: 'rejected' } }); });
    await prompt.fill('keep me');
    await page.getByLabel('Choose files').setInputFiles({ name: 'keep.txt', mimeType: 'text/plain', buffer: Buffer.from('keep') });
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.error-card')).toContainText('rejected', { timeout: 15000 });
    expect(failedPosts).toBe(1);
    await expect(prompt).toHaveValue('keep me');
    await expect(page.getByLabel('Attached files')).toContainText('keep.txt');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a scope change mid-send never clears B, and edits during the POST are preserved', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-sendscope-'));
  try {
    const gates = makeGates();
    const ws = { id: 'w1', name: 'ws', path: root, pinned: true, lastOpenedAt: '1', valid: true };
    await page.route('**/api/workspaces', route => route.fulfill({ json: { workspaces: [ws] } }));
    await page.route('**/api/workspaces/update', route => route.fulfill({ json: { workspace: ws } }));
    await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session('a', 'Session A'), session('b', 'Session B')] } }));
    await page.route('**/api/activity', route => route.fulfill({ json: { sessions: [] } }));
    await page.route('**/api/quick-prompts', route => route.fulfill({ json: { prompts: ['Extra context'] } }));
    await page.route('**/api/orchestrator*', route => route.fulfill({ json: { available: false } }));
    await page.route('**/api/session/options*', route => route.fulfill({ json: { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] } }));
    await page.route('**/api/resume', route => { const b = route.request().postDataJSON(); return route.fulfill({ json: { snapshot: snap(b.workspaceId, b.sessionId, `chat-${b.sessionId}`) } }); });
    await page.route('**/api/state?*', route => { const sid = new URL(route.request().url()).searchParams.get('sessionId')!; return route.fulfill({ json: snap('w1', sid, `updated-${sid}`, 2) }); });
    await page.route('**/api/events?*', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': hold\n\n' }));
    await page.route('**/api/prompt', async route => {
      const body = route.request().postDataJSON();
      if (body.sessionId === 'a') await gates.wait('prompt-a'); // held while we switch to B
      return route.fulfill({ json: { runId: 'r' } });
    });

    await page.goto('/');
    await page.getByLabel('Workspace', { exact: true }).selectOption('w1');
    await page.getByLabel('Session list').getByRole('button', { name: /^Session A / }).click();
    await expect(page.locator('.chat')).toContainText('chat-a', { timeout: 15000 });
    await page.getByRole('textbox', { name: 'Prompt' }).fill('from A');
    const sent = page.getByRole('button', { name: 'Send' }).click();
    await gates.observed('prompt-a');
    // Switch to B while A's POST is in flight and type there.
    await page.getByLabel('Session list').getByRole('button', { name: /^Session B / }).click();
    await expect(page.locator('.chat')).toContainText('chat-b', { timeout: 15000 });
    await page.getByRole('textbox', { name: 'Prompt' }).fill('B draft');
    gates.release('prompt-a');
    await sent.catch(() => {});
    await page.waitForTimeout(500); // let A's accepted POST try to clear state
    // B's composer must be untouched by A's completed send.
    await expect(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('B draft');

    // Edits made while the POST is in flight are not wiped by the submitted-clear.
    // The textarea is disabled while sending, so the edit goes through the quick-prompt
    // insert button (not disabled): it calls setPrompt and must survive the clear.
    await page.unroute('**/api/prompt');
    await page.route('**/api/prompt', async route => { await gates.wait('prompt-b'); return route.fulfill({ json: { runId: 'r' } }); });
    const prompt = page.getByRole('textbox', { name: 'Prompt' });
    await prompt.fill('B submitted');
    const sentB = page.getByRole('button', { name: 'Send' }).click();
    await gates.observed('prompt-b');
    await page.locator('.quick-details > summary').click();
    await page.getByRole('button', { name: 'Extra context' }).click();
    await expect(prompt).toHaveValue('B submitted\nExtra context');
    gates.release('prompt-b');
    await sentB;
    await page.waitForTimeout(300);
    await expect(prompt).toHaveValue('B submitted\nExtra context');
  } finally { await rm(root, { recursive: true, force: true }); }
});
