import { test, expect, type Page, type Route } from '@playwright/test';
import type { Snapshot, ExecutionEvent, ExecutionNode } from '../shared/types.ts';

const workspace = { id: 'status-w', name: 'Status workspace', path: 'C:/status-fixture', valid: true, pinned: false, lastOpenedAt: '2026-10-03T00:00:00Z' };
const sessions = ['A', 'B'].map(id => ({ id, workspaceId: workspace.id, name: `Status ${id}`, filePath: `/${id}.jsonl` }));
function initial(id: string): Snapshot {
  return { session: sessions.find(s => s.id === id)!, runtime: 'running', chat: [{ id: `reply-${id}`, role: 'assistant', text: `Ready ${id}`, complete: true }], events: [], execution: { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 }, seq: 0, generation: `g-${id}`, queue: [] };
}
async function setup(page: Page, mobile: boolean) {
  await page.setViewportSize(mobile ? { width: 390, height: 780 } : { width: 1280, height: 800 });
  const states: Record<string, Snapshot> = { A: initial('A'), B: initial('B') };
  const pending: Route[] = [];
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const w = window as any; w.__statusStreams = [];
    w.EventSource = class extends EventTarget {
      url: string; closed = false; onopen: any; onerror: any;
      constructor(url: string) { super(); this.url = url; w.__statusStreams.push(this); setTimeout(() => this.onopen?.(), 0); }
      close() { this.closed = true; }
    };
  });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === '/api/prompt') { pending.push(route); return; }
    let value: unknown;
    if (path === '/api/workspaces') value = { workspaces: [workspace] };
    else if (path === '/api/workspaces/update' || path === '/api/workspaces/open') value = { workspace };
    else if (path === '/api/sessions') value = { sessions };
    else if (path === '/api/resume') value = { snapshot: states[request.postDataJSON().sessionId] };
    else if (path === '/api/state') value = states[url.searchParams.get('sessionId')!];
    else if (path === '/api/session/options') value = { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] };
    else if (path === '/api/activity') value = { sessions: sessions.map(s => ({ sessionId: s.id, workspaceId: workspace.id, sessionName: s.name, workspaceName: workspace.name, running: true, decisionCount: 0, work: [], updatedAt: workspace.lastOpenedAt })) };
    else if (path === '/api/orchestrator/decisions') value = { decisions: [], canResume: false };
    else if (path.startsWith('/api/orchestrator')) value = { available: false };
    else if (path === '/api/quick-prompts') value = { prompts: [] };
    else if (path === '/api/pets') value = { pets: [] };
    else if (path === '/api/startup') value = { supported: false, enabled: false, installed: false };
    else if (path === '/api/session-retention') value = { enabled: false, days: 30 };
    else throw Error(`Unmocked API: ${path}`);
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  if (mobile) await page.locator('.workspace-card').first().click();
  else await page.getByLabel('Workspace', { exact: true }).selectOption(workspace.id);
  await page.getByLabel('Session list').getByRole('button', { name: /^Status A/ }).click();
  await expect(page.getByLabel('Chat output')).toContainText('Ready A');
  await expect(page.getByRole('status', { name: 'Current conversation status' })).toHaveText('Ready');
  return { states, pending, errors };
}
async function push(page: Page, states: Record<string, Snapshot>, type: ExecutionEvent['type'], patch: Partial<Snapshot> = {}, status?: ExecutionEvent['status']) {
  const before = states.A;
  const event: ExecutionEvent = { schemaVersion: 1, eventId: `e-${before.seq + 1}`, seq: before.seq + 1, generation: before.generation, workspaceId: workspace.id, sessionId: 'A', runId: 'run-A', entityId: 'run-A', timestamp: new Date().toISOString(), source: 'console', certainty: 'observed', type, status, payload: {} };
  states.A = { ...before, ...patch, seq: event.seq, events: [...before.events, event] };
  await page.evaluate(event => (window as any).__statusStreams.filter((s: any) => !s.closed).at(-1).dispatchEvent(new MessageEvent('execution', { data: JSON.stringify(event) })), event);
}
for (const mobile of [false, true]) {
  test(`one conversation status with expandable detail, connection and safety controls: mobile=${mobile}`, async ({ page }) => {
    const { states, errors } = await setup(page, mobile);
    const status = page.getByRole('status', { name: 'Current conversation status' });
    await expect(status).toHaveCount(1);
    await expect(page.getByLabel('connection', { exact: true })).toHaveText('Runtime healthy');
    await expect(page.getByLabel('Active session alerts')).toHaveText('● 2');
    if (!mobile) await expect(page.getByLabel('Activity notifications')).toContainText('Notifications');
    const tool: ExecutionNode = { id: 'tool', parentId: 'run-A', kind: 'tool', label: 'powershell', action: 'Write-Output STATUS_OK', sourceKind: 'pi', status: 'running', correlation: 'explicit', updatedAt: new Date().toISOString() };
    const execution = { ...states.A.execution, nodes: [tool], activeCount: 1 };
    await push(page, states, 'RunStarted', { activeRunId: 'run-A', execution, chat: [...states.A.chat, { id: 'stream', role: 'assistant', text: 'Partial reply', complete: false }] }, 'running');
    await expect(status).toHaveText('Running');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
    await expect(page.getByText('Streaming…', { exact: true })).toHaveCount(0);
    await expect(page.locator('.chat-processing')).toHaveCount(0);
    await expect(page.locator('.conversation-status-body')).not.toBeVisible();
    await page.getByLabel('Conversation status details').click();
    await expect(page.locator('.conversation-status-body')).toContainText('Write-Output STATUS_OK');
    await page.getByLabel('Conversation status details').press('Escape');
    await expect(page.locator('.conversation-status-body')).not.toBeVisible();
    await expect(page.getByLabel('Conversation status details')).toBeFocused();
    await push(page, states, 'DecisionRequired', { execution: { ...execution, decisionCount: 1 } });
    await expect(status).toHaveText('Input required');
    await page.getByLabel('Conversation status details').click();
    await expect(page.getByRole('button', { name: 'Answer in Execution', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Answer in Execution', exact: true }).click();
    await expect.poll(() => page.evaluate(() => history.state.view)).toBe('execution');
    await page.goBack();
    await expect(status).toBeVisible();
    await page.getByLabel('Conversation status details').press('Escape');
    await push(page, states, 'RunCompleted', { activeRunId: undefined, execution: { ...execution, nodes: [], decisionCount: 0, activeCount: 0 } }, 'completed');
    await expect(status).toHaveText('Completed');
    await expect(page.getByLabel('connection', { exact: true })).toHaveText('Runtime healthy');
    const held = { id: 'held', message: 'Uncertain follow-up', revision: 1, queuedAt: new Date().toISOString(), status: 'held' as const };
    // QueueChanged carries the entire queue projection in its payload, unlike other execution events.
    const before = states.A; const event: ExecutionEvent = { ...before.events.at(-1)!, type: 'QueueChanged', eventId: 'held-event', seq: before.seq + 1, payload: { queue: [held], queueHeld: true } };
    states.A = { ...before, queue: [held], queueHeld: true, seq: event.seq, events: [...before.events, event] };
    await page.evaluate(event => (window as any).__statusStreams.filter((s: any) => !s.closed).at(-1).dispatchEvent(new MessageEvent('execution', { data: JSON.stringify(event) })), event);
    await expect(status).toHaveText('Queue paused');
    await expect(page.getByLabel('Queued follow-ups')).toContainText(/delivery (to Pi was not confirmed|unconfirmed)/);
    await expect(page.getByRole('button', { name: 'Resume queued', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
  test(`sending status belongs to the submitted session only: mobile=${mobile}`, async ({ page }) => {
    const { states, pending, errors } = await setup(page, mobile);
    const status = page.getByRole('status', { name: 'Current conversation status' });
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Send in A');
    await page.getByRole('button', { name: /^Send/ }).click();
    await expect.poll(() => pending.length).toBe(1); await expect(status).toHaveText('Sending');
    await page.getByRole('button', { name: 'Switch session', exact: true }).click();
    await page.getByLabel('Session list').getByRole('button', { name: /^Status B/ }).click();
    await expect(status).toHaveText('Ready');
    await page.getByRole('button', { name: 'Switch session', exact: true }).click();
    await page.getByLabel('Session list').getByRole('button', { name: /^Status A/ }).click();
    await expect(status).toHaveText('Sending');
    await expect(page.getByRole('button', { name: /^Send/ })).toBeDisabled();
    await pending[0].fulfill({ json: { runId: 'run-A' } });
    await expect(status).toHaveText('Ready'); // ACK alone is not evidence of an active run.
    await push(page, states, 'RunStarted', { activeRunId: 'run-A' }, 'running');
    await expect(status).toHaveText('Running');
    expect(errors).toEqual([]);
  });
}

test('desktop execution folds by default, grows chat, preserves history state and resets for another session', async ({ page }) => {
  const { errors } = await setup(page, false);
  const panel = page.getByLabel('Execution panel', { exact: true });
  await expect(panel).not.toBeVisible();
  const foldedWidth = (await page.locator('.chat-panel').boundingBox())!.width;
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true }); await prompt.fill('Keep this draft');
  await page.getByRole('button', { name: 'Show execution details', exact: true }).click();
  await expect(panel).toBeVisible();
  expect(foldedWidth).toBeGreaterThan((await page.locator('.chat-panel').boundingBox())!.width + 150);
  await page.getByRole('button', { name: 'History / Canonical Events', exact: true }).click();
  await page.getByRole('button', { name: 'Hide execution details', exact: true }).click();
  await expect(panel).not.toBeVisible(); await expect(prompt).toHaveValue('Keep this draft');
  await page.getByLabel('Conversation status details').click();
  await page.getByRole('button', { name: 'Open execution details', exact: true }).click();
  await expect(panel).toBeVisible(); await expect(page.getByLabel('Execution Event Log')).toBeVisible();
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  await page.getByLabel('Session list').getByRole('button', { name: /^Status B/ }).click();
  await expect(page.getByLabel('Chat output')).toContainText('Ready B'); await expect(panel).not.toBeVisible();
  expect(errors).toEqual([]);
});
test('desktop input auto-opens details; manual fold retains warning and a new question reopens it', async ({ page }) => {
  const { states, errors } = await setup(page, false);
  const decision: ExecutionNode = { id: 'question-1', kind: 'decision', label: 'Confirm first change', status: 'waiting', sourceKind: 'pi', correlation: 'explicit', updatedAt: new Date().toISOString() };
  const execution = { ...states.A.execution, decisionCount: 1, nodes: [decision], rows: [{ node: decision, depth: 0, unattached: false }] };
  await push(page, states, 'DecisionRequired', { execution });
  const panel = page.getByLabel('Execution panel', { exact: true }); await expect(panel).toBeVisible();
  await page.getByRole('button', { name: 'Hide execution details', exact: true }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Show execution details', exact: true })).toHaveAttribute('data-attention', 'true');
  await expect(page.getByRole('status', { name: 'Current conversation status' })).toHaveText('Input required');
  const next = { ...decision, id: 'question-2', label: 'Confirm next change' };
  await push(page, states, 'DecisionRequired', { execution: { ...execution, nodes: [next], rows: [{ node: next, depth: 0, unattached: false }] } });
  await expect(panel).toBeVisible();
  await expect(page.getByLabel('Execution Timeline')).toContainText('Confirm next change');
  expect(errors).toEqual([]);
});
test('desktop interrupted run stays prominent when folded and issue action opens canonical history', async ({ page }) => {
  const { states, errors } = await setup(page, false);
  await push(page, states, 'RunFailed', { runtime: 'failed' }, 'interrupted');
  const panel = page.getByLabel('Execution panel', { exact: true }); await expect(panel).toBeVisible();
  await page.getByRole('button', { name: 'Hide execution details', exact: true }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Show execution details', exact: true })).toHaveAttribute('data-attention', 'true');
  await expect(page.getByRole('status', { name: 'Current conversation status' })).toHaveText('Session interrupted');
  await expect(page.getByText('Pi process stopped unexpectedly', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View in Execution', exact: true }).click();
  await expect(panel).toBeVisible(); await expect(page.getByLabel('Execution Event Log')).toContainText('RunFailed');
  expect(errors).toEqual([]);
});
test('desktop unsaved kit report opens details and retains visible attention after folding', async ({ page }) => {
  const { errors } = await setup(page, false);
  await page.route('**/api/orchestrator?*', route => route.fulfill({ json: { available: true, job: { running: false, runId: 'kit-report', request: 'Prepare report', reportError: 'Report delivery unconfirmed' } } }));
  await page.reload();
  const panel = page.getByLabel('Execution panel', { exact: true }); await expect(panel).toBeVisible();
  await expect(page.getByRole('status', { name: 'Current conversation status' })).toHaveText('Report not saved');
  await expect(page.getByRole('status', { name: 'Orchestrator run status' })).toContainText('Report not saved');
  await page.getByRole('button', { name: 'Hide execution details', exact: true }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Show execution details', exact: true })).toHaveAttribute('data-attention', 'true');
  await expect(page.getByRole('status', { name: 'Current conversation status' })).toHaveText('Report not saved');
  expect(errors).toEqual([]);
});

test('desktop default Execution view and browser Forward reopen details', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pi-console:preferences:v1', JSON.stringify({ defaultSessionView: 'execution' })));
  const { errors } = await setup(page, false);
  const panel = page.getByLabel('Execution panel', { exact: true }); await expect(panel).toBeVisible();
  await page.getByRole('button', { name: 'Hide execution details', exact: true }).click();
  await expect(panel).not.toBeVisible();
  await page.goBack(); await expect.poll(() => page.evaluate(() => history.state.view)).toBe('sessions');
  await page.goForward(); await expect(panel).toBeVisible();
  expect(errors).toEqual([]);
});
test('desktop historical failure count alone does not override completed status or force details open', async ({ page }) => {
  const { states } = await setup(page, false);
  await push(page, states, 'RunCompleted', { execution: { ...states.A.execution, failedCount: 3 } }, 'completed');
  await expect(page.getByRole('status', { name: 'Current conversation status' })).toHaveText('Completed');
  await expect(page.getByLabel('Execution panel', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Show execution details', exact: true })).toHaveAttribute('data-attention', 'false');
});

test('mobile workspace menu supports keyboard, editing focus, retained scope/draft and desktop fallback', async ({ page }) => {
  const { errors } = await setup(page, true);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true }); await prompt.fill('Retain the conversation draft');
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  const summary = page.locator('.workspace-menu:visible > summary');
  const host = page.getByRole('button', { name: 'Open on host PC', exact: true });
  await expect(host).not.toBeVisible();
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(host).toHaveCount(1); await expect(host).toBeVisible();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Edit selected workspace', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(host).toBeFocused();
  await page.keyboard.press('Escape'); await expect(host).not.toBeVisible(); await expect(summary).toBeFocused();
  await expect.poll(() => page.evaluate(() => history.state.session)).toBe('A');
  await page.keyboard.press('Enter'); await page.getByRole('button', { name: 'Edit selected workspace', exact: true }).click();
  await expect(page.getByLabel('Rename workspace')).toBeFocused();
  await expect.poll(() => page.evaluate(() => history.state.session)).toBe('A');
  await page.getByRole('button', { name: 'Hide workspace tools', exact: true }).click();
  await expect(page.getByLabel('Rename workspace')).not.toBeVisible(); await expect(summary).toBeFocused();
  await page.goBack(); await expect(summary).toBeVisible(); await expect(host).not.toBeVisible();
  await page.getByLabel('Session list').getByRole('button', { name: /^Status A/ }).click();
  await expect(prompt).toHaveValue('Retain the conversation draft');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('.workspace-menu')).toHaveCount(0); await expect(host).toHaveCount(1); await expect(host).toBeVisible();
  await page.setViewportSize({ width: 320, height: 360 });
  await page.locator('.session-toolbar > button').click();
  await summary.click(); await expect(host).toBeVisible();
  const box = (await host.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320); expect(box.y + box.height).toBeLessThanOrEqual(360);
  await page.keyboard.press('Escape'); await expect(summary).toBeFocused();
  expect(errors).toEqual([]);
});
test('workspace host menu keeps pending-send scope, disables repeated host calls and exposes errors after closing', async ({ page }) => {
  const { states, pending, errors } = await setup(page, true);
  const hostRequests: Route[] = [];
  await page.route('**/api/workspaces/explorer', route => { expect(route.request().postDataJSON()).toEqual({ id: workspace.id }); hostRequests.push(route); });
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true }); await prompt.fill('Pending send survives menus');
  await page.getByRole('button', { name: 'Send', exact: true }).click(); await expect.poll(() => pending.length).toBe(1);
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  const summary = page.locator('.workspace-menu:visible > summary');
  await summary.click(); await page.getByRole('button', { name: 'Open on host PC', exact: true }).click();
  await expect.poll(() => hostRequests.length).toBe(1); await expect(summary).toBeFocused();
  await summary.click(); await expect(page.getByRole('button', { name: 'Open on host PC', exact: true })).toBeDisabled();
  await hostRequests[0].fulfill({ status: 500, json: { error: 'Host Windows desktop unavailable' } });
  await expect(page.locator('.session-context .workspace-explorer-notice')).toHaveText('Host Windows desktop unavailable');
  await page.keyboard.press('Escape'); await expect(summary).toBeFocused();
  await expect(page.locator('.session-context .workspace-explorer-notice')).toBeVisible();
  await page.getByLabel('Session list').getByRole('button', { name: /^Status A/ }).click();
  await expect(prompt).toHaveValue('Pending send survives menus'); await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(pending).toHaveLength(1); expect(hostRequests).toHaveLength(1);
  await pending[0].fulfill({ json: { snapshot: states.A } }); await expect(prompt).toHaveValue('');
  expect(errors).toEqual([]);
});
test('mobile workspace menu bounds long names and keeps its host action reachable', async ({ page }) => {
  const { errors } = await setup(page, true);
  const name = 'Workspace_' + 'LongUnbrokenName'.repeat(24);
  await page.route('**/api/workspaces', route => route.fulfill({ json: { workspaces: [{ ...workspace, name }] } }));
  await page.setViewportSize({ width: 320, height: 780 }); await page.reload();
  await expect(page.getByLabel('Chat output')).toContainText('Ready A');
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  await page.locator('.workspace-menu:visible > summary').click();
  const host = page.getByRole('button', { name: 'Open on host PC', exact: true }); await host.scrollIntoViewIfNeeded();
  const box = (await host.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320); expect(box.y + box.height).toBeLessThanOrEqual(780);
  const body = page.locator('.workspace-menu:visible .workspace-menu-body');
  expect((await body.boundingBox())!.height).toBeLessThanOrEqual(780 * .4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(errors).toEqual([]);
});

test('mobile session menu retains selection, supports Escape and cancelling recycling restores focus', async ({ page }) => {
  const { errors } = await setup(page, true);
  let recycled = 0; await page.route('**/api/session/recycle', route => { recycled++; return route.fulfill({ json: { ok: true } }); });
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Session menu for Status A', exact: true });
  const recycle = page.getByRole('button', { name: 'Move Status A to Recycle Bin', exact: true });
  await expect(recycle).not.toBeVisible(); await trigger.focus(); await page.keyboard.press('Enter');
  await expect(recycle).toBeVisible(); await expect(page.getByLabel('Session list').locator('.session-row > button').first()).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => page.evaluate(() => history.state.session)).toBe('A');
  await page.keyboard.press('Tab'); await expect(recycle).toBeFocused();
  await page.keyboard.press('Escape'); await expect(recycle).not.toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.click(); page.once('dialog', async dialog => { expect(dialog.message()).toContain('this server’s Windows Recycle Bin'); expect(dialog.message()).toContain('other apps'); await dialog.dismiss(); });
  await recycle.click(); await expect(trigger).toBeFocused(); await expect(recycle).not.toBeVisible(); expect(recycled).toBe(0);
  await page.setViewportSize({ width: 1280, height: 800 }); await expect(trigger).toHaveCount(0); await expect(recycle).toBeVisible();
  expect(errors).toEqual([]);
});
test('session menu disables running, input-required and pending-ACK recycling without locking another session', async ({ page }) => {
  const { pending, states } = await setup(page, true);
  let protectedRows = true;
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: sessions.map(s => ({ ...s, running: protectedRows && s.id === 'A', decisionCount: protectedRows && s.id === 'B' ? 1 : 0 })) } }));
  await page.reload(); await expect(page.getByLabel('Chat output')).toContainText('Ready A');
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  for (const id of ['A', 'B']) {
    await page.getByRole('button', { name: `Session menu for Status ${id}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Move Status ${id} to Recycle Bin`, exact: true })).toBeDisabled();
  }
  protectedRows = false; await page.getByLabel('Session list').getByRole('button', { name: /^Status A/ }).click(); await page.reload();
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('ACK pending'); await page.getByRole('button', { name: 'Send', exact: true }).click(); await expect.poll(() => pending.length).toBe(1);
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  await page.getByRole('button', { name: 'Session menu for Status A', exact: true }).click(); await expect(page.getByRole('button', { name: 'Move Status A to Recycle Bin', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Session menu for Status B', exact: true }).click(); await expect(page.getByRole('button', { name: 'Move Status B to Recycle Bin', exact: true })).toBeEnabled();
  await pending[0].fulfill({ json: { snapshot: states.A } }); await expect(page.getByRole('button', { name: 'Move Status A to Recycle Bin', exact: true })).toBeEnabled();
});
test('late recycling of A removes only its row and does not clear B snapshot, draft or pending send', async ({ page }) => {
  const { pending, states, errors } = await setup(page, true);
  let recycled = false;
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: recycled ? sessions.filter(s => s.id !== 'A') : sessions } }));
  const requests: Route[] = []; await page.route('**/api/session/recycle', route => { expect(route.request().postDataJSON()).toEqual({ workspaceId: workspace.id, sessionId: 'A' }); requests.push(route); });
  await page.getByRole('button', { name: 'Switch session', exact: true }).click(); await page.getByRole('button', { name: 'Session menu for Status A', exact: true }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Move Status A to Recycle Bin', exact: true }).click(); await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('button', { name: 'Session menu for Status A', exact: true }).click(); await expect(page.getByRole('button', { name: 'Move Status A to Recycle Bin', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Session list').locator('.session-row > button').first()).toBeDisabled();
  await page.getByLabel('Session list').getByRole('button', { name: /^Status B/ }).click(); await expect(page.getByLabel('Chat output')).toContainText('Ready B');
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true }); await prompt.fill('Keep B send'); await page.getByRole('button', { name: 'Send', exact: true }).click(); await expect.poll(() => pending.length).toBe(1);
  recycled = true; await requests[0].fulfill({ json: { ok: true } });
  await expect(page.getByLabel('Chat output')).toContainText('Ready B'); await expect(prompt).toHaveValue('Keep B send'); await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => history.state.session)).toBe('B');
  await pending[0].fulfill({ json: { snapshot: states.B } }); await expect(prompt).toHaveValue('');
  await page.getByRole('button', { name: 'Switch session', exact: true }).click(); await expect(page.getByRole('button', { name: 'Session menu for Status A', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(1); expect(errors).toEqual([]);
});
test('pending recycle blocks sending after browser Back; failure releases only its lock and preserves the draft', async ({ page }) => {
  const { pending, errors } = await setup(page, true);
  const requests: Route[] = []; await page.route('**/api/session/recycle', route => { requests.push(route); });
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Do not send while moving');
  await page.getByRole('button', { name: 'Switch session', exact: true }).click(); await page.getByRole('button', { name: 'Session menu for Status A', exact: true }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Move Status A to Recycle Bin', exact: true }).click(); await expect.poll(() => requests.length).toBe(1);
  await page.goBack(); const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true }); await expect(prompt).toHaveValue('Do not send while moving');
  await expect(page.getByText("Moving this session to the server's Windows Recycle Bin…", { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await prompt.press('Enter'); expect(pending).toHaveLength(0);
  await requests[0].fulfill({ status: 500, json: { error: 'Recycle Bin unavailable' } });
  await expect(page.getByText('Recycle Bin unavailable', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled(); await expect(prompt).toHaveValue('Do not send while moving');
  expect(errors).toEqual([]);
});
test('late recycle failure stays on A row and does not overwrite B send error', async ({ page }) => {
  const { errors } = await setup(page, true);
  const requests: Route[] = []; await page.route('**/api/session/recycle', route => { requests.push(route); });
  await page.getByRole('button', { name: 'Switch session', exact: true }).click(); await page.getByRole('button', { name: 'Session menu for Status A', exact: true }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Move Status A to Recycle Bin', exact: true }).click(); await expect.poll(() => requests.length).toBe(1);
  await page.getByLabel('Session list').getByRole('button', { name: /^Status B/ }).click(); await expect(page.getByLabel('Chat output')).toContainText('Ready B');
  await page.route('**/api/prompt', route => route.fulfill({ status: 500, json: { error: 'B send rejected' } }));
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Keep B error'); await page.getByRole('button', { name: 'Send', exact: true }).click(); await expect(page.getByText('B send rejected', { exact: true })).toBeVisible();
  await requests[0].fulfill({ status: 500, json: { error: 'A recycle denied' } });
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  await expect(page.getByText('B send rejected', { exact: true })).toBeVisible(); await expect(page.getByText('Could not move this session: A recycle denied', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => history.state.session)).toBe('B');
  expect(errors).toEqual([]);
});
for (const viewport of [{width:1280,height:800},{width:1024,height:600},{width:920,height:420},{width:390,height:780},{width:320,height:568},{width:844,height:390}]) test(`session list stays inside its panel with many long rows: ${viewport.width}x${viewport.height}`, async ({page})=>{
  const mobile=viewport.width<=900; await setup(page,mobile); await page.setViewportSize(viewport);
  const rows=Array.from({length:40},(_,index)=>({...sessions[0],id:index===0?'A':`many-${index}`,name:`Session ${index} ${'LongUnbrokenTitle'.repeat(20)}`,updatedAt:'2026-10-04T00:00:00Z'}));
  await page.route('**/api/sessions?*',route=>route.fulfill({json:{sessions:rows}})); await page.route('**/api/activity',route=>route.fulfill({json:{sessions:[]}})); await page.reload();
  if(mobile) await page.getByRole('button',{name:'Switch session',exact:true}).click();
  const list=page.getByLabel('Session list'),panel=page.locator('.session-panel'); await expect(list.locator('.session-row')).toHaveCount(40);
  const metrics=await panel.evaluate(panel=>{const list=panel.querySelector('.session-list')!,sidebar=panel.closest('.sidebar')!,content=document.querySelector('.chat-panel')!;const box=(element:Element)=>{const b=element.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight}};return {panel:box(panel),list:box(list),sidebar:box(sidebar),content:box(content)}});
  console.log(JSON.stringify({viewport,metrics}));
  expect(metrics.list.right).toBeLessThanOrEqual(metrics.panel.right); expect(metrics.list.bottom).toBeLessThanOrEqual(metrics.panel.bottom); expect(metrics.list.scrollWidth).toBeLessThanOrEqual(metrics.list.clientWidth);
  if(!mobile)expect(metrics.sidebar.bottom).toBeLessThanOrEqual(metrics.content.bottom+1);
  const last=list.locator('.session-row').last(); await last.scrollIntoViewIfNeeded(); await expect(last).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  if(mobile){const trigger=last.getByRole('button',{name:/Session menu/});await trigger.click();await last.getByRole('button',{name:/Move .* to Recycle Bin/}).scrollIntoViewIfNeeded();}
  await page.screenshot({path:`.pi-console/sessions-bounds-${viewport.width}x${viewport.height}.png`});
});

test('compact session menus keep long titles bounded and last-row actions reachable in short viewports', async ({ page }) => {
  const { errors } = await setup(page, true);
  const name = 'Conversation_' + 'LongUnbrokenTitle'.repeat(24);
  await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: sessions.map(s => s.id === 'A' ? { ...s, name } : s) } }));
  await page.reload(); await expect(page.getByLabel('Chat output')).toContainText('Ready A');
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  await expect(page.getByRole('button', { name: `Session menu for ${name}`, exact: true })).toHaveAttribute('title', `Session menu · ${name}`);
  for (const [width, height] of [[320, 568], [844, 390], [320, 360]]) {
    await page.setViewportSize({ width, height });
    const trigger = page.getByRole('button', { name: 'Session menu for Status B', exact: true }); await trigger.click();
    const recycle = page.getByRole('button', { name: 'Move Status B to Recycle Bin', exact: true }); await recycle.scrollIntoViewIfNeeded();
    const box = (await recycle.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape'); await expect(recycle).not.toBeVisible(); await expect(trigger).toBeFocused();
  }
  expect(errors).toEqual([]);
});
