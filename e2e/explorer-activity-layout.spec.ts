import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('registered workspace offers a host Explorer action without accepting arbitrary paths', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-open-explorer-'));
  try {
    const workspace = (await (await page.request.post('/api/workspaces', { data: { path: root } })).json()).workspace;
    const rejected = await page.request.post('/api/workspaces/explorer', { data: { id: root } });
    expect(rejected.status()).toBe(400);
    let opened = 0;
    await page.route('**/api/workspaces/explorer', route => {
      expect(route.request().postDataJSON()).toEqual({ id: workspace.id });
      opened++; void route.fulfill({ json: { ok: true } });
    });
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/');
    await page.getByRole('button', { name: workspace.name, exact: false }).first().click();
    const button = page.getByRole('button', { name: 'Open on host PC' });
    await expect(button).not.toBeVisible();
    await page.locator('.workspace-menu:visible > summary').click();
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.locator('.session-context .workspace-explorer-notice')).toHaveText('Opened on the host Windows desktop.');
    await page.screenshot({ path: join(tmpdir(), 'pi-console-explorer-action-mobile.png') });
    expect(opened).toBe(1);
    await page.request.post('/api/workspaces/remove', { data: { id: workspace.id } });
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {}); }
});

test('Activity inbox leaves room for Send and Execution on desktop and does not cover mobile actions', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-inbox-space-'));
  let workspace: any, session: any;
  try {
    workspace = (await (await page.request.post('/api/workspaces', { data: { path: root } })).json()).workspace;
    session = (await (await page.request.post('/api/sessions', { data: { workspaceId: workspace.id } })).json()).session;
    const sessions = Array.from({ length: 25 }, (_, i) => ({
      sessionId: i ? `other-${i}` : session.id, workspaceId: workspace.id, workspaceName: `${workspace.name} — long workspace name for notification readability`,
      sessionName: `Running activity ${i} — long session name for notification readability`, running: i !== 0, decisionCount: 0,
      completion: i === 0 ? { id: 'current-completion', status: 'completed', scope: 'conversation', at: new Date().toISOString() } : undefined,
      updatedAt: new Date().toISOString(), work: Array.from({ length: 4 }, (_, n) => ({ id: `step-${i}-${n}`, label: 'Inspect and implement', status: 'running', kind: 'agent' })),
    }));
    await page.route('**/api/activity', route => route.fulfill({ json: { sessions } }));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(workspace.id);
    await page.getByLabel('Session list').locator('.session-row > button').first().click();
    await page.getByRole('button', { name: 'Show execution details', exact: true }).click();
    const inbox = page.getByRole('region', { name: 'Activity notifications' });
    await expect(inbox).toBeVisible();
    await expect(inbox.getByRole('button', { name: /Running activity 0/ })).not.toBeVisible();
    await page.screenshot({ path: join(tmpdir(), 'pi-console-activity-collapsed-desktop.png') });
    await inbox.locator('summary').click();
    await expect(inbox.getByRole('button', { name: /Running activity 1 —/ })).toBeVisible();
    const currentCard = inbox.locator('.activity-card.is-current');
    await expect(currentCard.locator('button').first()).toHaveAttribute('aria-current', 'page');
    await expect(currentCard).toContainText('Running activity 0 — long session name for notification readability');
    for (const name of [currentCard.locator('b'), currentCard.locator('.activity-inbox-name > small').first()]) {
      expect(await name.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
      expect(await name.evaluate(el => getComputedStyle(el).textOverflow)).toBe('ellipsis');
      await expect(name).toHaveAttribute('title', (await name.textContent())!);
    }
    expect(await inbox.locator('.activity-inbox-list').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await expect(send).toBeVisible();
    for (const [width, height] of [[1366, 768], [1024, 700], [1024, 500]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: join(tmpdir(), `pi-console-activity-layout-${width}.png`) });
      const sendBottom = await send.evaluate(el => el.getBoundingClientRect().bottom);
      const executionBottom = await page.getByRole('region', { name: 'Execution panel' }).evaluate(el => el.getBoundingClientRect().bottom);
      expect(sendBottom, `Send at ${width}×${height}`).toBeLessThanOrEqual(height - 5);
      expect(executionBottom, `Execution at ${width}×${height}`).toBeLessThanOrEqual(height - 5);
    }
    await page.screenshot({ path: join(tmpdir(), 'pi-console-activity-layout-desktop.png') });
    await page.setViewportSize({ width: 390, height: 780 });
    await expect(inbox).toBeVisible();
    await expect(send).toBeVisible();
    const mobileBottom = await send.evaluate(el => el.getBoundingClientRect().bottom);
    const navTop = await page.getByRole('navigation', { name: 'Session views' }).evaluate(el => el.getBoundingClientRect().top);
    expect(mobileBottom).toBeLessThanOrEqual(navTop);
    await page.screenshot({ path: join(tmpdir(), 'pi-console-activity-layout-mobile.png') });
    await page.setViewportSize({ width: 844, height: 390 });
    const landscapeNav = await page.getByRole('navigation', { name: 'Session views' }).evaluate(el => el.getBoundingClientRect().top);
    expect(await send.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(landscapeNav);
    await currentCard.getByRole('button', { name: /Dismiss .* completion/ }).click();
    await expect(currentCard).toHaveCount(0);
    await expect(page.getByLabel('Prompt', { exact: true })).toBeVisible();
    await page.reload();
    await inbox.locator('summary').click();
    await expect(inbox.getByRole('button', { name: /Running activity 0/ })).toHaveCount(0);
  } finally {
    if (workspace && session) await page.request.post('/api/close', { data: { workspaceId: workspace.id, sessionId: session.id } }).catch(() => {});
    if (workspace) await page.request.post('/api/workspaces/remove', { data: { id: workspace.id } }).catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
  }
});
