import { test, expect, type Page } from '@playwright/test';

// Real React wizard, fake APIs only. No native window or download is launched.
test.setTimeout(20000);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pi-console:preferences:v1', JSON.stringify({ language: 'ja', petEnabled: false })));
});
const IDLE = { state: 'idle', sameDevice: true };
const PREFLIGHT = { supported: true, vulkanLoader: true, nativeApproval: true };
const PAYLOAD = { source: 'managed', modelId: 'qwen3-asr-0.6b', allowDownload: true, hasExistingExecutable: false, hasExistingModelDirectory: false };
const REQ = '11111111-2222-4333-8444-555555555555';
const OFF = { enabled: false, available: false, phase: 'off', providerId: 'speech-cpp' };
const ON = { ...OFF, enabled: true, phase: 'stopped', modelId: 'qwen3-asr-0.6b' };

async function base(page: Page, options: { state?: string; sameDevice?: boolean; enabled?: boolean; loadFailure?: boolean; nativeApproval?: boolean } = {}) {
  let state = options.state ?? 'idle';
  let id = REQ;
  let enabled = options.enabled ?? false;
  let loadFailure = options.loadFailure ?? false;
  const posts: { url: string; body: any }[] = [];
  const ids: string[] = [];
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === 'POST') posts.push({ url: path, body: req.postDataJSON() });
    if (path === '/api/voice/setup') return route.fulfill({ json: { instanceId: 'a'.repeat(64), consolePort: 31718, probeUrl: 'http://127.0.0.1:31718/api/voice/local-probe', setupUrl: 'http://127.0.0.1:31718/voice-setup/' } });
    if (path === '/api/voice/local-probe') return route.fulfill({ status: options.sameDevice === false ? 403 : 200, json: { instanceId: 'a'.repeat(64) } });
    if (path === '/api/voice/status') return route.fulfill({ json: enabled ? ON : OFF });
    const status = () => ({ state, sameDevice: options.sameDevice !== false, ...(state !== 'idle' ? { requestId: id, payload: PAYLOAD, startedAt: Date.now() - 3000 } : {}), ...(state === 'processing' ? { job: { id: 'job-test', kind: 'model-fetch', state: 'running', startedAt: Date.now() - 3000 } } : {}), ...(state === 'failed' ? { error: 'speech_model_fetch_failed' } : {}) });
    if (path === '/api/voice/onboarding/status') return route.fulfill({ status: loadFailure ? 503 : 200, json: { status: status(), preflight: { ...PREFLIGHT, nativeApproval: options.nativeApproval ?? true } } });
    if (path === '/api/voice/onboarding/request') {
      id = req.postDataJSON().requestId; ids.push(id); state = 'pending';
      return route.fulfill({ status: 202, json: { status: status(), preflight: PREFLIGHT } });
    }
    if (path === '/api/voice/onboarding/cancel') { state = 'cancelled'; return route.fulfill({ json: { status: status(), preflight: PREFLIGHT } }); }
    if (path === '/api/quick-prompts') return route.fulfill({ json: { prompts: [] } });
    if (path === '/api/pets') return route.fulfill({ json: { pets: [] } });
    if (path === '/api/workspaces') return route.fulfill({ json: { workspaces: [] } });
    if (path === '/api/activity') return route.fulfill({ json: { sessions: [] } });
    if (path === '/api/session-retention') return route.fulfill({ json: { enabled: false, days: 30 } });
    if (path === '/api/startup') return route.fulfill({ json: { supported: false, enabled: false, installed: false } });
    if (req.method() !== 'GET') return route.abort();
    return route.fulfill({ json: {} });
  });
  await page.goto('/?view=settings');
  await page.locator('.settings-menu').getByRole('button', { name: '音声入力', exact: true }).click();
  return { posts, ids, setState: (next: string) => { state = next; if (next === 'ready') enabled = true; }, recover: () => { loadFailure = false; } };
}

async function prepare(page: Page) {
  await page.getByRole('button', { name: '準備する', exact: true }).click();
  await page.getByRole('button', { name: 'ダウンロードして準備する', exact: true }).click();
}

