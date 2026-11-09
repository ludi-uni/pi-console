import { test, expect, type Page } from '@playwright/test';
import type { ActiveSessionSummary } from '../shared/types.ts';

// Regression: polls re-sort /api/activity by urgency. While the inbox is open
// the displayed cards must keep their order and scroll position, or a card can
// slide out from under a pressed pointer and a click opens the wrong session.
// All API traffic is mocked; no SDK/model/user data.
test.use({ serviceWorkers: 'block' });
const at = '2026-10-28T00:00:00.000Z';
const notifications = (): ActiveSessionSummary[] => Array.from({ length: 30 }, (_, i) => ({
  workspaceId: 'w', workspaceName: 'Fixture workspace', sessionId: `s${i}`, sessionName: `Notification ${i}`,
  running: false, decisionCount: 0, updatedAt: at, work: [],
  completion: { id: `completion-${i}`, status: 'completed', scope: 'conversation', at },
}));

async function fixture(page: Page, withWorkspace = false) {
  let sessions = notifications(), activityReads = 0;
  const resumed: string[] = [];
  const workspace = { id: 'w', name: 'Fixture workspace', path: 'C:/fixture', valid: true, pinned: false, lastOpenedAt: at };
  const session = (id: string) => ({ id, workspaceId: 'w', filePath: `C:/fixture/${id}.jsonl`, name: `Notification ${id.slice(1)}` });
  const snapshot = (id: string) => ({ session: session(id), runtime: 'stopped', generation: 'fixture', seq: 0, events: [],
    execution: { nodes: [], rows: [], roots: [], unattached: [], activeCount: 0, failedCount: 0, decisionCount: 0 },
    chat: [{ id: 'history', role: 'assistant', complete: true, text: `History ${id}` }],
  });
  await page.addInitScript(() => {
    (window as any).EventSource = class {
      onopen?: () => void;
      constructor() { queueMicrotask(() => this.onopen?.()); }
      addEventListener() {}
      close() {}
    };
  });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let body: unknown = {};
    if (path === '/api/activity') { activityReads++; body = { sessions }; }
    else if (path === '/api/workspaces') body = { workspaces: withWorkspace ? [workspace] : [] };
    else if (path === '/api/workspaces/open') body = { workspace };
    else if (path === '/api/sessions') body = { sessions: ['s0', 's15', 's29'].map(session) };
    else if (path === '/api/resume') { const id = request.postDataJSON().sessionId; resumed.push(id); body = { snapshot: snapshot(id) }; }
    else if (path === '/api/state') body = snapshot(url.searchParams.get('sessionId') ?? 's0');
    else if (path === '/api/session/options') body = { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] };
    else if (path === '/api/quick-prompts') body = { prompts: [] };
    else if (path === '/api/orchestrator' || path === '/api/orchestrator/decisions') body = { available: false };
    else if (path === '/api/pets') body = { pets: [] };
    else if (path === '/api/voice/status') body = { enabled: false, available: false, phase: 'off' };
    await route.fulfill({ json: body });
  });
  return { reads: () => activityReads, update: (next: ActiveSessionSummary[]) => { sessions = next; }, resumed };
}

const cardKeys = (page: Page) => page.locator('.activity-card[data-key]').evaluateAll(cards => cards.map(card => (card as HTMLElement).dataset.key));
const cardTop = (page: Page, key: string) => page.locator(`.activity-card[data-key="${key}"]`).evaluate(card => card.getBoundingClientRect().top);

