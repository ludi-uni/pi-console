// Fakes for speech.cpp service tests — no network, no real processes, no real
// executables. Every external effect is recorded and controllable.
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SpeechDeps, SpeechFetchResponse, SpeechSpawnedProcess } from '../../server/speech-cpp.ts';

export interface SpawnCall { file: string; args: string[]; options: any }
export class FakeProcess extends EventEmitter implements SpeechSpawnedProcess {
  pid = 4242;
  exitCode: number | null = null;
  killed = false;
  stdinText='';
  stdin=new Writable({write:(chunk,_encoding,done)=>{this.stdinText+=chunk.toString('utf8');done();}});
  stdout = new EventEmitter() as any;
  stderr = new EventEmitter() as any;
  constructor(private readonly script: (p: FakeProcess) => void) { super(); queueMicrotask(() => this.script(this)); }
  kill() { this.killed = true; if (this.exitCode === null) { this.exitCode = 0; this.emit('exit', 0); this.emit('close',0); } }
  finish(code = 0, stdout = '', stderr = '') {
    if (stdout) this.stdout.emit('data', Buffer.from(stdout));
    if (stderr) this.stderr.emit('data', Buffer.from(stderr));
    this.exitCode = code; this.emit('exit', code); this.emit('close',code);
  }
}

export interface FakeSpawnSpec {
  /** match file + args prefix */
  match: (file: string, args: string[]) => boolean;
  run: (p: FakeProcess, call: SpawnCall) => void;
}
export function fakeSpawn(specs: FakeSpawnSpec[]) {
  const calls: SpawnCall[] = [];
  const spawn = (file: string, args: string[], options: any): SpeechSpawnedProcess => {
    const call: SpawnCall = { file, args, options };
    calls.push(call);
    const spec = specs.find(s => s.match(file, args));
    if (!spec) return new FakeProcess(p => queueMicrotask(() => p.finish(1, '', `no fake for ${file} ${args.join(' ')}`)));
    return new FakeProcess(p => {void Promise.resolve(spec.run(p, call)).catch(error=>p.finish(1,'',String(error)));});
  };
  return { spawn, calls };
}

export function versionSpec(stdout = 'speech.cpp 0.9.0, C API 3.4'): FakeSpawnSpec {
  return { match: (f, a) => f.endsWith('.exe') && a[0] === '--version', run: p => p.finish(0, stdout) };
}
export function modelsSpec(files: Record<string, string[]>): FakeSpawnSpec {
  return {
    match: (f, a) => f.endsWith('.exe') && a[0] === 'models',
    run: (p, call) => {
      const dir = call.options.env.SPEECH_MODEL_DIR;
      const models = Object.entries(files).map(([name, paths]) => ({ name, files: paths.map(path => ({ path, fetched:true, type:'Q8_0' })) }));
      p.finish(0, JSON.stringify({ directory: dir, models }));
    },
  };
}
export function pullSpec(modelId: string, gguf: string): FakeSpawnSpec {
  return { match: (f, a) => f.endsWith('.exe') && a[0] === 'pull' && a[1] === modelId, run: p => p.finish(0, `fetching\n${gguf}\n`) };
}
export function pullFailSpec(): FakeSpawnSpec {
  return { match: (f, a) => f.endsWith('.exe') && a[0] === 'pull', run: p => p.finish(1, '', 'download failed') };
}
export function extractSpec(): FakeSpawnSpec {
  return { match: (f, a) => f.endsWith('powershell.exe') && a.includes('-EncodedCommand'), run: p => p.finish(0) };
}
export function extractFailSpec(): FakeSpawnSpec {
  return { match: (f, a) => f.endsWith('powershell.exe'), run: p => p.finish(1, '', 'traversal') };
}

export interface FetchCall { url: string; init: any }
export function fakeFetch(handlers: Array<{ match: (url: string) => boolean; respond: (call: FetchCall) => Promise<SpeechFetchResponse> | SpeechFetchResponse }>) {
  const calls: FetchCall[] = [];
  const fetch = async (url: string, init: any): Promise<SpeechFetchResponse> => {
    const call: FetchCall = { url, init };
    calls.push(call);
    const h = handlers.find(x => x.match(url));
    if (!h) return { ok: false, status: 599, json: async () => ({}), text: async () => '', bytes: async () => new Uint8Array() };
    return h.respond(call);
  };
  return { fetch, calls };
}
const noHeaders = { get: () => null };
export const jsonResponse = (v: unknown, status = 200): SpeechFetchResponse => ({ ok: status < 300, status, headers: noHeaders, json: async () => v, text: async () => JSON.stringify(v), bytes: async () => new Uint8Array() });
export const textResponse = (v: string, status = 200): SpeechFetchResponse => ({ ok: status < 300, status, headers: noHeaders, json: async () => JSON.parse(v), text: async () => v, bytes: async () => new TextEncoder().encode(v) });
export const bytesResponse = (v: Uint8Array, status = 200): SpeechFetchResponse => ({ ok: status < 300, status, headers: noHeaders, json: async () => ({}), text: async () => '', bytes: async () => v });
export const redirectResponse = (location: string, status = 302): SpeechFetchResponse => ({ ok: false, status, headers: { get: (n: string) => n.toLowerCase() === 'location' ? location : null }, json: async () => ({}), text: async () => '', bytes: async () => new Uint8Array() });

