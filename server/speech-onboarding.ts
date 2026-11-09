// speech.cpp terminal-free onboarding — request/approval/job broker.
//
// A browser POST can only REQUEST a setup; the approval is a purpose-scoped
// native confirmation dialog on the Console PC (package/speech-approval-dialog).
// The broker never reuses the owner/admin enrollment grant: approval produces a
// job-scoped internal assertOwner that drives service.enable() exactly once —
// it cannot start/stop/disable anything else and dies with the job.
//
// Safety invariants:
// - One outstanding native prompt/job globally; ≤3 prompts per 10 minutes and a
//   per-actor cooldown. Entries are retained bounded and expire safely.
// - The dialog's binding digest covers requestId + immutable payload + Console
//   generation; the managed server identity is verified BEFORE and AFTER the
//   answer. Expiry, a changed generation, rejection or cancel can never commit.
// - No download happens before BOTH the browser's explicit consent AND the
//   native approval. GET reads never mint sessions, dialogs or jobs.
// - Cookie + optional remote Access principal bind receipts to the requester.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { PermissionFault } from './workspace-permissions.ts';
import type { SpeechCppService } from './speech-cpp.ts';
import type { SpeechApprovalDialog, SpeechApprovalView } from '../package/speech-approval-dialog.mjs';
import { speechApprovalBinding } from '../package/speech-approval-dialog.mjs';
import type { SpeechJobState, SpeechOnboardingPayload, SpeechOnboardingPreflight, SpeechOnboardingState } from '../shared/speech.ts';
import { SPEECH_MODELS, speechModelId } from '../shared/speech.ts';
import { validLocalDirectory, validLocalExecutable } from './speech-cpp.ts';
import type { ManagedOwnerIdentity } from '../package/server-manager.mjs';

const fail = (code: string): never => { throw new PermissionFault(code); };

// ---------------------------------------------------------------------------
// Limits — fixed, never configurable from HTTP/env.
const PROMPT_TTL_MS = 120_000;              // native confirmation window
const APPROVAL_LEASE_MS = 45 * 60_000;      // runtime install + model fetch headroom
const PROMPT_LIMIT = 3, PROMPT_WINDOW_MS = 600_000;
const ACTOR_COOLDOWN_MS = 60_000;
const MAX_REQUESTS = 64;
const RETENTION_MS = 30 * 60_000;
const COOKIE_MAX_AGE_S = 8 * 3600;
const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const modelLabel = (id: string) => SPEECH_MODELS.find(m => m.id === id)?.label ?? id;

export interface SpeechOnboardingDeps {
  /** Default: Win32 System32 vulkan-1.dll presence — loader only, never GPU proof. */
  checkVulkanLoader?: () => Promise<boolean>;
  now?: () => number;
}

export interface SpeechOnboardingOptions {
  service: SpeechCppService;
  /** Native dialog availability/identity — managed console only. */
  managed: {
    available: boolean;
    generation(): ManagedOwnerIdentity;
    verifyIdentity(expected: Readonly<ManagedOwnerIdentity>): Promise<ManagedOwnerIdentity>;
  };
  dialog: SpeechApprovalDialog;
  deps?: SpeechOnboardingDeps;
}

type EntryState = Exclude<SpeechOnboardingState, never>;
interface Entry {
  requestId: string;
  payload: SpeechOnboardingPayload;
  payloadDigest: string;
  /** sha256 of the opaque cookie value; the value itself is never stored or returned. */
  actorKey: string;
  /** Verified Access principal key when the request came over remote mode. */
  principalKey?: string;
  sameDevice: boolean;
  state: EntryState;
  createdAt: number;
  updatedAt: number;
  promptUntil?: number;
  approvalUntil?: number;
  generation?: string;
  job?: SpeechJobState;
  error?: string;
  abort: AbortController;
  /** Real prompt-TTL timer — aborts the entry even when nobody polls status. */
  promptTimer?: ReturnType<typeof setTimeout>;
  /** Native dialog transport promise; the outstanding slot stays busy until
   * it settles, so a slow child close can never overlap a new request. */
  transport?: Promise<void>;
}
type Phase = 'idle' | 'awaiting' | 'committing' | 'done';