test('one prepare CTA; advanced options and command are hidden; no redirect or POST on entry', async ({ page }) => {
  const h = await base(page);
  await expect(page).toHaveURL(/view=settings/);
  await expect(page.getByRole('button', { name: '準備する', exact: true })).toBeEnabled();
  await expect(page.getByText('Qwen3-ASR 0.6B', { exact: true })).toBeVisible();
  await expect(page.getByLabel('本人確認コマンド', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('link', { name: /localhost/i })).toHaveCount(0);
  expect(h.posts).toEqual([]);
});

test('prepare -> native wait -> real job phase -> ready stays within the same tab', async ({ page }) => {
  const h = await base(page);
  await page.getByRole('button', { name: '準備する', exact: true }).click();
  await expect(page.getByText('約0.84 GB', { exact: true })).toBeVisible();
  await expect(page.getByText('✓ Windows x64 / Vulkan loader', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ダウンロードして準備する', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Console PCで確認してください', exact: true })).toBeVisible();
  expect(h.posts).toHaveLength(1);
  expect(h.posts[0].body.payload).toEqual({ source: 'managed', modelId: 'qwen3-asr-0.6b', allowDownload: true });
  await expect(page.getByRole('button', { name: '許可する', exact: true })).toHaveCount(0);
  h.setState('processing');
  await expect(page.getByRole('heading', { name: '準備が終わるまで、お待ちください', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: '準備中', exact: true })).not.toHaveAttribute('value');
  h.setState('ready');
  await expect(page.getByRole('heading', { name: '準備できました', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '音声入力を試す', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/view=settings/);
});

test('mobile remote/unknown device asks for approval on the host, never in this browser', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await base(page, { sameDevice: false, state: 'pending' });
  await expect(page.getByRole('heading', { name: 'Console PCで確認してください', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '許可する', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('configured stopped recognition is ready without another install or command', async ({ page }) => {
  const h = await base(page, { enabled: true });
  const button = page.getByRole('button', { name: '音声入力を試す', exact: true });
  await expect(button).toBeEnabled();
  await expect(button).toBeInViewport();
  const card = await page.locator('.speech-onb').boundingBox();
  const box = await button.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(card!.x);
  expect(box!.y + box!.height).toBeLessThanOrEqual(card!.y + card!.height);
  await button.click();
  await expect(page.getByRole('dialog', { name: '音声入力', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '音声入力を閉じる', exact: true }).click();
  await expect(page.getByRole('button', { name: '準備する', exact: true })).toHaveCount(0);
  expect(h.posts).toEqual([]);
});

for (const state of ['rejected', 'expired', 'unavailable', 'failed']) {
  test(`${state} state gives a visible explanation and an explicit retry`, async ({ page }) => {
    await base(page, { state });
    await expect(page.locator('.speech-onb-notice').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '準備する', exact: true })).toBeEnabled();
  });
}

test('cancel/retry is a fresh intent, and reload never re-POSTs', async ({ page }) => {
  const h = await base(page);
  await prepare(page);
  await page.getByRole('button', { name: '依頼を取り消す', exact: true }).click();
  await prepare(page);
  expect(new Set(h.ids).size).toBe(2);
  const requests = h.ids.length;
  await page.reload();
  await page.locator('.settings-menu').getByRole('button', { name: '音声入力', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Console PCで確認してください', exact: true })).toBeVisible();
  expect(h.ids).toHaveLength(requests);
});

test('failed initial status read can be retried without an endless loading state', async ({ page }) => {
  const h = await base(page, { loadFailure: true });
  await expect(page.getByRole('button', { name: '状態を再取得', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '準備する', exact: true })).toBeDisabled();
  h.recover();
  await page.getByRole('button', { name: '状態を再取得', exact: true }).click();
  await expect(page.getByRole('button', { name: '準備する', exact: true })).toBeEnabled();
});

test('legacy localhost landing links to authenticated settings in remote mode without making setup requests', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.route('**/voice-setup/', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('<body>', '<body data-console-url="https://console.example.com/?view=settings">');
    await route.fulfill({ response, body });
  });
  await page.goto('/voice-setup/');
  await expect(page.getByRole('link', { name: /Continue to Console settings|Console の音声設定へ進む/ })).toHaveAttribute('href', 'https://console.example.com/?view=settings');
  await expect(page.getByRole('button', { name: '準備する', exact: true })).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});

test('unmanaged launch explains why PC-side confirmation is unavailable', async ({ page }) => {
  await base(page, { nativeApproval: false });
  await expect(page.getByText(/この起動方法では PC 側の確認機能を利用できません/)).toBeVisible();
  await expect(page.getByRole('button', { name: '準備する', exact: true })).toBeDisabled();
  await expect(page.getByLabel('本人確認コマンド', { exact: true })).not.toBeVisible();
});

test('advanced model selection is not described as the default model or size', async ({ page }) => {
  await base(page);
  await page.locator('.speech-onb-advanced > summary').click();
  await page.getByRole('combobox', { name: 'モデル', exact: true }).selectOption('qwen3-asr-1.7b');
  await page.getByRole('button', { name: '準備する', exact: true }).click();
  await expect(page.getByText('モデルにより異なります', { exact: true })).toBeVisible();
  await expect(page.getByText('約0.84 GB', { exact: true })).toHaveCount(0);
});
