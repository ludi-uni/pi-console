// Fixed native speech-approval transport/binding — the approved view is
// immutable (requestId + payload + generation + TTL), the digest covers real
// path fields, default Enter/Escape/close = cancel, and approval binds only
// this speech setup — never admin/MCP grants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechApprovalBinding, speechApprovalDisplay, createWindowsSpeechApprovalDialog, speechApprovalScript, type SpeechApprovalView } from '../package/speech-approval-dialog.mjs';

const base: Omit<SpeechApprovalView, 'bindingDigest'> = {
  requestId: '11111111-2222-4333-8444-555555555555',
  generation: 'a'.repeat(32),
  expiresAt: 1700000000000,
  source: 'managed',
  modelId: 'qwen3-asr-0.6b',
  modelLabel: 'Qwen3-ASR 0.6B',
  downloadBytesNote: '約0.84 GB · モデル単体',
  allowDownload: true,
  hasExistingExecutable: false,
  hasExistingModelDirectory: false,
};
const view = (over: Partial<typeof base> = {}): SpeechApprovalView => {
  const t = { ...base, ...over };
  return { ...t, bindingDigest: speechApprovalBinding(t) };
};

test('binding covers requestId + generation + payload including real paths', () => {
  const a = view();
  assert.match(a.bindingDigest, /^[0-9a-f]{64}$/);
  // Different payload → different digest.
  assert.notEqual(view({ modelId: 'qwen3-asr-1.7b' }).bindingDigest, a.bindingDigest);
  assert.notEqual(view({ source: 'existing', hasExistingExecutable: true, executablePath: 'C:\\A\\speech.exe' }).bindingDigest, a.bindingDigest);
  assert.notEqual(view({ executablePath: 'C:\\A\\speech.exe' }).bindingDigest, view({ executablePath: 'C:\\B\\speech.exe' }).bindingDigest);
  assert.notEqual(view({ modelDirectory: 'C:\\M' }).bindingDigest, a.bindingDigest);
  assert.notEqual(view({ requestId: '99999999-9999-4999-8999-999999999999' }).bindingDigest, a.bindingDigest);
  assert.notEqual(view({ generation: 'b'.repeat(32) }).bindingDigest, a.bindingDigest);
  // Malformed/absent fields throw.
  assert.throws(() => speechApprovalBinding({ ...base, requestId: 'x' } as any));
  assert.throws(() => speechApprovalBinding({ ...base, generation: 'z'.repeat(32) } as any));
  assert.throws(() => speechApprovalBinding({ ...base, source: 'bogus' } as any));
  assert.throws(() => speechApprovalBinding({ ...base, executablePath: 'bad\npath' } as any));
});

test('display shows the bound consent fields and never grants admin', () => {
  const v = view({ source: 'existing', hasExistingExecutable: true, executablePath: 'C:\\Tools\\speech.exe', hasExistingModelDirectory: true, modelDirectory: 'C:\\Models' });
  const text = speechApprovalDisplay(v);
  assert.match(text, /音声入力/);
  // Paths are shown JSON-quoted/escaped — present in the bound display.
  assert.match(text, /C:[\\]{2}Tools[\\]{2}speech\.exe/);
  assert.match(text, /C:[\\]{2}Models/);
  assert.match(text, /管理者登録・MCPキー・他の権限は付与しません/);
  assert.match(text, /初期状態の Enter・Escape・取消・閉じるでは許可しません/);
  // Escaped control/bidi chars never reach the dialog verbatim.
  const evil = view({ executablePath: 'C:\\A\u202e.exe', hasExistingExecutable: true });
  assert(!speechApprovalDisplay(evil).includes('\u202e'));
  // A view whose digest does not match its fields is refused.
  assert.throws(() => speechApprovalDisplay({ ...v, bindingDigest: '0'.repeat(64) }));
});

test('default cancel: any non-Yes dialog result is not approved', async () => {
  for (const decision of ['cancelled', 'noninteractive', 'unavailable', 'bogus', '']) {
    const dialog = createWindowsSpeechApprovalDialog({ transport: async () => decision, platform: 'win32', env: {} });
    const v = view();
    const r = await dialog(v, { signal: new AbortController().signal });
    assert.notEqual(r.decision, 'approved', decision);
    assert.equal(r.bindingDigest, v.bindingDigest);
  }
  const approved = createWindowsSpeechApprovalDialog({ transport: async () => 'approved', platform: 'win32', env: {} });
  const v = view();
  const r = await approved(v, { signal: new AbortController().signal });
  assert.equal(r.decision, 'approved');
  assert.equal(r.bindingDigest, v.bindingDigest);
});

test('non-Windows platform and aborted signal never approve', async () => {
  const ac = new AbortController();
  const notWin = createWindowsSpeechApprovalDialog({ transport: async () => 'approved', platform: 'linux', env: {} });
  const r1 = await notWin(view(), { signal: ac.signal });
  assert.equal(r1.decision, 'unavailable');
  ac.abort();
  const win = createWindowsSpeechApprovalDialog({ transport: async () => 'approved', platform: 'win32', env: {} });
  const r2 = await win(view(), { signal: ac.signal });
  assert.equal(r2.decision, 'cancelled');
});

test('the fixed script contains no admin grant verbs and stdin JSON only', () => {
  // Fixed script: no argv interpolation, no Invoke-Expression, no external file.
  assert(!speechApprovalScript.includes('Invoke-Expression'));
  assert(!speechApprovalScript.includes('Start-Process'));
  assert.match(speechApprovalScript, /ConvertFrom-Json/);
  assert.match(speechApprovalScript, /DialogResult\]::Cancel/);
  assert.match(speechApprovalScript, /音声入力を許可/);
  assert(!speechApprovalScript.includes('管理者'));
});