const samePrincipal = (e: Entry, p?: { subject: string; issuer: string; audience: string }) =>
  e.principalKey === (p ? sha256(JSON.stringify([p.subject, p.issuer, p.audience])) : undefined);

const defaultVulkanCheck = async () => {
  try { await access(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'vulkan-1.dll')); return true; }
  catch { return false; }
};

/** Domain broker: request → native prompt → exactly-once enable → status/cancel. */
export class SpeechOnboardingBroker {
  private entries = new Map<string, Entry>();
  private phases = new WeakMap<Entry, Phase>();
  private prompts: number[] = [];
  private actors = new Map<string, number>();
  private tasks = new Set<Promise<void>>();
  private closed = false;
  private readonly now: () => number;
  private readonly checkVulkan: () => Promise<boolean>;

  constructor(private readonly options: SpeechOnboardingOptions) {
    this.now = options.deps?.now ?? Date.now;
    this.checkVulkan = options.deps?.checkVulkanLoader ?? defaultVulkanCheck;
  }

  private phase(e: Entry) { return this.phases.get(e) ?? 'idle'; }
  private setPhase(e: Entry, p: Phase) { this.phases.set(e, p); }
  private prune() {
    const cutoff = this.now() - RETENTION_MS;
    for (const [id, e] of this.entries) {
      if (e.updatedAt < cutoff && this.phase(e) === 'done' && !this.transportBusy(e)) this.entries.delete(id);
    }
    if (this.entries.size > MAX_REQUESTS) {
      const done = [...this.entries.values()].filter(e => this.phase(e) === 'done' && !this.transportBusy(e)).sort((a, b) => a.updatedAt - b.updatedAt);
      for (const e of done) { if (this.entries.size <= MAX_REQUESTS) break; this.entries.delete(e.requestId); }
    }
  }
  private outstanding() { return [...this.entries.values()].some(e => { const p = this.phase(e); return p === 'awaiting' || p === 'committing' || this.transportBusy(e); }); }

  /**
   * Sanitized view for a caller. Cookie-bound and principal-bound: other
   * actors' requests are invisible. GET/unknown id returns idle — never a
   * cookie, dialog or job.
   */
  status(input: { actorKey?: string; principal?: { subject: string; issuer: string; audience: string }; requestId?: string; sameDevice?: boolean }) {
    const e = input.requestId && UUID_RE.test(input.requestId) ? this.entries.get(input.requestId) : undefined;
    const visible = e && e.actorKey === input.actorKey && samePrincipal(e, input.principal) ? e : undefined;
    if (visible && visible.state === 'pending' && this.phase(visible) === 'awaiting' && this.now() >= (visible.promptUntil ?? 0)) {
      // Lazy expiry reconciliation for a timer that already fired but whose
      // transport is still closing — reads only retire state, never spawn work.
      this.finish(visible, 'expired');
    }
    return {
      requestId: visible?.requestId,
      state: visible ? visible.state : ('idle' as const),
      // Sanitized echo: never local paths — only which bound inputs existed.
      ...(visible ? { payload: { source: visible.payload.source, modelId: visible.payload.modelId, allowDownload: visible.payload.allowDownload, hasExistingExecutable: visible.payload.executablePath !== undefined, hasExistingModelDirectory: visible.payload.modelDirectory !== undefined } } : {}),
      ...(visible?.job ? { job: visible.job } : {}),
      ...(visible ? { startedAt: visible.createdAt, updatedAt: visible.updatedAt } : {}),
      ...(visible?.error ? { error: visible.error } : {}),
      sameDevice: input.sameDevice === true,
    };
  }

  /** Coarse preflight for the card; a plain capability check, never a download. */
  async preflight(): Promise<SpeechOnboardingPreflight> {
    const supported = process.platform === 'win32' && process.arch === 'x64';
    const [vulkanLoader] = await Promise.all([supported ? this.checkVulkan() : Promise.resolve(false)]);
    const nativeApproval = supported && this.options.managed.available && !this.closed;
    return { supported, vulkanLoader, nativeApproval, ...(nativeApproval ? {} : { nativeReason: !supported ? 'unsupported' as const : !this.options.managed.available ? 'unmanaged' as const : 'noninteractive' as const }) };
  }

