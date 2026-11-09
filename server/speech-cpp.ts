// speech.cpp local STT service — owned runtime/process lifecycle.
//
// Hard boundaries enforced here:
// - Managed install is Windows x64 only, from the official GitHub release, into
//   <dataDir>/voice/speech-cpp. The release asset digest (asset `digest` field or
//   the release SHA256SUMS file) is verified before extraction; archives are
//   extracted through a fixed PowerShell stdin script that only writes
//   allowlisted flat file names, with entry/size/count/symlink/traversal checks.
// - Existing executables must be regular .exe files on a local fixed drive —
//   no UNC paths, no ADS, no relative paths, no shell interpretation — and are
//   adopted only after `speech.exe --version` (shell:false, bounded output,
//   timeout) reports a speech.cpp version.
// - The model directory is either the managed default inside the dataDir or an
//   explicitly adopted existing cache (SPEECH_MODEL_DIR). serve always gets a
//   raw absolute GGUF path; the child is never allowed to auto-fetch models.
// - The serve child binds 127.0.0.1 on an ephemeral port (--port 0); the real
//   port is parsed only from the stderr `Ready at http://127.0.0.1:<port>/`
//   line and must be loopback. Health and /v1/models plus child-liveness are
//   verified before 'ready'. Only owned children are ever stopped.
// - Nothing here runs on settings load: `load()` only reads the atomic
//   settings file. Downloads require allowDownload:true per enable request.
//
// All external effects (fetch, spawn, process listing, PowerShell, platform)
// are injected so tests never touch the network, real executables or real
// processes.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { PermissionFault, strictPermissionObject } from './workspace-permissions.ts';
import type { SpeechEnableRequest, SpeechJobState, SpeechModelId, SpeechOwnerStatus, SpeechPhase } from '../shared/speech.ts';
import { speechModelId, SPEECH_DEFAULT_MODEL } from '../shared/speech.ts';

const fault = (code: string): never => { throw new PermissionFault(code); };
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  if (signal?.aborted) return rej(new PermissionFault('speech_cancelled'));
  const onAbort=()=>{clearTimeout(t);signal?.removeEventListener('abort',onAbort);rej(new PermissionFault('speech_cancelled'));};
  const t=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);res();},ms);
  signal?.addEventListener('abort',onAbort,{once:true});
});

// ---------------------------------------------------------------------------
// Injected seams

export interface SpeechSpawnedProcess {
  pid?: number;
  exitCode: number | null;
  killed: boolean;
  stdin?: NodeJS.WritableStream | null;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  kill(signal?: string): void;
  once(event: 'exit' | 'close' | 'spawn' | 'error', listener: (...args: any[]) => void): unknown;
  on?(event: string, listener: (...args: any[]) => void): unknown;
}
export type SpeechSpawn = (file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean; windowsHide?: boolean; stdio?: any }) => SpeechSpawnedProcess;
export const defaultSpawn: SpeechSpawn = (file, args, options) => spawn(file, args, { shell: false, windowsHide: true, ...options }) as unknown as SpeechSpawnedProcess;

export interface SpeechFetchResponse {
  ok: boolean; status: number;
  headers?: { get(name: string): string | null };
  /** Bounded body reads: callers pass a byte cap; oversize aborts the stream. */
  json(limit?: number): Promise<unknown>;
  text(limit?: number): Promise<unknown>;
  bytes(limit?: number): Promise<Uint8Array>;
}
export type SpeechFetch = (url: string, init: { signal: AbortSignal; redirect?: 'error' | 'follow' | 'manual'; headers?: Record<string, string>; method?: string; body?: unknown }) => Promise<SpeechFetchResponse>;
const MAX_METADATA_BYTES = 1024 * 1024;
/** Stream the body with a hard byte cap — never buffer the full payload first.
 * Content-Length above the cap rejects before a single chunk is read. */
