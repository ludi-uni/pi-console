// HTTP boundary for the speech.cpp local STT service.
//
// Owner routes live under /local-owner/voice/* and are composed through the
// local-owner bootstrap's `settings` callback, so they inherit the loopback
// listener, no-proxy, literal host/origin and owner-session-cookie boundary.
// Public routes under /api/voice/* are sanitized metadata and one bounded
// transcription endpoint — never a path, port, log line or management action.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody } from './body.ts';
import { PermissionFault, strictPermissionObject } from './workspace-permissions.ts';
import type { SpeechCppService } from './speech-cpp.ts';
import { speechLimits } from './speech-cpp.ts';
import type { SpeechPublicStatus, SpeechTranscribeResult } from '../shared/speech.ts';
import { SPEECH_CPP_PROVIDER_ID } from '../shared/speech.ts';

const send = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
};
const fail = (code: string): never => { throw new PermissionFault(code); };

// WAV validation: RIFF/WAVE, fmt PCM mono 16-bit at 16 kHz, data ≤ ~60 s.
export function parseSpeechWav(bytes: Buffer): { pcm: Buffer; seconds: number } {
  if (bytes.length < 44 || bytes.length > speechLimits.MAX_AUDIO_BYTES + 44) fail('speech_audio_invalid');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') fail('speech_audio_invalid');
  // Canonical files only: the RIFF size field must cover the rest of the buffer
  // exactly (trailing bytes or a padded container make upstream interpretation ambiguous).
  const riffSize = bytes.readUInt32LE(4);
  if (riffSize !== bytes.length - 8) fail('speech_audio_invalid');
  let offset = 12, fmt: { audio: number; channels: number; rate: number; bits: number; byteRate: number; blockAlign: number } | undefined, data: Buffer | undefined;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), body = offset + 8;
    if (body + size > bytes.length) fail('speech_audio_invalid');
    if (id === 'fmt ') {
      if (fmt || size < 16) fail('speech_audio_invalid');
      fmt = { audio: bytes.readUInt16LE(body), channels: bytes.readUInt16LE(body + 2), rate: bytes.readUInt32LE(body + 4), byteRate: bytes.readUInt32LE(body + 8), blockAlign: bytes.readUInt16LE(body + 12), bits: bytes.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (data) fail('speech_audio_invalid');
      data = bytes.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) fail('speech_audio_invalid');
  const f = fmt as { audio: number; channels: number; rate: number; bits: number; byteRate: number; blockAlign: number }, pcm = data as Buffer;
  if (f.audio !== 1 || f.channels !== 1 || f.rate !== 16000 || f.bits !== 16) fail('speech_audio_format');
  if (f.byteRate !== f.rate * f.channels * (f.bits / 8) || f.blockAlign !== f.channels * (f.bits / 8)) fail('speech_audio_invalid');
  if (pcm.length === 0 || pcm.length % 2 !== 0 || pcm.length > speechLimits.MAX_AUDIO_BYTES) fail('speech_audio_invalid');
  const seconds = pcm.length / 2 / 16000;
  if (seconds > speechLimits.MAX_AUDIO_SECONDS) fail('speech_audio_too_long');
  return { pcm: Buffer.from(pcm), seconds };
}

const BCP47 = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/;
export function speechLanguage(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (v === 'auto') return 'auto';
  if (typeof v !== 'string' || v.length > 32 || !BCP47.test(v)) fail('invalid_arguments');
  // speech.cpp wants bare ISO codes; map the BCP-47 primary tag.
  const lower = (v as string).toLowerCase();
  return lower.split('-')[0];
}

export interface SpeechHttpOptions {
  service: SpeechCppService;
  /**
   * Owner boundary authorization — composed lazily from the local-owner
   * bootstrap. Runs the full native boundary check once, then returns a lease
   * guard that re-validates the session record (alive, unexpired) rather than
   * the request socket, so long-running install/start jobs survive keepalive
   * closes while session logout/expiry still revokes mid-job.
   */
  authorize: (req: IncomingMessage) => (() => void) | undefined;
  /** Optional expiry hook for owner-side job review (mirrors folder pattern). */
  ownerExpiry?: (req: IncomingMessage) => number | undefined;
}

