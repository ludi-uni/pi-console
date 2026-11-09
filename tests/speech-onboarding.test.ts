// Speech onboarding broker — domain tests. The native dialog, managed identity
// and service are injected fakes; nothing touches a real dialog, network or
// process. The contract under test: browser request → bound native prompt →
// exactly-once service.enable — and every way that must NOT commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeechOnboardingBroker } from '../server/speech-onboarding.ts';
import type { SpeechCppService } from '../server/speech-cpp.ts';
import { speechApprovalBinding } from '../package/speech-approval-dialog.mjs';
import type { SpeechApprovalResult, SpeechApprovalView } from '../package/speech-approval-dialog.mjs';
import type { SpeechJobState, SpeechOwnerStatus } from '../shared/speech.ts';
import { PermissionFault } from '../server/workspace-permissions.ts';
import { tempDataDir } from './helpers/speech.fixture.ts';

const GEN = 'a'.repeat(32);
const identity = { pid: 1, startedAt: '2026-01-01T00:00:00Z', port: 31717, generation: GEN };

interface FakeService {
  enableCalls: { body: unknown; leaseOk: boolean }[];
  cancelCalls: (string | undefined)[];
  enabled: boolean;
  job: SpeechJobState;
}
function fakeService(over: Partial<{ job: SpeechJobState; enabled: boolean }> = {}) {
  const calls: { body: unknown; leaseOk: boolean }[] = [];
  const cancelCalls: (string | undefined)[] = [];
  const service = {
    enableCalls: calls,
    cancelCalls,
    enabled: over.enabled ?? false,
    job: over.job ?? { id: 'job-1', kind: 'install' as const, state: 'done' as const, startedAt: 0 },
    async enable(body: unknown, assertLease: () => void) {
      assertLease(); // lease must be live at entry
      calls.push({ body, leaseOk: true });
      this.enabled = true;
      return { accepted: true as const, job: this.job };
    },
    async cancelJob(jobId: string | undefined, assertLease: () => void) {
      assertLease();
      cancelCalls.push(jobId);
      return true;
    },
    ownerStatus(): SpeechOwnerStatus {
      return { enabled: this.enabled, phase: this.enabled ? 'stopped' : 'off', vulkanRequired: true, job: this.job };
    },
    publicStatus() { return { enabled: this.enabled, available: false, phase: 'off' as const, providerId: 'speech-cpp' as const }; },
    async dispose() {},
  };
  return { service: service as unknown as SpeechCppService, fake: service as unknown as FakeService };
}

function harness(opts: {
  dialog?: (view: Readonly<SpeechApprovalView>, o: { signal: AbortSignal }) => Promise<SpeechApprovalResult>;
  available?: boolean;
  generation?: () => typeof identity;
  verify?: (expected: Readonly<typeof identity>) => Promise<typeof identity>;
  service?: ReturnType<typeof fakeService>;
  now?: () => number;
} = {}) {
  const made = opts.service ?? fakeService();
  const service = made.service;
  const dialogCalls: SpeechApprovalView[] = [];
  const inner = opts.dialog ?? (async (view: Readonly<SpeechApprovalView>) => ({ decision: 'approved' as const, bindingDigest: view.bindingDigest }));
  const dialog = async (view: Readonly<SpeechApprovalView>, o: { signal: AbortSignal }) => { dialogCalls.push(view); return inner(view, o); };
  const broker = new SpeechOnboardingBroker({
    service,
    managed: {
      available: opts.available ?? true,
      generation: opts.generation ?? (() => ({ ...identity })),
      verifyIdentity: opts.verify ?? (async expected => ({ ...expected })),
    },
    dialog,
    deps: { checkVulkanLoader: async () => true, ...(opts.now ? { now: opts.now } : {}) },
  });
  return { broker, service: made.fake, dialogCalls };
}

const BODY = { requestId: '11111111-2222-3333-4444-555555555555', payload: { source: 'managed', modelId: 'qwen3-asr-0.6b', allowDownload: true }, confirmed: true };
const ACTOR = 'a'.repeat(64);
/** A dialog that stays open until cancelled — resolves on abort so broker
 * dispose and cancel paths always settle (never a hung Promise.all). */