  /**
   * Explicit request. Cookie/principal binding plus UUID idempotency:
   * same requestId + same payload = the recorded receipt (safe POST retry);
   * same requestId + different payload = an immutable-payload collision.
   */
  async request(input: {
    actorKey: string;
    principal?: { subject: string; issuer: string; audience: string };
    sameDevice: boolean;
    body: unknown;
  }): Promise<Entry> {
    if (this.closed) fail('speech_onboarding_unavailable');
    const b = input.body as Record<string, unknown>;
    if (!b || typeof b !== 'object' || typeof b.requestId !== 'string' || !UUID_RE.test(b.requestId)) fail('invalid_arguments');
    const requestId = b.requestId as string;
    const payload = this.parsePayload(b.payload);
    const digest = sha256(JSON.stringify(payload));
    const existing = this.entries.get(requestId);
    if (existing) {
      if (existing.actorKey !== input.actorKey || !samePrincipal(existing, input.principal)) fail('speech_onboarding_forbidden');
      if (existing.payloadDigest !== digest) fail('speech_onboarding_collision');
      return existing; // idempotent receipt replay — before capability checks
    }
    // Server-side preflight is authoritative for NEW requests only — a client
    // ignoring its own preflight result cannot start a long download.
    const pf = await this.preflight();
    if (!pf.supported) fail('speech_platform_unsupported');
    if (payload.source === 'managed' && !pf.vulkanLoader) fail('speech_vulkan_loader_missing');
    if (this.entries.size >= MAX_REQUESTS) { this.prune(); if (this.entries.size >= MAX_REQUESTS) fail('speech_onboarding_capacity'); }
    if (this.outstanding()) fail('speech_onboarding_conflict');
    const e: Entry = {
      requestId, payload, payloadDigest: digest, actorKey: input.actorKey,
      ...(input.principal ? { principalKey: sha256(JSON.stringify([input.principal.subject, input.principal.issuer, input.principal.audience])) } : {}),
      sameDevice: input.sameDevice, state: 'pending', createdAt: this.now(), updatedAt: this.now(), abort: new AbortController(),
    };
    this.setPhase(e, 'idle');
    this.entries.set(e.requestId, e);
    this.prune();
    // An explicit confirmed request IS the ask for host confirmation: the
    // native dialog raises on the Console PC (rate-limited, one outstanding),
    // and only its human approval can start the job. Remote requests cannot
    // reach any host-local mutation in Access mode, so this is the only path.
    try {
      this.openPrompt(e, input.actorKey);
    } catch (err) {
      this.entries.delete(e.requestId);
      throw err;
    }
    return e;
  }

  /** Requester-side cancel: only the owning actor, only its own job/dialog. */
  async cancel(input: { actorKey: string; principal?: { subject: string; issuer: string; audience: string }; requestId: string }): Promise<void> {
    const e = this.entries.get(input.requestId);
    if (!e || e.actorKey !== input.actorKey || !samePrincipal(e, input.principal)) fail('speech_onboarding_forbidden');
    const phase = this.phase(e as Entry);
    if (phase === 'done') return; // idempotent
    const entry = e as Entry;
    if (phase === 'awaiting') this.finish(entry, 'cancelled');
    else if (phase === 'committing') {
      // Job-scoped cancel FIRST — aborting the entry before calling cancelJob
      // would make the lease guard fail and leave the job running.
      const jobId = entry.job?.id;
      const cancelled = await this.options.service.cancelJob(jobId, () => this.assertLease(entry));
      const current = this.options.service.ownerStatus().job;
      if (current && current.id === jobId) entry.job = current;
      // Commit-point rule: if the enable already began persisting, the cancel
      // could not take effect — reconcile the real job outcome, never claim it.
      if (!cancelled && current && current.id === jobId) {
        this.finish(entry, current.state === 'done' ? 'ready' : current.state === 'cancelled' ? 'cancelled' : 'failed', current.state === 'done' ? undefined : current.error ?? 'speech_cancel_uncertain');
      } else if (!cancelled) {
        this.finish(entry, 'failed', 'speech_cancel_uncertain');
      } else this.finish(entry, 'cancelled');
    } else this.finish(entry, 'cancelled');
    // A cancel must not report done while its native transport could still be
    // alive — wait for the dialog's own close (bounded) before responding.
    if (entry.transport) await Promise.race([entry.transport.catch(() => {}), new Promise<void>(r => { const t = setTimeout(r, 10_000); t.unref?.(); })]);
  }