export function createSpeechHttp(options: SpeechHttpOptions) {
  const { service } = options;
  const OWNER = '/local-owner/voice/', PUBLIC = '/api/voice/';

  /** Owner routes — must be composed inside the local-owner listener (which already enforces the native boundary). */
  async function handleOwner(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? '';
    if (!url.startsWith(OWNER)) return false;
    try {
      if (url.includes('?') || req.method !== 'POST') { req.resume(); send(res, 404, {}); return true; }
      const route = url.slice(OWNER.length);
      // Full boundary check once; the returned lease guards the async job.
      const lease = options.authorize(req);
      if (!lease) throw new PermissionFault('owner_session_expired');
      const assert = lease;
      assert();
      const body = await readJsonBody(req, 8192);
      let result: unknown;
      if (route === 'status') { strictPermissionObject(body, []); result = service.ownerStatus(); }
      else if (route === 'enable') { const r = await service.enable(body, assert); result = { ...service.ownerStatus(), accepted: r.accepted, job: r.job }; }
      else if (route === 'disable') { strictPermissionObject(body, []); await service.disable(assert); result = service.ownerStatus(); }
      else if (route === 'cancel') { strictPermissionObject(body, []); await service.cancel(assert); result = service.ownerStatus(); }
      else if (route === 'start') { strictPermissionObject(body, []); const r = await service.start(assert); result = { ...service.ownerStatus(), accepted: r.accepted, job: r.job }; }
      else throw new PermissionFault('speech_route_unavailable');
      assert();
      send(res, route === 'enable' || route === 'start' ? 202 : 200, result);
    } catch (e) {
      req.resume();
      send(res, e instanceof PermissionFault && e.code === 'speech_route_unavailable' ? 404 : 409, { error: e instanceof PermissionFault ? e.code : 'speech_request_unavailable' });
    }
    return true;
  }

  /** Public routes — sanitized status + bounded transcribe. Reachable per existing global access/POST checks. */
  async function handlePublic(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(PUBLIC)) return false;
    try {
      if (req.method === 'GET' && url.pathname === '/api/voice/status') {
        const s = service.publicStatus();
        const sanitized: SpeechPublicStatus = { enabled: s.enabled, available: s.available, phase: s.phase, ...(s.modelId ? { modelId: s.modelId } : {}), providerId: SPEECH_CPP_PROVIDER_ID };
        send(res, 200, sanitized);
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/voice/transcribe') {
        const body = await readJsonBody(req, speechLimits.MAX_TRANSCRIBE_BODY);
        strictPermissionObject(body, ['audioBase64', 'language'].filter(k => Object.hasOwn(body as object, k)));
        const b = body as { audioBase64?: unknown; language?: unknown };
        const audioBase64: unknown = b.audioBase64;
        if (typeof audioBase64 !== 'string' || audioBase64.length > speechLimits.MAX_TRANSCRIBE_BODY) fail('speech_audio_invalid');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64 as string) || (audioBase64 as string).length % 4 !== 0) fail('speech_audio_invalid');
        const wav = Buffer.from(audioBase64 as string, 'base64');
        if (wav.length === 0 || wav.length > speechLimits.MAX_AUDIO_BYTES + 44) fail('speech_audio_invalid');
        parseSpeechWav(wav);
        const language = speechLanguage(b.language);
        const ac = new AbortController();
        // Abort the upstream request only when the client connection dies mid-
        // flight — req 'close' also fires on normal body consumption, so watch
        // the response instead and never detach listeners we did not add.
        const onClose = () => { if (!res.writableEnded) ac.abort(); };
        res.once('close', onClose);
        try {
          const out = await service.transcribe(wav, language, ac.signal);
          const result: SpeechTranscribeResult = { text: out.text, providerId: SPEECH_CPP_PROVIDER_ID, ...(out.language ? { language: out.language } : {}) };
          send(res, 200, result);
        } finally { res.removeListener('close', onClose); }
        return true;
      }
      req.resume();
      send(res, 404, { error: 'not found' });
    } catch (e) {
      req.resume();
      send(res, e instanceof PermissionFault && (e.code === 'speech_audio_invalid' || e.code === 'speech_audio_format' || e.code === 'speech_audio_too_long' || e.code === 'invalid_arguments') ? 400
        : e instanceof PermissionFault && e.code === 'speech_busy' ? 409
        : e instanceof PermissionFault && e.code === 'speech_not_enabled' ? 409 : 400,
        { error: e instanceof PermissionFault ? e.code : 'speech_request_unavailable' });
    }
    return true;
  }

  return { handleOwner, handlePublic };
}
export type SpeechHttp = ReturnType<typeof createSpeechHttp>;
