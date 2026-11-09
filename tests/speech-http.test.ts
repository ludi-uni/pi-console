// speech.cpp HTTP boundary tests — owner routes require the local-owner
// session verify; public routes expose only sanitized metadata and a strictly
// bounded WAV transcribe endpoint.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpeechCppService } from '../server/speech-cpp.ts';
import { createSpeechHttp, parseSpeechWav, speechLanguage } from '../server/speech-http.ts';
import { ownerFixture } from './local-owner.fixture.ts';
import { fakeSpawn, fakeFetch, versionSpec, modelsSpec, serveSpec, jsonResponse, textResponse, wavBytes } from './helpers/speech.fixture.ts';

function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const r: any = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  r.method = method; r.url = url;
  r.headers = { 'content-type': 'application/json', ...headers };
  r.rawHeaders = Object.entries(r.headers).flat();
  r.socket = { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1', localPort: 40001 };
  return r as any;
}
function res() {
  const out: any = new EventEmitter();
  out.status = 0; out.body = undefined; out.headers = {} as Record<string, string>;
  out.writeHead = (s: number, h: Record<string, string> = {}) => { out.status = s; Object.assign(out.headers, h); return out; };
  out.end = (v?: string) => { out.ended = true; out.writableEnded = true; out.body = v ? JSON.parse(v) : undefined; return out; };
  out.resume = () => {};
  out.setHeader = (k: string, v: string) => { out.headers[k] = v; };
  out.destroyed = false; out.writableEnded = false;
  return out;
}

async function fixture(opts: { verified?: boolean } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pi-speech-http-'));
  const exe = join(dataDir, 'tools', 'speech.exe');
  await mkdir(join(dataDir, 'tools'), { recursive: true }); await writeFile(exe, 'MZ');
  const gguf = join(dataDir, 'voice', 'models', 'qwen3-asr-0.6b', 'm.gguf');
  await mkdir(join(gguf, '..'), { recursive: true }); await writeFile(gguf, 'GGUF');
  const { spawn, calls } = fakeSpawn([versionSpec(), modelsSpec({ 'qwen3-asr-0.6b': [gguf] }), serveSpec(45997)]);
  const { fetch, calls: fcalls } = fakeFetch([
    { match: u => u.endsWith('/health'), respond: () => jsonResponse({ status: 'ok' }) },
    { match: u => u.endsWith('/v1/models'), respond: () => jsonResponse({ data: [{id:'Qwen3-ASR-0.6B'}] }) },
    { match: u => u.includes('transcriptions'), respond: () => textResponse(JSON.stringify({ text: 'hello', language: 'en' })) },
  ]);
  const service = new SpeechCppService({ dataDir, deps: { platform: 'win32', arch: 'x64', spawn, fetch } });
  await service.load();
  const authorize = () => opts.verified !== false ? (() => {}) : undefined;
  const http = createSpeechHttp({ service, authorize });
  return { service, http, calls, fcalls, exe, gguf };
}
const settle = () => new Promise(r => setTimeout(r, 20));
async function waitDone(s: SpeechCppService) { for (let i = 0; i < 200; i++) { const j = s.ownerStatus().job; if (!j || j.state !== 'running') return; await settle(); } }