  private finish(e: Entry, state: EntryState, error?: string) {
    if (this.phase(e) === 'done') return;
    e.state = state;
    if (error) e.error = error;
    e.updatedAt = this.now();
    this.setPhase(e, 'done');
    clearTimeout(e.promptTimer);
    e.abort.abort();
  }

  /** An entry still occupies the outstanding slot while its native transport
   * may be alive — done-state does NOT release it until the transport settles. */
  private transportBusy(e: Entry) { return !!e.transport; }

  /** Job-scoped internal owner lease — scoped to THIS entry's approval window. */
  private assertLease(e: Entry) {
    if (this.closed || e.abort.signal.aborted) fail('speech_onboarding_cancelled');
    if (this.now() >= (e.approvalUntil ?? 0)) fail('speech_onboarding_expired');
    const g = e.generation;
    if (!g || this.options.managed.generation().generation !== g) fail('speech_onboarding_generation_changed');
  }

  private rateLimit(actorKey: string) {
    const t = this.now();
    this.prompts = this.prompts.filter(x => x > t - PROMPT_WINDOW_MS);
    // Bounded per-actor map: stale cooldown entries are evicted with the window.
    if (this.actors.size > 256) { for (const [k, at] of this.actors) if (at <= t - ACTOR_COOLDOWN_MS) this.actors.delete(k); }
    if (this.actors.size > 256) fail('speech_onboarding_rate_limited');
    if (this.prompts.length >= PROMPT_LIMIT) fail('speech_onboarding_rate_limited');
    if ((this.actors.get(actorKey) ?? -Infinity) > t - ACTOR_COOLDOWN_MS) fail('speech_onboarding_rate_limited');
    this.prompts.push(t);
    this.actors.set(actorKey, t);
  }

  private openPrompt(e: Entry, actorKey: string) {
    if (this.closed || e.abort.signal.aborted) fail('speech_onboarding_cancelled');
    if (this.outstanding()) fail('speech_onboarding_conflict');
    if (!this.options.managed.available || process.platform !== 'win32') { this.finish(e, 'unavailable', 'speech_native_unavailable'); return; }
    this.rateLimit(actorKey);
    const generation = this.options.managed.generation();
    e.generation = generation.generation;
    e.promptUntil = this.now() + PROMPT_TTL_MS;
    e.approvalUntil = this.now() + APPROVAL_LEASE_MS;
    e.updatedAt = this.now();
    this.setPhase(e, 'awaiting');
    const view = this.view(e);
    const task = this.runPrompt(e, view).finally(() => { this.tasks.delete(task); });
    this.tasks.add(task);
  }

  private onDialogAnswer(e: Entry, view: SpeechApprovalView, answer: { decision: string; bindingDigest: string } | undefined) {
    const task = this.finishDialog(e, view, answer).finally(() => { this.tasks.delete(task); });
    this.tasks.add(task);
  }

