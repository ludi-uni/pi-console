import { test, expect, type Page } from '@playwright/test';

// Fully hermetic: every API route is fulfilled by the mock and EventSource is
// stubbed, so no Console server, remote desktop host, or model is ever touched.
test.use({ serviceWorkers: 'block' });

const pin = 'a'.repeat(64);
const view = (overrides: Record<string, unknown> = {}) => ({
  connection: {
    connection: 'caivi-vm', hostName: 'AI-DESKTOP-01',
    gui: { address: '192.168.56.10', port: 47831, pinSha256: pin, expiresUtc: '2027-01-01T00:00:00.000Z', generation: 'gen-20261030T104225Z-38f5e157' },
    transfer: { address: '192.168.56.10', port: 47832, pinSha256: 'b'.repeat(64), expiresUtc: '2027-01-01T00:00:00.000Z', generation: 'gen-20261030T104225Z-38f5e158' },
  },
  enabled: true, operatorGranted: false,
  grants: { read: true, operate: false, send: false },
  roles: { gui: { tokenRegistered: true, pinApproved: true, error: null, pending: [] }, transfer: { tokenRegistered: true, pinApproved: true, error: null, pending: [] } },
  uncertain: {}, tombstones: {}, revision: 1, ...overrides,
});
const apiExtras = { approvedTarget: { bound: true }, artifacts: [], staged: [], config: { perRequestApproval: true } };
const pending = { approvalId: 'ap1', operation: 'caivi_click', requestedAt: '2026-10-31T00:00:00.000Z', expiresAt: '2027-10-31T00:01:00.000Z', revision: 1 };

async function openRemoteSettings(page: Page, remote: { pendingApproval: unknown; staged?: { name: string; size: number }[]; artifacts?: { name: string; sha256: string; size: number }[] }, posts: { route: string; body: unknown }[], counts: { gets: number }) {
  await page.addInitScript(() => { (window as any).EventSource = class extends EventTarget { close() {} }; });
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let value: unknown = {};
    if (path === '/api/remote-connections' && request.method() === 'GET') { counts.gets++; value = { connection: view(), pendingApproval: remote.pendingApproval, ...apiExtras, staged: remote.staged ?? [], artifacts: remote.artifacts ?? [] }; }
    else if (path === '/api/remote-connections/approval' && request.method() === 'POST') { posts.push({ route: 'approval', body: request.postDataJSON() }); value = { resolved: true }; }
    else if (path === '/api/remote-connections/grants' && request.method() === 'POST') { posts.push({ route: 'grants', body: request.postDataJSON() }); value = { connection: view({ grants: { read: true, operate: true, send: false } }) }; }
    else if (path === '/api/remote-connections/artifacts-upload' && request.method() === 'POST') { const body = request.postDataJSON() as any; posts.push({ route: 'artifacts-upload', body: { connection: body.connection, name: body.name, bytes: (body.dataBase64 ?? '').length } }); remote.staged = [...(remote.staged ?? []), { name: body.name, size: 11 }]; value = { staged: { name: body.name, size: 11, sha256: 'c'.repeat(64) }, artifact: { name: body.name, size: 11, sha256: 'c'.repeat(64) }, connection: view() }; }
    else if (path === '/api/remote-connections/artifacts' && request.method() === 'POST') { const body = request.postDataJSON() as any; posts.push({ route: 'artifacts', body }); if (body.action === 'register') { remote.artifacts = [{ name: body.name, sha256: 'c'.repeat(64), size: 11 }]; remote.staged = []; value = { artifacts: remote.artifacts, staged: [], connection: view() }; } else { remote.staged = []; value = { staged: [], connection: view() }; } }
    else if (path === '/api/workspaces') value = { workspaces: [] };
    else if (path === '/api/activity') value = { sessions: [] };
    else if (path === '/api/pets') value = { pets: [] };
    else if (path === '/api/session-retention') value = { enabled: false, days: 30 };
    else if (path === '/api/startup') value = { supported: false, enabled: false, installed: false };
    else if (path === '/api/quick-prompts') value = { prompts: [] };
    else if (path.startsWith('/api/orchestrator')) value = { available: false };
    else if (path === '/api/voice/status') value = { enabled: false, available: false, phase: 'off' };
    await route.fulfill({ json: value });
  });
  await page.goto('/?view=settings');
  await page.getByRole('button', { name: 'Remote connections' }).click();
}

test('approval is discovered while open, decided once, and drafts survive polling', async ({ page }) => {
  await page.clock.install();
  const remote = { pendingApproval: null as unknown }, posts: { route: string; body: unknown }[] = [], counts = { gets: 0 };
  await openRemoteSettings(page, remote, posts, counts);
  const panel = page.getByRole('region', { name: 'Approve a requested VM write' });
  await expect(panel).toBeHidden();

  // Draft edits made while polling must not be reset by a poll snapshot.
  await page.locator('details.remote-advanced > summary').click();
  await page.locator('details.remote-manual > summary').click();
  const address = page.getByLabel('gui address');
  await address.fill('192.168.56.99');

  // The request arrives after the page was already open: bounded monitoring finds it.
  remote.pendingApproval = pending;
  await page.clock.runFor(2500);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('exact click positions, typed text, or drag details');
  await expect(address).toHaveValue('192.168.56.99');

  // More polling while the panel is open still preserves drafts.
  await page.clock.runFor(4500);
  await expect(address).toHaveValue('192.168.56.99');

  const decide = async (name: string | RegExp) => {
    remote.pendingApproval = null;
    // dispatchEvent, not click: deciding removes the panel in the same tick, so a
    // real click's actionability retry can lose the detached button (WebKit).
    await panel.getByRole('button', { name }).dispatchEvent('click');
    await expect(panel).toBeHidden();
    return posts.at(-1)!.body;
  };
  expect(await decide('Deny')).toEqual({ connection: 'caivi-vm', approvalId: 'ap1', approved: false });

  // A later request is discovered again and can be approved.
  remote.pendingApproval = pending;
  await page.clock.runFor(2500);
  await expect(panel).toBeVisible();
  expect(await decide('Approve this one action')).toEqual({ connection: 'caivi-vm', approvalId: 'ap1', approved: true });
});

