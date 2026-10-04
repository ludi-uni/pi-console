import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PromptReceipts, PromptDeliveryError } from '../server/runtime/prompt-receipts.ts';
const id = '12345678-1234-4234-8234-123456789abc';
const payload = { workspaceId: 'w', sessionId: 's', message: 'sensitive prompt', attachments: [], mode: null };

test('concurrent retry and retry after restart share the accepted outcome without dispatching twice', { timeout: 5000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-console-receipts-'));
  try {
    const receipts = new PromptReceipts(dir);
    let calls = 0, resolve!: (id: string) => void;
    const original = receipts.execute(id, payload, () => { calls++; return new Promise(r => { resolve = r; }); });
    const retry = receipts.execute(id, payload, async () => { calls++; return 'duplicate'; });
    while (!resolve) await new Promise(r => setTimeout(r, 5));
    assert.equal(calls, 1);
    await assert.rejects(receipts.execute(id, { ...payload, sessionId: 'other' }, async () => 'wrong'), PromptDeliveryError);
    resolve('run-1');
    assert.deepEqual(await Promise.all([original, retry]), ['run-1', 'run-1']);
    assert.equal(await new PromptReceipts(dir).execute(id, payload, async () => { calls++; return 'duplicate'; }), 'run-1');
    assert.equal(calls, 1);
    const stored = await readFile(join(dir, `${id}.json`), 'utf8');
    assert.ok(!stored.includes(payload.message));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pending or failed acknowledgement receipts fail closed across restart and never redispatch', { timeout: 5000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-console-receipts-'));
  try {
    let resolve!: (id: string) => void, calls = 0;
    const receipts = new PromptReceipts(dir);
    const original = receipts.execute(id, payload, () => { calls++; return new Promise(r => { resolve = r; }); });
    while (!resolve) await new Promise(r => setTimeout(r, 5));
    await assert.rejects(new PromptReceipts(dir).execute(id, payload, async () => { calls++; return 'duplicate'; }), /Delivery is unconfirmed/);
    resolve('run-1'); await original;
    const failedId = '12345678-1234-4234-8234-123456789abd';
    await assert.rejects(receipts.execute(failedId, payload, async () => { calls++; throw Error('worker ACK lost'); }), PromptDeliveryError);
    await assert.rejects(new PromptReceipts(dir).execute(failedId, payload, async () => { calls++; return 'duplicate'; }), PromptDeliveryError);
    assert.equal(calls, 2);
    await assert.rejects(receipts.execute('../escape', payload, async () => { calls++; return 'bad'; }), /invalid prompt request ID/);
    assert.equal(calls, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
