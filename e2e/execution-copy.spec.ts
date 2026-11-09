import { test, expect, type Page } from '@playwright/test';

// Focused checks for Execution failed-log copying: per-event Copy log buttons on
// failed/error/interrupted history rows (including the pinned older-than-200
// selection), full node context copy that merges canonical events, the manual
// textarea fallback when the Clipboard API is unavailable or rejects, and ja
// labels. All APIs/SSE are mocked: no Pi, no model calls.
const workspaces = [{ id: 'A', name: 'Workspace A', path: 'C:/A', valid: true, lastOpenedAt: '2026-10-03T00:00:00Z' }];
const sessionRow = { id: 'A', workspaceId: 'A', name: 'Chat A', filePath: '/A.jsonl' };

const MULTILINE = 'compile error line 1\nat src/app.ts:42\nstack frame follows';
const eventBase = {
  schemaVersion: 1, generation: 'g-A', workspaceId: 'A', sessionId: 'A',
  runId: 'run-1', source: 'pi-rpc', certainty: 'observed', timestamp: '2026-10-03T01:00:00Z',
};
const failedEvent = {
  ...eventBase, eventId: 'fail-1', seq: 1, type: 'ToolFailed',
  entityId: 'pi-tool:run-1:call-1', parentId: 'run-1', toolCallId: 'call-1',
  sourceRef: { kind: 'pi', nativeId: 'call-1' }, status: 'failed',
  payload: { summary: 'powershell exited with an error', stderr: MULTILINE, exitCode: 3 },
};
// Real-shaped node: the projection keeps only contentBlocks — the failure
// reason lives only on the canonical ToolFailed event.
const failedNode = {
  id: 'pi-tool:run-1:call-1', kind: 'tool', label: 'powershell', status: 'failed',
  parentId: 'run-1', correlation: 'derived-safe', sourceKind: 'pi', nativeId: 'call-1',
  action: 'exit 3', updatedAt: '2026-10-03T01:00:00Z', endedAt: '2026-10-03T01:00:00Z',
  details: { contentBlocks: 2 },
};
const interruptedNode = {
  id: 'agent-1', kind: 'agent', label: 'reviewer', status: 'interrupted',
  correlation: 'explicit', sourceKind: 'pi-subagents', updatedAt: '2026-10-03T01:01:00Z',
  endedAt: '2026-10-03T01:01:00Z', attempt: 2, model: 'm-x', provider: 'p',
  attempts: [{ attempt: 1, model: 'm-x', failureClass: 'MODEL_FAILURE' }, { attempt: 2, failureClass: 'CANCELLED' }],
  details: { reason: 'run was interrupted by the user' },
};
const runNode = { id: 'run-1', kind: 'run', label: 'Pi run 1', status: 'completed', correlation: 'explicit', sourceKind: 'pi', updatedAt: '2026-10-03T01:00:00Z' };
const execution = {
  nodes: [runNode, failedNode, interruptedNode], roots: [runNode.id], unattached: [interruptedNode.id],
  rows: [
    { node: runNode, depth: 0, unattached: false },
    { node: failedNode, depth: 1, unattached: false },
    { node: interruptedNode, depth: 0, unattached: true },
  ],
  activeCount: 0, failedCount: 2, decisionCount: 0,
};
const olderEvents = Array.from({ length: 230 }, (_, i) => ({
  ...eventBase, eventId: `progress-${i}`, seq: 10 + i, type: 'ToolProgress',
  entityId: `tool-${i}`, status: 'running', payload: { summary: `Progress ${i}` },
}));
const snapshot = (overrides: any = {}) => ({
  session: sessionRow, runtime: 'running', chat: [{ id: 'm-A', role: 'assistant', text: 'done', complete: true }],
  events: [failedEvent, ...olderEvents], execution, seq: 300, generation: 'g-A', queue: [], ...overrides,
});

async function setup(page: Page, options: { language?: 'en' | 'ja'; clipboard?: 'grant' | 'reject' | 'remove'; olderIssue?: boolean } = {}) {
  await page.setViewportSize({ width: 1280, height: 800 });
  if (options.clipboard === 'grant') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(({ language, clipboard }) => {
    (window as any).EventSource = class extends EventTarget { close() {} };
    if (language) localStorage.setItem('pi-console:preferences:v1', JSON.stringify({ language }));
    if (clipboard === 'reject') navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    if (clipboard === 'remove') Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  }, { language: options.language ?? '', clipboard: options.clipboard ?? '' });
  const recentFailure = { ...failedEvent, timestamp: new Date().toISOString() };
  const currentSnapshot = () => snapshot({ events: options.olderIssue ? [recentFailure, ...olderEvents] : [...olderEvents, failedEvent] });
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let value: unknown = {};
    if (path === '/api/workspaces') value = { workspaces };
    else if (path === '/api/sessions') value = { sessions: [sessionRow] };
    else if (path === '/api/workspaces/update') value = { workspace: workspaces[0] };
    else if (path === '/api/resume') value = { snapshot: currentSnapshot() };
    else if (path === '/api/state') value = currentSnapshot();
    else if (path === '/api/session/options') value = { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] };
    else if (path === '/api/activity') value = { sessions: [] };
    else if (path === '/api/quick-prompts') value = { prompts: [] };
    else if (path.startsWith('/api/orchestrator')) value = { available: false };
    else if (path === '/api/pets') value = { pets: [] };
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await page.getByLabel('Workspace', { exact: true }).selectOption('A');
  await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click();
  await expect(page.getByLabel('Chat output')).toContainText('done');
  const showExecution = page.getByRole('button', { name: 'Show execution details', exact: true });
  if (await showExecution.isVisible()) await showExecution.click();
}

