// Client-side Voice-setup routing: the descriptor is never trusted on its own —
// a redirect happens only when the literal loopback probe echoes the exact same
// per-process instance id. Every deviation falls back without navigating.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpeechSetup } from '../web/speech-setup.ts';

const ID = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const descriptor = (over: Record<string, unknown> = {}) => ({
  instanceId: ID, consolePort: 31717,
  probeUrl: 'http://127.0.0.1:31717/api/voice/local-probe',
  setupUrl: 'http://127.0.0.1:31717/voice-setup/', ...over,
});
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(plan: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  mock.method(globalThis, 'fetch', (url: unknown, init?: RequestInit) => { calls.push({ url: String(url), init }); return plan(String(url), init); });
  return calls;
}

test('same-instance probe → local resolution with the validated landing URL', async () => {
  const calls = fakeFetch(async url =>
    url === '/api/voice/setup' ? json(descriptor())
    : url === 'http://127.0.0.1:31717/api/voice/local-probe' ? json({ instanceId: ID })
    : json({}, 404));
  const r = await resolveSpeechSetup();
  assert.deepEqual(r, { kind: 'local', setupUrl: 'http://127.0.0.1:31717/voice-setup/' });
  // The probe is fetched with no credentials, no cache, no redirects.
  const probe = calls.find(c => c.url.includes('local-probe'))!;
  assert.equal(probe.init?.credentials, 'omit');
  assert.equal(probe.init?.cache, 'no-store');
  assert.equal(probe.init?.redirect, 'error');
  assert.ok(probe.init?.signal instanceof AbortSignal);
});

test('instance-id mismatch → fallback, never a redirect target', async () => {
  fakeFetch(async url => url === '/api/voice/setup' ? json(descriptor()) : json({ instanceId: OTHER }));
  const r = await resolveSpeechSetup();
  assert.equal(r.kind, 'fallback');
  assert.equal(r.manualUrl, 'http://127.0.0.1:31717/voice-setup/', 'manual option keeps only the validated URL');
});

test('probe blocked/timeout/error → fallback', async () => {
  for (const plan of [
    async (url: string) => url === '/api/voice/setup' ? json(descriptor()) : Promise.reject(new TypeError('blocked')),
    async (url: string) => url === '/api/voice/setup' ? json(descriptor()) : json({}, 403),
    async (url: string) => url === '/api/voice/setup' ? json(descriptor()) : json({ hello: 'world' }),
    async (url: string) => url === '/api/voice/setup' ? json(descriptor()) : json({ instanceId: ID.toUpperCase() }),
  ]) {
    fakeFetch(plan);
    const r = await resolveSpeechSetup();
    assert.equal(r.kind, 'fallback');
    mock.restoreAll();
  }
});

test('descriptor fetch failure or HTTP error → fallback without manual URL', async () => {
  fakeFetch(async () => Promise.reject(new TypeError('offline')));
  assert.deepEqual(await resolveSpeechSetup(), { kind: 'fallback' });
  mock.restoreAll();
  fakeFetch(async () => json({}, 401));
  assert.deepEqual(await resolveSpeechSetup(), { kind: 'fallback' });
});

test('unsafe or mismatched descriptor URLs are never used', async () => {
  for (const d of [
    descriptor({ probeUrl: 'http://127.0.0.1:9999/api/voice/local-probe' }),   // foreign port
    descriptor({ probeUrl: 'http://localhost:31717/api/voice/local-probe' }),  // non-literal host
    descriptor({ probeUrl: 'https://127.0.0.1:31717/api/voice/local-probe' }), // wrong scheme
    descriptor({ probeUrl: 'http://127.0.0.1:31717/api/voice/local-probe?x=1' }),
    descriptor({ setupUrl: 'http://127.0.0.1:31717/voice-setup/?next=https://evil' }),
    descriptor({ setupUrl: 'http://127.0.0.1:9999/voice-setup/' }),
    descriptor({ instanceId: 'not-hex' }),
    descriptor({ instanceId: ID.slice(0, 32) }),                               // 32-hex is not accepted
    descriptor({ consolePort: 0 }),
    { probeUrl: 'http://127.0.0.1:31717/api/voice/local-probe', setupUrl: 'http://127.0.0.1:31717/voice-setup/', consolePort: 31717 },
  ]) {
    fakeFetch(async url => url === '/api/voice/setup' ? json(d) : json({ instanceId: ID }));
    const r = await resolveSpeechSetup();
    assert.equal(r.kind, 'fallback', JSON.stringify(d).slice(0, 80));
    mock.restoreAll();
  }
});

test('probe timeout via AbortController (no AbortSignal.timeout) → fallback', async () => {
  fakeFetch(async (url, init) => {
    if (url === '/api/voice/setup') return json(descriptor());
    // Hang until the helper's own timer aborts the request.
    await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    return json({});
  });
  const r = await resolveSpeechSetup();
  assert.equal(r.kind, 'fallback');
});

test('a probe that sends headers but stalls its JSON body still times out', async () => {
  fakeFetch(async url => url === '/api/voice/setup' ? json(descriptor()) : ({
    ok: true,
    json: () => new Promise(() => {}),
  } as unknown as Response));
  const r = await resolveSpeechSetup();
  assert.equal(r.kind, 'fallback');
  assert.equal(r.manualUrl, 'http://127.0.0.1:31717/voice-setup/');
});

test('the helper source never references experimental network APIs', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../web/speech-setup.ts', import.meta.url), 'utf8');
  for (const banned of ['targetAddressSpace', 'local-network-access', 'AbortSignal.timeout'])
    assert(!src.includes(banned), banned);
});