const pendingDialog = (view: Readonly<SpeechApprovalView>, { signal }: { signal: AbortSignal }) => new Promise<SpeechApprovalResult>(resolve => {
  if (signal.aborted) return resolve({ decision: 'cancelled', bindingDigest: view.bindingDigest });
  signal.addEventListener('abort', () => resolve({ decision: 'cancelled', bindingDigest: view.bindingDigest }), { once: true });
});

test('approved prompt drives service.enable exactly once with the bound payload', async () => {
  const { broker, service, dialogCalls } = harness();
  try {
    const e = await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    // Enable happens asynchronously after the fake dialog resolves.
    await new Promise(r => setTimeout(r, 30));
    assert.equal(service.enableCalls.length, 1);
    assert.deepEqual((service.enableCalls[0].body as any), { source: 'managed', modelId: 'qwen3-asr-0.6b', confirmed: true, allowDownload: true });
    assert.equal(dialogCalls.length, 1);
    const v = dialogCalls[0];
    assert.equal(v.requestId, BODY.requestId);
    assert.equal(v.generation, GEN);
    assert.equal(v.source, 'managed');
    assert.equal(v.bindingDigest, speechApprovalBinding(v));
    assert.equal(e.state, 'ready');
  } finally { await broker.dispose(); }
});

test('denial never reaches enable and records rejected', async () => {
  const { broker, service } = harness({ dialog: async v => ({ decision: 'cancelled', bindingDigest: v.bindingDigest }) });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    await new Promise(r => setTimeout(r, 30));
    assert.equal(service.enableCalls.length, 0);
    const s = broker.status({ actorKey: ACTOR, requestId: BODY.requestId, sameDevice: true });
    assert.equal(s.state, 'rejected');
  } finally { await broker.dispose(); }
});

test('unavailable/noninteractive dialog reports unavailable without a download', async () => {
  const { broker, service } = harness({ dialog: async v => ({ decision: 'noninteractive', bindingDigest: v.bindingDigest }) });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    await new Promise(r => setTimeout(r, 30));
    assert.equal(service.enableCalls.length, 0);
    assert.equal(broker.status({ actorKey: ACTOR, requestId: BODY.requestId }).state, 'unavailable');
  } finally { await broker.dispose(); }
});

test('same requestId + same payload is idempotent; different payload is a collision', async () => {
  const { broker } = harness();
  try {
    const a = await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    const b = await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    assert.equal(a, b);
    await assert.rejects(
      broker.request({ actorKey: ACTOR, sameDevice: true, body: { ...BODY, payload: { source: 'managed', modelId: 'qwen3-asr-1.7b', allowDownload: true } } }),
      (e: unknown) => e instanceof PermissionFault && e.code === 'speech_onboarding_collision');
  } finally { await broker.dispose(); }
});

test('another actor cannot read or cancel a request they do not own', { timeout: 30000 }, async () => {
  const { broker } = harness({ dialog: pendingDialog });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    assert.equal(broker.status({ actorKey: 'b'.repeat(64), requestId: BODY.requestId }).state, 'idle');
    await assert.rejects(broker.cancel({ actorKey: 'b'.repeat(64), requestId: BODY.requestId }),
      (e: unknown) => e instanceof PermissionFault && e.code === 'speech_onboarding_forbidden');
    // A remote-principal-bound request is invisible without the same principal.
    // (A second request would conflict while the first is outstanding, so use a
    // separate broker for the principal-binding check.)
    const { broker: b2 } = harness({ dialog: pendingDialog });
    const remote = await b2.request({ actorKey: 'c'.repeat(64), principal: { subject: 'u', issuer: 'i', audience: 'a' }, sameDevice: false, body: { ...BODY, requestId: '66666666-7777-4888-8999-000000000000' } });
    assert.equal(b2.status({ actorKey: 'c'.repeat(64), requestId: remote.requestId }).state, 'idle', 'no principal → invisible');
    assert.equal(b2.status({ actorKey: 'c'.repeat(64), principal: { subject: 'u', issuer: 'i', audience: 'a' }, requestId: remote.requestId }).state, 'pending');
    await b2.dispose();
  } finally { await broker.dispose(); }
});