describe('owner boundary', () => {
  it('ignores non-voice paths', async () => {
    const { http } = await fixture();
    assert.equal(await http.handleOwner(req('POST', '/local-owner/settings-owner/status', {}), res()), false);
    assert.equal(await http.handleOwner(req('POST', '/api/voice/status', {}), res()), false);
  });
  it('rejects owner actions without a verified local-owner session', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'pi-speech-http-'));
    const service = new SpeechCppService({ dataDir });
    await service.load();
    const http = createSpeechHttp({ service, authorize: () => undefined });
    for (const route of ['status', 'enable', 'disable', 'cancel', 'start']) {
      const r = res();
      await http.handleOwner(req('POST', `/local-owner/voice/${route}`, { source: 'managed', modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true }), r);
      assert.equal(r.status, 409, route);
      assert.equal(r.body.error, 'owner_session_expired');
    }
  });
  it('returns 404 for queries, GETs and unknown routes', async () => {
    const { http } = await fixture();
    for (const u of ['/local-owner/voice/status?x=1']) {
      const r = res(); await http.handleOwner(req('POST', u, {}), r); assert.equal(r.status, 404);
    }
    const g = res(); await http.handleOwner(req('GET', '/local-owner/voice/status'), g); assert.equal(g.status, 404);
    const u = res(); await http.handleOwner(req('POST', '/local-owner/voice/rm', {}), u); assert.equal(u.status, 404);
  });
  it('owner status is initially off and enable returns 202 with a job', async () => {
    const { http, service, exe } = await fixture();
    const s = res(); await http.handleOwner(req('POST', '/local-owner/voice/status', {}), s);
    assert.equal(s.status, 200); assert.equal(s.body.enabled, false); assert.equal(s.body.phase, 'off');
    const e = res();
    await http.handleOwner(req('POST', '/local-owner/voice/enable', { source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }), e);
    assert.equal(e.status, 202);
    assert.equal(e.body.job.state, 'running');
    await waitDone(service);
    const s2 = res(); await http.handleOwner(req('POST', '/local-owner/voice/status', {}), s2);
    assert.equal(s2.body.enabled, true); assert.equal(s2.body.phase, 'stopped');
    assert.ok(s2.body.executablePath.includes('speech.exe'), 'owner view may include paths');
  });
  it('disable and cancel run through the owner boundary', async () => {
    const { http, service } = await fixture();
    const d = res(); await http.handleOwner(req('POST', '/local-owner/voice/disable', {}), d);
    assert.equal(d.status, 200); assert.equal(d.body.enabled, false);
    const c = res(); await http.handleOwner(req('POST', '/local-owner/voice/cancel', {}), c);
    assert.equal(c.status, 200);
  });
});

