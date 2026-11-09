import { test, expect } from '@playwright/test';
import { openWorkspaceAdd } from './workspace-setup.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Local speech.cpp dictation over fake media devices only — the real
// microphone, real speech.exe and model downloads are never touched. The
// voice API surface is mocked at /api/voice/*; Chrome's fake audio device +
// real MediaRecorder/AudioContext exercise the actual capture→WAV pipeline.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

const ENABLED = { enabled: true, available: false, phase: 'stopped', modelId: 'qwen3-asr-0.6b', providerId: 'speech-cpp' };

test('local speech.cpp dictation works without Web Speech API; processing beyond 3 s does not time out; cancel suppresses late results', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-voice-'));
  const posts: { audioBase64: string; language: string }[] = [];
  const release: (() => void)[] = [];
  try {
    // Web Speech API is absent — the local provider must still offer dictation.
    await page.addInitScript(() => {
      delete (window as any).SpeechRecognition;
      delete (window as any).webkitSpeechRecognition;
    });
    await page.route('**/api/voice/status', route => route.fulfill({ json: ENABLED }));
    await page.route('**/api/voice/transcribe', async route => {
      posts.push(route.request().postDataJSON());
      // Hold the response past the 3 s streaming grace window: batch STT is
      // allowed to process far longer before the session gives up.
      await new Promise<void>(r => release.push(r));
      await route.fulfill({ json: { text: 'ローカル認識の結果', providerId: 'speech-cpp', language: 'ja' } });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.clock.install();
    await page.goto('/');
    await openWorkspaceAdd(page);
    await page.getByLabel('Workspace path').fill(root);
    await page.getByRole('button', { name: 'Add & open' }).click();
    await page.getByRole('button', { name: 'New Session' }).click();
    // Desktop layout already shows the chat panel — no Chat nav step needed.
    await expect(page.getByRole('button', { name: 'Voice input' })).toBeEnabled();

    await page.getByRole('button', { name: 'Voice input' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Voice input' });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    // Only the local engine is usable — no Web Speech, no engine switcher.
    await expect(dialog.getByLabel('Recognition engine')).toHaveCount(0);
    // The local batch provider offers auto language detection on top of ja/en.
    await expect(dialog.getByLabel('Recognition language').locator('option')).toHaveText(['日本語', 'English', 'Auto-detect']);
    await dialog.getByLabel('Recognition language').selectOption('auto');

    // A delayed permission grant must not consume the 60-second capture
    // window. Advancing this clock never accesses a real microphone.
    await page.evaluate(()=>{
      const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=constraints=>new Promise((resolve,reject)=>{
        (window as any).__grantLocalMic=()=>{navigator.mediaDevices.getUserMedia=original;void original(constraints).then(resolve,reject);};
      });
    });
    await dialog.getByRole('button', { name: 'Start listening' }).click();
    await expect(dialog.getByText('Waiting for microphone permission…')).toBeVisible();
    await page.clock.fastForward(64000);
    await expect(dialog.getByRole('button',{name:'Stop listening'})).toBeEnabled();
    expect(posts.length).toBe(0);
    await page.evaluate(()=>(window as any).__grantLocalMic());
    await expect(dialog.getByText('Listening · up to 60 seconds')).toBeVisible();
    await page.waitForTimeout(800);
    await dialog.getByRole('button', { name: 'Stop listening' }).click();
    // The mic is off; server-side transcription may run well past 3 s.
    await expect(dialog.getByText('Transcribing… the microphone is off')).toBeVisible();
    await page.waitForTimeout(4000);
    expect(posts.length).toBe(1);
    release.shift()!();
    await expect(dialog.getByRole('button', { name: 'Insert into prompt' })).toBeEnabled();
    // One bounded same-origin WAV POST, auto language passthrough.
    expect(posts[0].language).toBe('auto');
    const wav = Buffer.from(posts[0].audioBase64, 'base64');
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16000); // 16 kHz
    expect(wav.readUInt16LE(34)).toBe(16); // PCM16
    await dialog.getByRole('button', { name: 'Insert into prompt' }).click();
    await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('ローカル認識の結果');

    // Cancel mid-processing: the late server reply must never be inserted.
    // The engine select is absent when only one provider is available.
    await page.getByRole('button', { name: 'Voice input' }).first().click();
    await page.getByRole('dialog', { name: 'Voice input' }).getByRole('button', { name: 'Start listening' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('dialog', { name: 'Voice input' }).getByRole('button', { name: 'Stop listening' }).click();
    await expect(page.getByRole('dialog', { name: 'Voice input' }).getByText('Transcribing… the microphone is off')).toBeVisible();
    await expect.poll(() => posts.length).toBe(2);
    await page.getByRole('dialog', { name: 'Voice input' }).getByRole('button', { name: 'Cancel' }).click();
    release.shift()!();
    await page.waitForTimeout(300);
    await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('ローカル認識の結果');

    // Configured recognition opens the in-tab trial, not the old command guide.
    // No owner authentication or additional setup is needed to try it.
    await page.goto('/?view=settings');
    await page.getByRole('button', { name: 'Voice input', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Ready', exact: true })).toBeVisible();
    await expect(page.getByText('Qwen3-ASR 0.6B · Console PC', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try voice input', exact: true })).toBeVisible();
    await expect(page.getByLabel('Owner verification command', { exact: true })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Prepare', exact: true })).toHaveCount(0);
  } finally {
    while (release.length) release.shift()!();
    try {
      const ws = (await (await page.request.get('/api/workspaces')).json()).workspaces.find((w: { path: string }) => w.path === root);
      if (ws) {
        for (const item of (await (await page.request.get(`/api/sessions?workspaceId=${ws.id}`)).json()).sessions) await page.request.post('/api/close', { data: { workspaceId: ws.id, sessionId: item.id } });
        await page.request.post('/api/workspaces/remove', { data: { id: ws.id } });
      }
    } catch { /* Preserve the original test failure. */ }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
  }
});
