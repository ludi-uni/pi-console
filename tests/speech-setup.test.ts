// speech.cpp setup routing — the loopback probe, landing and status read run
// before the public gates under a strict native boundary; the descriptor runs
// after them. Real HTTP only: socket addresses and raw headers are the seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createSpeechSetup } from '../server/speech-setup.ts';
import { createSpeechHttp } from '../server/speech-http.ts';
import { SpeechCppService } from '../server/speech-cpp.ts';

const ASSETS = resolve('tests/fixtures/speech-setup');
const ID = 'a'.repeat(64);

// createSpeechSetup needs the real port before listen(); grab a free one first.
const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)); });
});

async function server(opts: { publicOrigin?: string; gateHost?: string } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pi-speech-setup-'));
  const service = new SpeechCppService({ dataDir });
  await service.load();
  const speechHttp = createSpeechHttp({ service, authorize: () => () => {} });
  const port = await freePort();
  const setup = createSpeechSetup({ port, assetsRoot: ASSETS, publicStatus: () => service.publicStatus(), publicOrigin: opts.publicOrigin, instanceId: ID });
  // Mirror server/index.ts order: pre-gate local routes → host gate → descriptor → public voice.
  const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (await setup.handleLocal(req, res)) return;
    if (opts.gateHost && req.headers.host !== opts.gateHost) { res.writeHead(403); res.end('invalid host'); return; }
    const d = setup.descriptor(req);
    if (d) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); return; }
    if (await speechHttp.handlePublic(req, res)) return;
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
  return {
    port, setup, service, srv, req, dataDir,
    cleanup: async () => { await new Promise<void>(r => srv.close(() => r())); await service.dispose(); await rm(dataDir, { recursive: true, force: true }); },
  };
}
const local = (port: number) => ({ host: `127.0.0.1:${port}` });

test('probe answers the same-instance id on a strict native loopback GET', async () => {
  const h = await server();
  try {
    const r = await h.req('/api/voice/local-probe', local(h.port));
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { instanceId: ID });
    assert.equal(r.headers['access-control-allow-origin'], undefined, 'no Origin → no CORS grant');
  } finally { await h.cleanup(); }
});

test('probe rejects every boundary violation', async () => {
  const h = await server({ publicOrigin: 'https://console.example.com' });
  try {
    for (const [name, headers] of [
      ['forwarded', { ...local(h.port), forwarded: 'for=1.2.3.4' }],
      ['x-forwarded-for', { ...local(h.port), 'x-forwarded-for': '1.2.3.4' }],
      ['unknown-forwarded-header', { ...local(h.port), 'x-forwarded-custom': '' }],
      ['unknown-cf-header', { ...local(h.port), 'cf-custom': '' }],
      ['empty-forwarded-header', { ...local(h.port), forwarded: '' }],
      ['cf-connecting-ip', { ...local(h.port), 'cf-connecting-ip': '1.2.3.4' }],
      ['via', { ...local(h.port), via: '1.1 proxy' }],
      ['wrong-origin', { ...local(h.port), origin: 'https://evil.example.com' }],
      ['foreign-same-site-origin', { ...local(h.port), origin: 'http://127.0.0.1:9999' }],
      ['cookie', { ...local(h.port), cookie: 'a=b' }],
      ['authorization', { ...local(h.port), authorization: 'Bearer x' }],
      ['wrong-host-port', { host: '127.0.0.1:9999' }],
      ['hostname-mismatch', { host: `127.0.0.2:${h.port}` }],
    ] as [string, Record<string, string>][]) {
      const r = await h.req('/api/voice/local-probe', headers);
      assert.equal(r.status, 403, name);
    }
    // A cross-site top-level navigation marker without Origin is allowed: the
    // probe body is a nonsecret id and CORS still withholds it from unlisted
    // origins — the loopback socket is the boundary, not fetch metadata.
    assert.equal((await h.req('/api/voice/local-probe', { ...local(h.port), 'sec-fetch-site': 'cross-site' })).status, 200);
    // wrong method, query string, duplicate Host
    assert.equal((await h.req('/api/voice/local-probe', local(h.port), 'POST')).status, 405);
    assert.equal((await h.req('/api/voice/local-probe?x=1', local(h.port))).status, 403);
    assert.equal((await h.req('/api/voice/local-probe?', local(h.port))).status, 403);
    const { connect } = await import('node:net');
    const dup = await new Promise<number>((resolve, reject) => {
      const s = connect(h.port, '127.0.0.1', () => s.write(`GET /api/voice/local-probe HTTP/1.1\r\nHost: 127.0.0.1:${h.port}\r\nHost: 127.0.0.1:${h.port}\r\nConnection: close\r\n\r\n`));
      let raw = '';
      s.on('data', d => raw += d);
      s.on('end', () => resolve(Number(raw.match(/^HTTP\/1\.1 (\d+)/)?.[1])));
      s.on('error', reject);
    });
    assert.ok([400, 403].includes(dup));
    // probe never mutates: status unaffected after all of the above
    const s = await h.req('/api/voice/status', { host: 'public.example.com' });
    assert.equal(s.status, 200);
    assert.equal(JSON.parse(s.body).enabled, false);
  } finally { await h.cleanup(); }
});

