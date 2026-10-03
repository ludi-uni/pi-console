import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });
const workspace = { id: 'w1', name: 'Pet test', path: 'C:/pet-test', valid: true, pinned: false, lastOpenedAt: '2026-01-01' };
const session = { id: 's1', workspaceId: 'w1', filePath: '/unused.jsonl', name: 'Pet chat' };
const oldEnd = { schemaVersion: 1, eventId: 'old-end', seq: 1, generation: 'g1', timestamp: '2026-01-01T00:00:00Z', workspaceId: 'w1', sessionId: 's1', runId: 'old-run', entityId: 'old-run', type: 'RunCompleted', status: 'completed', payload: {}, source: 'console', certainty: 'observed' };
const snapshot = { session, runtime: 'running', chat: [{ id: 'a1', role: 'assistant', text: 'Ready.', complete: true }], events: [oldEnd], execution: { nodes: [], roots: [], unattached: [], rows: [], activeCount: 0, failedCount: 0, decisionCount: 0 }, seq: 1, generation: 'g1' };

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem('pi-console:preferences:v1', JSON.stringify({ petEnabled: true, petId: 'fio', petSource: 'bundled', petScale: 2, petPosition: 'right' }));
    (window as any).EventSource = class {
      closed = false;
      close() { this.closed = true; }
      addEventListener(name: string, listener: (event: { data: string }) => void) {
        if (name === 'execution') (window as any).emitPetEvent = (event: unknown) => { if (!this.closed) listener({ data: JSON.stringify(event) }); };
      }
    };
  });
  // Every API request is mocked: real bundled artwork, no SDK/provider calls or settings writes.
  const sheet = await readFile('package/pets/fio/spritesheet.webp');
  const manifest = JSON.parse(await readFile('package/pets/fio/pet.json', 'utf8'));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/pet/file') return url.searchParams.get('file') === 'pet.json'
      ? route.fulfill({ json: manifest }) : route.fulfill({ contentType: 'image/webp', body: sheet });
    const responses: Record<string, unknown> = {
      '/api/workspaces': { workspaces: [workspace] }, '/api/workspaces/update': { workspace },
      '/api/sessions': { sessions: [session] }, '/api/activity': { sessions: [] },
      '/api/resume': { snapshot }, '/api/state': snapshot, '/api/quick-prompts': { prompts: [] },
      '/api/session/options': { models: [], thinkingLevel: 'off', thinkingLevels: ['off'] },
      '/api/pets': { pets: [{ id: 'fio', source: 'bundled', displayName: 'Fio' }] },
    };
    await route.fulfill({ json: responses[url.pathname] ?? { available: false } });
  });
});

async function ready(page: Page) {
  await page.goto('/');
  await expect.poll(() => page.locator('.pet-widget canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width === 192 && canvas.height === 208)).toBe(true);
  await expect.poll(async () => {
    await page.clock.runFor(32);
    return page.locator('.pet-widget').getAttribute('data-frame');
  }).not.toBeNull();
}

async function pose(page: Page) {
  return page.locator('.pet-widget').evaluate(el => {
    const canvas = el.querySelector('canvas')!, pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let top = canvas.height, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3] > 12) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    const bounds = el.getBoundingClientRect();
    return { top, bottom, x: bounds.x, y: bounds.y, motion: (el as HTMLElement).dataset.motion, frame: Number((el as HTMLElement).dataset.frame) };
  });
}

test('bundled jump preserves cell whitespace, body size, apex and landing', async ({ page }) => {
  await ready(page);
  const bounds = await page.evaluate(async () => {
    const image = new Image(); image.src = '/api/pet/file?pet=fio&source=bundled&file=spritesheet.webp'; await image.decode();
    const width = image.naturalWidth / 8, height = image.naturalHeight / 11, canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d')!;
    return Array.from({ length: 5 }, (_, frame) => {
      ctx.clearRect(0, 0, width, height); ctx.drawImage(image, frame * width, 4 * height, width, height, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height).data; let top = height, bottom = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 12) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
      return { top, bottom, bodyHeight: bottom - top + 1 };
    });
  });
  expect(bounds[0].bottom - bounds[2].bottom).toBeGreaterThan(40);
  expect(Math.abs(bounds[0].bottom - bounds[4].bottom)).toBeLessThanOrEqual(2);
  expect(Math.max(...bounds.map(b => b.bodyHeight)) - Math.min(...bounds.map(b => b.bodyHeight))).toBeLessThan(5);
});

