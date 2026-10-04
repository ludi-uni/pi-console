import { test, expect, devices, type Page, type Route } from '@playwright/test';

// Regression fixture: all APIs and SSE are mocked. No Pi/provider calls.
const workspace = { id: 'switch-w', name: 'switch-demo', path: 'C:/switch-demo', valid: true, pinned: false, lastOpenedAt: '2026-10-03T00:00:00Z' };
const sessions = ['A', 'B'].map(name => ({ id: name, workspaceId: workspace.id, name: `Chat ${name}`, filePath: `/${name}.jsonl`, updatedAt: '2026-10-03T00:00:00Z' }));
const execution = { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 };
const snapshot = (id: string, running = false) => ({ session: sessions.find(s => s.id === id)!, runtime: 'running', activeRunId: running ? `run-${id}` : undefined, chat: [{ id: `ready-${id}`, role: 'assistant', text: `Ready ${id}.`, complete: true }], events: [], execution, seq: 1, generation: `g-${id}`, queue: [] });

async function setup(page: Page, running = false) {
  const errors: string[] = [];
  const pending: Route[] = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  await page.addInitScript(() => {
    const w = window as any;
    w.__switchRejections = [];
    window.addEventListener('unhandledrejection', event => w.__switchRejections.push(String(event.reason)));
    w.__switchStreams = [];
    w.EventSource = class extends EventTarget {
      url: string; closed = false; onopen: any; onerror: any;
      constructor(url: string) { super(); this.url = url; w.__switchStreams.push(this); }
      close() { this.closed = true; }
    };
  });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === '/api/prompt') { pending.push(route); return; }
    let value: unknown;
    if (path === '/api/workspaces') value = { workspaces: [workspace] };
    else if (path === '/api/workspaces/update') value = { workspace };
    else if (path === '/api/sessions') value = { sessions };
    else if (path === '/api/resume') value = { snapshot: snapshot(request.postDataJSON().sessionId, running) };
    else if (path === '/api/state') value = snapshot(url.searchParams.get('sessionId')!, running);
    else if (path === '/api/session/options') value = { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] };
    else if (path === '/api/orchestrator/decisions') value = { decisions: [], canResume: false };
    else if (path.startsWith('/api/orchestrator')) value = { available: false };
    else if (path === '/api/activity') value = { sessions: [] };
    else if (path === '/api/quick-prompts') value = { prompts: [] };
    else if (path === '/api/pets') value = { pets: [] };
    else if (path === '/api/startup') value = { supported: false, enabled: false, installed: false };
    else if (path === '/api/session-retention') value = { enabled: false, days: 30 };
    else throw new Error(`Unmocked API: ${path}`);
    await route.fulfill({ json: value });
  });
  return { errors, pending };
}

async function openA(page: Page, mobile: boolean) {
  await page.goto('/');
  if (mobile) await page.locator('.workspace-card').first().click();
  else await page.getByLabel('Workspace', { exact: true }).selectOption(workspace.id);
  await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click();
  await expect(page.getByLabel('Chat output')).toContainText('Ready A.');
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeEnabled();
}

async function switchTo(page: Page, id: 'A' | 'B', mobile: boolean) {
  if (mobile) {
    // Use the application's own mobile history navigation, not injected React state.
    await page.goBack();
    await expect(page.getByLabel('Session list')).toBeVisible();
  }
  await page.getByLabel('Session list').getByRole('button', { name: new RegExp(`^Chat ${id}`) }).click();
  await expect(page.getByLabel('Chat output')).toContainText(`Ready ${id}.`);
}

async function noCrash(page: Page, errors: string[]) {
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as any).__switchRejections)).toEqual([]);
  await expect(page.locator('#root')).not.toBeEmpty();
}

