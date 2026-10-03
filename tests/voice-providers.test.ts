// Boundary tests for the voice provider abstraction. These pin the contracts
// the UI relies on — transcript event semantics, error mapping, routing — so
// providers can be added or swapped without regressing the dictation flow.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebSpeechSTTProvider, webSpeechErrorCode } from '../web/voice/web-speech-stt.ts';
import { PassthroughNormalizer, DisabledIntentProcessor } from '../web/voice/processing.ts';
import { ProviderRouter } from '../web/voice/router.ts';
import type { STTSessionEvents, Transcript } from '../web/voice/types.ts';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = ''; continuous = false; interimResults = false;
  onstart: (() => void) | null = null; onend: (() => void) | null = null;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  started = 0; stopped = 0; aborted = 0;
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.started++; this.onstart?.(); }
  stop() { this.stopped++; this.onend?.(); }
  abort() { this.aborted++; }
}

function installRecognition(ctor: unknown) {
  const target = globalThis as Record<string, unknown>;
  const fakeWindow = { isSecureContext: true, SpeechRecognition: ctor };
  target.window = fakeWindow;
  return () => { delete target.window; };
}

describe('webSpeechErrorCode', () => {
  it('maps SpeechRecognition error names to voice error codes', () => {
    assert.equal(webSpeechErrorCode('not-allowed'), 'MIC_PERMISSION_DENIED');
    assert.equal(webSpeechErrorCode('service-not-allowed'), 'STT_UNAVAILABLE');
    assert.equal(webSpeechErrorCode('audio-capture'), 'MIC_UNAVAILABLE');
    assert.equal(webSpeechErrorCode('network'), 'STT_UNAVAILABLE');
    assert.equal(webSpeechErrorCode('no-speech'), 'STT_FAILED');
    assert.equal(webSpeechErrorCode('language-not-supported'), 'STT_UNSUPPORTED');
    assert.equal(webSpeechErrorCode('aborted'), 'STT_FAILED');
    assert.equal(webSpeechErrorCode(undefined), 'STT_FAILED');
  });
});