async function boundedBody(r: Response, cap: number): Promise<Buffer> {
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > cap) throw new PermissionFault('speech_response_too_large');
  if (!r.body) return Buffer.alloc(0);
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) { await reader.cancel().catch(() => {}); throw new PermissionFault('speech_response_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}
export const defaultFetch: SpeechFetch = async (url, init) => {
  const r = await fetch(url, init as RequestInit);
  return {
    ok: r.ok, status: r.status, headers: r.headers,
    json: async (limit = MAX_METADATA_BYTES) => JSON.parse((await boundedBody(r, limit)).toString('utf8')),
    text: async (limit = MAX_METADATA_BYTES) => (await boundedBody(r, limit)).toString('utf8'),
    bytes: async (limit = MAX_ZIP_BYTES + 1) => new Uint8Array(await boundedBody(r, limit)),
  };
};

export interface SpeechDeps {
  spawn?: SpeechSpawn;
  fetch?: SpeechFetch;
  now?: () => number;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Existing executables must resolve inside one of these roots (never applied to managed paths). */
  allowedExistingRoots?: readonly string[];
  /**
   * Stops an owned process AND its whole child tree — speech.exe pulls spawn a
   * system curl child which would otherwise keep downloading after cancel.
   * Only ever called with a PID this service spawned; never port-derived or
   * foreign PIDs. Default: fixed `taskkill /PID <pid> /T /F` (validated int).
   */
  killTree?: (pid: number) => Promise<void>;
  /** Test hook: fake running speech serve processes on the host. */
  listRunningServePids?: () => Promise<number[]>;
}

// ---------------------------------------------------------------------------
// Release metadata (official API shape, strict subset)

const RELEASE_API = 'https://api.github.com/repos/nyosegawa/speech.cpp/releases/latest';
const WIN_ASSET = /^speech-(\d+\.\d+\.\d+)-windows-x64-vulkan\.zip$/;
const ALLOWED_ZIP_ENTRIES = new Set(['speech.exe', 'speech.dll', 'speech.lib', 'speech.h']);
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 16;
const MAX_ZIP_EXPANDED = 300 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const MODEL_PULL_TIMEOUT_MS = 30 * 60 * 1000;
const SERVE_START_TIMEOUT_MS = 120 * 1000;
const TRANSCRIBE_TIMEOUT_MS = 90 * 1000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 60;
const MAX_TRANSCRIBE_BODY = 3 * 1024 * 1024;
export const speechLimits = { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, MAX_TRANSCRIBE_BODY, TRANSCRIBE_TIMEOUT_MS, SERVE_START_TIMEOUT_MS };

interface ReleaseAsset { name: string; digest?: string; browser_download_url: string }
interface ReleaseInfo { tag: string; version: string; asset: ReleaseAsset; sha256: string }

const RELEASE_DOWNLOAD = 'https://github.com/nyosegawa/speech.cpp/releases/download';
function parseRelease(raw: unknown): ReleaseInfo & { sums?: ReleaseAsset } {
  // External metadata: pick required fields only; extra GitHub API keys are ignored.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fault('speech_release_unavailable');
  const tag = (raw as any).tag_name;
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag)) fault('speech_release_unavailable');
  const version = tag.slice(1);
  const assets = (raw as any).assets;
  if (!Array.isArray(assets)) fault('speech_release_unavailable');
  const zipName = `speech-${version}-windows-x64-vulkan.zip`;
  const zipUrl = `${RELEASE_DOWNLOAD}/${tag}/${zipName}`;
  const sumsUrl = `${RELEASE_DOWNLOAD}/${tag}/SHA256SUMS`;
  let asset: ReleaseAsset | undefined, sums: ReleaseAsset | undefined;
  for (const a of assets) {
    if (!a || typeof a !== 'object' || typeof a.name !== 'string') continue;
    // Asset URLs are pinned to the exact official release-download path for the
    // validated tag — no redirects, proxies or look-alike hosts are ever followed.
    if (a.name === 'SHA256SUMS' && a.browser_download_url === sumsUrl) sums = { name: a.name, browser_download_url: sumsUrl };
    if (a.name === zipName && a.browser_download_url === zipUrl)
      asset = { name: zipName, browser_download_url: zipUrl, ...(typeof a.digest === 'string' ? { digest: a.digest } : {}) };
  }
  if (!asset) fault('speech_release_asset_missing');
  const found = asset as ReleaseAsset;
  const digest = typeof found.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(found.digest) ? found.digest.slice(7) : undefined;
  return { tag, version, asset: found, sha256: digest ?? '', ...(sums ? { sums } : {}) };
}

// Strict local-executable check: absolute win32 path on a local drive letter,
// no UNC, no ADS/stream syntax, no relative segments, .exe file name only.
// Conservative char class: no shell/path metacharacters even though spawn is
// shell:false — these paths are persisted and may be reviewed by the owner.
const SAFE_SEGMENT = "^\\0<>:\"|?*;&`'$%\n\r";
const LOCAL_EXE = new RegExp(`^[A-Za-z]:[\\\\/][${SAFE_SEGMENT}]*\\.exe$`);
const LOCAL_DIR = new RegExp(`^[A-Za-z]:[\\\\/][${SAFE_SEGMENT}]*$`);
const ADS = /:(?!\\|\/)/;
export function validLocalExecutable(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 260 && LOCAL_EXE.test(path) && !ADS.test(path.slice(2)) && !path.includes('..') && !/[\u0000-\u001f]/.test(path);
}
export function validLocalDirectory(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 260 && LOCAL_DIR.test(path) && !ADS.test(path.slice(2)) && !path.includes('..') && !/[\u0000-\u001f]/.test(path);
}

// EncodedCommand accepts no trailing argv. Paths are UTF-8 JSON on stdin,
// never interpolated into script source. Validate all entries before writing
// into a fresh staging directory; publication happens only after success.
const EXTRACT_SCRIPT = `
$ErrorActionPreference='Stop';
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false);
$inputData=[Console]::In.ReadToEnd()|ConvertFrom-Json;
$zip=[string]$inputData.zip; $dest=[string]$inputData.destination;
$allowed=@('speech.exe','speech.dll','speech.lib','speech.h');
Add-Type -AssemblyName System.IO.Compression.FileSystem;
$a=[IO.Compression.ZipFile]::OpenRead($zip);
try {
  $entries=@($a.Entries); if($entries.Count -gt ${MAX_ZIP_ENTRIES}){throw 'entries'};
  $total=0; $seen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase);
  foreach($e in $entries){
    $n=$e.FullName; if($n -match '[/\\\\]' -or $n -ne [IO.Path]::GetFileName($n)){throw 'traversal'};
    if(-not $allowed.Contains($n) -or -not $seen.Add($n)){throw 'name'};
    $total+=$e.Length; if($total -gt ${MAX_ZIP_EXPANDED}){throw 'expanded'};
    $mode=($e.ExternalAttributes -shr 16) -band 0xF000;
    if($mode -ne 0 -and $mode -ne 0x8000 -or ($e.ExternalAttributes -band 0x10) -ne 0){throw 'link'};
  }
  if(-not $seen.Contains('speech.exe')){throw 'missing executable'};
  foreach($e in $entries){
    [IO.Compression.ZipFileExtensions]::ExtractToFile($e,(Join-Path $dest $e.FullName),$false);
  }
} finally { $a.Dispose() }
`;

async function runCommand(child: SpeechSpawnedProcess, timeoutMs: number, maxOutput = 8192, stop: () => Promise<void> = async () => { child.kill(); }): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    let stdout = '', stderr = '', done = false, timedOut=false;
    const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => { timedOut=true; void stop().catch(() => {}).finally(() => finish(() => reject(new PermissionFault('speech_command_timeout')))); }, timeoutMs);
    const cap = (s: string, c: Buffer) => (s + c.toString('utf8')).slice(0, maxOutput);
    child.stdout?.on?.('data', c => { stdout = cap(stdout, c); });
    child.stderr?.on?.('data', c => { stderr = cap(stderr, c); });
    child.once('error', e => finish(() => reject(e instanceof Error ? e : new PermissionFault('speech_command_failed'))));
    child.once('close', code => {if(!timedOut)finish(() => resolvePromise({ code, stdout, stderr }));});
  });
}

