// Settings Voice-tab setup routing. Detects — heuristically only — whether this
// browser runs on the Console PC: fetch the authenticated descriptor, call the
// literal loopback probe it names and require the SAME per-process instance id
// back. Any deviation (blocked, timeout, mismatch, unexpected URL shape) falls
// back to the in-page guide; nothing is redirected on server say-so alone.
import type { SpeechSetupDescriptor, SpeechLocalProbeResult } from '../shared/speech.ts';

export type SpeechSetupResolution =
  | { kind: 'local'; setupUrl: string }
  | { kind: 'fallback'; manualUrl?: string };

const HEX_ID = /^[0-9a-f]{64}$/;
const PROBE_TIMEOUT_MS = 1500;
const DESCRIPTOR_TIMEOUT_MS = 5000;

/**
 * Strict literal validation: only exact http://127.0.0.1:<port>/<path> URLs are
 * ever navigated to or fetched — no credentials, query, hash, redirects or
 * arbitrary loopback/ports.
 */
function literalUrl(value: unknown, port: number, path: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value !== `http://127.0.0.1:${port}${path}`) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== String(port) || url.pathname !== path || url.search || url.hash || url.username || url.password) return undefined;
    return value;
  } catch { return undefined; }
}

const parseDescriptor = (value: unknown): { id: string; probe: string; setup: string } | undefined => {
  const d = value as SpeechSetupDescriptor | undefined;
  if (!d || typeof d !== 'object' || !HEX_ID.test(d.instanceId ?? '') || !Number.isInteger(d.consolePort) || d.consolePort < 1 || d.consolePort > 65535) return undefined;
  const probe = literalUrl(d.probeUrl, d.consolePort, '/api/voice/local-probe');
  const setup = literalUrl(d.setupUrl, d.consolePort, '/voice-setup/');
  return probe && setup ? { id: d.instanceId, probe, setup } : undefined;
};

async function timedJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ac.abort(); reject(new Error('speech_setup_timeout')); }, timeoutMs);
  });
  try {
    // Keep the deadline until the body is consumed, not just until headers
    // arrive. A stalled loopback listener must not strand the settings page.
    return await Promise.race([deadline, (async () => {
      const response = await fetch(url, { ...init, signal: ac.signal });
      return response.ok ? await response.json() : undefined;
    })()]);
  } finally { clearTimeout(timer); }
}

/**
 * Resolve where this device's Voice setup should continue. No redirect is ever
 * produced unless the descriptor parses literally AND the loopback probe —
 * called with no credentials, no cache, no redirects, bounded by an
 * AbortController timer — echoes the exact same instance id. When the page
 * itself is already on a loopback hostname the probe is still required: a bare
 * localhost URL is never trusted as proof of the same process.
 */
export async function resolveSpeechSetup(): Promise<SpeechSetupResolution> {
  let descriptor: { id: string; probe: string; setup: string } | undefined;
  try {
    descriptor = parseDescriptor(await timedJson('/api/voice/setup', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' }, DESCRIPTOR_TIMEOUT_MS));
  } catch { descriptor = undefined; }
  // On every failure the already-validated literal setup URL may still be
  // offered as a manual option — it was checked character-for-character, never
  // taken on trust from the JSON body.
  if (!descriptor) return { kind: 'fallback' };
  const manual = { kind: 'fallback' as const, manualUrl: descriptor.setup };
  try {
    const body = await timedJson(descriptor.probe, { credentials: 'omit', cache: 'no-store', redirect: 'error', mode: 'cors' }, PROBE_TIMEOUT_MS) as SpeechLocalProbeResult | undefined;
    // Same-instance equality is the only "this is the Console PC" signal.
    if (body?.instanceId !== descriptor.id) return manual;
    return { kind: 'local', setupUrl: descriptor.setup };
  } catch { return manual; }
}
