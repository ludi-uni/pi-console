import { test, expect, type Page, type Browser } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Two independent browser contexts (PC + phone) run the real built web/main.tsx against
// mocked APIs and a controllable Fake EventSource. Simulates a server restart that resets
// seq 100 -> 0 and mints a new generation: each client must re-baseline on resume/state
// and reject late events from the old connection without them closing the new stream.

const FAKE_ES = `
window.__streams = [];
window.EventSource = class {
  constructor(url){ this.url = url; this.listeners = {}; this.closed = false; this.id = window.__streams.length; window.__streams.push(this); }
  addEventListener(t, f){ (this.listeners[t] ??= []).push(f); }
  close(){ this.closed = true; }
};
window.__emit = (id, ev) => { const s = window.__streams[id]; for (const f of s.listeners['execution'] ?? []) f(new MessageEvent('execution', { data: JSON.stringify(ev) })); };
window.__error = id => { const s = window.__streams[id]; s.onerror && s.onerror(); };
window.__open = id => { const s = window.__streams[id]; s.onopen && s.onopen(); };
`;

const ws = { id: 'w1', name: 'ws', path: 'C:\\tmp\\ws', pinned: true, lastOpenedAt: '1', valid: true };
const sess = { id: 's1', workspaceId: 'w1', filePath: 'C:\\tmp\\ws\\s.jsonl', name: 'Session' };
const snap = (gen: string, seq: number, text = '') => ({
  session: sess, runtime: 'running', activeRunId: undefined,
  chat: text ? [{ id: `${gen}-m`, role: 'user', text, complete: true }] : [],
  events: [], execution: { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 },
  seq, generation: gen,
});
const ev = (gen: string, seq: number, extra: object = {}) => ({
  schemaVersion: 1, eventId: `ev-${gen}-${seq}`, seq, generation: gen, timestamp: new Date().toISOString(),
  workspaceId: 'w1', sessionId: 's1', runId: 'run', type: 'MessageCompleted', entityId: `e-${seq}`,
  source: 'pi-rpc', certainty: 'observed', payload: { role: 'user', text: `GEN-${gen}-MSG-${seq}` }, ...extra,
});

async function openClient(browser: Browser, genRef: { current: string }, root: string): Promise<Page> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(FAKE_ES);
  const page = await ctx.newPage();
  await page.route('**/api/workspaces', r => r.fulfill({ json: { workspaces: [ws] } }));
  await page.route('**/api/workspaces/update', r => r.fulfill({ json: { workspace: ws } }));
  await page.route('**/api/sessions?*', r => r.fulfill({ json: { sessions: [sess] } }));
  await page.route('**/api/activity', r => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/quick-prompts', r => r.fulfill({ json: { prompts: [] } }));
  await page.route('**/api/orchestrator*', r => r.fulfill({ json: { available: false } }));
  await page.route('**/api/session/options*', r => r.fulfill({ json: { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] } }));
  // resume/state honour the current mock server generation (genRef flips on "restart").
  await page.route('**/api/resume', r => r.fulfill({ json: { snapshot: snap(genRef.current, genRef.current === 'old' ? 100 : 0, 'old-chat') } }));
  await page.route('**/api/state?*', r => r.fulfill({ json: snap(genRef.current, genRef.current === 'old' ? 100 : 0, 'old-chat') }));
  // EventSource is faked via init script; real EventSource never fires.
  await page.route('**/api/events?*', r => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': hold\n\n' }));
  await page.goto('/');
  await page.getByLabel('Workspace', { exact: true }).selectOption('w1');
  await page.getByRole('button', { name: 'Session Just created' }).click();
  await page.waitForFunction(() => window.__streams.length >= 1);
  return page;
}

const streamsOf = (page: Page) => page.evaluate(() => (window as any).__streams.map((s: any) => ({ url: s.url, closed: s.closed })));

