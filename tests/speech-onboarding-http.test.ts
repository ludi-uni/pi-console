// Speech onboarding HTTP boundary — real sockets, injected broker/service. The
// admission contract: local mode = literal loopback socket + exact Host/Origin
// + no proxy headers + JSON + the explicit custom header; remote mode = the
// verified principal + configured origin. GET status never mints cookies,
// dialogs or jobs and sanitizes everything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpeechOnboardingBroker } from '../server/speech-onboarding.ts';
import { createSpeechOnboardingHttp } from '../server/speech-onboarding-http.ts';
import { SpeechCppService, type SpeechDeps } from '../server/speech-cpp.ts';
import { fakeSpawn, versionSpec } from './helpers/speech.fixture.ts';
import type { SpeechApprovalResult, SpeechApprovalView } from '../package/speech-approval-dialog.mjs';

const ID = { pid: 1, startedAt: '2026-01-01T00:00:00Z', port: 0, generation: 'a'.repeat(32) };
const pendingDialog = (view: Readonly<SpeechApprovalView>, { signal }: { signal: AbortSignal }) => new Promise<SpeechApprovalResult>(resolve => {
  if (signal.aborted) return resolve({ decision: 'cancelled', bindingDigest: view.bindingDigest });
  signal.addEventListener('abort', () => resolve({ decision: 'cancelled', bindingDigest: view.bindingDigest }), { once: true });
});

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); });
});

