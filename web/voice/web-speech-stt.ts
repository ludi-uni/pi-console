// WebSpeechSTTProvider — the existing Web Speech API dictation, expressed as an
// STTProvider. This is a relocation of the behavior previously embedded in
// VoiceInput.tsx; observable behavior is unchanged.
//
// Capture is provider-managed: the browser owns the microphone. No audio
// upload, provider key or automatic send happens here.

import { voiceError } from './types.ts';
import type { ProviderPrivacy, STTCapabilities, STTProvider, STTSession, STTSessionEvents, STTStartOptions, VoiceErrorCode } from './types.ts';

type Result = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null; onend: (() => void) | null;
  onresult: ((event: { results: ArrayLike<Result> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
};
type Constructor = new () => Recognition;

const speechRecognitionConstructor = (): Constructor | undefined => {
  if (typeof window === 'undefined') return undefined;
  const browser = window as unknown as { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
};

const ERROR_CODES: Record<string, VoiceErrorCode> = {
  'not-allowed': 'MIC_PERMISSION_DENIED',
  'service-not-allowed': 'STT_UNAVAILABLE',
  'audio-capture': 'MIC_UNAVAILABLE',
  'network': 'STT_UNAVAILABLE',
  'no-speech': 'STT_FAILED',
  'language-not-supported': 'STT_UNSUPPORTED',
};

export const webSpeechErrorCode = (raw: string | undefined): VoiceErrorCode => ERROR_CODES[raw ?? ''] ?? 'STT_FAILED';

export class WebSpeechSTTProvider implements STTProvider {
  readonly id = 'web-speech';
  readonly label = 'Browser (Web Speech API)';
  readonly capabilities: STTCapabilities = {
    streaming: true,
    batch: false,
    providerManagedCapture: true,
    externalAudioInput: false,
    local: false,
    requiresNetwork: true,
    requiresApiKey: false,
  };
  readonly privacy: ProviderPrivacy = {
    local: false,
    requiresNetwork: true,
    audioLeavesDevice: true,
    textLeavesDevice: false,
  };
  readonly notes = [
    'No additional installation required.',
    'Browser support varies.',
    'Recognition may use an online service depending on browser implementation.',
  ];

  isAvailable(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext && !!speechRecognitionConstructor();
  }

  start(options: STTStartOptions, events: STTSessionEvents): STTSession {
    const Ctor = speechRecognitionConstructor();
    if (!Ctor || !this.isAvailable()) throw voiceError('STT_UNSUPPORTED', 'web-speech-unavailable');
    let recognition: Recognition;
    try { recognition = new Ctor(); } catch (cause) { throw voiceError('STT_UNSUPPORTED', 'recognition-constructor', cause); }
    if (options.language) recognition.lang = options.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    let emittedFinals = 0;
    const detach = () => {
      recognition.onstart = recognition.onend = recognition.onresult = recognition.onerror = null;
    };
    recognition.onstart = () => events.onStart?.();
    recognition.onresult = event => {
      // The result list is cumulative; emit only finals not delivered before so
      // re-delivered results cannot double-count, and keep the interim as a
      // single replaceable non-final transcript.
      const results = Array.from(event.results);
      const finals = results.filter(r => r.isFinal);
      for (const result of finals.slice(emittedFinals)) {
        events.onTranscript?.({ text: result[0].transcript, isFinal: true, providerId: this.id, language: options.language });
      }
      emittedFinals = Math.max(emittedFinals, finals.length);
      events.onTranscript?.({ text: results.filter(r => !r.isFinal).map(r => r[0].transcript).join(''), isFinal: false, providerId: this.id, language: options.language });
    };
    recognition.onend = () => events.onEnd?.();
    recognition.onerror = event => events.onError?.(voiceError(webSpeechErrorCode(event.error), event.error));
    try { recognition.start(); } catch (cause) { detach(); throw voiceError('STT_FAILED', 'recognition-start', cause); }
    return {
      stop: () => recognition.stop(),
      detach,
      abort: () => { detach(); try { recognition.abort(); } catch { /* already stopped */ } },
    };
  }
}