test('server restart re-baselines PC and phone to the new generation; old-connection late events are dropped', async ({ browser }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-gen-'));
  const gen = { current: 'old' };
  try {
    const pc = await openClient(browser, gen, root);
    const phone = await openClient(browser, gen, root);
    await expect(pc.locator('.chat')).toContainText('old-chat', { timeout: 15000 });
    await expect(phone.locator('.chat')).toContainText('old-chat', { timeout: 15000 });

    // "Restart": the mock now serves generation=new at seq 0.
    gen.current = 'new';
    // PC's stream dies first.
    await pc.evaluate(() => (window as any).__error(0));
    await pc.waitForFunction(() => (window as any).__streams.length >= 2, undefined, { timeout: 15000 });
    // The phone is still on the old stream. Late old-gen events there must not surface
    // on the phone UI once it re-bases — but they are legitimate on the old stream until then.
    await phone.evaluate(() => (window as any).__emit(0, { schemaVersion: 1, eventId: 'old-late', seq: 101, generation: 'old', timestamp: new Date().toISOString(), workspaceId: 'w1', sessionId: 's1', runId: 'r', type: 'MessageCompleted', entityId: 'old-m', source: 'pi-rpc', certainty: 'observed', payload: { role: 'user', text: 'OLD-ONLY' } }));
    await expect(phone.locator('.chat')).toContainText('OLD-ONLY'); // phone's old connection still lives
    // Now phone's old stream dies too; it re-baselines to generation=new, seq 0.
    await phone.evaluate(() => (window as any).__error(0));
    await phone.waitForFunction(() => (window as any).__streams.length >= 2, undefined, { timeout: 15000 });
    await expect(phone.locator('.chat')).not.toContainText('OLD-ONLY', { timeout: 15000 });

    // Old-stream late events and errors must not reach the new screen or kill the new stream.
    for (const page of [pc, phone]) {
      await page.evaluate(() => (window as any).__emit(0, { schemaVersion: 1, eventId: 'stale', seq: 1, generation: 'old', timestamp: new Date().toISOString(), workspaceId: 'w1', sessionId: 's1', runId: 'r', type: 'MessageCompleted', entityId: 'stale-m', source: 'pi-rpc', certainty: 'observed', payload: { role: 'user', text: 'STALE-MSG' } }));
      await page.evaluate(() => (window as any).__error(0));
    }
    const pcStreams = await streamsOf(pc);
    expect(pcStreams.at(-1)?.closed).toBe(false, 'old stream error must not close the new stream');
    await expect(pc.locator('.chat')).not.toContainText('STALE-MSG');
    await expect(phone.locator('.chat')).not.toContainText('STALE-MSG');

    // A live new-generation event (seq 1) reaches BOTH clients.
    for (const page of [pc, phone]) {
      await page.evaluate(() => (window as any).__emit(1, { schemaVersion: 1, eventId: 'n1', seq: 1, generation: 'new', timestamp: new Date().toISOString(), workspaceId: 'w1', sessionId: 's1', runId: 'r', type: 'MessageCompleted', entityId: 'n1-m', source: 'pi-rpc', certainty: 'observed', payload: { role: 'user', text: 'NEW-GEN-MSG' } }));
    }
    await expect(pc.locator('.chat')).toContainText('NEW-GEN-MSG');
    await expect(phone.locator('.chat')).toContainText('NEW-GEN-MSG');
    // Same-generation lower/duplicate seq on the live stream is rejected (no dup render).
    await pc.evaluate(() => (window as any).__emit(1, { schemaVersion: 1, eventId: 'dup', seq: 1, generation: 'new', timestamp: new Date().toISOString(), workspaceId: 'w1', sessionId: 's1', runId: 'r', type: 'MessageCompleted', entityId: 'dup-m', source: 'pi-rpc', certainty: 'observed', payload: { role: 'user', text: 'DUP-MSG' } }));
    await pc.waitForTimeout(300);
    await expect(pc.locator('.chat')).not.toContainText('DUP-MSG');
    // The new stream stays connected after the stale onerror storm.
    expect((await streamsOf(pc)).at(-1)?.closed).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