test('grant toggles post /grants and show effective state with prerequisites', async ({ page }) => {
  await page.clock.install();
  const remote = { pendingApproval: null as unknown }, posts: { route: string; body: unknown }[] = [], counts = { gets: 0 };
  await openRemoteSettings(page, remote, posts, counts);
  const panel = page.getByRole('region', { name: 'Permissions' });
  await expect(panel).toBeVisible();

  // read is on and all prerequisites met → Ready to use; operate is off.
  const readGrant = page.getByLabel('read grant');
  const operateGrant = page.getByLabel('operate grant');
  await expect(readGrant).toBeChecked();
  await expect(operateGrant).not.toBeChecked();
  await expect(panel).toContainText('Ready to use');

  // Toggling operate on posts the grant change (controlled input: click, then
  // the mocked response drives the checked state).
  await operateGrant.click();
  expect(posts.at(-1)).toEqual({ route: 'grants', body: { connection: 'caivi-vm', grants: { operate: true } } });
  await expect(operateGrant).toBeChecked();

  // Turning read off posts the revoke.
  await readGrant.click();
  expect(posts.at(-1)).toEqual({ route: 'grants', body: { connection: 'caivi-vm', grants: { read: false } } });
});

test('monitoring is bounded to five minutes, restartable via Refresh, and stops on unmount', async ({ page }) => {
  await page.clock.install();
  const remote = { pendingApproval: null as unknown }, posts: { route: string; body: unknown }[] = [], counts = { gets: 0 };
  await openRemoteSettings(page, remote, posts, counts);
  const before = counts.gets;
  await page.clock.runFor(290_000); // still inside the five-minute discovery window
  const inside = counts.gets;
  expect(inside).toBeGreaterThan(before + 100);
  await page.clock.runFor(30_000); // cross the window boundary; remaining ticks may still land inside
  const polled = counts.gets;
  await page.clock.runFor(10_000);
  expect(counts.gets).toBe(polled); // stopped after the bounded window
  await expect(page.getByText('Approval request monitoring paused')).toBeVisible();

  // Refresh restarts bounded monitoring.
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  remote.pendingApproval = pending;
  await page.clock.runFor(2500);
  expect(counts.gets).toBeGreaterThan(polled);
  await expect(page.getByRole('region', { name: 'Approve a requested VM write' })).toBeVisible();

  // Leaving the section unmounts the component and stops all polling.
  const resolved = page.waitForRequest(r => r.url().includes('/api/remote-connections/approval'));
  remote.pendingApproval = null;
  await page.getByRole('button', { name: 'Deny' }).dispatchEvent('click');
  await resolved;
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  const atLeave = counts.gets;
  await page.clock.runFor(15_000);
  expect(counts.gets).toBe(atLeave);
});

test('file picker stages bytes, shows name/size/hash, and register is a separate approval', async ({ page }) => {
  await page.clock.install();
  const remote: { pendingApproval: unknown; staged?: { name: string; size: number }[]; artifacts?: { name: string; sha256: string; size: number }[] } = { pendingApproval: null };
  const posts: { route: string; body: unknown }[] = [], counts = { gets: 0 };
  await openRemoteSettings(page, remote, posts, counts);
  const panel = page.getByRole('region', { name: 'Approved files' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('No staged files');

  // Picker upload: bytes go only to the dedicated upload route as base64.
  const picker = panel.getByLabel('Choose a file to stage');
  await expect(picker).toBeEnabled();
  await picker.setInputFiles({ name: 'report.zip', mimeType: 'application/zip', buffer: Buffer.from('hello-bytes') });
  await expect.poll(() => posts.some(p => p.route === 'artifacts-upload')).toBe(true);
  const upload = posts.find(p => p.route === 'artifacts-upload')!.body as any;
  expect(upload.connection).toBe('caivi-vm');
  expect(upload.name).toBe('report.zip');
  expect(upload.bytes).toBeGreaterThan(0); // base64 payload length
  await expect(panel).toContainText('Staged: report.zip');
  await expect(panel).toContainText('c'.repeat(16));

  // Register is a separate explicit step with its own confirm.
  await panel.getByRole('button', { name: 'Register…' }).click();
  await panel.getByRole('button', { name: 'Confirm registration' }).click();
  expect(posts.at(-1)).toEqual({ route: 'artifacts', body: { connection: 'caivi-vm', action: 'register', name: 'report.zip' } });
  await expect(panel).toContainText('report.zip');
});