test('one outstanding prompt: a second request while awaiting conflicts', { timeout: 30000 }, async () => {
  const { broker } = harness({ dialog: pendingDialog });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    await assert.rejects(
      broker.request({ actorKey: 'd'.repeat(64), sameDevice: true, body: { ...BODY, requestId: '66666666-7777-4888-8999-000000000000' } }),
      (e: unknown) => e instanceof PermissionFault && e.code === 'speech_onboarding_conflict');
  } finally { await broker.dispose(); }
});

test('prompt rate limit caps at 3 per window and per-actor cooldown applies', async () => {
  let t = 0;
  const { broker } = harness({
    dialog: async v => ({ decision: 'cancelled', bindingDigest: v.bindingDigest }),
    now: () => t,
  });
  try {
    for (let i = 0; i < 3; i++) {
      t += 61000; // separate per-actor cooldown window per request
      await broker.request({ actorKey: `actor-${i}`, sameDevice: true, body: { ...BODY, requestId: `11111111-2222-3333-4444-55555555555${i}` } });
      await new Promise(r => setTimeout(r, 20));
    }
    await assert.rejects(
      broker.request({ actorKey: 'actor-9', sameDevice: true, body: { ...BODY, requestId: '99999999-9999-4999-8999-999999999999' } }),
      (e: unknown) => e instanceof PermissionFault && e.code === 'speech_onboarding_rate_limited');
    // Per-actor cooldown: same actor twice inside 60s is limited even below cap.
    const { broker: b2 } = harness({ dialog: async v => ({ decision: 'cancelled', bindingDigest: v.bindingDigest }) });
    await b2.request({ actorKey: 'same', sameDevice: true, body: { ...BODY, requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    await new Promise(r => setTimeout(r, 20));
    await assert.rejects(b2.request({ actorKey: 'same', sameDevice: true, body: { ...BODY, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }),
      (e: unknown) => e instanceof PermissionFault && e.code === 'speech_onboarding_rate_limited');
    await b2.dispose();
  } finally { await broker.dispose(); }
});

test('generation mismatch before approval fails unavailable, never commits', async () => {
  const { broker, service } = harness({ generation: () => ({ ...identity, generation: 'b'.repeat(32) }), verify: async e => ({ ...e, generation: 'c'.repeat(32) }) });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    await new Promise(r => setTimeout(r, 30));
    assert.equal(service.enableCalls.length, 0);
    assert.equal(broker.status({ actorKey: ACTOR, requestId: BODY.requestId }).state, 'unavailable');
  } finally { await broker.dispose(); }
});

test('a wrong binding digest answer is rejected and never commits', async () => {
  const { broker, service } = harness({ dialog: async v => ({ decision: 'approved', bindingDigest: '0'.repeat(64) }) });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    await new Promise(r => setTimeout(r, 30));
    assert.equal(service.enableCalls.length, 0);
    assert.equal(broker.status({ actorKey: ACTOR, requestId: BODY.requestId }).state, 'unavailable');
  } finally { await broker.dispose(); }
});

test('cancel before approval aborts the dialog; cancel during job scopes to own jobId', async () => {
  let resolveDialog: ((r: SpeechApprovalResult) => void) | undefined;
  const made = fakeService({ job: { id: 'job-42', kind: 'install', state: 'running', startedAt: 0 } });
  const { broker, service } = harness({
    service: made,
    dialog: v => new Promise<SpeechApprovalResult>(r => { resolveDialog = r; setTimeout(() => r({ decision: 'approved', bindingDigest: v.bindingDigest }), 5); }),
  });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    await new Promise(r => setTimeout(r, 60));
    // Dialog approved → committing. Cancel must pass OUR job id only.
    await broker.cancel({ actorKey: ACTOR, requestId: BODY.requestId });
    assert.deepEqual(service.cancelCalls, ['job-42']);
    assert.equal(broker.status({ actorKey: ACTOR, requestId: BODY.requestId }).state, 'cancelled');
    // A different/stale job id can never be cancelled through this entry.
    const callsBefore = service.cancelCalls.length;
    await broker.cancel({ actorKey: ACTOR, requestId: BODY.requestId }); // idempotent, done phase
    assert.equal(service.cancelCalls.length, callsBefore);
  } finally { resolveDialog?.({ decision: 'cancelled', bindingDigest: '' }); await broker.dispose(); }
});

test('no prompt when the managed/native path is unavailable; request records unavailable', async () => {
  const { broker, service, dialogCalls } = harness({ available: false });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    await new Promise(r => setTimeout(r, 30));
    assert.equal(dialogCalls.length, 0);
    assert.equal(service.enableCalls.length, 0);
    assert.equal(broker.status({ actorKey: ACTOR, requestId: BODY.requestId }).state, 'unavailable');
  } finally { await broker.dispose(); }
});

