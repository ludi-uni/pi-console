// SpeechCppSTTProvider — batch dictation through the local speech.cpp service
// behind the console's own /api/voice/* endpoints (same origin, CSP
// connect-src 'self' is preserved; the browser never talks to the model
// server directly and no audio or transcript is stored anywhere).
//
// Capture uses the microphone only after the user's explicit Start action:
// getUserMedia → MediaRecorder (first isTypeSupported match, constructor
// fallback) → decodeAudioData → OfflineAudioContext resample to mono 16 kHz →
// PCM16 WAV → base64 JSON POST to /api/voice/transcribe. The POST timeout is
// bounded above the server's own bounds (serve start 120 s + inference 90 s).
// stop() ends capture and enters 'processing': the server work is already
// committed and may legitimately take tens of seconds, so the session reports
// that state via onProcessing instead of being forced through the streaming
// grace window. abort() cancels deterministically — mic tracks stop, the
// decode/upload aborts and late results are suppressed by an epoch check.

import { SPEECH_CPP_PROVIDER_ID } from '../../shared/speech.ts';
import type { SpeechPublicStatus, SpeechTranscribeResult } from '../../shared/speech.ts';
import { voiceError } from './types.ts';
import type { ProviderPrivacy, STTCapabilities, STTProvider, STTSession, STTSessionEvents, STTStartOptions } from './types.ts';
import { audioBufferToSpeechWav, encodeWavPcm16, wavToBase64 } from './wav.ts';

export interface SpeechCppProviderDeps {
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Status used instead of GET /api/voice/status — test seam, never a URL. */
  statusOverride?: SpeechPublicStatus;
  /** Decode a recorded blob into an AudioBuffer (test seam; default: AudioContext). */
  decode?: (data: ArrayBuffer) => Promise<AudioBuffer>;
  /** Render an AudioBuffer down to mono 16 kHz (test seam; default: OfflineAudioContext). */
  render?: (decoded: AudioBuffer) => Promise<Float32Array>;
}

export const RECORDER_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
// Server-side bounds: serve start ≤120 s, transcription ≤90 s. 240 s leaves
// headroom while keeping the upload strictly bounded.
export const SPEECH_TRANSCRIBE_TIMEOUT_MS = 240_000;
export const SPEECH_MAX_RECORDED_BYTES = 64 * 1024 * 1024;
export const SPEECH_MAX_WAV_BYTES = 60 * 16000 * 2 + 44;

type Media = { stream: MediaStream; recorder: MediaRecorder; done: Promise<Blob>; };

const pickRecorderMime = (media: typeof MediaRecorder): string | undefined => {
  try { return RECORDER_MIME_CANDIDATES.find(type => media.isTypeSupported(type)); } catch { return undefined; }
};

export class SpeechCppSTTProvider implements STTProvider {
  readonly id = SPEECH_CPP_PROVIDER_ID;
  readonly label = 'Local (speech.cpp)';
  readonly capabilities: STTCapabilities = {
    streaming: false,
    batch: true,
    providerManagedCapture: false,
    externalAudioInput: false,
    local: true,
    requiresNetwork: false,
    requiresApiKey: false,
  };
  readonly privacy: ProviderPrivacy = {
    local: true,
    requiresNetwork: false,
    // Audio leaves the browser only as a same-origin POST to the console's own
    // bounded /api/voice/transcribe endpoint (the server runs the model).
    audioLeavesDevice: false,
    textLeavesDevice: false,
  };
  readonly notes = [
    'On-device speech.cpp on the Console PC; no external service.',
    'Requires owner-enabled setup (Windows x64 + Vulkan loader).',
    'Audio is sent only to this console server for one transcription.',
  ];
  private status: SpeechPublicStatus | undefined;
  constructor(private readonly deps: SpeechCppProviderDeps = {}) {}

  /** Cheap availability: browser capture stack + an enabled local service. */
  isAvailable(): boolean {
    const status = this.deps.statusOverride ?? this.status;
    if (!status?.enabled) return false;
    if (typeof navigator === 'undefined' || typeof window === 'undefined' || !window.isSecureContext) return false;
    const mediaDevices = navigator.mediaDevices;
    return typeof mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder === 'function';
  }

