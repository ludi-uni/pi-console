// WAV helpers for the speech.cpp local STT provider.
//
// Capture produces whatever MediaRecorder yields (Opus in WebM/MP4/Ogg); the
// speech.cpp backend accepts only 16 kHz mono 16-bit PCM WAV and rejects
// anything else, so normalization happens here: decodeAudioData →
// OfflineAudioContext resample at exactly 16 kHz → PCM16 WAV encode.
// All steps are bounded — recording duration, decoded size and the final clip.

export const SPEECH_WAV_RATE = 16000;
export const SPEECH_MAX_SECONDS = 60;
export const SPEECH_MAX_WAV_BYTES = SPEECH_MAX_SECONDS * SPEECH_WAV_RATE * 2 + 44;

/** Encode bounded mono 16 kHz Float32 samples into a canonical PCM16 WAV. */
export function encodeWavPcm16(samples: Float32Array, rate = SPEECH_WAV_RATE): ArrayBuffer {
  const frames = Math.min(samples.length, SPEECH_MAX_SECONDS * rate);
  const out = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(out);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return out;
}

/**
 * Decode an arbitrary recorded blob and resample to mono 16 kHz PCM16 WAV.
 * The OfflineAudioContext does resampling and downmix natively; output is
 * hard-clipped to 60 s so the backend limit can never be exceeded.
 */
export async function blobToSpeechWav(blob: Blob): Promise<ArrayBuffer> {
  const raw = await blob.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(raw);
    return await audioBufferToSpeechWav(decoded);
  } finally {
    // The decode context is temporary — always release the audio thread.
    void context.close().catch(() => {});
  }
}

/** Resample an already-decoded AudioBuffer to the fixed speech WAV shape. */
export async function audioBufferToSpeechWav(decoded: AudioBuffer): Promise<ArrayBuffer> {
  const seconds = Math.min(decoded.duration, SPEECH_MAX_SECONDS);
  const frames = Math.max(1, Math.ceil(seconds * SPEECH_WAV_RATE));
  const offline = new OfflineAudioContext(1, frames, SPEECH_WAV_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return encodeWavPcm16(rendered.getChannelData(0));
}

/** Bounded base64 for JSON transport (chunked to avoid arg-length limits). */
export function wavToBase64(wav: ArrayBuffer): string {
  const bytes = new Uint8Array(wav);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