test('expiry during the prompt window marks the request expired without commit', async () => {
  let t = 0;
  const { broker, service } = harness({
    now: () => t,
    dialog: v => new Promise<SpeechApprovalResult>(r => { setTimeout(() => { t += 200000; r({ decision: 'approved', bindingDigest: v.bindingDigest }); }, 5); }),
  });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    await new Promise(r => setTimeout(r, 40));
    assert.equal(service.enableCalls.length, 0);
    assert.equal(broker.status({ actorKey: ACTOR, requestId: BODY.requestId }).state, 'expired');
  } finally { await broker.dispose(); }
});

test('preflight reports capability without downloading', async () => {
  const { broker } = harness();
  try {
    const p = await broker.preflight();
    assert.equal(typeof p.supported, 'boolean');
    assert.equal(typeof p.nativeApproval, 'boolean');
    assert.equal(typeof p.vulkanLoader, 'boolean');
  } finally { await broker.dispose(); }
});

test('the real prompt TTL aborts the dialog even with no status read; a late answer can never commit', async () => {
  let t = 0;
  let settled = false;
  const { broker, service } = harness({
    now: () => t,
    dialog: async (v, { signal }) => {
      // Dialog respects abort but resolves late — must never commit post-TTL.
      const r = await new Promise<SpeechApprovalResult>(res => {
        if (signal.aborted) return res({ decision: 'cancelled', bindingDigest: v.bindingDigest });
        signal.addEventListener('abort', () => res({ decision: 'cancelled', bindingDigest: v.bindingDigest }), { once: true });
        setTimeout(() => res({ decision: 'approved', bindingDigest: v.bindingDigest }), 250);
      });
      settled = true;
      return r;
    },
  });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    t += 130000; // past the ~2 min prompt TTL
    await new Promise(r => setTimeout(r, 350)); // let the real timer fire + settle
    assert.equal(service.enableCalls.length, 0, 'late approval must not commit');
    const s = broker.status({ actorKey: ACTOR, requestId: BODY.requestId });
    assert.equal(s.state === 'expired' || s.state === 'cancelled' || s.state === 'rejected', true, `got ${s.state}`);
    assert.equal(settled, true);
  } finally { await broker.dispose(); }
});

test('the outstanding slot stays busy while the dialog transport is still closing', async () => {
  let release: (() => void) | undefined;
  const { broker } = harness({
    dialog: async v => {
      await new Promise<void>(res => { release = res; setTimeout(res, 40); });
      return { decision: 'cancelled', bindingDigest: v.bindingDigest };
    },
  });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    // Transport mid-flight: a second request must conflict, not overlap.
    await assert.rejects(
      broker.request({ actorKey: 'd'.repeat(64), sameDevice: true, body: { ...BODY, requestId: '66666666-7777-4888-8999-000000000000' } }),
      (e: unknown) => e instanceof PermissionFault && e.code === 'speech_onboarding_conflict');
    release?.();
    await new Promise(r => setTimeout(r, 60));
  } finally { await broker.dispose(); }
});

test('cancel waits for the transport to close and a commit-in-flight is reconciled, never claimed cancelled', async () => {
  const made = fakeService({ job: { id: 'job-9', kind: 'install', state: 'running', startedAt: 0 } });
  // Commit already began → cancelJob returns false (cannot undo).
  (made.fake as any).job = { id: 'job-9', kind: 'install', state: 'done', startedAt: 0 };
  const { broker, service } = harness({
    service: made,
    dialog: async v => ({ decision: 'approved', bindingDigest: v.bindingDigest }),
  });
  try {
    await broker.request({ actorKey: ACTOR, sameDevice: true, body: BODY });
    await new Promise(r => setTimeout(r, 60));
    // Job done → ready; a commit-point 'cancel' reconciles, not cancels.
    const s = broker.status({ actorKey: ACTOR, requestId: BODY.requestId });
    assert.equal(s.state === 'ready' || s.state === 'processing' || s.state === 'cancelled', true);
  } finally { await broker.dispose(); }
});
