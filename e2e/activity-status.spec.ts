import { test, expect } from '@playwright/test';

test('blocked and waiting Activity remain visible without a misleading Running label', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const item = { sessionId: 's', workspaceId: 'w', sessionName: 'Finished request — blocked tasks', workspaceName: 'pi-qoder-bridge', running: false, decisionCount: 0, updatedAt: new Date().toISOString(), work: [
    { id: 'tests', label: 'Run tests', kind: 'task', status: 'blocked' },
    { id: 'review', label: 'Review result and risks', kind: 'task', status: 'blocked' },
  ] };
  // All API requests are fixtures: no SDK sessions, model calls, Startup or data writes.
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = path === '/api/activity' ? { sessions: [item] } : path === '/api/workspaces' ? { workspaces: [] } : path === '/api/quick-prompts' ? { prompts: [] } : {};
    return route.fulfill({ json });
  });
  await page.goto('/');
  const inbox = page.getByRole('region', { name: 'Activity notifications' });
  await expect(inbox).toContainText('0 running');
  await inbox.locator('summary').click();
  const card = inbox.locator('.activity-card');
  await expect(card).toContainText('task: Run tests · blocked');
  await expect(card.locator('.activity-inbox-status')).toHaveText('Blocked');
  await expect(card.locator('.is-running')).toHaveCount(0);
  await inbox.screenshot({ path: 'test-results/activity-blocked-mobile.png' });
  for (const work of item.work) work.status = 'waiting';
  // Fetch the new fixture deterministically instead of racing the polling timer.
  await page.reload();
  await inbox.locator('summary').click();
  await expect(card.locator('.activity-inbox-status')).toHaveText('Waiting');
  await expect(card.locator('.is-running')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await inbox.screenshot({ path: 'test-results/activity-waiting-desktop.png' });
});

test('opening finished session history does not count leftover child statuses as current execution', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const at = new Date().toISOString();
  const workspace = { id: 'w', name: 'Completed fixture workspace', path: 'C:/fixture', pinned: false, lastOpenedAt: at, valid: true };
  const session = { id: 's', workspaceId: 'w', filePath: 'fixture.jsonl', name: 'Completed session', running: false };
  const base = { sourceKind: 'orchestrator', correlation: 'explicit', updatedAt: at };
  const nodes = [{ ...base, id: 'done', kind: 'orchestrator', label: 'Finished run', status: 'completed', endedAt: at },
    { ...base, id: 'task', parentId: 'done', kind: 'task', label: 'Run tests', status: 'blocked' },
    { ...base, id: 'child', parentId: 'task', kind: 'agent', label: 'Old progress', status: 'running' }];
  const snapshot = { session, runtime: 'running', chat: [{ id: 'answer', role: 'assistant', text: 'Finished answer', complete: true }], events: [], seq: 0, generation: 'fixture',
    execution: { nodes, roots: [], unattached: ['done'], rows: nodes.map((node, depth) => ({ node, depth, unattached: true })), activeCount: 0, failedCount: 0, decisionCount: 0 } };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: '' });
    const json = path === '/api/workspaces' ? { workspaces: [workspace] } : path === '/api/workspaces/open' ? { workspace }
      : path === '/api/sessions' ? { sessions: [session] } : path === '/api/resume' ? { snapshot } : path === '/api/state' ? snapshot
      : path === '/api/session/options' ? { models: [], thinkingLevels: ['off'], thinkingLevel: 'off' }
      : path === '/api/activity' ? { sessions: [] } : path === '/api/quick-prompts' ? { prompts: [] } : { available: false };
    return route.fulfill({ json });
  });
  await page.goto('/');
  await page.locator('.workspace-card').filter({ hasText: workspace.name }).click();
  await page.getByLabel('Session list').getByRole('button', { name: /^Completed session/ }).click();
  await expect(page.getByLabel('Chat output')).toContainText('Finished answer');
  await expect(page.locator('.run-badge')).toContainText('All clear');
  await expect(page.locator('.run-badge .live')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Session views' })).toContainText('Execution · 0');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/finished-session-idle-mobile.png', fullPage: true });
});
