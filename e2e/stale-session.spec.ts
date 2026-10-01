import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// All API endpoints are mocked. Requests that must stay slow until released are held on
// a named gate: the test observes the request arriving (gate set) before releasing, so a
// late A response is guaranteed to land only after the UI shows B.
const session = (id: string, label: string) => ({ id, workspaceId: 'w1', filePath: `/${id}.jsonl`, name: label });
const snap = (wsId: string, id: string, name: string, text: string, seq = 1, generation = `gen-${id}`) => ({
  session: { id, workspaceId: wsId, filePath: `/${id}.jsonl`, name },
  runtime: 'running', activeRunId: undefined,
  chat: [{ id: `${id}-m`, role: 'assistant', text, complete: true }],
  events: [], execution: { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 },
  seq, generation,
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

test.beforeEach(async ({ page }) => {
  // Keep mocked SSE quiet: reconnects must not manufacture extra gated state requests.
  await page.addInitScript(() => {
    (window as any).EventSource = class { close() {} addEventListener() {} };
  });
});

test('switching A->B while prompt acceptance is in flight must not request A state or overwrite B, and B stays operable', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-stale-'));
  try {
    const gates = makeGates();
    let aStateRequests = 0;
    const ws = { id: 'w1', name: 'ws', path: root, pinned: true, lastOpenedAt: '1', valid: true };
    await page.route('**/api/workspaces', route => route.fulfill({ json: { workspaces: [ws] } }));
    await page.route('**/api/workspaces/update', route => route.fulfill({ json: { workspace: ws } }));
    await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session('a', 'Session A'), session('b', 'Session B')] } }));
    await page.route('**/api/activity', route => route.fulfill({ json: { sessions: [] } }));
    await page.route('**/api/quick-prompts', route => route.fulfill({ json: { prompts: [] } }));
    await page.route('**/api/orchestrator*', route => route.fulfill({ json: { available: false } }));
    await page.route('**/api/session/options*', route => route.fulfill({ json: { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] } }));
    // resume returns a snapshot matching the REQUESTED session, not a fixed fixture.
    await page.route('**/api/resume', route => { const b = route.request().postDataJSON(); return route.fulfill({ json: { snapshot: snap(b.workspaceId, b.sessionId, `s-${b.sessionId}`, `chat-${b.sessionId}`) } }); });
    await page.route('**/api/state?*', async route => {
      const sid = new URL(route.request().url()).searchParams.get('sessionId')!;
      if (sid === 'a') { aStateRequests++; return route.fulfill({ json: snap('w1', 'a', 'Session A', 'A reply — must not reach the screen') }); }
      return route.fulfill({ json: snap('w1', sid, `s-${sid}`, `updated-${sid}`, 2) });
    });
    await page.route('**/api/prompt', async route => {
      const b = route.request().postDataJSON();
      if (b.sessionId === 'a') { await gates.wait('prompt-a'); return route.fulfill({ json: { runId: 'run-a' } }); }
      return route.fulfill({ json: { runId: `run-${b.sessionId}` } });
    });
    await page.route('**/api/events?*', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': hold\n\n' }));

    await page.goto('/');
    await page.getByLabel('Workspace', { exact: true }).selectOption('w1');
    await page.getByRole('button', { name: 'Session A Just created' }).click();
    await page.getByRole('textbox', { name: 'Prompt' }).fill('from A');
    const sent = page.getByRole('button', { name: 'Send' }).click();
    await gates.observed('prompt-a'); // the A prompt request is in flight
    await page.getByRole('button', { name: 'Session B Just created' }).click();
    await expect(page.locator('.chat')).toContainText('chat-b', { timeout: 15000 });
    // Release A only after B is showing. Acceptance from the old scope must
    // neither clear B's input nor start an obsolete state request for A.
    const accepted = page.waitForResponse(r => r.url().endsWith('/api/prompt'));
    gates.release('prompt-a');
    await accepted;
    await sent;
    await page.waitForTimeout(500); // let the stale replies attempt to land
    await expect(page.locator('.chat')).toContainText('chat-b');
    await expect(page.locator('.chat')).not.toContainText('A reply');
    expect(aStateRequests).toBe(0);
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
    // B still works: send from B and confirm the seq-2 update is actually applied.
    await page.getByRole('textbox', { name: 'Prompt' }).fill('from B');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue('', { timeout: 15000 });
    await expect(page.locator('.chat')).toContainText('updated-b');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a slow model change on session A must not mark session B busy or apply A options', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-stale-model-'));
  try {
    const gates = makeGates();
    const ws = { id: 'w1', name: 'ws', path: root, pinned: true, lastOpenedAt: '1', valid: true };
    const models = (id: string, current?: string) => ({ models: [{ provider: 'p', id: `m-${id}`, name: `model-${id}` }, { provider: 'p', id: `alt-${id}`, name: `alt-${id}` }], model: { provider: 'p', id: current ?? `m-${id}` }, thinkingLevel: 'off', thinkingLevels: ['off'] });
    await page.route('**/api/workspaces', route => route.fulfill({ json: { workspaces: [ws] } }));
    await page.route('**/api/workspaces/update', route => route.fulfill({ json: { workspace: ws } }));
    await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: [session('a', 'Session A'), session('b', 'Session B')] } }));
    await page.route('**/api/activity', route => route.fulfill({ json: { sessions: [] } }));
    await page.route('**/api/quick-prompts', route => route.fulfill({ json: { prompts: [] } }));
    await page.route('**/api/orchestrator*', route => route.fulfill({ json: { available: false } }));
    await page.route('**/api/session/options*', route => { const sid = new URL(route.request().url()).searchParams.get('sessionId')!; return route.fulfill({ json: models(sid) }); });
    await page.route('**/api/session/model', async route => {
      const body = route.request().postDataJSON();
      if (body.sessionId === 'a') await gates.wait('model-a');
      await route.fulfill({ json: models(body.sessionId, body.modelId) });
    });
    await page.route('**/api/state?*', route => { const sid = new URL(route.request().url()).searchParams.get('sessionId')!; return route.fulfill({ json: snap('w1', sid, `s-${sid}`, `chat-${sid}`) }); });
    await page.route('**/api/resume', route => { const b = route.request().postDataJSON(); return route.fulfill({ json: { snapshot: snap(b.workspaceId, b.sessionId, `s-${b.sessionId}`, `chat-${b.sessionId}`) } }); });
    await page.route('**/api/events?*', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': hold\n\n' }));

    await page.goto('/');
    await page.getByLabel('Workspace', { exact: true }).selectOption('w1');
    await page.getByRole('button', { name: 'Session A Just created' }).click();
    await expect(page.getByLabel('Model', { exact: true })).toBeEnabled({ timeout: 15000 });
    const changed = page.getByLabel('Model', { exact: true }).selectOption('p::alt-a'); // gated
    await gates.observed('model-a');
    await page.getByRole('button', { name: 'Session B Just created' }).click();
    await expect(page.getByLabel('Model', { exact: true })).toBeEnabled({ timeout: 15000 });
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('p::m-b');
    gates.release('model-a');
    await changed.catch(() => {});
    await page.waitForTimeout(400);
    // B is not left busy and still shows its own options — A's result never lands.
    await expect(page.getByLabel('Model', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('p::m-b');
    await page.getByLabel('Model', { exact: true }).selectOption('p::alt-b');
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('p::alt-b');
    await expect(page.getByLabel('Model', { exact: true })).toBeEnabled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('newSession POST delayed across a workspace switch never navigates B to A\u2019s session', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-stale-new-'));
  try {
    const gates = makeGates();
    const ws1 = { id: 'w1', name: 'ws-one', path: root, pinned: true, lastOpenedAt: '1', valid: true };
    const ws2 = { id: 'w2', name: 'ws-two', path: join(root, 'two'), pinned: false, lastOpenedAt: '2', valid: true };
    await page.route('**/api/workspaces', route => route.fulfill({ json: { workspaces: [ws1, ws2] } }));
    await page.route('**/api/workspaces/update', route => route.fulfill({ json: { workspace: route.request().postDataJSON().id === 'w2' ? ws2 : ws1 } }));
    await page.route('**/api/sessions?*', route => { const wid = new URL(route.request().url()).searchParams.get('workspaceId'); return route.fulfill({ json: { sessions: wid === 'w2' ? [session('b2', 'B session')] : [session('a', 'Session A')] } }); });
    await page.route('**/api/activity', route => route.fulfill({ json: { sessions: [] } }));
    await page.route('**/api/quick-prompts', route => route.fulfill({ json: { prompts: [] } }));
    await page.route('**/api/orchestrator*', route => route.fulfill({ json: { available: false } }));
    await page.route('**/api/session/options*', route => route.fulfill({ json: { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] } }));
    await page.route('**/api/state?*', route => { const sid = new URL(route.request().url()).searchParams.get('sessionId')!; return route.fulfill({ json: snap('w1', sid, `s-${sid}`, `chat-${sid}`) }); });
    await page.route('**/api/resume', route => { const b = route.request().postDataJSON(); return route.fulfill({ json: { snapshot: snap(b.workspaceId, b.sessionId, `s-${b.sessionId}`, `chat-${b.sessionId}`) } }); });
    await page.route('**/api/events?*', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': hold\n\n' }));
    await page.route('**/api/sessions', async route => { await gates.wait('create-a'); return route.fulfill({ json: { session: { ...session('new-a', 'New conversation'), workspaceId: 'w1' } } }); });

    await page.goto('/');
    await page.getByLabel('Workspace', { exact: true }).selectOption('w1');
    const created = page.getByRole('button', { name: 'New Session' }).click();
    await gates.observed('create-a'); // the create POST is in flight
    // Switch workspaces while creation is pending.
    await page.getByLabel('Workspace', { exact: true }).selectOption('w2');
    await expect(page.getByRole('button', { name: 'B session Just created' })).toBeVisible({ timeout: 15000 });
    // The stale A create resolves — it must not navigate B's view to A's new session.
    gates.release('create-a');
    await created.catch(() => {});
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: 'B session Just created' })).toBeVisible();
    await expect(page.locator('.session-toolbar')).not.toBeVisible(); // still on B's session list, not pushed into chat
    // The workspace B composer path is usable: its New Session button is not stuck busy.
    await expect(page.getByRole('button', { name: 'New Session' })).toBeEnabled();
    // And a second create works normally (creatingSession flag cleared by navigation).
    await page.unroute('**/api/sessions');
    await page.route('**/api/sessions', route => route.request().method() === 'POST'
      ? route.fulfill({ json: { session: { ...session('new-b', 'New conversation'), workspaceId: 'w2' } } })
      : route.fulfill({ json: { sessions: [session('b2', 'B session')] } }));
    await page.getByRole('button', { name: 'New Session' }).click();
    await expect(page.locator('.chat')).toBeVisible({ timeout: 15000 });
  } finally { await rm(root, { recursive: true, force: true }); }
});