for (const mobile of [false, true]) for (const outcome of ['success', 'failure'] as const) {
  test(`pending prompt ACK then A to B: ${outcome}, mobile=${mobile}`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 780 } : { width: 1280, height: 800 });
    const { errors, pending } = await setup(page);
    await openA(page, mobile);
    const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
    await prompt.fill('Submitted A');
    await page.locator('.composer-actions .button-primary').click();
    await expect.poll(() => pending.length).toBe(1);
    await switchTo(page, 'B', mobile);
    await prompt.fill('Keep B draft');
    await pending[0].fulfill(outcome === 'success' ? { json: { runId: 'run-A' } } : { status: 500, json: { error: 'Late A failure' } });
    await expect(prompt).toHaveValue('Keep B draft');
    await expect(page.getByText('Late A failure', { exact: true })).toHaveCount(0);
    await switchTo(page, 'A', mobile);
    await expect(prompt).toHaveValue(outcome === 'success' ? '' : 'Submitted A');
    expect(pending).toHaveLength(1);
    expect(pending[0].request().postDataJSON()).toMatchObject({ sessionId: 'A', message: 'Submitted A' });
    await noCrash(page, errors);
  });
}

test('returning A while its prompt ACK is pending must keep the submitted draft locked', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { errors, pending } = await setup(page);
  await openA(page, false);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.fill('Pending A once');
  await page.locator('.composer-actions .button-primary').click();
  await expect.poll(() => pending.length).toBe(1);
  await switchTo(page, 'B', false);
  await switchTo(page, 'A', false);
  try {
    await noCrash(page, errors);
    await expect(prompt).toHaveValue('Pending A once');
    await expect(page.locator('.composer-actions .button-primary')).toBeDisabled({ timeout: 2000 });
  } finally { await pending[0].fulfill({ json: { runId: 'run-A' } }); }
  await expect(prompt).toBeEnabled();
  await expect(prompt).toHaveValue('');
});

for (const outcome of ['success', 'failure'] as const) test(`late A ${outcome} releases only A while B is still sending`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { errors, pending } = await setup(page);
  await openA(page, false);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.fill('Submitted A');
  await page.locator('.composer-actions .button-primary').click();
  await expect.poll(() => pending.length).toBe(1);
  await switchTo(page, 'B', false);
  await prompt.fill('Submitted B');
  await page.locator('.composer-actions .button-primary').click();
  await expect.poll(() => pending.length).toBe(2);
  try {
    await pending[0].fulfill(outcome === 'success' ? { json: { runId: 'run-A' } } : { status: 500, json: { error: 'Late A failure' } });
    await expect(page.locator('.composer-actions .button-primary')).toBeDisabled();
    await expect(prompt).toHaveValue('Submitted B');
    await switchTo(page, 'A', false);
    await expect(prompt).toBeEnabled();
    await expect(prompt).toHaveValue(outcome === 'success' ? '' : 'Submitted A');
    await switchTo(page, 'B', false);
    await expect(page.locator('.composer-actions .button-primary')).toBeDisabled();
    await noCrash(page, errors);
  } finally { await pending[1].fulfill({ json: { runId: 'run-B' } }); }
  await expect(prompt).toBeEnabled();
  await expect(prompt).toHaveValue('');
});

test('A to B to A must not submit the same pending prompt twice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { errors, pending } = await setup(page);
  await openA(page, false);
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Same A submission');
  await page.locator('.composer-actions .button-primary').click();
  await expect.poll(() => pending.length).toBe(1);
  await switchTo(page, 'B', false);
  await switchTo(page, 'A', false);
  try {
    if (await page.locator('.composer-actions .button-primary').isEnabled()) {
      await page.locator('.composer-actions .button-primary').click();
      await expect.poll(() => pending.length).toBe(2);
    }
    await noCrash(page, errors);
    expect(pending.map(route => route.request().postDataJSON().message)).toEqual(['Same A submission']);
  } finally {
    for (const route of pending) await route.fulfill({ json: { runId: 'run-A' } });
  }
});

