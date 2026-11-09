// speech.cpp service lifecycle tests — every external effect (release API,
// download, spawn, extraction, model pull, serve) is faked. No real network,
// executable or process is touched.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpeechCppService, validLocalExecutable, validLocalDirectory } from '../server/speech-cpp.ts';
import {
  fakeSpawn, fakeFetch, versionSpec, modelsSpec, pullSpec, pullFailSpec, extractSpec, extractFailSpec,
  jsonResponse, bytesResponse, textResponse, redirectResponse, releaseJson, FAKE_ZIP, sha256, serveSpec,
} from './helpers/speech.fixture.ts';

const owner = () => {};
const ownerDeny = () => { throw new Error('denied'); };

async function dir() { return mkdtemp(join(tmpdir(), 'pi-speech-svc-')); }
async function existingExe(root: string) {
  const exe = join(root, 'tools', 'speech.exe');
  await mkdir(join(root, 'tools'), { recursive: true });
  await writeFile(exe, 'MZ');
  return exe;
}
async function service(dataDir: string, deps: Parameters<typeof Object.assign>[1]) {
  const s = new SpeechCppService({ dataDir, deps });
  await s.load();
  return s;
}
const settle = () => new Promise(r => setTimeout(r, 25));
async function waitJob(s: SpeechCppService) {
  for (let i = 0; i < 200; i++) { const j = s.ownerStatus().job; if (!j || j.state !== 'running') return j; await settle(); }
  return s.ownerStatus().job;
}

describe('defaults and settings load', () => {
  it('fresh dataDir loads OFF with zero side effects', async () => {
    const dataDir = await dir();
    let spawned = 0, fetched = 0;
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn: (...a: any[]) => { spawned++; throw new Error('no'); }, fetch: async () => { fetched++; throw new Error('no'); } });
    const st = s.publicStatus();
    assert.equal(st.enabled, false); assert.equal(st.available, false); assert.equal(st.phase, 'off');
    assert.equal(spawned, 0); assert.equal(fetched, 0);
  });
  it('persisted enabled settings load as stopped without touching the network or processes', async () => {
    const dataDir = await dir();
    await mkdir(join(dataDir, 'voice'), { recursive: true });
    await writeFile(join(dataDir, 'voice', 'settings.json'), JSON.stringify({ version: 1, enabled: true, source: 'existing', executablePath: 'D:\\tools\\speech.exe', modelDirectory: 'D:\\tools\\models', modelId: 'qwen3-asr-0.6b', modelFile: 'D:\\tools\\models\\m.gguf' }));
    let spawned = 0, fetched = 0;
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn: () => { spawned++; throw new Error('no'); }, fetch: async () => { fetched++; throw new Error('no'); } });
    assert.equal(s.publicStatus().phase, 'stopped');
    assert.equal(s.ownerStatus().executablePath, 'D:\\tools\\speech.exe');
    assert.equal(spawned, 0); assert.equal(fetched, 0);
  });
  it('corrupt settings fail closed but keep the console bootable', async () => {
    const dataDir = await dir();
    await mkdir(join(dataDir, 'voice'), { recursive: true });
    await writeFile(join(dataDir, 'voice', 'settings.json'), '{"version":99}');
    let spawned = 0, fetched = 0;
    const s = new SpeechCppService({ dataDir, deps: { platform: 'win32', arch: 'x64', spawn: () => { spawned++; throw new Error('no'); }, fetch: async () => { fetched++; throw new Error('no'); } } });
    await s.load(); // soft-fail: app boot must not depend on this file
    const st = s.ownerStatus();
    assert.equal(st.enabled, false);
    assert.equal(st.phase, 'error');
    assert.equal(st.lastError, 'speech_settings_unavailable');
    assert.equal(spawned, 0); assert.equal(fetched, 0);
    // non-configure actions still fail closed until explicit owner re-configure
    await assert.rejects(() => s.transcribe(Buffer.alloc(44, 0), undefined, new AbortController().signal), /speech_unavailable/);
    await assert.rejects(() => s.disable(owner), /speech_unavailable/);
    // the corrupt file is preserved — never silently overwritten
    assert.equal(await readFile(join(dataDir, 'voice', 'settings.json'), 'utf8'), '{"version":99}');
  });
});

