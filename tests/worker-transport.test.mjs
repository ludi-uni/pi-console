import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable, PassThrough } from 'node:stream';
import { FrameDecoder, FrameLineReader, TransportWriter, recordFrames, serializeRecord, FRAME_BYTES, waitForPressure } from '../package/worker-transport.mjs';
import { JsonlParser } from '../server/adapters/pi/parser.ts';
const gen = 'test-generation';
const frames = value => [...recordFrames(serializeRecord(value), gen, 0, value)];
const decode = list => { const reader = new FrameDecoder({ generation: gen }); let result; for (const frame of list) result = reader.accept(frame); return result; };
test('large final/tool/aggregate records are exact and every physical frame fits the existing parser', () => {
  for (const type of ['message_end', 'tool_execution_end', 'agent_end']) {
    const value = { type, data: '日本語😀\u2028\u2029\\\"'.repeat(800000) };
    const list = frames(value), parser = new JsonlParser();
    assert.ok(Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024);
    for (const frame of list) { const line = Buffer.from(JSON.stringify(frame) + '\n'); assert.ok(line.length <= FRAME_BYTES); assert.equal(parser.push(line).length, 1); }
    assert.deepEqual(decode(list), value);
  }
});
test('decoder refuses generation/sequence/duplicate/count/checksum/base64 errors and never returns partial data', () => {
  const base = frames({ type: 'event', text: 'x'.repeat(70000) });
  for (const change of [
    list => { list[0].generation = 'foreign'; },
    list => { list[0].seq = 1; },
    list => { list[0].bytes = 1e12; },
    list => { list[0].total++; },
    list => { list[1].data = '!!!!'; },
    list => { list.splice(2, 0, { ...list[1] }); },
    list => { list.at(-1).sha256 = 'bad'; },
    list => { list.splice(2, 1); },
  ]) { const copy = structuredClone(base); change(copy); assert.throws(() => decode(copy), /transport/); }
});
test('EOF and transfer timeout close partial assemblers', async () => {
  const list = frames({ type: 'event', text: 'some' });
  const reader = new FrameDecoder(); reader.accept(list[0]); assert.throws(() => reader.finish(), /EOF/);
  let error; const timed = new FrameDecoder({ timeoutMs: 10, onError: e => { error = e; } }); timed.accept(list[0]);
  await new Promise(r => setTimeout(r, 30)); assert.match(error.message, /timed out/); assert.throws(() => timed.accept(list[1]), /closed/);
});
test('byte reader uses LF only and handles fragmented/coalesced frames', () => {
  const value = { type: 'event', text: '日本😀\u2028\u2029' };
  const bytes = Buffer.from(frames(value).map(f => JSON.stringify(f) + '\n').join(''));
  const line = new FrameLineReader(), decoder = new FrameDecoder(); let result;
  for (let i = 0; i < bytes.length; i += 7) for (const frame of line.push(bytes.subarray(i, i + 7))) result = decoder.accept(frame) ?? result;
  line.finish(); assert.deepEqual(result, value);
});
test('writer snapshots at enqueue, serializes records and releases blocked sends on disconnect', async () => {
  const output = []; const stream = new Writable({ highWaterMark: 8, write(chunk, _encoding, cb) { output.push(Buffer.from(chunk)); setTimeout(cb, 1); } });
  const writer = new TransportWriter(stream, gen), value = { type: 'event', data: 'old' };
  const first = writer.send(value); value.data = 'changed'; const second = writer.send({ type: 'next' }); await Promise.all([first, second]);
  const reader = new FrameLineReader(), decoder = new FrameDecoder(); const result = [];
  for (const chunk of output) for (const frame of reader.push(chunk)) { const v = decoder.accept(frame); if (v) result.push(v); }
  assert.deepEqual(result, [{ type: 'event', data: 'old' }, { type: 'next' }]); writer.close();
  const stalled = new PassThrough({ highWaterMark: 1 }); const blocked = new TransportWriter(stalled, gen, { timeoutMs: 20 });
  await assert.rejects(blocked.send({ type: 'event', data: 'x'.repeat(70000) })); blocked.close(); stalled.destroy();
});
test('abort releases SDK pressure immediately while queued records remain complete and ordered', async () => {
  const stream = new PassThrough({ highWaterMark: 1 }), writer = new TransportWriter(stream, gen);
  const value = { type: 'event', text: 'x'.repeat(70000) }, sent = writer.send(value), controller = new AbortController();
  const pressure = waitForPressure(writer, controller.signal); controller.abort(); await pressure;
  assert.ok(writer.pendingBytes > 0);
  const output = []; stream.on('data', chunk => output.push(chunk)); await sent;
  const line = new FrameLineReader(), decoder = new FrameDecoder(); let result;
  for (const chunk of output) for (const frame of line.push(chunk)) result = decoder.accept(frame) ?? result;
  assert.deepEqual(result, value); writer.close(); stream.destroy();
});
test('logical resource and queued byte limits reject rather than truncate', async () => {
  const stream = new PassThrough({ highWaterMark: 1 }), writer = new TransportWriter(stream, gen, { maxBytes: 100, queuedBytes: 20 });
  await assert.rejects(writer.send({ type: 'event', text: 'x'.repeat(200) }), /resource/);
  await assert.rejects(writer.send({ type: 'event', text: 'small' }), /resource/); writer.close(); stream.destroy();
});
