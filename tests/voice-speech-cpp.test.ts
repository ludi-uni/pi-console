// Unit tests for the speech.cpp local STT provider and the WAV helpers.
// All browser globals are faked — no real microphone, no real executable,
// no network. Fakes exercise permission races, abort semantics, recorder
// bounds, WAV output and the transcribe boundary contract.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SpeechCppSTTProvider } from '../web/voice/speech-cpp-stt.ts';
import { encodeWavPcm16, wavToBase64 } from '../web/voice/wav.ts';
import type { STTSessionEvents, Transcript, VoiceError } from '../web/voice/types.ts';
import type { SpeechPublicStatus } from '../shared/speech.ts';

const ENABLED: SpeechPublicStatus = { enabled: true, available: false, phase: 'stopped', providerId: 'speech-cpp' };
const DISABLED: SpeechPublicStatus = { enabled: false, available: false, phase: 'off', providerId: 'speech-cpp' };

class FakeTrack { stopped = 0; stop() { this.stopped++; } }
class FakeStream { tracks = [new FakeTrack(), new FakeTrack()]; getTracks() { return this.tracks; } }
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static supported = new Set(['audio/webm;codecs=opus']);
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: FakeStream, options?: { mimeType?: string }) {
    if (options?.mimeType && !FakeRecorder.supported.has(options.mimeType)) throw Error('NotSupportedError');
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeRecorder.instances.push(this);
  }
  static isTypeSupported(type: string) { return FakeRecorder.supported.has(type); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
  emit(blob: Blob) { this.ondataavailable?.({ data: blob }); }
}
type Globals = { navigator?: unknown; window?: unknown; MediaRecorder?: unknown; AudioContext?: unknown; OfflineAudioContext?: unknown; fetch?: unknown };
// Node exposes some of these (navigator) as getter-only globals — override via
// defineProperty and restore the original descriptor afterwards.
const sandbox = (values: Globals) => {
  const target = globalThis as unknown as Globals;
  const before = new Map<keyof Globals, PropertyDescriptor | undefined>();
  for (const key of Object.keys(values) as (keyof Globals)[]) {
    before.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: values[key], configurable: true, writable: true });
  }
  return () => {
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete target[key];
    }
  };
};
const baseGlobals = (over: Globals = {}): Globals => ({
  window: { isSecureContext: true },
  navigator: { mediaDevices: { getUserMedia: async () => new FakeStream() } },
  MediaRecorder: FakeRecorder,
  ...over,
});
const collect = () => {
  const transcripts: Transcript[] = [], errors: VoiceError[] = [];
  let started = 0, ended = 0, processing = 0;
  const events: STTSessionEvents = {
    onStart: () => started++, onEnd: () => ended++, onProcessing: () => processing++,
    onTranscript: t => transcripts.push(t), onError: e => errors.push(e),
  };
  return { transcripts, errors, events, stats: () => ({ started, ended, processing }) };
};
const response = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const silentPcm = (seconds: number) => new Float32Array(seconds * 16000);

describe('wav helpers', () => {
  it('encodes a canonical 16 kHz mono PCM16 WAV with exact header values', () => {
    const samples = silentPcm(1);
    samples[0] = 1; samples[1] = -1;
    const wav = new DataView(encodeWavPcm16(samples));
    assert.equal(wav.getUint32(0, false), 0x52494646); // 'RIFF'
    assert.equal(wav.getUint32(4, true), 36 + 32000);
    assert.equal(wav.getUint32(8, false), 0x57415645); // 'WAVE'
    assert.equal(wav.getUint16(20, true), 1); // PCM
    assert.equal(wav.getUint16(22, true), 1); // mono
    assert.equal(wav.getUint32(24, true), 16000);
    assert.equal(wav.getUint32(28, true), 32000); // byteRate
    assert.equal(wav.getUint16(32, true), 2); // blockAlign
    assert.equal(wav.getUint16(34, true), 16); // bits
    assert.equal(wav.getUint32(36, false), 0x64617461); // 'data'
    assert.equal(wav.getUint32(40, true), 32000);
    assert.equal(wav.getInt16(44, true), 32767);
    assert.equal(wav.getInt16(46, true), -32768);
  });
  it('clips beyond 60 seconds and round-trips base64', () => {
    const wav = encodeWavPcm16(new Float32Array(61 * 16000));
    assert.equal(wav.byteLength, 44 + 60 * 16000 * 2);
    assert.equal(atob(wavToBase64(wav)).length, wav.byteLength);
  });
});