describe('executable and directory validation', () => {
  it('accepts only local-drive absolute .exe paths', () => {
    for (const good of ['D:\\tools\\speech.exe', 'C:/speech/speech.exe', 'C:\\Program Files\\speech.cpp\\speech.exe', 'D:\\Users\\日本語 User\\speech.exe']) assert.ok(validLocalExecutable(good), good);
    for (const bad of [
      '\\\\server\\share\\speech.exe', 'speech.exe', '..\\speech.exe', 'D:\\x\\speech.exe:ads',
      'D:\\x\\speech.exe\\evil', 'D:\\x\\speech.bat', 'D:\\x\\..\\speech.exe',
      'D:\\x;speech.exe', 'D:\\x\\speech exe', 'http://x/speech.exe', '',
    ]) assert.ok(!validLocalExecutable(bad), bad);
  });
  it('validates model directories the same way', () => {
    assert.ok(validLocalDirectory('D:\\models\\speech'));
    assert.ok(validLocalDirectory('C:\\Users\\Local User\\speech models'));
    assert.ok(!validLocalDirectory('\\\\nas\\models'));
    assert.ok(!validLocalDirectory('relative\\models'));
  });
});

describe('existing executable adoption', () => {
  it('adopts a validated local exe with a cached model without any download', async () => {
    const dataDir = await dir(), exe = await existingExe(dataDir);
    const gguf = join(dataDir, 'voice', 'models', 'qwen3-asr-0.6b', 'm.gguf');
    await mkdir(join(gguf, '..'), { recursive: true }); await writeFile(gguf, 'GGUF');
    const { spawn, calls } = fakeSpawn([versionSpec(), modelsSpec({ 'qwen3-asr-0.6b': [gguf] })]);
    const { fetch, calls: fcalls } = fakeFetch([]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch });
    const r = await s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }, owner);
    assert.equal(r.accepted, true);
    const job = await waitJob(s);
    assert.equal(job?.state, 'done');
    assert.equal(s.ownerStatus().phase, 'stopped');
    assert.equal(fcalls.length, 0, 'no network fetch without explicit download consent');
    assert.deepEqual(calls.map(c => c.args[0]), ['--version', 'models']);
    assert.equal(calls[0].options.shell, false);
    const saved = JSON.parse(await readFile(join(dataDir, 'voice', 'settings.json'), 'utf8'));
    assert.equal(saved.enabled, true); assert.equal(saved.modelFile, gguf);
  });
  it('rejects a model that is not cached when downloads are not allowed', async () => {
    const dataDir = await dir(), exe = await existingExe(dataDir);
    const { spawn } = fakeSpawn([versionSpec(), modelsSpec({})]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch: async () => { throw new Error('no'); } });
    await s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }, owner);
    const job = await waitJob(s);
    assert.equal(job?.state, 'failed'); assert.equal(job?.error, 'speech_model_not_cached');
    assert.equal(s.publicStatus().enabled, false);
  });
  it('fetches the model via speech pull only with explicit allowDownload', async () => {
    const dataDir = await dir(), exe = await existingExe(dataDir);
    const gguf = join(dataDir, 'voice', 'models', 'qwen3-asr-0.6b', 'm.gguf');
    const { spawn, calls } = fakeSpawn([versionSpec(), modelsSpec({}), {
      match: (f, a) => a[0] === 'pull',
      run: async p => { await mkdir(join(gguf, '..'), { recursive: true }); await writeFile(gguf, 'GGUF'); p.finish(0, `${gguf}\n`); },
    }, { match: (f, a) => a[0] === 'models', run: p => p.finish(0, JSON.stringify({ models: [] })) }]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch: async () => { throw new Error('no'); } });
    await s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    const job = await waitJob(s);
    assert.equal(job?.state, 'done');
    const pull = calls.find(c => c.args[0] === 'pull');
    assert.equal(pull?.options.env.SPEECH_NO_UPDATE_CHECK, '1');
    assert.equal(pull?.options.env.SPEECH_MODEL_DIR, join(dataDir, 'voice', 'models'));
  });
  it('requires confirmed:true and a passing --version identity check', async () => {
    const dataDir = await dir(), exe = await existingExe(dataDir);
    const { spawn } = fakeSpawn([{ match: (f, a) => a[0] === '--version', run: p => p.finish(0, 'random tool 1.0') }]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch: async () => { throw new Error('no'); } });
    await assert.rejects(() => s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: false, allowDownload: true }, owner), /speech_confirmation_required/);
    await s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    const job = await waitJob(s);
    assert.equal(job?.error, 'speech_identity_failed');
  });
  it('reports a missing Vulkan loader distinctly', async () => {
    const dataDir = await dir(), exe = await existingExe(dataDir);
    const { spawn } = fakeSpawn([{ match: (f, a) => a[0] === '--version', run: p => p.finish(-1073741515, '', 'The code execution cannot proceed because vulkan-1.dll was not found') }]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch: async () => { throw new Error('no'); } });
    await s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    const job = await waitJob(s);
    assert.equal(job?.error, 'speech_vulkan_loader_missing');
  });
  it('refuses non-local and shell-interpretable executable paths before spawning', async () => {
    const dataDir = await dir();
    let spawned = 0;
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn: () => { spawned++; throw new Error('no'); }, fetch: async () => { throw new Error('no'); } });
    for (const p of ['\\\\server\\s\\speech.exe', 'speech.exe', 'D:\\x\\speech.exe:evil', 'D:\\x\\..\\speech.exe'])
      await assert.rejects(() => s.enable({ source: 'existing', executablePath: p, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner), /speech_executable_invalid/);
    assert.equal(spawned, 0);
  });
});