  private async finishDialog(e: Entry, view: SpeechApprovalView, answer: { decision: string; bindingDigest: string } | undefined) {
    try {
      if (e.abort.signal.aborted || this.closed) return this.finish(e, 'cancelled');
      if (this.now() >= (e.promptUntil ?? 0)) return this.finish(e, 'expired');
      if (!answer || answer.bindingDigest !== view.bindingDigest) return this.finish(e, 'unavailable', 'speech_binding_rejected');
      if (answer.decision !== 'approved') {
        return this.finish(e, answer.decision === 'cancelled' ? 'rejected' : answer.decision === 'noninteractive' ? 'unavailable' : 'unavailable',
          answer.decision === 'noninteractive' ? 'speech_native_noninteractive' : answer.decision === 'unavailable' ? 'speech_native_unavailable' : undefined);
      }
      await this.verify(e); // AFTER: same process identity before any commit
      if (this.now() >= (e.promptUntil ?? 0)) return this.finish(e, 'expired');
      this.setPhase(e, 'committing');
      e.state = 'processing';
      e.updatedAt = this.now();
      clearTimeout(e.promptTimer);
      const result = await this.options.service.enable(
        { source: e.payload.source, modelId: e.payload.modelId, confirmed: true, allowDownload: e.payload.allowDownload, ...(e.payload.executablePath ? { executablePath: e.payload.executablePath } : {}), ...(e.payload.modelDirectory ? { modelDirectory: e.payload.modelDirectory } : {}) },
        () => this.assertLease(e));
      e.job = result.job;
      await this.watchJob(e);
    } catch (err) {
      if (this.phase(e) === 'done') return;
      const code = err instanceof PermissionFault ? err.code : 'speech_onboarding_failed';
      this.finish(e, code === 'speech_onboarding_cancelled' ? 'cancelled' : code === 'speech_onboarding_expired' || code === 'owner_gui_expired' ? 'expired'
        : code === 'speech_onboarding_generation_changed' ? 'unavailable' : 'failed', code);
    }
  }

  /** Immutable dialog view; binding digest covers id+payload+generation+TTL. */
  private view(e: Entry): SpeechApprovalView {
    const tuple = {
      requestId: e.requestId,
      generation: e.generation!,
      expiresAt: e.promptUntil!,
      source: e.payload.source,
      modelId: e.payload.modelId,
      modelLabel: modelLabel(e.payload.modelId),
      downloadBytesNote: e.payload.modelId === 'qwen3-asr-0.6b' ? '約0.84 GB · モデル単体（実行環境は別途必要）' : '容量は選択モデルにより異なります（実行環境は別途必要）',
      allowDownload: e.payload.allowDownload,
      hasExistingExecutable: e.payload.source === 'existing',
      hasExistingModelDirectory: e.payload.modelDirectory !== undefined,
      ...(e.payload.executablePath !== undefined ? { executablePath: e.payload.executablePath } : {}),
      ...(e.payload.modelDirectory !== undefined ? { modelDirectory: e.payload.modelDirectory } : {}),
    };
    return Object.freeze({ ...tuple, bindingDigest: speechApprovalBinding(tuple) });
  }

  private async runPrompt(e: Entry, view: SpeechApprovalView) {
    try {
      await this.verify(e); // BEFORE the dialog opens: identity must already match
      if (e.abort.signal.aborted || this.closed) return this.finish(e, 'cancelled');
      // Real prompt TTL — armed only while the dialog could be open; a late
      // answer past this window can never commit (re-checked at answer time).
      e.promptTimer = setTimeout(() => { if (this.phase(e) === 'awaiting') this.finish(e, 'expired'); }, Math.max(1, (e.promptUntil ?? 0) - this.now()));
      e.promptTimer.unref?.();
      // Track the raw dialog transport on the entry: the outstanding slot stays
      // busy until the child actually closes, and cancel/dispose can await it.
      // A transport that ignores abort still frees the slot via this race —
      // but its promise is retained so nothing overlaps the live dialog.
      e.transport = this.options.dialog(view, { signal: e.abort.signal }).then(
        answer => { e.transport = undefined; this.onDialogAnswer(e, view, answer); },
        () => { e.transport = undefined; this.onDialogAnswer(e, view, undefined); });
      e.transport.catch(() => {});
      // Race the answer bookkeeping against abort so a hung/ignored transport
      // cannot pin this entry or dispose; the transport itself is still awaited.
      await Promise.race([
        e.transport,
        new Promise<never>((_, reject) => {
          if (e.abort.signal.aborted) return reject(new PermissionFault('speech_onboarding_cancelled'));
          e.abort.signal.addEventListener('abort', () => reject(new PermissionFault('speech_onboarding_cancelled')), { once: true });
        }),
      ]);
    } catch (err) {
      if (this.phase(e) === 'done') return;
      const code = err instanceof PermissionFault ? err.code : 'speech_onboarding_failed';
      this.finish(e, code === 'speech_onboarding_cancelled' ? 'cancelled' : code === 'speech_onboarding_expired' || code === 'owner_gui_expired' ? 'expired'
        : code === 'speech_onboarding_generation_changed' ? 'unavailable' : 'failed', code);
    }
  }