test('probe allows only the configured public origin and canonical console origins', async () => {
  const h = await server({ publicOrigin: 'https://console.example.com' });
  try {
    for (const origin of ['https://console.example.com', `http://127.0.0.1:${h.port}`, `http://localhost:${h.port}`, `http://[::1]:${h.port}`]) {
      // A public-origin page on the host PC probes its own loopback — that is
      // cross-site by definition, so the allowlisted Origin carries the grant.
      const r = await h.req('/api/voice/local-probe', { ...local(h.port), origin, 'sec-fetch-site': 'cross-site' });
      assert.equal(r.status, 200, origin);
      assert.equal(r.headers['access-control-allow-origin'], origin);
      const same = await h.req('/api/voice/local-probe', { ...local(h.port), origin, 'sec-fetch-site': 'same-origin' });
      assert.equal(same.status, 200, origin);
      assert.equal(same.headers['access-control-allow-origin'], origin);
    }
    // OPTIONS preflight: exact GET request only, no headers, allowed origin
    const ok = await h.req('/api/voice/local-probe', { ...local(h.port), origin: 'https://console.example.com', 'access-control-request-method': 'GET' }, 'OPTIONS');
    assert.equal(ok.status, 204);
    assert.equal(ok.headers['access-control-allow-methods'], 'GET');
    assert.equal(ok.headers['access-control-allow-credentials'], undefined);
    assert.equal((await h.req('/api/voice/local-probe', { ...local(h.port), origin: 'https://console.example.com', 'access-control-request-method': 'POST' }, 'OPTIONS')).status, 403);
    assert.equal((await h.req('/api/voice/local-probe', { ...local(h.port), origin: 'https://console.example.com', 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-csrf' }, 'OPTIONS')).status, 403);
    assert.equal((await h.req('/api/voice/local-probe', { ...local(h.port), origin: 'https://evil.example.com', 'access-control-request-method': 'GET' }, 'OPTIONS')).status, 403);
  } finally { await h.cleanup(); }
});

test('landing serves the built page and assets only inside the native boundary', async () => {
  const h = await server();
  try {
    const page = await h.req('/voice-setup/', local(h.port));
    assert.equal(page.status, 200);
    assert.match(page.body, /src="\/voice-setup\/assets\/speech-setup-test\.js"/);
    assert.match(String(page.headers['content-security-policy']), /connect-src 'self'/);
    const js = await h.req('/voice-setup/assets/speech-setup-test.js', { ...local(h.port), 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'script' });
    assert.equal(js.status, 200);
    const css = await h.req('/voice-setup/assets/speech-setup-test.css', local(h.port));
    assert.equal(css.status, 200);
    assert.equal((await h.req('/voice-setup/assets/missing.js', local(h.port))).status, 404);
    // %-encoded traversal never reaches the asset branch at all → normal 404.
    assert.equal((await h.req('/voice-setup/assets/..%2Fsecret.js', local(h.port))).status, 404);
    assert.equal((await h.req('/voice-setup/?x=1', local(h.port))).status, 403);
    assert.equal((await h.req('/voice-setup/', { ...local(h.port), 'x-forwarded-host': 'evil' })).status, 403);
    assert.equal((await h.req('/voice-setup/', local(h.port), 'POST')).status, 405);
    // path traversal / arbitrary public files are never served
    assert.equal((await h.req('/voice-setup/sw.js', local(h.port))).status, 404);
  } finally { await h.cleanup(); }
});

test('local status read bypasses the gate only for native loopback GET; never POST', async () => {
  const h = await server({ gateHost: 'console.example.com', publicOrigin: 'https://console.example.com' });
  try {
    const landing = await h.req('/voice-setup/', local(h.port));
    assert.equal(landing.status, 200);
    assert.ok(landing.body.includes('data-console-url="https://console.example.com/?view=settings"'));
    // Remote-mode style gate: public Host gets 403, native loopback still reads status.
    assert.equal((await h.req('/api/voice/status', { host: 'console.example.com' })).status, 200);
    assert.equal((await h.req('/api/voice/status', { host: 'elsewhere.example.com' })).status, 403);
    const native = await h.req('/api/voice/status', local(h.port));
    assert.equal(native.status, 200);
    assert.deepEqual(JSON.parse(native.body), { enabled: false, available: false, phase: 'off', providerId: 'speech-cpp' });
    // A loopback POST never bypasses the gate.
    assert.equal((await h.req('/api/voice/status', { ...local(h.port), 'content-type': 'application/json' }, 'POST', '{}')).status, 403);
    // Loopback with proxy headers falls back to the gate → 403.
    assert.equal((await h.req('/api/voice/status', { ...local(h.port), forwarded: 'for=x' })).status, 403);
  } finally { await h.cleanup(); }
});

test('descriptor stays after the gates and only exposes literal loopback URLs', async () => {
  const h = await server({ gateHost: 'console.example.com' });
  try {
    const gated = await h.req('/api/voice/setup', local(h.port));
    assert.equal(gated.status, 403, 'descriptor is not a pre-gate bypass');
    const r = await h.req('/api/voice/setup', { host: 'console.example.com' });
    assert.equal(r.status, 200);
    const d = JSON.parse(r.body);
    assert.equal(d.instanceId, ID);
    assert.equal(d.probeUrl, `http://127.0.0.1:${h.port}/api/voice/local-probe`);
    assert.equal(d.setupUrl, `http://127.0.0.1:${h.port}/voice-setup/`);
    assert.equal(d.consolePort, h.port);
    assert.equal((await h.req('/api/voice/setup?x=1', { host: 'console.example.com' })).status, 404);
    // The id is the nonsecret routing token — it must never equal manage material.
    assert.equal(/manage|nonce|token/i.test(ID), false);
  } finally { await h.cleanup(); }
});

test('the PWA service worker never caches the local setup page as the Console shell', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const listeners: Record<string, (event: any) => void> = {};
  runInNewContext(await readFile('public/sw.js', 'utf8'), {
    URL,
    self: { location: { origin: 'http://127.0.0.1:31718' }, addEventListener: (name: string, handler: (event: any) => void) => { listeners[name] = handler; } },
  });
  for (const path of ['/voice-setup/', '/voice-setup/assets/setup.js', '/voice-setup/assets/setup.css']) {
    let intercepted = false;
    listeners.fetch({ request: { method: 'GET', mode: 'navigate', url: `http://127.0.0.1:31718${path}` }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});

test('landing assets do not provide a general API bypass', async () => {
  const h = await server({ gateHost: 'console.example.com' });
  try {
    // Only the three exact bypass paths exist; any other API on loopback still hits the gate.
    for (const p of ['/api/workspaces', '/api/voice/transcribe', '/local-owner/voice/status', '/api/manage/identity', '/api/voice/setup'])
      assert.equal((await h.req(p, local(h.port))).status, 403, p);
  } finally { await h.cleanup(); }
});
