import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { readJsonBody } from '../server/body.ts';

const MAX = 64;

// Test-only HTTP server running the production body reader on POST /echo. `obs` lets
// the test prove the handler engaged with the body and settled after the client died.
async function withEchoServer(use: (port: number, obs: { started: number; settled: number }) => Promise<void>) {
  const obs = { started: 0, settled: 0 };
  const server = createServer(async (req, res) => {
    obs.started++;
    try {
      const body = await readJsonBody(req, MAX);
      if (!res.destroyed) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, body })); }
    } catch (error) {
      if (!res.destroyed) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: (error as Error).message })); }
    } finally { obs.settled++; }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  try { await use(port, obs); }
  finally {
    server.closeAllConnections();
    await Promise.race([new Promise<void>(r => server.close(() => r())), new Promise<void>(r => setTimeout(r, 3000))]);
  }
}

// Poll a condition with a hard deadline so an observed-state assertion can never hang.
const until = async (ok: () => boolean, ms = 5000, what = 'condition') => {
  const start = Date.now();
  while (!ok()) { if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 10)); }
};

// POST `payload` as two TCP-level chunks split at `split` bytes (delayed so the boundary
// is real on the wire).
function postSplit(port: number, payload: Buffer, split: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { req.destroy(); reject(new Error('postSplit timed out')); }, 10000);
    const req = request({ port, host: '127.0.0.1', path: '/echo', method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, res => {
      let text = '';
      res.on('data', c => text += c);
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode!, text }); });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(payload.subarray(0, split));
    setTimeout(() => req.end(payload.subarray(split)), 5);
  });
}

test('JSON body decodes Japanese/emoji split at every byte boundary, enforces a byte limit, and aborts cleanly', { timeout: 60000 }, async () => {
  await withEchoServer(async (port, obs) => {
    // 1) Split at EVERY byte offset — including inside multi-byte UTF-8 sequences — must decode intact.
    const message = { text: '画像レビュー🖼️と計画', n: 1 };
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    for (let i = 1; i < payload.length; i++) {
      const { status, text } = await postSplit(port, payload, i);
      assert.equal(status, 200, `split at byte ${i}`);
      assert.deepEqual(JSON.parse(text).body, message, `split at byte ${i}`);
    }
    // 2) The limit is in BYTES: a Japanese body under the char budget still fails when its
    //    bytes exceed maxBytes; just-under and exact-byte bodies pass.
    const sized = (target: number) => {
      const head = Buffer.from('{"t":"', 'utf8'), tail = Buffer.from('"}', 'utf8');
      const unit = Buffer.from('あ', 'utf8'); // 3 bytes
      let body = Buffer.concat([head, tail]);
      while (body.length + unit.length <= target - 1) body = Buffer.concat([head, unit, body.subarray(head.length, body.length - tail.length), tail]);
      while (body.length < target) body = Buffer.concat([head, Buffer.from('x'), body.subarray(head.length, body.length - tail.length), tail]);
      return body;
    };
    assert.equal(sized(MAX).length, MAX);
    assert.equal((await postSplit(port, sized(MAX), MAX)).status, 200, 'exact-byte body is accepted');
    assert.equal((await postSplit(port, sized(MAX - 1), MAX - 1)).status, 200, 'just-under body is accepted');
    const over = await postSplit(port, sized(MAX + 1), MAX + 1);
    assert.equal(over.status, 400, 'one byte over the byte limit is rejected even though chars are few');
    assert.match(JSON.parse(over.text).error, /too large/);
    // 3) Invalid JSON fails cleanly; a normal single-write JSON body still parses.
    assert.equal((await postSplit(port, Buffer.from('{not json'), 0)).status, 400);
    const plain = await postSplit(port, Buffer.from(JSON.stringify({ ok: true, n: 42 })), 3);
    assert.deepEqual(JSON.parse(plain.text).body, { ok: true, n: 42 });
    // 4) A client that dies mid-body: prove the handler started reading, then settled
    //    within the deadline instead of hanging on the dead socket.
    const startedBefore = obs.started, settledBefore = obs.settled;
    const req = request({ port, host: '127.0.0.1', path: '/echo', method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } });
    req.on('error', () => {});
    await new Promise<void>(r => req.write(Buffer.from('{"part'), () => r())); // flushed to the server
    await until(() => obs.started > startedBefore, 5000, 'server handler engaged'); // server saw the request
    req.destroy();
    await until(() => obs.settled > settledBefore, 5000, 'server handler settled after client abort');
  });
});