for (const width of [390, 1280]) {
test(`a reordered poll keeps open inbox order and scroll anchor at width ${width}; new order applies on reopen`, async ({ page }) => {
  await page.clock.install();
  const mock = await fixture(page, true);
  await page.setViewportSize({ width, height: 780 });
  await page.goto('/');
  const inbox = page.getByRole('region', { name: 'Activity notifications' });
  const list = inbox.locator('.activity-inbox-list');
  await page.getByRole('button', { name: 'Active session alerts' }).click();
  await expect(inbox.locator('.activity-card')).toHaveCount(20);
  await inbox.locator('.activity-show-more').click();
  await expect(inbox.locator('.activity-card')).toHaveCount(30);
  const orderBefore = await cardKeys(page);
  expect(orderBefore).toHaveLength(30);

  // Scroll so the target card is mid-viewport and early cards are above it.
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const topBefore = await cardTop(page, 'w:s25');

  // A poll that reverses the server order, adds a brand-new session at the top
  // and grows s0 with work rows (height change above the scroll viewport).
  const reordered = notifications().reverse();
  reordered[29] = { ...reordered[29], work: [
    { id: 'w1', label: 'Edit files', status: 'running', kind: 'task', action: 'write' },
    { id: 'w2', label: 'Run tests', status: 'running', kind: 'task', action: 'exec' },
    { id: 'w3', label: 'Review diff', status: 'waiting', kind: 'task' },
    { id: 'w4', label: 'Install deps', status: 'blocked', kind: 'task' },
  ] };
  reordered.unshift({ workspaceId: 'w', workspaceName: 'Fixture workspace', sessionId: 'new', sessionName: 'Fresh notification',
    running: true, decisionCount: 1, updatedAt: at, work: [] });
  mock.update(reordered);
  const reads = mock.reads();
  await page.clock.fastForward(5100);
  await expect.poll(mock.reads).toBeGreaterThan(reads);

  // Order is frozen while open: the same 30 cards in the same positions, and
  // the card above the viewport grew without pushing the target down. The new
  // session appended at the end instead of taking the top slot it has live.
  await expect(inbox.locator('.activity-card')).toHaveCount(31);
  expect(await cardKeys(page)).toEqual([...orderBefore, 'w:new']);
  expect(Math.abs(await cardTop(page, 'w:s25') - topBefore)).toBeLessThanOrEqual(1);

  // A poll that removes a card above the viewport must not shift the cards
  // below it: the slot stays as an inert tombstone so the same visible anchor
  // keeps its position and a click cannot land on the next card.
  mock.update(reordered.filter(item => item.sessionId !== 's0'));
  const readsBeforeRemoval = mock.reads();
  await page.clock.fastForward(5100);
  await expect.poll(mock.reads).toBeGreaterThan(readsBeforeRemoval);
  await expect(inbox.locator('.activity-card')).toHaveCount(31);
  await expect(inbox.locator('.activity-card[data-key="w:s0"].is-removed')).toHaveCount(1);
  // offsetTop is integer-rounded while layout positions can be fractional.
  expect(Math.abs(await cardTop(page, 'w:s25') - topBefore)).toBeLessThanOrEqual(1);

  // Closing and reopening applies the live urgency order and clears the
  // tombstone: only live sessions come back.
  await inbox.locator('summary').click();
  await expect(inbox.locator('.activity-card')).toHaveCount(0);
  await inbox.locator('summary').click();
  await expect(inbox.locator('.activity-card')).toHaveCount(20);
  expect(await cardKeys(page)).not.toContain('w:s0');
  expect((await cardKeys(page))[0]).toBe('w:new');
});
}

test('a poll-vanished card leaves an inert tombstone: the same-position click cannot open the next session', async ({ page }) => {
  await page.clock.install();
  const mock = await fixture(page, true);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  const inbox = page.getByRole('region', { name: 'Activity notifications' });
  await page.getByRole('button', { name: 'Active session alerts' }).click();
  await expect(inbox.locator('.activity-card')).toHaveCount(20);
  await inbox.locator('.activity-show-more').click();
  await expect(inbox.locator('.activity-card')).toHaveCount(30);

  // Hover the s5 card, then let an authoritative poll remove it: the click
  // that follows on the same screen point must not open s6, which would have
  // slid into that slot if the card just disappeared.
  const slot = await inbox.locator('.activity-card[data-key="w:s5"] > button').first().boundingBox();
  expect(slot).not.toBeNull();
  const point = { x: slot!.x + slot!.width / 2, y: slot!.y + slot!.height / 2 };
  await page.mouse.move(point.x, point.y);
  mock.update(notifications().filter(item => item.sessionId !== 's5'));
  const reads = mock.reads();
  await page.clock.fastForward(5100);
  await expect.poll(mock.reads).toBeGreaterThan(reads);

  // The card count and geometry are unchanged: an inert, inaccessible
  // tombstone holds the slot instead of s6 sliding under the pointer.
  await expect(inbox.locator('.activity-card')).toHaveCount(30);
  const tombstone = inbox.locator('.activity-card[data-key="w:s5"].is-removed');
  await expect(tombstone).toHaveCount(1);
  await expect(tombstone).toHaveAttribute('aria-hidden', 'true');
  await expect(tombstone.locator('button')).toBeDisabled();
  expect((await cardKeys(page)).slice(4, 7)).toEqual(['w:s4', 'w:s5', 'w:s6']);
  const after = await tombstone.boundingBox();
  expect(Math.abs(after!.y - slot!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.height - slot!.height)).toBeLessThanOrEqual(1);

  // Clicking the same screen point hits the tombstone, which does nothing.
  await page.mouse.click(point.x, point.y);
  await page.clock.runFor(50);
  expect(mock.resumed).toEqual([]);

  // The next card is still reachable by an explicit click on it.
  await inbox.locator('.activity-card[data-key="w:s6"] > button').first().click();
  await expect(page.getByLabel('Chat output')).toContainText('History s6');
  expect(mock.resumed).toEqual(['s6']);

  // Reopening applies the live order: no tombstone for s5 comes back.
  await inbox.locator('summary').click();
  await expect(inbox.locator('.activity-card')).toHaveCount(20);
  expect(await cardKeys(page)).not.toContain('w:s5');
  expect((await cardKeys(page))[5]).toBe('w:s6');
});