test('pet preserves aspect ratio at horizontal and vertical viewport limits', async ({ page }) => {
  await ready(page);
  for (const [width, height] of [[390, 780], [320, 360], [1280, 200]]) {
    await page.setViewportSize({ width, height }); await page.clock.runFor(32);
    const size = await page.locator('.pet-widget canvas').evaluate((canvas: HTMLCanvasElement) => {
      const bounds = canvas.getBoundingClientRect(); return { width: bounds.width, height: bounds.height, x: bounds.width / canvas.width, y: bounds.height / canvas.height };
    });
    expect(size.x).toBeCloseTo(size.y, 3);
    expect(size.width).toBeLessThanOrEqual(width * .32 + 1);
    expect(size.height).toBeLessThanOrEqual(height * .32 + 1);
  }
});

test('dragging still follows the pointer, pauses roaming and restores the scaled position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 }); await ready(page);
  const widget = page.locator('.pet-widget'), before = (await widget.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down(); await page.mouse.move(80, 180, { steps: 5 });
  await page.clock.runFor(200);
  expect((await pose(page)).motion).toMatch(/^walk-/);
  await page.mouse.up(); await page.clock.runFor(32);
  const dropped = (await widget.boundingBox())!;
  expect(dropped.x).toBeLessThan(before.x - 50);
  expect(dropped.x).toBeGreaterThanOrEqual(4); expect(dropped.y).toBeGreaterThanOrEqual(4);
  await page.clock.runFor(1000);
  const paused = (await widget.boundingBox())!;
  expect(paused.x).toBeCloseTo(dropped.x, 1); expect(paused.y).toBeCloseTo(dropped.y, 1);
  await page.reload();
  await expect.poll(async () => { await page.clock.runFor(32); return widget.getAttribute('data-frame'); }).not.toBeNull();
  const restored = (await widget.boundingBox())!;
  expect(restored.x).toBeCloseTo(dropped.x, 1); expect(restored.y).toBeCloseTo(dropped.y, 1);
});

test('jump lands once without roaming interruption; idle roaming resumes afterward', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 }); await ready(page);
  await page.locator('.workspace-card').first().click();
  await page.getByLabel('Session list').getByRole('button', { name: /^Pet chat/ }).click();
  await expect(page.getByLabel('Chat output')).toContainText('Ready.');
  await page.clock.runFor(32);
  await page.evaluate(event => (window as any).emitPetEvent(event), { ...oldEnd, eventId: 'new-end', seq: 2, runId: 'new-run', entityId: 'new-run' });
  await page.clock.runFor(32);
  const initial = await pose(page); expect(initial.motion).toBe('completed');
  await page.clock.runFor(360);
  const apex = await pose(page); expect(apex.frame).toBe(2); expect(initial.bottom - apex.bottom).toBeGreaterThan(40);
  await page.locator('.pet-widget').screenshot({ path: 'test-results/pet-jump-apex.png' });
  await page.clock.runFor(1800);
  const landed = await pose(page);
  expect(landed.motion).toBe('completed'); expect(landed.frame).toBe(4);
  expect(Math.abs(landed.bottom - initial.bottom)).toBeLessThanOrEqual(2);
  expect(landed.x).toBeCloseTo(initial.x, 1); expect(landed.y).toBeCloseTo(initial.y, 1);
  await page.locator('.pet-widget').screenshot({ path: 'test-results/pet-jump-landed.png' });
  await page.clock.runFor(1600); await page.clock.runFor(200);
  expect((await pose(page)).motion).toMatch(/^walk-/);
});