describe('managed install', () => {
  const managedDeps = async (dataDir: string, overrides: { digest?: boolean; zip?: Uint8Array; extractFails?: boolean; wrongSha?: boolean } = {}) => {
    const zip = overrides.zip ?? FAKE_ZIP;
    const release = releaseJson(zip, { digest: overrides.digest !== false });
    if (overrides.wrongSha) release.assets[0].digest = 'sha256:' + '0'.repeat(64);
    const exe = join(dataDir, 'voice', 'speech-cpp', 'speech.exe');
    const gguf = join(dataDir, 'voice', 'models', 'qwen3-asr-0.6b', 'm.gguf');
    const { spawn, calls } = fakeSpawn([
      versionSpec(),
      {
        match: (f, a) => f.endsWith('powershell.exe'),
        run: async p => {
          if (overrides.extractFails) { p.finish(1, '', 'traversal'); return; }
          // Model the actual EncodedCommand contract, including piped JSON.
          const call=calls.at(-1)!;
          assert.equal(call.args.length,4,'no trailing argv after EncodedCommand');
          const input=JSON.parse(p.stdinText);
          assert.ok(input.destination.includes('speech-install-'),'fresh staging directory');
          await writeFile(join(input.destination,'speech.exe'),'MZ');
          p.finish(0);
        },
      },
      { match: (f, a) => a[0] === 'pull', run: async p => { await mkdir(join(gguf, '..'), { recursive: true }); await writeFile(gguf, 'GGUF'); p.finish(0, gguf + '\n'); } },
      { match: (f, a) => a[0] === 'models', run: p => p.finish(0, JSON.stringify({ models: [] })) },
    ]);
    const { fetch, calls: fcalls } = fakeFetch([
      { match: u => u.endsWith('/releases/latest'), respond: () => jsonResponse(release) },
      // Realistic flow: the release asset URL answers 302 to the GitHub CDN host.
      { match: u => u === 'https://github.com/nyosegawa/speech.cpp/releases/download/v0.9.0/speech-0.9.0-windows-x64-vulkan.zip', respond: () => redirectResponse('https://release-assets.githubusercontent.com/github-production-release-asset/123/speech.zip?token=sig') },
      { match: u => u.startsWith('https://release-assets.githubusercontent.com/'), respond: () => bytesResponse(zip) },
    ]);
    return { spawn, fetch, calls, fcalls, exe, gguf };
  };

  it('installs the verified official release then pulls the model', async () => {
    const dataDir = await dir();
    const { spawn, fetch, fcalls } = await managedDeps(dataDir);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch });
    await s.enable({ source: 'managed', modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    const job = await waitJob(s);
    assert.equal(job?.state, 'done');
    assert.equal(fcalls[0].url, 'https://api.github.com/repos/nyosegawa/speech.cpp/releases/latest');
    assert.equal(fcalls[0].init.redirect, 'error');
    const st = s.ownerStatus();
    assert.equal(st.phase, 'stopped'); assert.equal(st.executablePath, join(dataDir, 'voice', 'speech-cpp', 'speech.exe'));
  });
  it('refuses a digest mismatch before extraction', async () => {
    const dataDir = await dir();
    const { spawn, fetch } = await managedDeps(dataDir, { wrongSha: true });
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch });
    await s.enable({ source: 'managed', modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    const job = await waitJob(s);
    assert.equal(job?.error, 'speech_digest_mismatch');
    assert.equal(s.publicStatus().enabled, false);
  });
  it('supports SHA256SUMS fallback when the asset digest is absent', async () => {
    const dataDir = await dir();
    const release = releaseJson(FAKE_ZIP, { digest: false, sums: true });
    const exe = join(dataDir, 'voice', 'speech-cpp', 'speech.exe');
    const { spawn } = fakeSpawn([
      versionSpec(),
      { match: (f, a) => f.endsWith('powershell.exe'), run: async p => { const input=JSON.parse(p.stdinText); await writeFile(join(input.destination,'speech.exe'),'MZ'); p.finish(0); } },
      { match: (f, a) => a[0] === 'pull', run: async p => { const g = join(dataDir, 'voice', 'models', 'qwen3-asr-0.6b', 'm.gguf'); await mkdir(join(g, '..'), { recursive: true }); await writeFile(g, 'GGUF'); p.finish(0, g + '\n'); } },
      { match: (f, a) => a[0] === 'models', run: p => p.finish(0, JSON.stringify({ models: [] })) },
    ]);
    const { fetch } = fakeFetch([
      { match: u => u.endsWith('/releases/latest'), respond: () => jsonResponse(release) },
      { match: u => u.endsWith('SHA256SUMS'), respond: () => textResponse(`${sha256(FAKE_ZIP)}  speech-0.9.0-windows-x64-vulkan.zip\n`) },
      { match: u => u.endsWith('.zip'), respond: () => bytesResponse(FAKE_ZIP) },
    ]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch });
    await s.enable({ source: 'managed', modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    assert.equal((await waitJob(s))?.state, 'done');
  });
  it('managed install never runs without explicit allowDownload', async () => {
    const dataDir = await dir();
    let fetched = 0;
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn: () => { throw new Error('no'); }, fetch: async () => { fetched++; throw new Error('no'); } });
    await assert.rejects(() => s.enable({ source: 'managed', modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }, owner), /speech_download_not_allowed/);
    assert.equal(fetched, 0);
  });
  it('rejects non-Windows/non-x64 platforms for managed installs', async () => {
    const dataDir = await dir();
    const s = await service(dataDir, { platform: 'linux', arch: 'x64', spawn: () => { throw new Error('no'); }, fetch: async () => { throw new Error('no'); } });
    await s.enable({ source: 'managed', modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    assert.equal((await waitJob(s))?.error, 'speech_platform_unsupported');
  });
  it('refuses asset redirects to non-GitHub hosts', async () => {
    const dataDir = await dir();
    const release = releaseJson(FAKE_ZIP);
    const { spawn } = fakeSpawn([]);
    const { fetch, calls } = fakeFetch([
      { match: u => u.endsWith('/releases/latest'), respond: () => jsonResponse(release) },
      { match: u => u.endsWith('.zip'), respond: () => redirectResponse('https://evil.example/payload.zip') },
    ]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch });
    await s.enable({ source: 'managed', modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    const job = await waitJob(s);
    assert.equal(job?.error, 'speech_download_failed');
    assert.equal(calls.some(c => c.url.includes('evil.example')), false, 'must never fetch the hostile redirect');
  });
  it('refuses releases whose asset URL does not pin the official repo path', async () => {
    const dataDir = await dir();
    const release = releaseJson(FAKE_ZIP, { wrongUrl: true });
    const { spawn } = fakeSpawn([]);
    const { fetch } = fakeFetch([{ match: u => u.endsWith('/releases/latest'), respond: () => jsonResponse(release) }]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch });
    await s.enable({ source: 'managed', modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    assert.equal((await waitJob(s))?.error, 'speech_release_asset_missing');
  });
  it('fails the job when extraction reports traversal/unsafe entries', async () => {
    const dataDir = await dir();
    const { spawn, fetch } = await managedDeps(dataDir, { extractFails: true });
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch });
    await s.enable({ source: 'managed', modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    const job = await waitJob(s);
    assert.equal(job?.error, 'speech_extract_failed');
  });
});

describe('jobs, cancel, disable', () => {
  it('rejects a second concurrent job', async () => {
    const dataDir = await dir(), exe = await existingExe(dataDir);
    let release = false;
    const { spawn } = fakeSpawn([{ match: () => true, run: p => { const t = setInterval(() => { if (release) { clearInterval(t); p.finish(0, 'speech.cpp 0.9.0'); } }, 5); } }]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch: async () => { throw new Error('no'); } });
    await s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }, owner);
    await assert.rejects(() => s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }, owner), /speech_busy/);
    release = true;
    await waitJob(s);
  });
  it('cancel aborts a running job and disable cleans up', async () => {
    const dataDir = await dir(), exe = await existingExe(dataDir);
    const { spawn } = fakeSpawn([{ match: () => true, run: p => {} }]); // never finishes
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, killTree:async()=>{}, fetch: async () => { throw new Error('no'); } });
    await s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    await s.cancel(owner);
    const job = s.ownerStatus().job;
    assert.equal(job?.state, 'cancelled');
    assert.equal((await s.disable(owner)).ok, true);
    assert.equal(s.publicStatus().enabled, false);
    assert.equal(s.publicStatus().phase, 'off');
  });
  it('cancel during model pull kills the owned process tree (curl child)', async () => {
    const dataDir = await dir(), exe = await existingExe(dataDir);
    const killedTrees: number[] = [];
    const { spawn, calls } = fakeSpawn([
      versionSpec(), modelsSpec({}),
      { match: (f, a) => a[0] === 'pull', run: p => {} }, // hangs until killed
    ]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch: async () => { throw new Error('no'); }, killTree: async (pid: number) => { killedTrees.push(pid); } });
    await s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, owner);
    for (let i = 0; i < 200 && !calls.some(c => c.args[0] === 'pull'); i++) await settle();
    assert.ok(calls.some(c => c.args[0] === 'pull'), 'pull spawned');
    await s.cancel(owner);
    const job = await waitJob(s);
    assert.equal(job?.state, 'cancelled');
    assert.ok(killedTrees.includes(4242), `owned tree kill requested, got ${JSON.stringify(killedTrees)}`);
  });
  it('disable stops the owned serve child via tree kill', async () => {
    const dataDir = await dir(), exe = await existingExe(dataDir);
    const gguf = join(dataDir, 'voice', 'models', 'qwen3-asr-0.6b', 'm.gguf');
    await mkdir(join(gguf, '..'), { recursive: true }); await writeFile(gguf, 'GGUF');
    const killedTrees: number[] = [];
    const { spawn } = fakeSpawn([versionSpec(), modelsSpec({ 'qwen3-asr-0.6b': [gguf] }), serveSpec(45996)]);
    const { fetch } = fakeFetch([
      { match: u => u.endsWith('/health'), respond: () => jsonResponse({ status: 'ok' }) },
      { match: u => u.endsWith('/v1/models'), respond: () => jsonResponse({ data: [{id:'Qwen3-ASR-0.6B'}] }) },
      { match: u => u.includes('transcriptions'), respond: () => textResponse(JSON.stringify({ text: 'ok' })) },
    ]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch, killTree: async (pid: number) => { killedTrees.push(pid); } });
    await s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }, owner);
    await waitJob(s);
    await s.transcribe(Buffer.alloc(44, 0), undefined, new AbortController().signal).catch(() => {});
    await s.disable(owner);
    assert.ok(killedTrees.includes(4242), 'owned serve tree killed');
  });
  it('owner verification is required for every mutating action', async () => {
    const dataDir = await dir();
    const s = await service(dataDir, { platform: 'win32', arch: 'x64' });
    await assert.rejects(() => s.enable({ source: 'managed', modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }, ownerDeny));
    await assert.rejects(() => s.disable(ownerDeny));
    await assert.rejects(() => s.cancel(ownerDeny));
    await assert.rejects(() => s.start(ownerDeny));
  });
});