// ---------------------------------------------------------------------------
// Persisted settings — atomic write, read-only load (no side effects).

interface SpeechSettings {
  version: 1;
  enabled: boolean;
  source?: 'managed' | 'existing';
  executablePath?: string;
  modelDirectory?: string;
  modelId?: SpeechModelId;
  modelFile?: string;   // absolute GGUF path adopted/pulled for the selected model
  speechVersion?: string;
}
function parseSettings(raw: unknown): SpeechSettings {
  if (raw === undefined) return { version: 1, enabled: false };
  strictPermissionObject(raw, ['version', 'enabled', 'source', 'executablePath', 'modelDirectory', 'modelId', 'modelFile', 'speechVersion'].filter(k => Object.hasOwn(raw as object, k)));
  const v = raw as any;
  if (v.version !== 1 || typeof v.enabled !== 'boolean') fault('speech_settings_unavailable');
  if (v.source !== undefined && v.source !== 'managed' && v.source !== 'existing') fault('speech_settings_unavailable');
  if (v.modelId !== undefined && !speechModelId(v.modelId)) fault('speech_settings_unavailable');
  for (const k of ['executablePath', 'modelDirectory', 'modelFile', 'speechVersion']) if (v[k] !== undefined && (typeof v[k] !== 'string' || v[k].length > 1024)) fault('speech_settings_unavailable');
  return v as SpeechSettings;
}

export interface SpeechServiceOptions {
  dataDir: string;
  deps?: SpeechDeps;
}

type Job = SpeechJobState & { abort: AbortController; owner: () => void; settled: Promise<void>; committing?: boolean };

const SETTLED_DONE = new WeakSet<Job>();

export class SpeechCppService {
  private readonly voiceDir: string;
  private readonly settingsFile: string;
  private readonly installDir: string;
  private readonly managedModelDir: string;
  private settings: SpeechSettings = { version: 1, enabled: false };
  private loaded = false;
  private phase: SpeechPhase = 'off';
  private lastError?: string;
  private job?: Job;
  private serve?: { proc: SpeechSpawnedProcess; port: number; modelFile: string };
  private transcribing = false;
  private transcribeAbort?: AbortController;
  private readonly deps: Required<Omit<SpeechDeps, 'listRunningServePids' | 'allowedExistingRoots'>> & Pick<SpeechDeps, 'listRunningServePids' | 'allowedExistingRoots'>;
  private saving: Promise<unknown> = Promise.resolve();