async function server(opts: { publicOrigin?: string; principal?: object; dialog?: (v: Readonly<SpeechApprovalView>, o: { signal: AbortSignal }) => Promise<SpeechApprovalResult>; available?: boolean; serviceDeps?: SpeechDeps } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pi-speech-onb-'));
  const service = new SpeechCppService({ dataDir, deps: opts.serviceDeps });
  await service.load();
  const broker = new SpeechOnboardingBroker({
    service,
    managed: { available: opts.available ?? true, generation: () => ({ ...ID, port }), verifyIdentity: async e => ({ ...e }) },
    dialog: opts.dialog ?? pendingDialog,
    deps: { checkVulkanLoader: async () => true },
  });
  const port = await freePort();
  const principal = opts.principal;
  const http = createSpeechOnboardingHttp({ broker, port, publicOrigin: opts.publicOrigin, principal: principal ? () => principal as any : undefined });
  const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (await http.handle(req, res)) return;
    res.writeHead(404); res.end('not found');
  });
  await new Promise<void>(r => srv.listen(port, '127.0.0.1', r));
  const req = (path: string, headers: Record<string, string> = {}, method = 'GET', body?: string) =>
    new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
      const r = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString(), headers: res.headers as Record<string, unknown> }));
      });
      r.on('error', reject);
      if (body !== undefined) r.write(body);
      r.end();
    });
  const post = (path: string, port_: number, headers: Record<string, string>, body: unknown) =>
    req(path, { host: `127.0.0.1:${port_}`, origin: `http://127.0.0.1:${port_}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-pi-console-speech': '1', ...headers }, 'POST', JSON.stringify(body));
  return { port, broker, service, srv, req, post, dataDir,
    cleanup: async () => { await new Promise<void>(r => srv.close(() => r())); await broker.dispose(); await service.dispose(); await rm(dataDir, { recursive: true, force: true }); } };
}
const BODY = { requestId: '11111111-2222-3333-4444-555555555555', payload: { source: 'managed', modelId: 'qwen3-asr-0.6b', allowDownload: true }, confirmed: true };

test('local POST without the custom speech header or same-origin markers is refused', async () => {
  const h = await server();
  try {
    const local = { host: `127.0.0.1:${h.port}` };
    // No custom header
    assert.equal((await h.req('/api/voice/onboarding/request', { ...local, origin: `http://127.0.0.1:${h.port}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, 'POST', JSON.stringify(BODY))).status, 403);
    // Wrong/missing origin, fetch-site, content-type
    for (const [name, headers] of [
      ['no-origin', { ...local, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-pi-console-speech': '1' }],
      ['wrong-origin', { ...local, origin: 'https://evil.example.com', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-pi-console-speech': '1' }],
      ['cross-site', { ...local, origin: `http://127.0.0.1:${h.port}`, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json', 'x-pi-console-speech': '1' }],
      ['text-content-type', { ...local, origin: `http://127.0.0.1:${h.port}`, 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain', 'x-pi-console-speech': '1' }],
      ['proxy-header', { ...local, origin: `http://127.0.0.1:${h.port}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-pi-console-speech': '1', 'x-forwarded-for': '1.2.3.4' }],
      ['empty-cf-header', { ...local, origin: `http://127.0.0.1:${h.port}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-pi-console-speech': '1', 'cf-anything': '' }],
      ['wrong-header-value', { ...local, origin: `http://127.0.0.1:${h.port}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-pi-console-speech': 'yes' }],
    ] as [string, Record<string, string>][]) {
      assert.equal((await h.req('/api/voice/onboarding/request', headers, 'POST', JSON.stringify(BODY))).status, 403, name);
    }
  } finally { await h.cleanup(); }
});

test('a valid local POST mints an HttpOnly path-scoped cookie and registers the request', async () => {
  const h = await server();
  try {
    const r = await h.post('/api/voice/onboarding/request', h.port, {}, BODY);
    assert.equal(r.status, 202);
    const cookie = String(r.headers['set-cookie'] ?? '');
    assert.match(cookie, /pi_speech_onb=[0-9a-f]{64}/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/api\/voice\/onboarding/);
    // The opaque value never appears in the JSON body.
    const token = /pi_speech_onb=([0-9a-f]{64})/.exec(cookie)?.[1];
    assert.ok(token && !r.body.includes(token));
    const parsed = JSON.parse(r.body);
    const status = parsed.status;
    assert.equal(status.requestId, BODY.requestId);
    assert.equal(status.state, 'pending');
    assert.equal(status.sameDevice, true);
    // Sanitized payload — no paths.
    assert.equal(status.payload.hasExistingExecutable, false);
    assert.equal(status.payload.executablePath, undefined);
    assert.ok(parsed.preflight);
  } finally { await h.cleanup(); }
});

test('GET status without a session returns idle + preflight and never mints a cookie', async () => {
  const h = await server();
  try {
    const r = await h.req('/api/voice/onboarding/status', { host: `127.0.0.1:${h.port}` });
    assert.equal(r.status, 200);
    assert.equal(r.headers['set-cookie'], undefined);
    const body = JSON.parse(r.body);
    assert.equal(body.status.state, 'idle');
    assert.equal(body.status.sameDevice, true);
    assert.equal(typeof body.preflight.supported, 'boolean');
    // An unknown requestId reconciles as idle; GET never mutates.
    const u = await h.req(`/api/voice/onboarding/status?requestId=${'9'.repeat(8)}-9999-4999-8999-999999999999`, { host: `127.0.0.1:${h.port}` });
    assert.equal(JSON.parse(u.body).status.state, 'idle');
  } finally { await h.cleanup(); }
});

test('request idempotency: same id + same payload replays the receipt, different payload collides', async () => {
  const h = await server();
  try {
    const a = await h.post('/api/voice/onboarding/request', h.port, {}, BODY);
    assert.equal(a.status, 202);
    const cookie = /pi_speech_onb=[0-9a-f]{64}/.exec(String(a.headers['set-cookie']))?.[0] ?? '';
    const replay = await h.post('/api/voice/onboarding/request', h.port, { cookie }, BODY);
    assert.equal(replay.status, 202);
    assert.equal(JSON.parse(replay.body).status.requestId, BODY.requestId);
    const collision = await h.post('/api/voice/onboarding/request', h.port, { cookie }, { ...BODY, payload: { source: 'managed', modelId: 'qwen3-asr-1.7b', allowDownload: true } });
    assert.equal(collision.status, 409);
    assert.equal(JSON.parse(collision.body).error, 'speech_onboarding_collision');
    // A different cookie (different actor) cannot take over the requestId.
    const stolen = await h.post('/api/voice/onboarding/request', h.port, { cookie: 'pi_speech_onb=' + 'f'.repeat(64) }, BODY);
    assert.equal(stolen.status, 403);
  } finally { await h.cleanup(); }
});

test('cancel is own-actor only and the confirmed:false shape never registers', async () => {
  const h = await server();
  try {
    // confirmed !== true never creates anything, not even a cookie.
    const noConsent = await h.post('/api/voice/onboarding/request', h.port, {}, { ...BODY, confirmed: false });
    assert.equal(noConsent.status, 400);
    assert.equal(noConsent.headers['set-cookie'], undefined);
    const a = await h.post('/api/voice/onboarding/request', h.port, {}, BODY);
    const cookie = /pi_speech_onb=[0-9a-f]{64}/.exec(String(a.headers['set-cookie']))?.[0] ?? '';
    // Another actor cannot cancel.
    const alien = await h.post('/api/voice/onboarding/cancel', h.port, { cookie: 'pi_speech_onb=' + 'e'.repeat(64) }, { requestId: BODY.requestId });
    assert.equal(alien.status, 403);
    const ok = await h.post('/api/voice/onboarding/cancel', h.port, { cookie }, { requestId: BODY.requestId });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).status.state, 'cancelled');
  } finally { await h.cleanup(); }
});

test('remote mode requires the configured origin + verified principal; requests stay request-only', async () => {
  const principal = { subject: 'user@example.com', issuer: 'https://team.cloudflareaccess.com', audience: 'aud', expiresAt: Date.now() + 60000 };
  const h = await server({ publicOrigin: 'https://console.example.com', principal });
  try {
    // Loopback socket is irrelevant in remote mode — Host must be the configured one.
    const localHost = await h.req('/api/voice/onboarding/status', { host: `127.0.0.1:${h.port}` });
    assert.equal(localHost.status, 403, 'loopback Host is not the configured public host');
    const ok = await h.req('/api/voice/onboarding/status', { host: 'console.example.com' });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).status.sameDevice, false);
    // POST needs exact origin + custom header + principal.
    const bad = await h.req('/api/voice/onboarding/request', { host: 'console.example.com', origin: 'https://other.example.com', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-pi-console-speech': '1' }, 'POST', JSON.stringify(BODY));
    assert.equal(bad.status, 403);
    const good = await h.req('/api/voice/onboarding/request', { host: 'console.example.com', origin: 'https://console.example.com', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-pi-console-speech': '1' }, 'POST', JSON.stringify(BODY));
    assert.equal(good.status, 202);
    const cookie = String(good.headers['set-cookie'] ?? '');
    assert.match(cookie, /Secure/); // Secure on HTTPS
    assert.equal(JSON.parse(good.body).status.sameDevice, false);
  } finally { await h.cleanup(); }
});

test('HTTP request waits for native approval, then the real service persists the scoped setup without leaking paths', { timeout: 10000 }, async () => {
  let modelFile = '';
  let shown: Readonly<SpeechApprovalView> | undefined;
  let answer: ((value: SpeechApprovalResult) => void) | undefined;
  const { spawn, calls } = fakeSpawn([versionSpec(), {
    match: (_file, args) => args[0] === 'models',
    run: p => p.finish(0, JSON.stringify({ models: [{ name: 'qwen3-asr-0.6b', files: [{ path: modelFile, type: 'Q8_0', fetched: true }] }] })),
  }]);
  const h = await server({
    dialog: (view, { signal }) => new Promise(resolve => {
      shown = view; answer = resolve;
      signal.addEventListener('abort', () => resolve({ decision: 'cancelled', bindingDigest: view.bindingDigest }), { once: true });
    }),
    serviceDeps: { platform: 'win32', arch: 'x64', spawn, fetch: async () => { throw Error('unexpected real download'); }, killTree: async () => {} },
  });
  try {
    const executable = join(h.dataDir, 'speech.exe');
    const models = join(h.dataDir, 'voice', 'models');
    modelFile = join(models, 'cached.gguf');
    await mkdir(models, { recursive: true });
    await writeFile(executable, 'MZ');
    await writeFile(modelFile, 'GGUF');
    const body = { ...BODY, payload: { source: 'existing', executablePath: executable, modelDirectory: models, modelId: 'qwen3-asr-0.6b', allowDownload: false } };
    const response = await h.post('/api/voice/onboarding/request', h.port, {}, body);
    assert.equal(response.status, 202);
    assert.equal(calls.length, 0, 'no executable runs before host approval');
    assert.ok(shown && answer);
    assert.equal(shown.executablePath, executable);
    const cookie = /pi_speech_onb=[0-9a-f]{64}/.exec(String(response.headers['set-cookie']))![0];
    answer({ decision: 'approved', bindingDigest: shown.bindingDigest });
    let state = '';
    let receipt = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await h.req(`/api/voice/onboarding/status?requestId=${BODY.requestId}`, { host: `127.0.0.1:${h.port}`, cookie });
      receipt = result.body; state = JSON.parse(receipt).status.state;
      if (state !== 'pending' && state !== 'processing') break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(state, 'ready', receipt);
    assert.equal(h.service.publicStatus().enabled, true);
    assert.equal(JSON.parse(await readFile(join(h.dataDir, 'voice', 'settings.json'), 'utf8')).modelFile, modelFile);
    assert.ok(!receipt.includes(executable) && !receipt.includes(models), 'browser receipt has no local paths');
    assert.ok(calls.some(call => call.args[0] === '--version'));
    assert.ok(!calls.some(call => call.args[0] === 'pull'));
  } finally { await h.cleanup(); }
});

test('remote POST without a verified principal is 401 — a bare header/JWT is not trusted', async () => {
  const h = await server({ publicOrigin: 'https://console.example.com' }); // no principal seam
  try {
    const r = await h.req('/api/voice/onboarding/request', { host: 'console.example.com', origin: 'https://console.example.com', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-pi-console-speech': '1' }, 'POST', JSON.stringify(BODY));
    assert.equal(r.status, 401);
  } finally { await h.cleanup(); }
});