test('reselecting current A during prompt send must preserve its chat and live projection', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { errors, pending } = await setup(page);
  await openA(page, false);
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Pending A');
  await page.locator('.composer-actions .button-primary').click();
  await expect.poll(() => pending.length).toBe(1);
  await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click();
  try {
    await noCrash(page, errors);
    await expect(page.getByLabel('Chat output')).toContainText('Ready A.', { timeout: 2000 });
    await expect(page.locator('.composer-actions .button-primary')).toBeDisabled();
    await expect.poll(() => page.evaluate(() => (window as any).__switchStreams.length)).toBe(1);
    await page.evaluate(() => {
      const stream = (window as any).__switchStreams[0];
      if (stream.closed) throw new Error('Current session stream was closed');
      stream.dispatchEvent(new MessageEvent('execution', { data: JSON.stringify({ generation: 'g-A', workspaceId: 'switch-w', sessionId: 'A', seq: 2, type: 'MessageCompleted', entityId: 'live-A', payload: { role: 'assistant', text: 'Live A answer' } }) }));
    });
    await expect(page.getByLabel('Chat output')).toContainText('Live A answer');
    await noCrash(page, errors);
  } finally { await pending[0].fulfill({ json: { runId: 'run-A' } }); }
});

test.describe('Android touch workspace navigation', () => {
  const android = devices['Pixel 7'];
  test.use({ userAgent: android.userAgent, viewport: android.viewport, deviceScaleFactor: android.deviceScaleFactor, isMobile: true, hasTouch: true });
  for (const entry of ['session-list', 'restored-chat'] as const) for (const outcome of ['success', 'failure'] as const) {
  test(`mobile workspace button during pending send: ${entry}, ${outcome}`, async ({ page }) => {
    const marks: { phase: string; elapsedMs: number }[] = [];
    const started = Date.now();
    const mark = (phase: string) => marks.push({ phase, elapsedMs: Date.now() - started });
    await page.setViewportSize({ width: 390, height: 780 });
    const { errors, pending } = await setup(page);
    if (entry === 'restored-chat') {
      await page.addInitScript(() => {
        history.replaceState({ piConsoleNav: true, view: 'chat', workspace: 'switch-w', session: 'A', sessionReturn: 'workspaces' }, '', location.href);
      });
      await page.goto('/');
      await expect(page.getByLabel('Chat output')).toContainText('Ready A.');
    } else await openA(page, true);
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Waiting mobile A');
    await page.locator('.composer-actions .button-primary').click();
    await expect.poll(() => pending.length).toBe(1);
    await expect(page.locator('.composer-actions .button-primary')).toBeDisabled();
    mark('send-pending');
    const toolbar = page.locator('.session-toolbar > button');
    expect(await toolbar.evaluate(button => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit === button || !!hit && button.contains(hit);
    })).toBe(true);
    // Android-style touch input: actual screen buttons, not browser history.
    await toolbar.tap({ noWaitAfter: true });
    mark('toolbar-tapped');
    if (entry === 'session-list') {
      await expect(page.locator('.app-shell')).toHaveClass(/view-sessions/);
      await page.locator('.session-panel .back-link').tap({ noWaitAfter: true });
      mark('workspace-tapped');
    }
    await expect(page.locator('.app-shell')).toHaveClass(/view-workspaces/);
    mark('workspace-visible');
    await expect(page.locator('.workspace-card').first()).toBeVisible();
    await noCrash(page, errors);
    await pending[0].fulfill(outcome === 'success' ? { json: { runId: 'run-A' } } : { status: 500, json: { error: 'Late mobile send failure' } });
    await page.locator('.workspace-card').first().click();
    await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click();
    await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue(outcome === 'success' ? '' : 'Waiting mobile A');
    await noCrash(page, errors);
    expect(pending).toHaveLength(1);
    await test.info().attach('navigation-timings', { body: JSON.stringify(marks, null, 2), contentType: 'application/json' });
    console.log(JSON.stringify({ entry, outcome, marks }));
  });
  }
});