  /** Public status is sanitized — refresh before starting a session. */
  async refreshStatus(): Promise<SpeechPublicStatus | undefined> {
    if (this.deps.statusOverride) { this.status = this.deps.statusOverride; return this.status; }
    const fetchImpl = this.deps.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) { this.status = undefined; return undefined; }
    try {
      const res = await fetchImpl('/api/voice/status', { cache: 'no-store' });
      const body: unknown = await res.json().catch(() => undefined);
      const s = body as Partial<SpeechPublicStatus> | undefined;
      this.status = res.ok && s?.providerId === SPEECH_CPP_PROVIDER_ID && typeof s.enabled === 'boolean' && typeof s.phase === 'string'
        ? { enabled: s.enabled, available: s.available === true, phase: s.phase as SpeechPublicStatus['phase'], ...(s.modelId ? { modelId: s.modelId } : {}), providerId: SPEECH_CPP_PROVIDER_ID }
        : undefined;
    } catch { this.status = undefined; }
    return this.status;
  }

  async healthCheck() {
    const status = await this.refreshStatus();
    return { installed: status?.enabled, running: status?.available, healthy: status?.enabled === true, detail: status?.phase };
  }

  start(options: STTStartOptions, events: STTSessionEvents): STTSession {
    // enabled-but-stopped is valid: the serve process starts lazily on the
    // first transcription from the cached model. enabled:false/unknown blocks.
    if (!this.isAvailable()) throw voiceError('STT_UNAVAILABLE', 'speech-cpp-not-enabled');
    const fetchImpl = this.deps.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) throw voiceError('STT_UNAVAILABLE', 'speech-cpp-fetch-unavailable');
    let epoch = 0, media: Media | undefined, cancelled = false;
    const live = (token: number) => token === epoch && !cancelled;
    const fail = (token: number, code: Parameters<typeof voiceError>[0], detail?: string) => {
      if (live(token)) { cancelled = true; events.onError?.(voiceError(code, detail)); }
    };
    const aborts = new Set<AbortController>();

    const open = async (token: number) => {
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (cause) {
        const name = (cause as { name?: string })?.name;
        fail(token, name === 'NotAllowedError' || name === 'SecurityError' ? 'MIC_PERMISSION_DENIED' : 'MIC_UNAVAILABLE', name);
        return;
      }
      // Permission may resolve after the user already cancelled — stop the
      // granted tracks immediately instead of leaving a live mic.
      if (!live(token)) { for (const track of stream.getTracks()) track.stop(); return; }
      let recorder: MediaRecorder;
      try {
        const mime = pickRecorderMime(MediaRecorder);
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch { for (const track of stream.getTracks()) track.stop(); fail(token, 'MIC_UNAVAILABLE', 'recorder-constructor'); return; }
      const chunks: Blob[] = [];
      let done: (blob: Blob) => void;
      const finished = new Promise<Blob>(resolve => { done = resolve; });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      // Tracks stop as part of recorder teardown — recording end always
      // releases the microphone even when stop() raced an abort.
      recorder.onstop = () => { for (const track of stream.getTracks()) track.stop(); done!(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })); };
      recorder.onerror = () => fail(token, 'STT_FAILED', 'recorder-error');
      media = { stream, recorder, done: finished };
      try { recorder.start(250); } catch { for (const track of stream.getTracks()) track.stop(); fail(token, 'STT_FAILED', 'recorder-start'); return; }
      events.onStart?.();
    };
    void open(epoch);

    const finish = async (blob: Blob) => {
      const mine = epoch;
      processing = true;
      events.onProcessing?.();
      try {
        if (blob.size === 0 || blob.size > SPEECH_MAX_RECORDED_BYTES) throw voiceError('STT_FAILED', 'recording-bounds');
        const raw = await blob.arrayBuffer();
        let wav: ArrayBuffer;
        if (this.deps.decode && this.deps.render) {
          const decoded = await this.deps.decode(raw);
          wav = encodeWavPcm16(await this.deps.render(decoded));
        } else {
          const context = new AudioContext();
          try { wav = await audioBufferToSpeechWav(await context.decodeAudioData(raw)); }
          finally { void context.close().catch(() => {}); }
        }
        if (!live(mine)) return;
        if (wav.byteLength > SPEECH_MAX_WAV_BYTES) throw voiceError('STT_FAILED', 'wav-bounds');
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), SPEECH_TRANSCRIBE_TIMEOUT_MS);
        aborts.add(ac);
        try {
          const res = await fetchImpl('/api/voice/transcribe', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ audioBase64: wavToBase64(wav), language: options.language ?? 'auto' }),
            signal: ac.signal,
          });
          const body: unknown = await res.json().catch(() => undefined);
          if (!live(mine)) return;
          const result = body as Partial<SpeechTranscribeResult> | undefined;
          if (!res.ok) {
            const code = (body as { error?: string } | undefined)?.error;
            cancelled = true;
            events.onError?.(voiceError(code === 'speech_busy' ? 'STT_UNAVAILABLE' : 'STT_FAILED', code ?? `http-${res.status}`));
            return;
          }
          if (result?.providerId !== SPEECH_CPP_PROVIDER_ID || typeof result.text !== 'string') {
            cancelled = true;
            events.onError?.(voiceError('STT_FAILED', 'invalid-result'));
            return;
          }
          if (!result.text.trim()) {
            // An empty transcript is not a successful dictation — surface it
            // as no-speech so nothing blank is ever inserted.
            cancelled = true;
            events.onError?.(voiceError('STT_FAILED', 'no-speech'));
            return;
          }
          events.onTranscript?.({ text: result.text, isFinal: true, providerId: this.id, language: result.language ?? options.language });
          events.onEnd?.();
        } finally { clearTimeout(timeout); aborts.delete(ac); }
      } catch (cause) {
        if (!live(mine)) return;
        cancelled = true;
        const detail = (cause as { detail?: string; name?: string })?.detail ?? (cause as { name?: string })?.name;
        const aborted = (cause as { name?: string })?.name === 'AbortError';
        events.onError?.(voiceError(aborted ? 'STT_TIMEOUT' : 'STT_FAILED', aborted ? 'transcribe-timeout' : detail ?? 'transcribe-failed'));
      }
    };

    let processing = false;
    return {
      stop: () => {
        if(cancelled||processing)return;
        // Stop while permission is pending must retire capture immediately;
        // a later permission grant is cleaned up without ever recording.
        if(!media){cancelled=true;epoch++;events.onEnd?.();return;}
        if (media.recorder.state === 'inactive') return;
        try { media.recorder.stop(); } catch { /* already stopped */ }
        void media.done.then(blob => { if (live(epoch)) void finish(blob); });
      },
      detach: () => { cancelled = true; },
      abort: () => {
        cancelled = true; epoch++;
        if (media && media.recorder.state !== 'inactive') try { media.recorder.stop(); } catch { /* already stopped */ }
        // Recorder.onstop stops tracks, but abort must not wait for it.
        if (media) for (const track of media.stream.getTracks()) track.stop();
        for (const ac of aborts) ac.abort();
      },
    };
  }
}