describe('SpeechCppSTTProvider availability', () => {
  it('requires enabled status, secure context, getUserMedia and MediaRecorder', async () => {
    const restore = sandbox(baseGlobals());
    try {
      const off = new SpeechCppSTTProvider({ statusOverride: DISABLED });
      assert.equal(off.isAvailable(), false);
      const on = new SpeechCppSTTProvider({ statusOverride: ENABLED });
      assert.equal(on.isAvailable(), true);
      const g = globalThis as unknown as Globals;
      g.window = { isSecureContext: false };
      assert.equal(on.isAvailable(), false);
      g.window = { isSecureContext: true };
      g.MediaRecorder = undefined;
      assert.equal(on.isAvailable(), false);
    } finally { restore(); }
    // No globals at all: enabled status alone must not throw.
    assert.equal(new SpeechCppSTTProvider({ statusOverride: ENABLED }).isAvailable(), false);
  });
  it('refreshes status from the same-origin public endpoint only', async () => {
    const calls: string[] = [];
    const restore = sandbox(baseGlobals({ fetch: async (url: string) => { calls.push(url); return response(200, ENABLED); } }));
    try {
      const provider = new SpeechCppSTTProvider();
      assert.equal(provider.isAvailable(), false); // not enabled until status is known
      assert.equal((await provider.refreshStatus())?.phase, 'stopped');
      assert.deepEqual(calls, ['/api/voice/status']);
      assert.equal(provider.isAvailable(), true);
    } finally { restore(); }
  });
  it('rejects malformed status bodies instead of trusting them', async () => {
    const restore = sandbox(baseGlobals({ fetch: async () => response(200, { enabled: true }) }));
    try {
      const provider = new SpeechCppSTTProvider();
      assert.equal(await provider.refreshStatus(), undefined);
      assert.equal(provider.isAvailable(), false);
    } finally { restore(); }
  });
});