describe('serve lifecycle and transcribe', () => {
  async function enabledService(overrides: { port?: number; serveExit?: number } = {}) {
    const dataDir = await dir(), exe = await existingExe(dataDir);
    const gguf = join(dataDir, 'voice', 'models', 'qwen3-asr-0.6b', 'm.gguf');
    await mkdir(join(gguf, '..'), { recursive: true }); await writeFile(gguf, 'GGUF');
    const port = overrides.port ?? 45999;
    const { spawn, calls } = fakeSpawn([versionSpec(), modelsSpec({ 'qwen3-asr-0.6b': [gguf] }), serveSpec(port, { exit: overrides.serveExit })]);
    const { fetch, calls: fcalls } = fakeFetch([
      { match: u => u.endsWith('/health'), respond: () => jsonResponse({ status: 'ok' }) },
      { match: u => u.endsWith('/v1/models'), respond: () => jsonResponse({ data: [{id:'Qwen3-ASR-0.6B'}] }) },
      { match: u => u.endsWith('/v1/audio/transcriptions'), respond: () => textResponse(JSON.stringify({ text: 'こんにちは', language: 'ja' })) },
    ]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch });
    await s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }, owner);
    assert.equal((await waitJob(s))?.state, 'done');
    return { s, calls, fcalls, port, gguf };
  }

  it('lazy-starts the owned serve child on first transcribe with a loopback ephemeral port', async () => {
    const { s, calls, fcalls, port, gguf } = await enabledService();
    const wav = Buffer.alloc(44, 0); wav.write('RIFF', 0); wav.writeUInt32LE(36, 4); wav.write('WAVEfmt ', 8);
    const result = await s.transcribe(wav, 'ja', new AbortController().signal);
    assert.equal(result.text, 'こんにちは');
    const serve = calls.find(c => c.args[0] === 'serve');
    assert.deepEqual(serve?.args, ['serve', gguf, '--host', '127.0.0.1', '--port', '0', '--no-warmup']);
    assert.equal(serve?.options.shell, false);
    assert.equal(serve?.options.env.SPEECH_NO_UPDATE_CHECK, '1');
    assert.equal(fcalls[0].url, `http://127.0.0.1:${port}/health`);
    const tx = fcalls.find(c => c.url.includes('transcriptions'));
    assert.equal(tx?.init.method, 'POST'); assert.equal(tx?.init.redirect, 'error');
    assert.equal(tx?.init.body.has('model'),false,'catalog aliases are not runtime GGUF model ids');
    assert.equal(tx?.init.body.get('language'),'ja');
    assert.equal(s.ownerStatus().port, port);
    await s.dispose();
  });
  it('kills only the owned child on disable/dispose', async () => {
    const { s, calls } = await enabledService();
    await s.transcribe(Buffer.alloc(44, 0), undefined, new AbortController().signal).catch(() => {});
    const serve = calls.find(c => c.args[0] === 'serve');
    const procs = serve ? [serve] : [];
    await s.disable(owner);
    assert.equal(s.publicStatus().phase, 'off');
  });
  it('fails start when the child exits before Ready', async () => {
    const { s } = await enabledService({ serveExit: 2 });
    await assert.rejects(() => s.transcribe(Buffer.alloc(44, 0), undefined, new AbortController().signal), /speech_serve_exited/);
  });
  it('serializes concurrent transcriptions behind a busy gate', async () => {
    const dataDir = await dir(), exe = await existingExe(dataDir);
    const gguf = join(dataDir, 'voice', 'models', 'qwen3-asr-0.6b', 'm.gguf');
    await mkdir(join(gguf, '..'), { recursive: true }); await writeFile(gguf, 'GGUF');
    const { spawn } = fakeSpawn([versionSpec(), modelsSpec({ 'qwen3-asr-0.6b': [gguf] }), serveSpec(45998)]);
    let hold = true;
    const { fetch } = fakeFetch([
      { match: u => u.endsWith('/health'), respond: () => jsonResponse({ status: 'ok' }) },
      { match: u => u.endsWith('/v1/models'), respond: () => jsonResponse({ data: [{id:'Qwen3-ASR-0.6B'}] }) },
      { match: u => u.includes('transcriptions'), respond: () => new Promise(r => { const t = setInterval(() => { if (!hold) { clearInterval(t); r(textResponse(JSON.stringify({ text: 'ok' }))); } }, 5); }) },
    ]);
    const s = await service(dataDir, { platform: 'win32', arch: 'x64', spawn, fetch });
    await s.enable({ source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }, owner);
    await waitJob(s);
    const first = s.transcribe(Buffer.alloc(44, 0), undefined, new AbortController().signal);
    await settle();
    await assert.rejects(() => s.transcribe(Buffer.alloc(44, 0), undefined, new AbortController().signal), /speech_busy/);
    hold = false;
    assert.equal((await first).text, 'ok');
    await s.dispose();
  });
});