export const RELEASE_URL = 'https://api.github.com/repos/nyosegawa/speech.cpp/releases/latest';
/** Realistic full GitHub Releases API shape — extra fields must be ignored, never rejected. */
export function releaseJson(zipBytes: Uint8Array, opts: { digest?: boolean; sums?: boolean; wrongUrl?: boolean } = { digest: true }) {
  const sha = createHash('sha256').update(zipBytes).digest('hex');
  const base = 'https://github.com/nyosegawa/speech.cpp/releases/download/v0.9.0';
  const assets: any[] = [{
    name: 'speech-0.9.0-windows-x64-vulkan.zip',
    url: 'https://api.github.com/repos/nyosegawa/speech.cpp/releases/assets/1',
    id: 1, node_id: 'RA_1', label: null, state: 'uploaded',
    content_type: 'application/zip', size: zipBytes.length, download_count: 5,
    created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z',
    browser_download_url: opts.wrongUrl ? 'https://github.com/evil/speech.cpp/releases/download/v0.9.0/speech-0.9.0-windows-x64-vulkan.zip' : `${base}/speech-0.9.0-windows-x64-vulkan.zip`,
    ...(opts.digest !== false ? { digest: `sha256:${sha}` } : {}),
    uploader: { login: 'nyosegawa', id: 1 },
  },
  { name: 'speech-0.9.0-linux-x64-cpu.zip', browser_download_url: `${base}/speech-0.9.0-linux-x64-cpu.zip`, digest: `sha256:${'a'.repeat(64)}` },
  { name: 'speech-0.9.0-macos-arm64-metal.zip', browser_download_url: `${base}/speech-0.9.0-macos-arm64-metal.zip`, digest: `sha256:${'b'.repeat(64)}` }];
  if (opts.sums) assets.push({ name: 'SHA256SUMS', id: 2, browser_download_url: `${base}/SHA256SUMS` });
  return {
    url: 'https://api.github.com/repos/nyosegawa/speech.cpp/releases/1', id: 1, node_id: 'R_1',
    tag_name: 'v0.9.0', target_commitish: 'main', name: 'v0.9.0', draft: false, prerelease: false,
    created_at: '2026-10-26T00:00:00Z', published_at: '2026-10-26T00:00:00Z',
    author: { login: 'nyosegawa', id: 1 }, body: 'release notes',
    tarball_url: 'https://api.github.com/repos/nyosegawa/speech.cpp/tarball/v0.9.0',
    zipball_url: 'https://api.github.com/repos/nyosegawa/speech.cpp/zipball/v0.9.0',
    assets,
  };
}
export const FAKE_ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(64).fill(0)]);
export const sha256 = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');

/** Build a fake serve process that announces Ready on stderr then stays alive. */
export function serveSpec(port = 45999, opts: { exit?: number; ready?: boolean } = {}): FakeSpawnSpec {
  return {
    match: (f, a) => f.endsWith('.exe') && a[0] === 'serve',
    run: p => {
      if (opts.exit !== undefined) { p.finish(opts.exit); return; }
      if (opts.ready !== false) p.stderr.emit('data', Buffer.from(`Ready at http://127.0.0.1:${port}/\nAPI at http://127.0.0.1:${port}/v1\n`));
      // stays alive until killed
    },
  };
}

/** Minimal WAV builder: 16 kHz mono 16-bit PCM. */
export function wavBytes(seconds = 0.5, opts: { rate?: number; channels?: number; bits?: number; format?: number } = {}): Buffer {
  const rate = opts.rate ?? 16000, channels = opts.channels ?? 1, bits = opts.bits ?? 16;
  const samples = Math.floor(seconds * rate) * channels;
  const data = Buffer.alloc(samples * (bits / 8));
  const byteRate = rate * channels * (bits / 8), blockAlign = channels * (bits / 8);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(opts.format ?? 1, 0); fmt.writeUInt16LE(channels, 2); fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(byteRate, 8); fmt.writeUInt16LE(blockAlign, 12); fmt.writeUInt16LE(bits, 14);
  const size = 4 + (8 + fmt.length) + (8 + data.length);
  const head = Buffer.alloc(12); head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(size, 4); head.write('WAVE', 8, 'ascii');
  const fmtH = Buffer.alloc(8); fmtH.write('fmt ', 0, 'ascii'); fmtH.writeUInt32LE(fmt.length, 4);
  const dataH = Buffer.alloc(8); dataH.write('data', 0, 'ascii'); dataH.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, fmtH, fmt, dataH, data]);
}

export async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-console-speech-'));
  await mkdir(join(dir, 'voice'), { recursive: true });
  return dir;
}
export async function writeSettings(dataDir: string, value: unknown) {
  await writeFile(join(dataDir, 'voice', 'settings.json'), JSON.stringify(value));
}
export async function placeExe(path: string) { await mkdir(join(path, '..'), { recursive: true }).catch(() => {}); await writeFile(path, 'MZ'); }

export function platformDeps(extra: Partial<SpeechDeps> = {}): SpeechDeps {
  return { platform: 'win32', arch: 'x64', ...extra };
}