describe('public boundary', () => {
  it('public status is sanitized: no paths, ports, versions or job internals', async () => {
    const { http, service, exe } = await fixture();
    // enable first so the record would contain paths
    const e = res(); await http.handleOwner(req('POST', '/local-owner/voice/enable', { source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }), e);
    await waitDone(service);
    const r = res();
    await http.handlePublic(req('GET', '/api/voice/status'), r);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['available', 'enabled', 'modelId', 'phase', 'providerId']);
    assert.equal(r.body.providerId, 'speech-cpp');
    assert.equal(JSON.stringify(r.body).includes('speech.exe'), false);
    assert.equal(JSON.stringify(r.body).includes('port'), false);
  });
  it('public status default is disabled and unavailable', async () => {
    const { http } = await fixture();
    const r = res();
    await http.handlePublic(req('GET', '/api/voice/status'), r);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { enabled: false, available: false, phase: 'off', providerId: 'speech-cpp' });
  });
  it('transcribe validates base64, RIFF/WAVE PCM mono 16k format and duration', async () => {
    const { http, service, exe } = await fixture();
    const e = res(); await http.handleOwner(req('POST', '/local-owner/voice/enable', { source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }), e);
    await waitDone(service);
    const tx = async (body: unknown) => { const r = res(); await http.handlePublic(req('POST', '/api/voice/transcribe', body), r); return r; };
    assert.equal((await tx({ audioBase64: '!!!' })).status, 400);
    assert.equal((await tx({ audioBase64: Buffer.from('not a wav').toString('base64') })).status, 400);
    assert.equal((await tx({ audioBase64: wavBytes(0.5, { rate: 8000 }).toString('base64') })).body.error, 'speech_audio_format');
    assert.equal((await tx({ audioBase64: wavBytes(0.5, { channels: 2 }).toString('base64') })).body.error, 'speech_audio_format');
    assert.equal((await tx({ audioBase64: wavBytes(0.5, { bits: 8 }).toString('base64') })).body.error, 'speech_audio_format');
    assert.equal((await tx({ audioBase64: wavBytes(61).toString('base64') })).body.error, 'speech_audio_too_long');
    const ok = await tx({ audioBase64: wavBytes(0.5).toString('base64'), language: 'en-US' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.text, 'hello');
    assert.equal(ok.body.providerId, 'speech-cpp');
    assert.equal(ok.body.language, 'en');
  });
  it('transcribe fails closed when disabled', async () => {
    const { http } = await fixture();
    const r = res();
    await http.handlePublic(req('POST', '/api/voice/transcribe', { audioBase64: wavBytes(0.5).toString('base64') }), r);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'speech_not_enabled');
  });
  it('rejects non-public paths', async () => {
    const { http } = await fixture();
    assert.equal(await http.handlePublic(req('GET', '/api/other'), res()), false);
  });
  it('language mapping accepts BCP-47 and auto, rejects junk', () => {
    assert.equal(speechLanguage('ja-JP'), 'ja');
    assert.equal(speechLanguage('en-US'), 'en');
    assert.equal(speechLanguage('auto'), 'auto');
    assert.equal(speechLanguage(undefined), undefined);
    assert.throws(() => speechLanguage('../../etc'), /invalid_arguments/);
    assert.throws(() => speechLanguage(42), /invalid_arguments/);
  });
  it('WAV parser accepts only canonical 16kHz mono PCM', () => {
    const ok = parseSpeechWav(wavBytes(1));
    assert.equal(ok.seconds, 1);
    assert.throws(() => parseSpeechWav(wavBytes(0.1, { rate: 44100 })), /speech_audio_format/);
    assert.throws(() => parseSpeechWav(Buffer.from('RIFFxxxxWAVE')), /speech_audio_invalid/);
    // duplicate fmt/data chunks and byteRate/blockAlign mismatches are rejected
    const wav = wavBytes(0.5);
    const dup = Buffer.concat([wav, wav.subarray(12, 28)]);
    dup.writeUInt32LE(dup.length - 8, 4);
    assert.throws(() => parseSpeechWav(dup), /speech_audio_invalid/);
    const bad = Buffer.from(wav); bad.writeUInt32LE(1, 28); // corrupt byteRate inside fmt body
    assert.throws(() => parseSpeechWav(bad), /speech_audio_invalid/);
    const trailing = Buffer.concat([wav, Buffer.alloc(4)]);
    assert.throws(() => parseSpeechWav(trailing), /speech_audio_invalid/);
  });
  it('a normal POST body does not abort the upstream transcription', async () => {
    // Real HTTP: reading the request body fires req 'close' on some runtimes;
    // the upstream abort must be tied to the response closing instead.
    const { service, exe } = await fixture();
    const e = res();
    await createSpeechHttp({ service, authorize: () => () => {} }).handleOwner(req('POST', '/local-owner/voice/enable', { source: 'existing', executablePath: exe, modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: false }), e);
    await waitDone(service);
    let upstreamAborted = false;
    const seen: { signal?: AbortSignal } = {};
    // Reuse the enabled service but observe the transcribe call's signal via a wrapper.
    const wrapped = createSpeechHttp({
      service: { ...service, transcribe: (wav: Buffer, lang: string | undefined, signal: AbortSignal) => { seen.signal = signal; signal.addEventListener('abort', () => { upstreamAborted = true; }); return service.transcribe(wav, lang, signal); } } as SpeechCppService,
      authorize: () => () => {},
    });
    const server = createServer((rq, rs) => void wrapped.handlePublic(rq, rs).then(h => { if (!h) { rs.writeHead(404); rs.end(); } }));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as any).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/voice/transcribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audioBase64: wavBytes(0.5).toString('base64'), language: 'en-US' }) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).text, 'hello');
      assert.equal(upstreamAborted, false, 'request body consumption must not abort upstream');
    } finally { await new Promise<void>(r => server.close(() => r())); await service.dispose(); }
  });
  it('owner lease survives keepalive close but dies with the session', async () => {
    // Real local-owner bootstrap: authorize() checks the session record, not the
    // request socket — a finished response/closed keepalive must not kill a job.
    const f = await ownerFixture();
    try {
      const { cookie } = await f.login();
      const authorize = (req: any) => f.app!.authorize(req);
      // simulate the owner-session request shape authorize() expects
      const mkReq = () => {
        const port = f.app!.status().port!;
        const r: any = new EventEmitter();
        r.method = 'POST'; r.url = '/local-owner/voice/status';
        r.headers = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie };
        r.rawHeaders = Object.entries(r.headers).flat();
        r.socket = { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1', localPort: port };
        return r;
      };
      const lease = authorize(mkReq());
      assert.ok(lease, 'authorized lease returned');
      assert.doesNotThrow(lease);
      // closing the HTTP connection/response does not invalidate the lease
      const dead = mkReq(); dead.socket = undefined;
      assert.doesNotThrow(lease);
      // logout revokes the session → lease throws
      await f.browser('auth/logout', {}, cookie);
      assert.throws(lease, /owner_session_expired/);
      // a fresh login creates a new session; expired sessions also throw
      const { cookie: cookie2 } = await f.login();
      const old = mkReq(); old.headers.cookie = cookie;
      assert.equal(authorize(old), undefined, 'dead cookie yields no lease');
      f.advance(600001);
      const lease2 = authorize({ ...mkReq(), headers: { ...mkReq().headers, cookie: cookie2 } });
      assert.equal(lease2, undefined, 'expired session yields no lease');
    } finally { await f.cleanup(); }
  });
});