describe('WebSpeechSTTProvider', () => {
  it('reports browser-mode capabilities and privacy without API keys', () => {
    const provider = new WebSpeechSTTProvider();
    assert.equal(provider.capabilities.providerManagedCapture, true);
    assert.equal(provider.capabilities.externalAudioInput, false);
    assert.equal(provider.capabilities.streaming, true);
    assert.equal(provider.capabilities.requiresApiKey, false);
    assert.equal(provider.privacy.audioLeavesDevice, true);
    assert.equal(provider.privacy.textLeavesDevice, false);
    assert.ok(provider.notes?.length);
  });

  it('is unavailable without a secure context or recognition constructor', () => {
    const provider = new WebSpeechSTTProvider();
    const target = globalThis as Record<string, unknown>;
    assert.equal(provider.isAvailable(), false);
    target.window = { isSecureContext: false, SpeechRecognition: FakeRecognition };
    assert.equal(provider.isAvailable(), false);
    target.window = { isSecureContext: true };
    assert.equal(provider.isAvailable(), false);
    delete target.window;
  });

  it('throws STT_UNSUPPORTED when started on an unsupported browser', () => {
    const provider = new WebSpeechSTTProvider();
    assert.throws(() => provider.start({}, {}), (error: unknown) => (error as { code?: string }).code === 'STT_UNSUPPORTED');
  });

  it('emits each final once and replaces interim text', () => {
    const restore = installRecognition(FakeRecognition);
    try {
      const provider = new WebSpeechSTTProvider();
      const transcripts: Transcript[] = [];
      const events: STTSessionEvents = { onTranscript: t => transcripts.push(t) };
      const session = provider.start({ language: 'ja-JP' }, events);
      const recognition = FakeRecognition.instances.at(-1)!;
      assert.equal(recognition.lang, 'ja-JP');
      assert.equal(recognition.continuous, true);
      assert.equal(recognition.interimResults, true);
      const cumulative = [{ isFinal: true, 0: { transcript: 'こんにちは' } }, { isFinal: true, 0: { transcript: '世界' } }];
      recognition.onresult!({ results: cumulative });
      recognition.onresult!({ results: cumulative });
      const finals = transcripts.filter(t => t.isFinal);
      assert.deepEqual(finals.map(t => t.text), ['こんにちは', '世界']);
      assert.ok(finals.every(t => t.providerId === 'web-speech' && t.language === 'ja-JP'));
      recognition.onresult!({ results: [{ isFinal: false, 0: { transcript: 'あ' } }, { isFinal: false, 0: { transcript: 'い' } }] });
      const last = transcripts.at(-1)!;
      assert.equal(last.isFinal, false);
      assert.equal(last.text, 'あい');
      session.abort();
      assert.equal(recognition.aborted, 1);
    } finally { restore(); }
  });

  it('forwards start/end/error events and supports detach/stop/abort lifecycle', () => {
    const restore = installRecognition(FakeRecognition);
    try {
      const provider = new WebSpeechSTTProvider();
      let started = 0, ended = 0; const errors: string[] = [];
      const session = provider.start({}, { onStart: () => started++, onEnd: () => ended++, onError: e => errors.push(e.code) });
      const recognition = FakeRecognition.instances.at(-1)!;
      assert.equal(started, 1);
      session.stop();
      assert.equal(recognition.stopped, 1);
      assert.equal(ended, 1);
      const session2 = provider.start({}, { onError: e => errors.push(e.code) });
      const second = FakeRecognition.instances.at(-1)!;
      second.onerror!({ error: 'audio-capture' });
      assert.deepEqual(errors, ['MIC_UNAVAILABLE']);
      session2.detach();
      assert.equal(second.onerror, null);
      assert.deepEqual(errors, ['MIC_UNAVAILABLE']);
      session2.abort();
      assert.equal(second.aborted, 1);
    } finally { restore(); }
  });
});

describe('text processing boundary', () => {
  it('passthrough normalizer preserves the transcript text', async () => {
    const raw: Transcript = { text: 'raw words', isFinal: true, providerId: 'web-speech' };
    const normalized = await new PassthroughNormalizer().normalize(raw);
    assert.equal(normalized.text, 'raw words');
    assert.equal(normalized.providerId, 'raw');
  });

  it('disabled intent processor fails with PROCESSOR_UNAVAILABLE', async () => {
    const raw: Transcript = { text: 'do thing', isFinal: true, providerId: 'raw' };
    await assert.rejects(() => new DisabledIntentProcessor().process(raw, {}), (error: unknown) => (error as { code?: string }).code === 'PROCESSOR_UNAVAILABLE');
  });
});

describe('ProviderRouter', () => {
  const stt = new WebSpeechSTTProvider();
  const normalizer = new PassthroughNormalizer();
  const intent = new DisabledIntentProcessor();
  const router = new ProviderRouter({ stt: [stt], normalizers: [normalizer], intentProcessors: [intent] });

  it('resolves providers explicitly by id only when available', () => {
    const restore = installRecognition(FakeRecognition);
    try { assert.equal(router.resolveSTT('web-speech'), stt); }
    finally { restore(); }
    assert.equal(router.resolveSTT('web-speech'), undefined);
    assert.equal(router.resolveSTT('missing'), undefined);
    assert.equal(router.resolveNormalizer('raw'), normalizer);
    assert.equal(router.resolveIntentProcessor('disabled'), intent);
  });

  it('routes tasks by capability and locality preference without naming models', () => {
    const restore = installRecognition(FakeRecognition);
    try {
      assert.equal(router.route({ task: 'transcription' }), stt);
      assert.equal(router.route({ task: 'transcription', localPreference: 'require' }), undefined);
      assert.equal(router.route({ task: 'dictation_cleanup' }), undefined);
      assert.equal(router.route({ task: 'agent_intent' }), undefined);
    } finally { restore(); }
  });
});