test.describe('short restored conversation header', () => {
  const android = devices['Pixel 7'];
  test.use({ userAgent: android.userAgent, deviceScaleFactor: android.deviceScaleFactor, isMobile: true, hasTouch: true });
  for (const [width, height] of [[844, 390], [390, 360]]) test(`header directly opens session list despite workspace return and pending ACK: ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); const { pending, errors } = await setup(page);
    await page.addInitScript(() => history.replaceState({ piConsoleNav: true, view: 'chat', workspace: 'switch-w', session: 'A', sessionReturn: 'workspaces' }, '', location.href));
    await page.goto('/'); await expect(page.getByLabel('Chat output')).toContainText('Ready A.');
    const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true }); await prompt.fill('Restored short A'); await page.locator('.composer-actions .button-primary').click(); await expect.poll(() => pending.length).toBe(1);
    const switcher = page.getByRole('button', { name: 'Switch session', exact: true }); await expect(switcher).toHaveCount(1); await expect(switcher).toBeVisible();
    const box = (await switcher.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    await switcher.tap(); await expect(page.locator('.app-shell')).toHaveClass(/view-sessions/); await expect.poll(() => page.evaluate(() => history.state.session)).toBe('A');
    await expect(page.getByLabel('Search sessions')).toBeFocused(); await expect(page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ })).toHaveAttribute('aria-current', 'page');
    await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).tap(); await expect(page.getByLabel('Chat output')).toContainText('Ready B.');
    await page.getByRole('button', { name: 'Switch session', exact: true }).tap(); await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).tap();
    await expect(prompt).toHaveValue('Restored short A'); await expect(page.locator('.composer-actions .button-primary')).toBeDisabled(); expect(pending).toHaveLength(1);
    await pending[0].fulfill({ json: { runId: 'run-A' } }); await expect(prompt).toHaveValue(''); await noCrash(page, errors);
  });
});

for (const mobile of [false, true]) test(`one session list, opened from chat header, preserves pending sends: mobile=${mobile}`, async ({ page }) => {
  await page.setViewportSize(mobile ? { width: 390, height: 780 } : { width: 1280, height: 800 });
  const { errors, pending } = await setup(page);
  await openA(page, mobile);
  await expect(page.getByLabel('Session', { exact: true })).toHaveCount(0);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.fill('A still sending');
  await page.locator('.composer-actions .button-primary').click();
  await expect.poll(() => pending.length).toBe(1);
  try {
    await page.getByRole('button', { name: 'Switch session', exact: true }).click();
    await expect(page.getByLabel('Session list')).toBeVisible();
    await expect(page.getByLabel('Search sessions')).toBeFocused();
    await expect(page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ })).toHaveAttribute('aria-current', 'page');
    await page.getByLabel('Search sessions').fill('Chat B');
    await expect(page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ })).toHaveCount(0);
    await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).click();
    await expect(page.getByLabel('Chat output')).toContainText('Ready B.');
    await prompt.fill('B draft');
    await page.getByRole('button', { name: 'Switch session', exact: true }).click();
    await expect(page.getByLabel('Search sessions')).toHaveValue('');
    await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click();
    await expect(prompt).toHaveValue('A still sending');
    await expect(page.locator('.composer-actions .button-primary')).toBeDisabled();
    await noCrash(page, errors);
  } finally { await pending[0].fulfill({ json: { runId: 'run-A' } }); }
  await expect(prompt).toHaveValue('');
  expect(pending).toHaveLength(1);
});

test('streaming A to B to A ignores retired SSE callbacks and remains responsive', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { errors } = await setup(page, true);
  await openA(page, false);
  await expect.poll(() => page.evaluate(() => (window as any).__switchStreams.length)).toBe(1);
  await switchTo(page, 'B', false);
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
  await prompt.fill('Unsent B');
  await page.evaluate(() => {
    const old = (window as any).__switchStreams[0];
    old.dispatchEvent(new MessageEvent('execution', { data: JSON.stringify({ generation: 'g-A', workspaceId: 'switch-w', sessionId: 'A', seq: 2, type: 'MessageCompleted', entityId: 'late-A', payload: { role: 'assistant', text: 'Late A answer' } }) }));
  });
  await expect(page.getByLabel('Chat output')).not.toContainText('Late A answer');
  await expect(prompt).toHaveValue('Unsent B');
  await switchTo(page, 'A', false);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await noCrash(page, errors);
});

for (const width of [390, 320]) {
  test(`one visible conversation heading with auxiliary workspace context, including short landscape and pending send: width=${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 780 : 568 });
    const { errors, pending } = await setup(page);
    const title = 'Chat A — investigate a deliberately long conversation title without losing navigation';
    const workspaceName = 'Workspace with a deliberately long descriptive name';
    await page.route('**/api/workspaces', route => route.fulfill({ json: { workspaces: [{ ...workspace, name: workspaceName }] } }));
    await page.route('**/api/workspaces/update', route => route.fulfill({ json: { workspace: { ...workspace, name: workspaceName } } }));
    await page.route('**/api/sessions?*', route => route.fulfill({ json: { sessions: sessions.map(s => s.id === 'A' ? { ...s, name: title } : s) } }));
    await openA(page, true);
    const heading = page.getByRole('heading', { name: title, exact: true });
    await expect(heading).toHaveCount(1);
    await expect(page.locator('.chat-heading h2')).toBeVisible();
    await expect(page.locator('.session-toolbar-context h2')).not.toBeVisible();
    await expect(page.locator('.workspace-context')).toHaveText(workspaceName);
    await expect(page.locator('.workspace-context')).toHaveAttribute('title', workspaceName);
    await expect(page.getByRole('button', { name: 'Switch session', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: /^Execution/ }).click();
    await expect(heading).toHaveCount(1); await expect(page.locator('.session-toolbar-context h2')).toBeVisible();
    await expect(page.locator('.workspace-context')).toHaveText(workspaceName);
    await page.getByRole('button', { name: '← Chat', exact: true }).click();
    await expect(heading).toHaveCount(1);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('.chat-heading h2')).not.toBeVisible();
    await expect(page.locator('.session-toolbar-context h2')).toBeVisible();
    await expect(heading).toHaveCount(1);
    await expect(page.getByRole('status', { name: 'Current conversation status' })).toBeVisible();
    await page.getByLabel('Conversation status details').click();
    const details = (await page.locator('.conversation-status-body').boundingBox())!;
    expect(details.x).toBeGreaterThanOrEqual(0); expect(details.x + details.width).toBeLessThanOrEqual(844);
    await page.getByLabel('Conversation status details').press('Escape');
    await expect(page.getByRole('button', { name: 'Model / Thinking', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true });
    await prompt.fill('Pending A under short header');
    await page.getByRole('button', { name: /^Send/ }).click(); await expect.poll(() => pending.length).toBe(1);
    await page.getByRole('button', { name: '← Sessions', exact: true }).click();
    await page.getByLabel('Session list').getByRole('button', { name: /^Chat B/ }).click();
    await expect(page.getByRole('heading', { name: 'Chat B', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: '← Sessions', exact: true }).click();
    await page.getByLabel('Session list').getByRole('button', { name: /^Chat A/ }).click();
    await expect(heading).toHaveCount(1);
    await expect(page.getByRole('status', { name: 'Current conversation status' })).toHaveText('Sending');
    await expect(page.getByRole('button', { name: /^Send/ })).toBeDisabled();
    await pending[0].fulfill({ json: { runId: 'run-A' } });
    await expect(prompt).toHaveValue(''); expect(pending).toHaveLength(1);
    await page.getByRole('button', { name: '← Sessions', exact: true }).click();
    await page.getByRole('button', { name: '← Workspaces', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
    await noCrash(page, errors);
  });
}
