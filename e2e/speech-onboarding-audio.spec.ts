import { test, expect } from '@playwright/test';

// Chrome fake microphone only. The API never reaches speech.exe, Pi or a model.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
test('the onboarding test records locally, previews a transcript and never sends a prompt', async ({ page }, testInfo) => {
  test.setTimeout(25000);
  const posts: { path: string; body: any }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('pi-console:preferences:v1', JSON.stringify({ language: 'ja', petEnabled: false }));
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
  });
  const voice = { enabled: true, available: false, phase: 'stopped', modelId: 'qwen3-asr-0.6b', providerId: 'speech-cpp' };
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === 'POST') posts.push({ path, body: req.postDataJSON() });
    if (path === '/api/voice/status') return route.fulfill({ json: voice });
    if (path === '/api/voice/onboarding/status') return route.fulfill({ json: { status: { state: 'idle', sameDevice: true }, preflight: { supported: true, vulkanLoader: true, nativeApproval: true } } });
    if (path === '/api/voice/setup') return route.fulfill({ status: 503, json: {} });
    if (path === '/api/voice/transcribe') return route.fulfill({ json: { text: 'テストの文字起こし', providerId: 'speech-cpp' } });
    if (path === '/api/quick-prompts') return route.fulfill({ json: { prompts: [] } });
    if (path === '/api/workspaces') return route.fulfill({ json: { workspaces: [] } });
    if (path === '/api/pets') return route.fulfill({ json: { pets: [] } });
    if (path === '/api/activity') return route.fulfill({ json: { sessions: [] } });
    if (path === '/api/session-retention') return route.fulfill({ json: { enabled: false, days: 30 } });
    if (path === '/api/startup') return route.fulfill({ json: { supported: false, enabled: false } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/?view=settings');
  await page.locator('.settings-menu').getByRole('button', { name: '音声入力', exact: true }).click();
  await page.getByRole('button', { name: '音声入力を試す', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '音声入力', exact: true });
  await expect(dialog.getByRole('combobox', { name: '認識の方法', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '開始', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '開始', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '停止', exact: true })).toBeEnabled();
  await page.waitForTimeout(700); // bounded capture of the fake audio device
  await dialog.getByRole('button', { name: '停止', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'この文字起こしを使う', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'この文字起こしを使う', exact: true }).click();
  await expect(page.getByText('テストの文字起こし', { exact: true })).toBeVisible();
  await expect(page.getByText('文字起こしプレビュー · 未送信', { exact: true })).toBeVisible();
  expect(posts.map(p => p.path)).toEqual(['/api/voice/transcribe']);
  const wav = Buffer.from(posts[0].body.audioBase64, 'base64');
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.length).toBeGreaterThan(44);
  await page.screenshot({ path: testInfo.outputPath('transcript.png'), fullPage: true });
});