test('a failed event row copies the full untruncated multiline payload plus identifiers', async ({ page }) => {
  await setup(page, { clipboard: 'grant' });
  await page.getByRole('button', { name: 'History / Canonical Events' }).click();
  const log = page.getByLabel('Execution Event Log');
  // Only the failed event offers a copy control; progress rows do not.
  await expect(log.getByRole('button', { name: 'Copy full ToolFailed log' })).toHaveCount(1);
  await log.getByRole('button', { name: 'Copy full ToolFailed log' }).click();
  const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  for (const part of [
    'Type: ToolFailed', 'Status: failed', 'Source: pi', 'Source native ID: call-1',
    'Event ID: fail-1', 'Entity ID: pi-tool:run-1:call-1', 'Run ID: run-1', 'Session ID: A',
    'summary: powershell exited with an error', `stderr: ${MULTILINE}`, 'exitCode: 3',
  ]) expect(text, part).toContain(part);
  await expect(page.getByRole('status').filter({ hasText: 'Copied' }).last()).toBeVisible();
});

test('the selected issue older than the visible window keeps a working Copy log', async ({ page }) => {
  // Keep the seven-second issue toast fresh throughout setup and navigation.
  await page.clock.setFixedTime(new Date());
  await setup(page, { clipboard: 'grant', olderIssue: true });
  // The failure toast pins the event into History via "View in Execution" even
  // though it is older than the first 200-event window.
  const toast = page.getByRole('alert', { name: 'Recent tool or run issue' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'View in Execution' }).click();
  const log = page.getByLabel('Execution Event Log');
  const pinned = log.locator('[data-selected-issue="true"]');
  await expect(pinned).toContainText('powershell exited with an error');
  await expect(pinned).toContainText('Selected issue · older than recent events');
  await pinned.getByRole('button', { name: 'Copy full ToolFailed log' }).click();
  const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  expect(text).toContain('Event ID: fail-1');
  expect(text).toContain(`stderr: ${MULTILINE}`);
});

test('failed and interrupted node Copy context includes full details and event-carried reason', async ({ page }) => {
  await setup(page, { clipboard: 'grant' });
  // Tree view is the default: both terminal nodes show the Copy context control.
  const panel = page.getByRole('region', { name: 'Execution panel' });
  // Settled tool nodes are shown inside their parent's expanded tool history.
  await panel.locator('.execution-node').filter({ hasText: 'Pi run 1' }).getByRole('button', { name: 'Show tool details / metadata' }).click();
  const copyButtons = panel.getByRole('button', { name: 'Copy context', exact: true });
  await expect(copyButtons).toHaveCount(2);
  await copyButtons.first().click();
  const toolText = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  for (const part of [
    'Label: powershell', 'Status: failed', 'Action: exit 3', '"contentBlocks": 2',
    'Related events:', 'Type: ToolFailed', 'summary: powershell exited with an error', `stderr: ${MULTILINE}`,
  ]) expect(toolText, part).toContain(part);
  await copyButtons.nth(1).click();
  const agentText = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  for (const part of [
    'Label: reviewer', 'Status: interrupted', 'Attempt: 2', 'Model: p / m-x',
    'Attempt 1: m-x · MODEL_FAILURE', 'Attempt 2: CANCELLED', '"reason": "run was interrupted by the user"',
  ]) expect(agentText, part).toContain(part);
});

test('a rejected clipboard write shows a focused, selectable fallback with the full text — never a false success', async ({ page }) => {
  await setup(page, { clipboard: 'reject' });
  await page.getByRole('button', { name: 'History / Canonical Events' }).click();
  await page.getByRole('button', { name: 'Copy full ToolFailed log' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Copied$/ })).toHaveCount(0);
  const fallback = page.getByRole('group', { name: 'Manual copy' });
  await expect(fallback).toBeVisible();
  const box = fallback.getByLabel('Full event log text to copy');
  await expect(box).toBeFocused();
  const value = await box.inputValue();
  expect(value).toContain('summary: powershell exited with an error');
  expect(value).toContain(`stderr: ${MULTILINE}`);
  // The textarea contents are preselected for a single keystroke copy.
  await expect.poll(() => box.evaluate(el => (el as HTMLTextAreaElement).selectionEnd - (el as HTMLTextAreaElement).selectionStart)).toBe(value.length);
  await fallback.getByRole('button', { name: 'Dismiss' }).click();
  await expect(fallback).toHaveCount(0);
});

test('an unavailable Clipboard API takes the same manual fallback path', async ({ page }) => {
  await setup(page, { clipboard: 'remove' });
  await page.getByRole('button', { name: 'History / Canonical Events' }).click();
  await page.getByRole('button', { name: 'Copy full ToolFailed log' }).click();
  const fallback = page.getByRole('group', { name: 'Manual copy' });
  await expect(fallback).toBeVisible();
  await expect(fallback.getByLabel('Full event log text to copy')).toHaveValue(/Entity ID: pi-tool:run-1:call-1/);
});

test('ja language renders localized copy labels and fallback', async ({ page }) => {
  await setup(page, { language: 'ja', clipboard: 'reject' });
  await page.getByRole('button', { name: 'History / Canonical Events' }).click();
  await page.getByRole('button', { name: 'このToolFailedイベントの完全なログをコピー' }).click();
  const fallback = page.getByRole('group', { name: '手動コピー' });
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText('自動コピーできませんでした');
  await expect(fallback.getByLabel('コピー用の完全なイベントログテキスト')).toBeFocused();
  await expect(fallback.getByRole('button', { name: '閉じる' })).toBeVisible();
});