  constructor(options: SpeechServiceOptions) {
    this.voiceDir = resolve(options.dataDir, 'voice');
    this.settingsFile = join(this.voiceDir, 'settings.json');
    this.installDir = join(this.voiceDir, 'speech-cpp');
    this.managedModelDir = join(this.voiceDir, 'models');
    this.deps = {
      spawn: options.deps?.spawn ?? defaultSpawn,
      fetch: options.deps?.fetch ?? defaultFetch,
      now: options.deps?.now ?? Date.now,
      platform: options.deps?.platform ?? process.platform,
      arch: options.deps?.arch ?? process.arch,
      listRunningServePids: options.deps?.listRunningServePids,
      allowedExistingRoots: options.deps?.allowedExistingRoots,
      killTree: options.deps?.killTree ?? (async (pid: number) => {
        if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0) return;
        const child = this.deps.spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true });
        await runCommand(child, 10000, 2048).catch(() => {});
      }),
    };
  }

  /**
   * Read persisted settings only. No network, no process, no directory creation.
   * A corrupt file must never take the whole console down: mark the feature
   * load-failed (fail-closed, original file preserved) and let the app boot.
   * Recovery requires an explicit owner re-configure (enable), not a silent rewrite.
   */
  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.settingsFile, 'utf8');
      this.settings = parseSettings(JSON.parse(raw));
      this.phase = this.settings.enabled ? 'stopped' : 'off';
      this.loaded = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.settings = { version: 1, enabled: false };
        this.phase = 'off';
        this.loaded = true;
      } else {
        this.settings = { version: 1, enabled: false };
        this.phase = 'error';
        this.lastError = 'speech_settings_unavailable';
        this.loaded = false;
      }
    }
  }

  private assertLoaded() { if (!this.loaded) fault('speech_unavailable'); }
  /** A job occupies the slot until its settled promise resolves — even after a
   * cancel marked it cancelled, its cleanup must finish before a new job starts. */
  private busy() { return this.job && !SETTLED_DONE.has(this.job) ? this.job : undefined; }

  private async save(): Promise<void> {
    const write = this.saving.then(async () => {
      await fs.mkdir(this.voiceDir, { recursive: true });
      const temp = `${this.settingsFile}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(this.settings));
      await fs.rename(temp, this.settingsFile);
    });
    this.saving = write.catch(() => {});
    await write;
  }

  private setJob(kind: Job['kind'], ownerGuard: () => void): Job {
    if (this.busy()) fault('speech_busy');
    const job: Job = { id: randomUUID(), kind, state: 'running', startedAt: this.deps.now(), abort: new AbortController(), owner: ownerGuard, settled: Promise.resolve() };
    this.job = job;
    return job;
  }
  private track(job: Job, work: Promise<void>) {
    job.settled = work.finally(() => { SETTLED_DONE.add(job); });
  }
  private endJob(job: Job, state: 'done' | 'failed' | 'cancelled', error?: string) {
    if (this.job === job) { job.state = state; if (error) job.error = error; }
  }
  /** Job-scoped guard: owner lease still valid AND this job is still the active one. */
  private guard(job: Job) {
    if (this.job !== job) fault('speech_cancelled');
    if(job.abort.signal.aborted) fault('speech_cancelled');
    job.owner();
  }

  ownerStatus(): SpeechOwnerStatus {
    const s: SpeechOwnerStatus = {
      enabled: this.settings.enabled, phase: this.phase, vulkanRequired: true,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.settings.modelId ? { modelId: this.settings.modelId } : {}),
      ...(this.settings.executablePath ? { executablePath: this.settings.executablePath } : {}),
      ...(this.settings.modelDirectory ? { modelDirectory: this.settings.modelDirectory } : {}),
      ...(this.settings.speechVersion ? { version: this.settings.speechVersion } : {}),
      ...(this.serve ? { port: this.serve.port } : {}),
      ...(this.job ? { job: this.jobView(this.job) } : {}),
    };
    return s;
  }
  private jobView(j: Job): SpeechJobState {
    return { id: j.id, kind: j.kind, state: j.state, ...(j.progress !== undefined ? { progress: j.progress } : {}), ...(j.error ? { error: j.error } : {}), startedAt: j.startedAt };
  }
  publicStatus() {
    const ready = this.phase === 'ready' || this.phase === 'transcribing';
    return { enabled: this.settings.enabled, available: ready, phase: this.phase, ...(this.settings.modelId ? { modelId: this.settings.modelId } : {}), providerId: 'speech-cpp' as const };
  }

  // -- actions --------------------------------------------------------------

  /**
   * Owner-confirmed enable. Fast-returns the running job; progress via status.
   * Allowed even when the persisted file failed to load — this is the explicit
   * owner re-configure that recovers a corrupt settings file.
   */
  async enable(body: unknown, assertOwner: () => void): Promise<{ accepted: true; job: SpeechJobState }> {
    assertOwner();
    strictPermissionObject(body, ['source', 'executablePath', 'modelDirectory', 'modelId', 'confirmed', 'allowDownload'].filter(k => Object.hasOwn(body as object, k)));
    const b = body as SpeechEnableRequest;
    if (b.confirmed !== true) fault('speech_confirmation_required');
    if (b.source !== 'managed' && b.source !== 'existing') fault('invalid_arguments');
    if (!speechModelId(b.modelId)) fault('invalid_arguments');
    if (b.allowDownload !== true && b.allowDownload !== false) fault('invalid_arguments');
    if (b.source === 'existing') {
      if (!validLocalExecutable(b.executablePath)) fault('speech_executable_invalid');
      if (this.deps.allowedExistingRoots?.length && !this.deps.allowedExistingRoots.some(root => resolve(b.executablePath!).startsWith(resolve(root) + '\\') || resolve(b.executablePath!).startsWith(resolve(root) + '/'))) fault('speech_executable_outside_allowed_root');
      if (b.modelDirectory !== undefined && !validLocalDirectory(b.modelDirectory)) fault('speech_model_directory_invalid');
    } else {
      if (b.executablePath !== undefined || b.modelDirectory !== undefined) fault('invalid_arguments');
      if (b.allowDownload !== true) fault('speech_download_not_allowed');
    }
    assertOwner();
    if (this.busy()) fault('speech_busy');
    if (this.serve) fault('speech_busy');
    const job = this.setJob(b.source === 'managed' ? 'install' : 'enable-existing', assertOwner);
    this.track(job, this.runEnable(b, job).catch(() => {}));
    const { abort, owner, settled, ...view } = job;
    return { accepted: true, job: view };
  }

  private async runEnable(b: SpeechEnableRequest, job: Job): Promise<void> {
    const signal = job.abort.signal;
    try {
      this.guard(job);
      if (this.deps.platform !== 'win32' || this.deps.arch !== 'x64') fault('speech_platform_unsupported');
      let executable: string, modelDir: string;
      if (b.source === 'managed') {
        this.phase = 'installing';
        executable = await this.installManaged(signal);
        this.guard(job);
        modelDir = this.managedModelDir;
      } else {
        this.phase = 'validating';
        executable = await this.adoptExecutable(b.executablePath!, signal);
        this.guard(job);
        modelDir = b.modelDirectory ?? this.managedModelDir;
      }
      const modelFile = await this.ensureModel(executable, modelDir, b.modelId, b.allowDownload, job, signal);
      // Owner lease + active-job check right before persisting the new config.
      this.guard(job);
      if (signal.aborted) fault('speech_cancelled');
      // Irreversible commit point: once the new settings begin persisting, a
      // cancel can no longer undo the enable — the write finishes and callers
      // reconcile the final state instead of rolling back mid-flight.
      job.committing = true;
      this.settings = { version: 1, enabled: true, source: b.source, executablePath: executable, modelDirectory: modelDir, modelId: b.modelId, modelFile, speechVersion: this.settings.speechVersion };
      await this.save();
      this.loaded = true;
      this.lastError = undefined;
      if (this.job === job) {
        this.phase = 'stopped';
        this.endJob(job, 'done');
      }
    } catch (e) {
      // A superseded/cancelled job must not clobber phase or settings. An
      // already-cancelled job keeps the 'cancelled' outcome — cleanup finished.
      if (this.job === job && job.state === 'running') {
        this.phase = this.settings.enabled ? 'stopped' : 'error';
        this.endJob(job, 'failed', e instanceof PermissionFault ? e.code : 'speech_enable_failed');
      } else if (this.job === job) {
        // cancelled mid-run: settle back to a stable phase
        this.phase = this.settings.enabled ? 'stopped' : 'off';
      }
    }
  }

  async cancel(assertOwner: () => void): Promise<{ ok: true }> {
    this.assertLoaded(); assertOwner();
    this.transcribeAbort?.abort();
    const j = this.busy();
    if (j) {
      // Same commit-point rule as cancelJob: an enable that already began
      // persisting settles rather than pretending it never committed.
      if (!j.committing) { j.abort.abort(); this.endJob(j, 'cancelled'); }
      // Wait for the job's own cleanup (process tree kill, temp removal) before
      // freeing the slot — a follow-up job must not race leftover children.
      await j.settled;
    }
    return { ok: true };
  }

  /**
   * Job-scoped cancel for the onboarding broker: aborts ONLY the job whose id
   * it was issued for — a stale or foreign job id is a no-op, never a cancel of
   * unrelated owner/lazy-start work. Returns false when nothing was running
   * under that id, so callers verify the outcome instead of asserting it.
   */
  async cancelJob(jobId: string | undefined, assertLease: () => void): Promise<boolean> {
    this.assertLoaded(); assertLease();
    const j = this.busy();
    if (!j || !jobId || j.id !== jobId) return false;
    // Commit already began: cancelling now could leave enabled settings next to
    // a 'cancelled' job — refuse to abort, let it settle, report not-cancelled.
    if (j.committing) { await j.settled; return false; }
    j.abort.abort();
    this.endJob(j, 'cancelled');
    await j.settled;
    return true;
  }

  /** Stops the owned serve process and disables the feature. Never touches foreign processes. */
  async disable(assertOwner: () => void): Promise<{ ok: true }> {
    this.assertLoaded(); assertOwner();
    this.transcribeAbort?.abort();
    const j = this.busy();
    if (j) {
      j.abort.abort();
      this.endJob(j, 'cancelled');
      await j.settled; // let the cancelled job finish releasing owned resources
    }
    await this.stopServe();
    this.settings = { ...this.settings, enabled: false };
    await this.save();
    this.phase = 'off';
    return { ok: true };
  }

  /** Explicitly start the owned serve process (used by the owner start action). */
  async start(assertOwner: () => void): Promise<{ accepted: true; job: SpeechJobState }> {
    this.assertLoaded(); assertOwner();
    if (!this.settings.enabled || !this.settings.executablePath || !this.settings.modelFile || !this.settings.modelDirectory) fault('speech_not_enabled');
    if (this.busy()) fault('speech_busy');
    if (this.serve) { const view: SpeechJobState = { id: '', kind: 'start', state: 'done', startedAt: this.deps.now() }; return { accepted: true, job: view }; }
    const job = this.setJob('start', assertOwner);
    this.track(job, this.startServe(job).then(() => { if (this.job === job) this.endJob(job, 'done'); }).catch(e => { if (this.job === job) this.endJob(job, job.abort.signal.aborted?'cancelled':'failed', e instanceof PermissionFault ? e.code : 'speech_start_failed'); }));
    const { abort, owner, settled, ...view } = job;
    return { accepted: true, job: view };
  }

  /** Public transcription entry: lazy-starts the owned server from persisted absolute paths only — never downloads. */
  async transcribe(wav: Buffer, language: string | undefined, client: AbortSignal): Promise<{ text: string; language?: string }> {
    this.assertLoaded();
    if (!this.settings.enabled) fault('speech_not_enabled');
    if (client.aborted) fault('speech_cancelled');
    if (this.busy()) fault('speech_busy');
    if (!this.serve) {
      const start = this.setJob('start', () => { if(!this.settings.enabled) fault('speech_not_enabled'); });
      const abortStart=()=>start.abort.abort();
      client.addEventListener('abort',abortStart,{once:true});
      const work=this.startServe(start);
      this.track(start,work.catch(()=>{}));
      try { await work; this.endJob(start, 'done'); }
      catch (e) { this.endJob(start, start.abort.signal.aborted?'cancelled':'failed', e instanceof PermissionFault ? e.code : 'speech_start_failed'); throw e; }
      finally { client.removeEventListener('abort',abortStart); }
    }
    if (client.aborted) fault('speech_cancelled');
    if (this.transcribing) fault('speech_busy');
    if (!this.serve) fault('speech_unavailable');
    this.transcribing = true;
    const prior = this.phase;
    this.phase = 'transcribing';
    const ac = new AbortController();
    this.transcribeAbort=ac;
    const timer = setTimeout(() => ac.abort(new PermissionFault('speech_transcribe_timeout')), TRANSCRIBE_TIMEOUT_MS);
    const onClientAbort = () => ac.abort(new PermissionFault('speech_cancelled'));
    client.addEventListener('abort', onClientAbort, { once: true });
    if(client.aborted)onClientAbort();
    try {
      if(ac.signal.aborted)fault('speech_cancelled');
      const lang = language === 'auto' ? undefined : language;
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
      // The owned server holds exactly one recognizer. Its runtime model id
      // comes from GGUF metadata, not the lower-case catalog download alias.
      // Omit the optional model field to select that recognizer.
      if (lang) form.append('language', lang);
      const port = (this.serve as { port: number }).port;
      const res = await this.deps.fetch(`http://127.0.0.1:${port}/v1/audio/transcriptions`, { method: 'POST', body: form, signal: ac.signal, redirect: 'error' });
      if (!res.ok) fault('speech_transcribe_failed');
      const raw: unknown = await res.text(256 * 1024);
      if(ac.signal.aborted)fault('speech_cancelled');
      const text = typeof raw === 'string' ? raw : '';
      if (text.length > 256 * 1024) fault('speech_transcribe_failed');
      const parsed = JSON.parse(text) as { text?: unknown; language?: unknown };
      if (!parsed || typeof parsed !== 'object') fault('speech_transcribe_failed');
      if (typeof parsed.text !== 'string' || parsed.text.length > 128 * 1024) fault('speech_transcribe_failed');
      if (parsed.language !== undefined && (typeof parsed.language !== 'string' || parsed.language.length > 64)) fault('speech_transcribe_failed');
      const outText = parsed.text as string;
      return { text: outText, ...(typeof parsed.language === 'string' ? { language: parsed.language as string } : {}) };
    } finally {
      clearTimeout(timer);
      client.removeEventListener('abort', onClientAbort);
      if(this.transcribeAbort===ac)this.transcribeAbort=undefined;
      this.transcribing = false;
      this.phase = this.serve ? prior === 'transcribing' ? 'ready' : prior : this.settings.enabled ? 'stopped' : 'off';
    }
  }

  /** Shutdown hook: release only owned processes. */
  async dispose(): Promise<void> {
    this.transcribeAbort?.abort();
    const j = this.busy();
    if (j) { j.abort.abort(); this.endJob(j, 'cancelled'); await j.settled; }
    await this.stopServe();
  }

  // -- internals --------------------------------------------------------------

  private async fileDigest(file:string,signal:AbortSignal):Promise<string>{
    const handle=await fs.open(file,'r');
    try{
      const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_ZIP_EXPANDED)fault('speech_install_conflict');
      const hash=createHash('sha256'),chunk=Buffer.alloc(65536);let total=0;
      for(;;){if(signal.aborted)fault('speech_cancelled');const {bytesRead}=await handle.read(chunk,0,chunk.length,null);if(!bytesRead)break;total+=bytesRead;if(total>MAX_ZIP_EXPANDED)fault('speech_install_conflict');hash.update(chunk.subarray(0,bytesRead));}
      return hash.digest('hex');
    }finally{await handle.close();}
  }

  private async installManaged(signal: AbortSignal): Promise<string> {
    const exe=join(this.installDir,'speech.exe'),manifest=join(this.installDir,'managed.json');
    const exists=await fs.lstat(this.installDir).then(()=>true,()=>false);
    if(exists){
      // A file merely present at the managed path is not a verified install.
      let receipt:any;try{receipt=JSON.parse(await fs.readFile(manifest,'utf8'));}catch{fault('speech_install_conflict');}
      const st=await fs.lstat(exe).catch(()=>fault('speech_install_conflict'));
      if(!st.isFile()||st.isSymbolicLink()||receipt?.version!==1||!/^\d+\.\d+\.\d+$/.test(receipt.releaseVersion??'')||!/^[0-9a-f]{64}$/.test(receipt.executableSha256??'')||await this.fileDigest(exe,signal)!==receipt.executableSha256)fault('speech_install_conflict');
      return this.adoptExecutable(exe,signal);
    }
    const release=await this.fetchRelease(signal),zip=await this.download(release,signal);
    await fs.mkdir(this.voiceDir,{recursive:true});
    const stage=join(this.voiceDir,`speech-install-${randomUUID()}`);
    await fs.mkdir(stage);
    try{
      await this.extract(zip,signal,stage);
      const stagedExe=join(stage,'speech.exe');
      const executableSha256=await this.fileDigest(stagedExe,signal);
      await fs.writeFile(join(stage,'managed.json'),JSON.stringify({version:1,releaseVersion:release.version,assetSha256:release.sha256,executableSha256}),{flag:'wx'});
      if(signal.aborted)fault('speech_cancelled');
      if(await fs.lstat(this.installDir).then(()=>true,()=>false))fault('speech_install_conflict');
      await fs.rename(stage,this.installDir);
    }finally{await fs.rm(stage,{recursive:true,force:true});}
    return this.adoptExecutable(exe,signal);
  }

  private async fetchRelease(signal: AbortSignal): Promise<ReleaseInfo & { sums?: ReleaseAsset }> {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(), 30000);
    try {
      const res = await this.deps.fetch(RELEASE_API, { signal: ac.signal, redirect: 'error', headers: { accept: 'application/vnd.github+json' } });
      if (!res.ok) fault('speech_release_unavailable');
      const parsed = parseRelease(await res.json(MAX_METADATA_BYTES));
      if (!parsed.sha256) {
        // Fall back to the release SHA256SUMS asset — still an official artifact.
        const sums = parsed.sums;
        if (!sums) fault('speech_digest_unavailable');
        const sumsUrl = (sums as ReleaseAsset).browser_download_url;
        const sumsRes = await this.fetchOfficialAsset(sumsUrl, ac.signal);
        if (!sumsRes.ok) fault('speech_digest_unavailable');
        const text: unknown = await sumsRes.text(64 * 1024);
        if (typeof text !== 'string' || text.length > 64 * 1024) fault('speech_digest_unavailable');
        const sumsText = text as string;
        const line = sumsText.split(/\r?\n/).find((l: string) => l.trimEnd().endsWith(` ${parsed.asset.name}`));
        const m = line && /^([0-9a-f]{64})\s+/.exec(line.trim());
        if (!m) fault('speech_digest_unavailable');
        parsed.sha256 = (m as RegExpExecArray)[1];
      }
      return parsed;
    } catch (e) {
      if (e instanceof PermissionFault) throw e;
      return fault(signal.aborted ? 'speech_cancelled' : 'speech_release_unavailable');
    } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
  }

  /**
   * GitHub release asset URLs answer 302 → a signed CDN host. Follow at most
   * one redirect, only to a literal pinned allowlist of GitHub-owned asset
   * hosts over HTTPS, without carrying any headers — never an arbitrary
   * Location. The metadata API itself stays redirect:'error'.
   */
  private static readonly ASSET_REDIRECT_HOSTS = new Set([
    'release-assets.githubusercontent.com',
    'objects.githubusercontent.com',
    'github-production-release-asset-2e65be.s3.amazonaws.com',
    'github-cloud.s3.amazonaws.com',
  ]);
  private async fetchOfficialAsset(url: string, signal: AbortSignal): Promise<SpeechFetchResponse> {
    const first = await this.deps.fetch(url, { signal, redirect: 'manual', headers: { accept: 'application/octet-stream' } });
    if (first.status === 301 || first.status === 302 || first.status === 307 || first.status === 308) {
      const location = first.headers?.get?.('location');
      let target: URL;
      try { target = new URL(String(location)); } catch { fault('speech_download_failed'); }
      if (target!.protocol !== 'https:' || !SpeechCppService.ASSET_REDIRECT_HOSTS.has(target!.host)) fault('speech_download_failed');
      return this.deps.fetch(target!.href, { signal, redirect: 'error', headers: { accept: 'application/octet-stream' } });
    }
    return first;
  }

  private async download(release: ReleaseInfo, signal: AbortSignal): Promise<Uint8Array> {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await this.fetchOfficialAsset(release.asset.browser_download_url, ac.signal);
      if (!res.ok) fault('speech_download_failed');
      const data = await res.bytes(MAX_ZIP_BYTES + 1);
      if (data.length > MAX_ZIP_BYTES) fault('speech_download_too_large');
      const digest = createHash('sha256').update(data).digest('hex');
      if (digest !== release.sha256) fault('speech_digest_mismatch');
      return data;
    } catch (e) {
      if (e instanceof PermissionFault) throw e;
      return fault(signal.aborted ? 'speech_cancelled' : 'speech_download_failed');
    } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
  }

  private async extract(zip: Uint8Array, signal: AbortSignal, destination:string): Promise<void> {
    const tempZip=join(destination,`release-${randomUUID()}.zip`);
    await fs.writeFile(tempZip,zip,{flag:'wx'});
    try{
      if(signal.aborted)fault('speech_cancelled');
      const encoded=Buffer.from(EXTRACT_SCRIPT,'utf16le').toString('base64');
      const helper=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
      const child=this.deps.spawn(helper,['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
      if(!child.stdin){await this.stopOwned(child);fault('speech_extract_failed');}
      child.stdin!.on('error',()=>{});
      child.stdin!.end(JSON.stringify({zip:tempZip,destination}));
      const {code}=await this.runOwned(child,120000,8192,signal);
      if(code!==0)fault('speech_extract_failed');
    }finally{await fs.rm(tempZip,{force:true}).catch(()=>{});}
  }

  private async adoptExecutable(path: string, signal: AbortSignal): Promise<string> {
    const st = await fs.lstat(path).catch(() => fault('speech_executable_missing'));
    if (!st.isFile() || st.isSymbolicLink()) fault('speech_executable_invalid');
    if (signal.aborted) fault('speech_cancelled');
    const child = this.deps.spawn(path, ['--version'], { shell: false, windowsHide: true });
    const { code, stdout, stderr } = await this.runOwned(child, 15000, 4096,signal).catch(e => { throw e instanceof PermissionFault && e.code === 'speech_command_timeout' ? new PermissionFault('speech_identity_timeout') : e; });
    if (code !== 0) {
      if (/vulkan-1\.dll|VULKAN/i.test(stderr)) fault('speech_vulkan_loader_missing');
      fault('speech_identity_failed');
    }
    const m = /speech\.cpp\s+(\d+\.\d+\.\d+)/.exec(stdout);
    if (!m) fault('speech_identity_failed');
    this.settings.speechVersion = m![1];
    return path;
  }

  private async ensureModel(executable: string, modelDir: string, modelId: SpeechModelId, allowDownload: boolean, job: Job, signal: AbortSignal): Promise<string> {
    await fs.mkdir(modelDir, { recursive: true });
    // Offline adoption: only an already-cached GGUF under the model dir is accepted.
    const env = { ...process.env, SPEECH_MODEL_DIR: modelDir, SPEECH_NO_UPDATE_CHECK: '1', NO_COLOR:'1' };
    const envOf = () => env;
    const models = await this.speechJson(executable, ['models', '--json'], modelDir, signal, 30000).catch(() => undefined);
    this.guard(job);
    const cached = await this.findCachedModel(models, modelId, modelDir);
    this.guard(job);
    if (cached) return cached;
    if (!allowDownload) fault('speech_model_not_cached');
    // Explicitly consented model fetch only.
    this.phase = 'model-fetch';
    job.kind = 'model-fetch';
    const child = this.deps.spawn(executable, ['pull', modelId], { shell: false, windowsHide: true, env: envOf() });
    // speech pull spawns a system curl child; cancel must take down the whole
    // owned tree, not just the speech.exe PID.
    const { code, stdout, stderr } = await this.runOwned(child, MODEL_PULL_TIMEOUT_MS, 8192,signal);
    if (signal.aborted) fault('speech_cancelled');
    if (code !== 0) {
      if (/vulkan-1\.dll|VULKAN/i.test(stderr)) fault('speech_vulkan_loader_missing');
      fault('speech_model_fetch_failed');
    }
    // `speech pull` prints the model file path on stdout; adopt only absolute paths under the model dir.
    const line = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => /\.gguf$/i.test(l)).pop();
    if (!line || !this.underDir(line, modelDir)) {
      const after = await this.speechJson(executable, ['models', '--json'], modelDir, signal, 30000).catch(() => undefined);
      const found = await this.findCachedModel(after, modelId, modelDir);
      if (!found) fault('speech_model_path_unverified');
      return found as string;
    }
    const gguf = await fs.realpath(line as string).catch(()=>fault('speech_model_path_unverified'));
    if(!this.underDir(gguf,modelDir)||!(await fs.stat(gguf).then(s=>s.isFile()&&s.size>0,()=>false)))fault('speech_model_path_unverified');
    return gguf;
  }

  private underDir(file: string, dir: string): boolean {
    if(!isAbsolute(file)||!/\.gguf$/i.test(file))return false;
    const within=relative(resolve(dir),resolve(file));
    return !!within&&within!=='..'&&!within.startsWith('..\\')&&!within.startsWith('../')&&!isAbsolute(within);
  }

  private async findCachedModel(models:any,modelId:SpeechModelId,modelDir:string):Promise<string|undefined>{
    // Upstream cache.cpp:models_json emits a path for EVERY catalog file,
    // including missing downloads. Only fetched:true + a real file is usable.
    if(!models||!Array.isArray(models.models))return undefined;
    if(typeof models.directory==='string'&&relative(resolve(modelDir),resolve(models.directory))!=='')return undefined;
    for(const m of models.models){
      if(m?.name!==modelId||!Array.isArray(m.files))continue;
      const files=[...m.files].sort((a,b)=>Number(b?.type===m.type)-Number(a?.type===m.type));
      for(const file of files){
        if(file?.fetched!==true||typeof file.path!=='string'||!this.underDir(file.path,modelDir))continue;
        const real=await fs.realpath(file.path).catch(()=>undefined);
        if(!real||!this.underDir(real,modelDir))continue;
        if(await fs.stat(real).then(s=>s.isFile()&&s.size>0,()=>false))return real;
      }
    }
    return undefined;
  }

  private async speechJson(executable: string, args: string[], modelDir: string, signal: AbortSignal, timeoutMs: number): Promise<any> {
    const child = this.deps.spawn(executable, args, { shell: false, windowsHide: true, env: { ...process.env, SPEECH_MODEL_DIR: modelDir, SPEECH_NO_UPDATE_CHECK: '1', NO_COLOR:'1' } });
    const { code, stdout } = await this.runOwned(child, timeoutMs, 1024 * 1024,signal);
    if (signal.aborted) fault('speech_cancelled');
    if (code !== 0) fault('speech_models_unavailable');
    try { return JSON.parse(stdout); } catch { fault('speech_models_unavailable'); }
  }

  private async startServe(job: Job): Promise<void> {
    this.guard(job);
    const { executablePath, modelDirectory, modelFile } = this.settings;
    if (!executablePath || !modelDirectory || !modelFile) fault('speech_not_enabled');
    const gguf = modelFile as string;
    if (!(await fs.stat(gguf).then(s => s.isFile(), () => false))) fault('speech_model_missing');
    this.guard(job);
    this.phase = 'starting';
    const env = { ...process.env, SPEECH_MODEL_DIR: modelDirectory, SPEECH_NO_UPDATE_CHECK: '1', NO_COLOR:'1' };
    const child = this.deps.spawn(executablePath as string, ['serve', resolve(gguf), '--host', '127.0.0.1', '--port', '0', '--no-warmup'], { shell: false, windowsHide: true, env });
    const signal = job.abort.signal;
    let exited = false;
    child.once('exit', () => { exited = true; if (this.serve?.proc === child) { this.serve = undefined; if (this.phase === 'ready' || this.phase === 'transcribing') this.phase = 'stopped'; } });
    try {
      const port = await this.waitReady(child, signal);
      if (exited) fault('speech_serve_exited');
      this.serve = { proc: child, port, modelFile: resolve(gguf) };
      await this.assertServeHealthy(port, child, signal);
      this.guard(job);
      this.phase = 'ready';
    } catch (e) {
      if(this.serve?.proc===child)this.serve=undefined;
      await this.stopOwned(child);
      this.phase = this.settings.enabled ? 'stopped' : 'error';
      throw e instanceof PermissionFault ? e : new PermissionFault(exited ? 'speech_serve_exited' : 'speech_start_failed');
    }
  }

  private waitReady(child: SpeechSpawnedProcess, signal: AbortSignal): Promise<number> {
    return new Promise((resolvePromise,reject)=>{
      let stderrBuf='',done=false;
      const finish=(fn:()=>void)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',onAbort);child.stderr?.removeListener('data',onData);fn();};
      const onAbort=()=>finish(()=>reject(new PermissionFault('speech_cancelled')));
      const onData=(chunk:Buffer)=>{
        stderrBuf=(stderrBuf+chunk.toString('utf8')).slice(-8192);
        const match=/Ready at http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d+)\//.exec(stderrBuf);
        if(match){const port=Number(match[2]);finish(()=>port>0&&port<65536?resolvePromise(port):reject(new PermissionFault('speech_port_invalid')));}
        if(/vulkan-1\.dll|VK_ERROR|failed to load.*vulkan/i.test(stderrBuf))finish(()=>reject(new PermissionFault('speech_vulkan_loader_missing')));
        if(/cannot listen|EADDRINUSE/i.test(stderrBuf))finish(()=>reject(new PermissionFault('speech_port_refused')));
      };
      const timer=setTimeout(()=>finish(()=>reject(new PermissionFault('speech_start_timeout'))),SERVE_START_TIMEOUT_MS);
      signal.addEventListener('abort',onAbort,{once:true});
      child.stderr?.on('data',onData);
      child.once('exit',()=>finish(()=>reject(new PermissionFault('speech_serve_exited'))));
      child.once('error',()=>finish(()=>reject(new PermissionFault('speech_serve_exited'))));
      if(signal.aborted)onAbort();
    });
  }

  private async assertServeHealthy(port: number, child: SpeechSpawnedProcess, signal: AbortSignal): Promise<void> {
    const deadline=performance.now()+15000;
    const json=async(path:string)=>{
      const ac=new AbortController(),abort=()=>ac.abort();
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      const timer=setTimeout(abort,3000);
      try{
        const response=await this.deps.fetch(`http://127.0.0.1:${port}${path}`,{signal:ac.signal,redirect:'error'});
        if(!response.ok)fault('speech_health_failed');
        const body=await response.json(64*1024);if(ac.signal.aborted)fault('speech_cancelled');return body;
      }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
    };
    while(performance.now()<deadline){
      if(signal.aborted)fault('speech_cancelled');
      if(child.exitCode!==null)fault('speech_serve_exited');
      try{
        const health=await json('/health') as any;
        if(health?.status==='ok'){
          const models=await json('/v1/models') as any;
          if(Array.isArray(models?.data)&&models.data.some((m:any)=>typeof m?.id==='string'&&m.id.length>0))return;
        }
      }catch{if(signal.aborted)fault('speech_cancelled');}
      await sleep(150,signal);
    }
    fault('speech_health_failed');
  }

  private async runOwned(child:SpeechSpawnedProcess,timeout:number,cap:number,signal:AbortSignal){
    let cleanup:Promise<void>|undefined;
    const stop=()=>cleanup??=this.stopOwned(child);
    signal.addEventListener('abort',stop,{once:true});if(signal.aborted)void stop();
    try{return await runCommand(child,timeout,cap,stop);}
    finally{signal.removeEventListener('abort',stop);await cleanup;if(signal.aborted)fault('speech_cancelled');}
  }

  private async stopOwned(child:SpeechSpawnedProcess):Promise<void>{
    if(child.exitCode!==null)return;
    // Kill the tree WHILE its parent is alive; killing the parent first can
    // orphan speech pull's curl subprocess before taskkill can enumerate it.
    if(child.pid&&Number.isSafeInteger(child.pid)&&child.pid>0)await this.deps.killTree(child.pid).catch(()=>{});
    if(child.exitCode!==null)return;
    try{child.kill();}catch{}
    if(child.exitCode!==null)return;
    await new Promise<void>(resolveDone=>{const timer=setTimeout(resolveDone,5000);child.once('close',()=>{clearTimeout(timer);resolveDone();});});
  }

  private async stopServe(): Promise<void> {
    const current=this.serve;this.serve=undefined;
    if(current)await this.stopOwned(current.proc);
  }
}