  private async verify(e: Entry) {
    this.assertLease(e);
    const g = this.options.managed.generation();
    if (g.generation !== e.generation) fail('speech_onboarding_generation_changed');
    const actual = await this.options.managed.verifyIdentity(Object.freeze({ ...g }));
    if (actual.generation !== e.generation || actual.pid !== g.pid || actual.port !== g.port || actual.startedAt !== g.startedAt) fail('speech_onboarding_generation_changed');
    this.assertLease(e);
  }

  /** Poll the service status until the owned job settles or the lease dies. */
  private async watchJob(e: Entry) {
    const id = e.job?.id;
    while (this.phase(e) === 'committing' && !e.abort.signal.aborted && !this.closed) {
      if (this.now() >= (e.approvalUntil ?? 0)) return this.finish(e, 'expired');
      const status = this.options.service.ownerStatus();
      const job = status.job;
      if (job && job.id === id) {
        e.job = job; e.updatedAt = this.now();
        if (job.state === 'done') return this.finish(e, status.enabled ? 'ready' : 'failed', status.enabled ? undefined : 'speech_enable_incomplete');
        if (job.state === 'failed') return this.finish(e, 'failed', job.error ?? 'speech_enable_failed');
        if (job.state === 'cancelled') return this.finish(e, 'cancelled');
      } else if (status.enabled && !job) {
        return this.finish(e, 'ready');
      } else if (job && job.id !== id && job.state === 'running') {
        // A different running job is not ours — keep waiting for our own record.
      }
      await new Promise<void>(resolve => {
        const onAbort = () => { clearTimeout(t); resolve(); };
        const t = setTimeout(() => { e.abort.signal.removeEventListener('abort', onAbort); resolve(); }, 1000); t.unref?.();
        e.abort.signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

  private parsePayload(raw: unknown): SpeechOnboardingPayload {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_arguments');
    const p = raw as Record<string, unknown>;
    if (Object.keys(p).some(k => !['source', 'modelId', 'allowDownload', 'executablePath', 'modelDirectory'].includes(k))) fail('invalid_arguments');
    if (p.source !== 'managed' && p.source !== 'existing') fail('invalid_arguments');
    if (!speechModelId(p.modelId)) fail('invalid_arguments');
    if (p.allowDownload !== true && p.allowDownload !== false) fail('invalid_arguments');
    const payload: SpeechOnboardingPayload = { source: p.source as SpeechOnboardingPayload['source'], modelId: p.modelId as SpeechOnboardingPayload['modelId'], allowDownload: p.allowDownload as boolean };
    if (p.source === 'existing') {
      if (!validLocalExecutable(p.executablePath)) fail('speech_executable_invalid');
      if (p.modelDirectory !== undefined && !validLocalDirectory(p.modelDirectory)) fail('speech_model_directory_invalid');
      payload.executablePath = p.executablePath as string;
      if (p.modelDirectory) payload.modelDirectory = p.modelDirectory as string;
    } else {
      if (p.executablePath !== undefined || p.modelDirectory !== undefined) fail('invalid_arguments');
      if (p.allowDownload !== true) fail('speech_download_not_allowed');
    }
    return payload;
  }

  async dispose() {
    this.closed = true;
    for (const e of this.entries.values()) e.abort.abort();
    // Owned transports settle before disposal completes — nothing is left
    // half-alive after the broker is gone.
    const transports = [...this.entries.values()].map(e => e.transport).filter((t): t is Promise<void> => !!t);
    await Promise.all([...this.tasks, ...transports.map(t => t.catch(() => {}))]).catch(() => {});
  }
}
export type { SpeechOnboardingBroker as SpeechOnboardingService };
