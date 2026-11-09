import { test, expect, type Page, type Route } from '@playwright/test';

// Source-only integration checks for the approved UX redesign (stages 1–6).
// Every API and SSE is mocked: no Console server, Pi worker or model calls.
// Covers: mobile chat height and primary controls, the single in-chat kit
// decision form (answer payload + draft survival across navigation/resizes),
// the OFF local-connection guidance and existing management, the compact
// sidebar workspace menu, the Execution digest, and the dark connection state.

const workspace = { id: 'ux-w', name: 'UX workspace', path: 'C:/ux-redesign', valid: true, pinned: false, lastOpenedAt: '2026-10-03T00:00:00Z' };
const session = { id: 'ux-s', workspaceId: workspace.id, name: 'UX chat', filePath: '/ux.jsonl', updatedAt: '2026-10-03T00:00:00Z' };
const emptyExecution = { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 };
const snapshot = (overrides: object = {}) => ({
  session, runtime: 'running', chat: [{ id: 'ready', role: 'assistant', text: 'UX ready.', complete: true }],
  events: [], execution: emptyExecution, seq: 0, generation: 'ux-g', queue: [], ...overrides,
});
type KitState = { available: boolean; decisions?: { runId: string; canResume: boolean; decisions: { id: string; runId: string; question: string; reason?: string; options: { id: string; summary: string }[]; recommended?: string }[] }; job?: object };

async function setup(page: Page, options: { mobile?: boolean; language?: 'en' | 'ja'; snapshotOverrides?: object; kit?: KitState; failWorkspaces?: boolean } = {}) {
  const answers: Route[] = [];
  await page.addInitScript(language => {
    // Inert SSE: the stream connects but no events arrive unless the test pushes them.
    (window as any).EventSource = class extends EventTarget {
      constructor() { super(); setTimeout(() => (this as any).onopen?.(), 0); }
      close() {}
    };
    localStorage.setItem('pi-console:preferences:v1', JSON.stringify({ language: language ?? 'en', petEnabled: false }));
  }, options.language ?? 'en');
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let json: unknown;
    if (path === '/api/workspaces') json = options.failWorkspaces ? { __fail: true } : { workspaces: [workspace] };
    else if (path === '/api/workspaces/update' || path === '/api/workspaces/open') json = { workspace };
    else if (path === '/api/sessions') json = { sessions: [session] };
    else if (path === '/api/resume') json = { snapshot: { ...snapshot(), ...options.snapshotOverrides } };
    else if (path === '/api/state') json = { ...snapshot(), ...options.snapshotOverrides };
    else if (path === '/api/session/options') json = { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] };
    else if (path === '/api/activity') json = { sessions: [] };
    else if (path === '/api/quick-prompts') json = { prompts: [] };
    else if (path === '/api/pets') json = { pets: [] };
    else if (path === '/api/startup') json = { supported: false, enabled: false, installed: false };
    else if (path === '/api/session-retention') json = { enabled: false, days: 30 };
    else if (path === '/api/orchestrator/decisions') json = options.kit?.decisions ?? { decisions: [], canResume: false };
    else if (path === '/api/orchestrator/answer') { answers.push(route); return; }
    else if (path.startsWith('/api/orchestrator')) json = { available: !!options.kit?.available, ...(options.kit?.job ? { job: options.kit.job } : {}) };
    else if (path === '/api/prompt') json = { runId: 'ux-run' };
    else if (path.startsWith('/api/settings-local-mcp')) json = { authenticatedOwner: false, accessConfigured: false, setupComplete: false, guiAvailable: false };
    else throw Error(`Unmocked API: ${path}`);
    if (json && typeof json === 'object' && '__fail' in json) await route.fulfill({ status: 500, json: { error: 'Console unreachable' } });
    else await route.fulfill({ json });
  });
  if (options.mobile) await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  return { answers };
}

async function openChat(page: Page, mobile: boolean) {
  if (mobile) await page.locator('.workspace-card').filter({ hasText: workspace.name }).click();
  else await page.getByLabel('Workspace', { exact: true }).selectOption(workspace.id);
  await page.getByLabel('Session list').getByRole('button', { name: /^UX chat/ }).click();
  await expect(page.getByLabel('Chat output')).toContainText('UX ready.');
}

const kitQuestion = {
  runId: 'run-ux', canResume: false,
  decisions: [{ id: 'decision-ux', runId: 'run-ux', question: 'Apply the redesign?', reason: 'User confirmation is required.', options: [{ id: 'yes', summary: 'Apply' }, { id: 'no', summary: 'Cancel' }], recommended: 'yes' }],
};