describe('SpeechCppSTTProvider session', () => {
  const decodeOk = async () => ({ duration: 1 } as AudioBuffer);
  const renderOk = async () => silentPcm(1);
  const deps = (over: Record<string, unknown> = {}) => ({
    statusOverride: ENABLED,
    decode: decodeOk, render: renderOk,
    fetch: async () => response(200, { text: 'こんにちは', providerId: 'speech-cpp', language: 'ja' }),
    ...over,
  });
  it('records, posts one bounded WAV and emits a single final transcript', async () => {
    const bodies: unknown[] = [];
    const restore = sandbox(baseGlobals());
    try {
      const provider = new SpeechCppSTTProvider(deps({
        fetch: async (url: string, init: RequestInit) => { bodies.push({ url, body: JSON.parse(String(init.body)) }); return response(200, { text: 'こんにちは', providerId: 'speech-cpp', language: 'ja' }); },
      }));
      const { transcripts, errors, events, stats } = collect();
      const session = provider.start({ language: 'ja-JP' }, events);
      await new Promise(r => setTimeout(r, 0));
      assert.equal(stats().started, 1);
      const recorder = FakeRecorder.instances.at(-1)!;
      assert.equal(recorder.mimeType, 'audio/webm;codecs=opus');
      recorder.emit(new Blob([new Uint8Array(16)], { type: 'audio/webm' }));
      session.stop();
      await new Promise(r => setTimeout(r, 10));
      assert.equal(stats().processing, 1);
      assert.equal(stats().ended, 1);
      assert.deepEqual(errors, []);
      assert.deepEqual(transcripts.map(t => [t.text, t.isFinal, t.providerId]), [['こんにちは', true, 'speech-cpp']]);
      assert.equal((bodies as { url: string }[])[0].url, '/api/voice/transcribe');
      const payload = (bodies as { body: { audioBase64: string; language: string } }[])[0].body;
      assert.equal(payload.language, 'ja-JP');
      const wav = Buffer.from(payload.audioBase64, 'base64');
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.readUInt32LE(24), 16000);
      assert.equal(wav.readUInt16LE(22), 1);
      assert.equal(wav.readUInt16LE(34), 16);
      // mic tracks stopped exactly when recording ended
      assert.ok(FakeRecorder.instances.at(-1)!.stream.tracks.every(t => t.stopped === 1));
    } finally { restore(); }
  });
  it('maps empty transcripts to no-speech instead of a blank success', async () => {
    const restore = sandbox(baseGlobals());
    try {
      const provider = new SpeechCppSTTProvider(deps({ fetch: async () => response(200, { text: '   ', providerId: 'speech-cpp' }) }));
      const { transcripts, errors, events, stats } = collect();
      const session = provider.start({ language: 'auto' }, events);
      await new Promise(r => setTimeout(r, 0));
      FakeRecorder.instances.at(-1)!.emit(new Blob([new Uint8Array(8)]));
      session.stop();
      await new Promise(r => setTimeout(r, 10));
      assert.equal(stats().ended, 0);
      assert.deepEqual(transcripts, []);
      assert.deepEqual(errors.map(e => [e.code, e.detail]), [['STT_FAILED', 'no-speech']]);
    } finally { restore(); }
  });
  it('blocks recording and POST when disabled or status unknown', async () => {
    let posts = 0;
    const restore = sandbox(baseGlobals({ fetch: async () => { posts++; return response(200, {}); } }));
    try {
      const provider = new SpeechCppSTTProvider({ statusOverride: DISABLED, decode: decodeOk, render: renderOk });
      assert.throws(() => provider.start({}, {}), (e: unknown) => (e as VoiceError).code === 'STT_UNAVAILABLE' && (e as VoiceError).detail === 'speech-cpp-not-enabled');
      await new Promise(r => setTimeout(r, 5));
      assert.equal(posts, 0);
      const unknown = new SpeechCppSTTProvider({ decode: decodeOk, render: renderOk });
      assert.throws(() => unknown.start({}, {}), (e: unknown) => (e as VoiceError).code === 'STT_UNAVAILABLE');
    } finally { restore(); }
  });
  it('stops late-granted mic tracks when abort races the permission prompt', async () => {
    let grant: (s: FakeStream) => void = () => {};
    const stream = new FakeStream();
    const pending = new Promise<FakeStream>(r => { grant = r; });
    const restore = sandbox(baseGlobals({ navigator: { mediaDevices: { getUserMedia: () => pending } } }));
    try {
      const provider = new SpeechCppSTTProvider(deps());
      const { errors, events } = collect();
      const session = provider.start({}, events);
      session.abort();
      grant(stream);
      await new Promise(r => setTimeout(r, 5));
      assert.ok(stream.tracks.every(t => t.stopped === 1));
      assert.equal(FakeRecorder.instances.length === 0 || FakeRecorder.instances.at(-1)!.stream !== stream, true);
      assert.deepEqual(errors, []);
    } finally { restore(); }
  });
  it('stop before permission ends immediately and a late grant never records or uploads',async()=>{
    let grant:(stream:FakeStream)=>void=()=>{},posts=0;
    const stream=new FakeStream(),pending=new Promise<FakeStream>(resolve=>{grant=resolve;});
    const restore=sandbox(baseGlobals({navigator:{mediaDevices:{getUserMedia:()=>pending}}}));
    try{
      const provider=new SpeechCppSTTProvider(deps({fetch:async()=>{posts++;return response(200,{});}}));
      const {events,stats,errors,transcripts}=collect(),session=provider.start({},events);
      session.stop();session.stop();assert.equal(stats().ended,1);
      grant(stream);await new Promise(resolve=>setTimeout(resolve,5));
      assert.deepEqual(stats(),{started:0,ended:1,processing:0});assert.equal(posts,0);
      assert.ok(stream.tracks.every(track=>track.stopped===1));assert.deepEqual(errors,[]);assert.deepEqual(transcripts,[]);
    }finally{restore();}
  });
  it('denied permission maps to MIC_PERMISSION_DENIED', async () => {
    const denied = Object.assign(Error('denied'), { name: 'NotAllowedError' });
    const restore = sandbox(baseGlobals({ navigator: { mediaDevices: { getUserMedia: async () => { throw denied; } } } }));
    try {
      const provider = new SpeechCppSTTProvider(deps());
      const { errors, events } = collect();
      provider.start({}, events);
      await new Promise(r => setTimeout(r, 5));
      assert.deepEqual(errors.map(e => e.code), ['MIC_PERMISSION_DENIED']);
    } finally { restore(); }
  });
  it('falls back to a default-constructed recorder when isTypeSupported declines', async () => {
    const previous = FakeRecorder.supported;
    FakeRecorder.supported = new Set();
    const restore = sandbox(baseGlobals());
    try {
      const provider = new SpeechCppSTTProvider(deps());
      const { events, stats } = collect();
      provider.start({}, events);
      await new Promise(r => setTimeout(r, 0));
      assert.equal(stats().started, 1);
      assert.equal(FakeRecorder.instances.at(-1)!.mimeType, 'audio/webm');
    } finally { FakeRecorder.supported = previous; restore(); }
  });
  it('a decode failure ends with STT_FAILED and never posts', async () => {
    let posts = 0;
    const restore = sandbox(baseGlobals());
    try {
      const provider = new SpeechCppSTTProvider(deps({
        decode: async () => { throw Error('decode-failed'); },
        fetch: async () => { posts++; return response(200, {}); },
      }));
      const { errors, events } = collect();
      const session = provider.start({}, events);
      await new Promise(r => setTimeout(r, 0));
      FakeRecorder.instances.at(-1)!.emit(new Blob([new Uint8Array(8)]));
      session.stop();
      await new Promise(r => setTimeout(r, 10));
      assert.equal(posts, 0);
      assert.deepEqual(errors.map(e => e.code), ['STT_FAILED']);
    } finally { restore(); }
  });
  it('maps busy/invalid results to stable errors and suppresses transcripts', async () => {
    const restore = sandbox(baseGlobals());
    try {
      for (const [status, body, code] of [[409, { error: 'speech_busy' }, 'STT_UNAVAILABLE'], [200, { text: 5 }, 'STT_FAILED']] as const) {
        const provider = new SpeechCppSTTProvider(deps({ fetch: async () => response(status, body) }));
        const { transcripts, errors, events } = collect();
        const session = provider.start({}, events);
        await new Promise(r => setTimeout(r, 0));
        FakeRecorder.instances.at(-1)!.emit(new Blob([new Uint8Array(8)]));
        session.stop();
        await new Promise(r => setTimeout(r, 10));
        assert.deepEqual(transcripts, []);
        assert.deepEqual(errors.map(e => e.code), [code]);
      }
    } finally { restore(); }
  });
  it('aborts an in-flight upload and suppresses the late result', async () => {
    let resolvePost: (r: Response) => void = () => {};
    const restore = sandbox(baseGlobals());
    try {
      const provider = new SpeechCppSTTProvider(deps({ fetch: async () => new Promise<Response>(r => { resolvePost = r; }) }));
      const { transcripts, errors, events, stats } = collect();
      const session = provider.start({}, events);
      await new Promise(r => setTimeout(r, 0));
      FakeRecorder.instances.at(-1)!.emit(new Blob([new Uint8Array(8)]));
      session.stop();
      await new Promise(r => setTimeout(r, 10));
      assert.equal(stats().processing, 1);
      session.abort();
      resolvePost(response(200, { text: 'late', providerId: 'speech-cpp' }));
      await new Promise(r => setTimeout(r, 10));
      assert.equal(stats().ended, 0);
      assert.deepEqual(transcripts, []);
      assert.deepEqual(errors, []);
    } finally { restore(); }
  });
  it('respects the recorded blob size bound before any upload', async () => {
    let posts = 0;
    const restore = sandbox(baseGlobals());
    try {
      const provider = new SpeechCppSTTProvider(deps({ fetch: async () => { posts++; return response(200, {}); } }));
      const { errors, events } = collect();
      const session = provider.start({}, events);
      await new Promise(r => setTimeout(r, 0));
      FakeRecorder.instances.at(-1)!.emit(new Blob([new Uint8Array(65 * 1024 * 1024)]));
      session.stop();
      await new Promise(r => setTimeout(r, 10));
      assert.equal(posts, 0);
      assert.deepEqual(errors.map(e => [e.code, e.detail]), [['STT_FAILED', 'recording-bounds']]);
    } finally { restore(); }
  });
});