test('a poll removing every notification keeps the open inbox mounted as tombstones', async ({ page }) => {
  await page.clock.install();
  const mock = await fixture(page, true);
  mock.update(notifications().slice(0, 3));
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  const inbox = page.getByRole('region', { name: 'Activity notifications' });
  await page.getByRole('button', { name: 'Active session alerts' }).click();
  await expect(inbox.locator('.activity-card')).toHaveCount(3);
  const slot = await inbox.locator('.activity-card[data-key="w:s1"] > button').first().boundingBox();
  expect(slot).not.toBeNull();

  // The poll that empties the live list must not unmount the open inbox out
  // from under the pointer; every slot stays as an inert tombstone.
  mock.update([]);
  const reads = mock.reads();
  await page.clock.fastForward(5100);
  await expect.poll(mock.reads).toBeGreaterThan(reads);
  await expect(inbox).toBeVisible();
  await expect(inbox.locator('.activity-card.is-removed')).toHaveCount(3);
  await page.mouse.click(slot!.x + slot!.width / 2, slot!.y + slot!.height / 2);
  await page.clock.runFor(50);
  expect(mock.resumed).toEqual([]);

  // Closing the empty inbox releases it entirely.
  await inbox.locator('summary').click();
  await expect(inbox).toHaveCount(0);
});

test('dismissing an old completion keeps a still-running notification in its slot', async ({ page }) => {
  const mock = await fixture(page, true);
  const items = notifications().slice(0, 3);
  items[1] = { ...items[1], running: true };
  mock.update(items);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  const inbox = page.getByRole('region', { name: 'Activity notifications' });
  await page.getByRole('button', { name: 'Active session alerts' }).click();
  await expect(inbox.locator('.activity-card')).toHaveCount(3);
  const before = await cardKeys(page);
  await inbox.getByRole('button', { name: 'Dismiss Notification 1 completion', exact: true }).click();
  await expect(inbox.locator('.activity-card[data-key="w:s1"]')).toContainText('Running');
  await expect(inbox.locator('.activity-card.is-removed')).toHaveCount(0);
  expect(await cardKeys(page)).toEqual(before);
});

test('pointer held across a reordering poll still opens the pressed session', async ({ page }) => {
  await page.clock.install();
  const mock = await fixture(page, true);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  const inbox = page.getByRole('region', { name: 'Activity notifications' });
  const list = inbox.locator('.activity-inbox-list');
  await page.getByRole('button', { name: 'Active session alerts' }).click();
  await expect(inbox.locator('.activity-card')).toHaveCount(20);
  await inbox.locator('.activity-show-more').click();
  await expect(inbox.locator('.activity-card')).toHaveCount(30);
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });

  const target = inbox.locator('.activity-card[data-key="w:s25"] > button').first();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  // Press down, let the 5s poll land a full order reversal, then release on the
  // same screen point. Frozen order means the pointer still rests on s25.
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  mock.update(notifications().reverse());
  const reads = mock.reads();
  await page.clock.fastForward(5100);
  await expect.poll(mock.reads).toBeGreaterThan(reads);
  await page.mouse.up();
  await expect(page.getByLabel('Chat output')).toContainText('History s25');
  expect(mock.resumed).toEqual(['s25']);
});