test('mobile 390x844 keeps a 45%+ conversation with the session title and primary controls', async ({ page }) => {
  await setup(page, { mobile: true });
  await openChat(page, true);
  const chat = page.getByLabel('Chat output');
  const box = (await chat.boundingBox())!;
  // The conversation must actually occupy 45%+ of the 844px viewport.
  expect(box.height).toBeGreaterThanOrEqual(844 * 0.45);
  // The toolbar carries the session title; the composer row stays compact.
  await expect(page.getByRole('button', { name: 'Switch session', exact: true })).toBeVisible();
  await expect(page.locator('.session-toolbar-context h2')).toContainText('UX chat');
  const input = page.locator('.composer-input');
  // Usable typing area: the textarea's visible height stays >= 40px above the
  // footer buttons, and the footer overlay row still sits inside the composer
  // box without covering the text area.
  const promptBox = (await page.getByRole('textbox', { name: 'Prompt', exact: true }).boundingBox())!;
  const inputBox = (await input.boundingBox())!;
  const attachBox = (await page.getByRole('button', { name: 'Attach files', exact: true }).boundingBox())!;
  expect(promptBox.height).toBeGreaterThanOrEqual(40);
  expect(promptBox.y + promptBox.height).toBeLessThanOrEqual(attachBox.y + 1);
  expect(attachBox.y + attachBox.height).toBeLessThanOrEqual(inputBox.y + inputBox.height + 1);
  expect(inputBox.height).toBeLessThanOrEqual(96);
  await expect(page.locator('.model-summary-bar.chat-meta')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeVisible();
  const send = (await page.getByRole('button', { name: 'Send', exact: true }).boundingBox())!;
  const nav = (await page.getByRole('navigation', { name: 'Session views' }).boundingBox())!;
  expect(send.y + send.height).toBeLessThanOrEqual(nav.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // Main navigation: chat → execution → sessions → workspaces and back.
  await page.getByRole('button', { name: /^Execution/ }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/view-execution/);
  await page.getByRole('button', { name: '← Chat', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/view-chat/);
  await page.getByRole('button', { name: '← Sessions', exact: true }).click();
  await expect(page.getByLabel('Session list')).toBeVisible();
  await page.getByRole('button', { name: '← Workspaces', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
});

test('the kit question form stays a single card inside the conversation, keeps its draft through views and resizes, and posts the exact answer', async ({ page }) => {
  const { answers } = await setup(page, { mobile: true, kit: { available: true, decisions: kitQuestion, job: { running: false, needsInput: true, runId: 'run-ux', request: 'Redesign work' } } });
  await openChat(page, true);
  const question = page.getByRole('region', { name: 'Orchestrator questions' });
  // One card only, mounted inside the Chat scroll area; Execution shows a link, not a second form.
  await expect(question).toHaveCount(1);
  await expect(page.getByLabel('Chat output').locator('.kit-decision-panel')).toBeVisible();
  await expect(question).toContainText('Apply the redesign?');
  const select = question.getByLabel('Answer to decision decision-ux');
  await select.selectOption('no');
  await page.getByRole('button', { name: /^Execution/ }).click();
  // The form stays mounted once inside .chat (hidden in this view); Execution
  // itself only carries the link back, never a second form.
  await expect(page.locator('.execution-area .kit-decision-panel')).toHaveCount(0);
  const link = page.locator('.kit-execution-link');
  await expect(link).toContainText('The kit question card is shown in the conversation');
  await link.getByRole('button', { name: 'Answer in chat card' }).click();
  await expect(question).toBeVisible();
  await expect(select).toHaveValue('no');
  // Resizing the viewport must not discard the in-flight draft either.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(select).toHaveValue('no');
  await page.setViewportSize({ width: 390, height: 844 });
  await select.selectOption('yes');
  await question.getByRole('button', { name: 'Submit answer' }).click();
  await expect.poll(() => answers.length).toBe(1);
  expect(answers[0].request().postDataJSON()).toMatchObject({ workspaceId: workspace.id, sessionId: session.id, runId: 'run-ux', decisionId: 'decision-ux', answer: 'yes' });
  await answers[0].fulfill({ json: { runId: 'run-ux', remaining: 0, resuming: true } });
});

test('settings local MCP separates the OFF guide from existing management on a compact screen', async ({ page }) => {
  await setup(page, { mobile: true });
  await page.goto('/?view=settings');
  await expect(page.getByRole('region', { name: 'Settings' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Local MCP' }).click();
  const settings = page.locator('.local-mcp-settings');
  await expect(settings).toContainText('New connection: prepare first');
  await expect(settings).toContainText('You are browsing on your current PC');
  // The OFF preview stays explicitly disabled — it cannot start a real connection.
  const off = page.getByRole('region', { name: 'Local connection disabled', exact: true });
  await expect(off).toContainText('権限機能はOFFです');
  await expect(off.getByRole('button', { name: 'ローカル連携を始める' })).toBeDisabled();
  const offStyles = await off.evaluate(el => {
    const self = getComputedStyle(el), heading = getComputedStyle(el.querySelector('h2')!);
    const rgb = (v: string) => v.match(/\d+/g)!.map(Number) as [number, number, number];
    const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return { background: lum(rgb(self.backgroundColor)), text: lum(rgb(heading.color)) };
  });
  // Connection settings follow the app-dark palette: dark card, light text.
  expect(offStyles.background).toBeLessThan(80);
  expect(offStyles.text).toBeGreaterThan(200);
  expect(offStyles.text - offStyles.background).toBeGreaterThan(120);
  // The step-by-step guide uses details/summary; step 1 shows the owner command.
  await page.getByRole('button', { name: 'Open local connection instructions' }).click();
  await expect(page.locator('.resume-setup__step')).toHaveCount(4);
  await page.locator('.resume-setup__step').first().locator('summary').click();
  await expect(page.getByLabel('Local owner login command')).toBeVisible();
  // Existing management stays reachable and independent of the preview.
  await expect(settings).toContainText('Existing connections and permissions');
  await page.getByRole('button', { name: 'Manage existing connections and permissions' }).click();
  await expect(page.getByLabel('Existing connection and permissions')).toBeVisible();
});

test('the compact sidebar keeps workspace management inside the menu, including Add', async ({ page }) => {
  await setup(page, { mobile: true });
  await page.locator('.workspace-card').filter({ hasText: workspace.name }).click();
  const menu = page.locator('.workspace-menu:visible');
  await expect(menu).toHaveCount(1);
  await menu.locator('summary').click();
  const body = page.locator('.workspace-menu:visible .workspace-menu-body');
  await expect(body.getByRole('button', { name: 'Edit selected workspace' })).toBeVisible();
  await expect(body.getByRole('button', { name: 'Open on host PC' })).toBeVisible();
  // Add is reachable again from the session screen on mobile.
  await body.getByRole('button', { name: 'Add a workspace' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/view-workspaces/);
  await expect(page.getByLabel('Workspace path')).toBeVisible();
  // Back returns to the session screen for the same workspace.
  await page.goBack();
  await expect(page.locator('.app-shell')).toHaveClass(/view-sessions/);
});

test('the execution digest groups attention, progress and settled results on mobile and desktop', async ({ page }) => {
  const at = new Date().toISOString();
  const nodes = [
    { id: 'run-1', kind: 'orchestrator', label: 'UX run', status: 'running', sourceKind: 'pi', correlation: 'explicit', updatedAt: at },
    { id: 'task-blocked', parentId: 'run-1', kind: 'task', label: 'Awaiting review', status: 'blocked', blockedReason: 'needs user input', sourceKind: 'pi', correlation: 'explicit', updatedAt: at },
    { id: 'task-run', parentId: 'run-1', kind: 'task', label: 'Running task', status: 'running', sourceKind: 'pi', correlation: 'explicit', updatedAt: at },
    { id: 'task-done', parentId: 'run-1', kind: 'task', label: 'Finished task', status: 'completed', sourceKind: 'pi', correlation: 'explicit', updatedAt: at },
    { id: 'task-failed', parentId: 'run-1', kind: 'task', label: 'Broken task', status: 'failed', sourceKind: 'pi', correlation: 'explicit', updatedAt: at },
  ];
  const execution = { nodes, roots: ['run-1'], unattached: [], rows: nodes.map((node, depth) => ({ node, depth: node.parentId ? 1 : 0, unattached: false })), activeCount: 2, failedCount: 1, decisionCount: 0 };
  await setup(page, { mobile: true, snapshotOverrides: { execution, activeRunId: 'run-1' } });
  await openChat(page, true);
  await page.getByRole('button', { name: /^Execution/ }).click();
  const digest = page.locator('.exec-digest');
  await expect(digest).toBeVisible();
  await expect(digest).toContainText('Needs attention');
  await expect(digest).toContainText('Awaiting review');
  await expect(digest).toContainText('In progress');
  await expect(digest).toContainText('Running task');
  // Settled outcomes stay folded behind details.
  const results = digest.locator('details[data-tone=done]');
  await results.locator('summary').click();
  await expect(results).toContainText('Finished task');
  const failures = digest.locator('details[data-tone=failed]');
  await failures.locator('summary').click();
  await expect(failures).toContainText('Broken task');
  await expect(page.getByLabel('Execution Timeline')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(digest).toBeVisible();
});

test('the connection status keeps dark readable colors when the console is unreachable', async ({ page }) => {
  await setup(page, { mobile: true, failWorkspaces: true });
  await expect(page.locator('.error-card')).toBeVisible();
  const connection = page.locator('.connection');
  await expect(connection).toContainText('Server unavailable');
  await expect(connection).toHaveAttribute('data-warning', 'true');
  const styles = await connection.evaluate(el => {
    const self = getComputedStyle(el), dot = getComputedStyle(el.querySelector('.connection-dot')!);
    const rgb = (v: string) => v.match(/\d+/g)!.map(Number) as [number, number, number];
    const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return { text: lum(rgb(self.color)), dot: lum(rgb(dot.backgroundColor)), scheme: getComputedStyle(document.documentElement).colorScheme };
  });
  expect(styles.scheme).toBe('dark');
  expect(styles.text).toBeGreaterThan(120);
  expect(styles.dot).toBeGreaterThan(60);
});
