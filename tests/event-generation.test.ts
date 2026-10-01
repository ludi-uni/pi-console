import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SessionEvents } from '../server/runtime/events.ts';
import type { ExecutionEvent, Snapshot } from '../shared/types.ts';

const session = { id: 'sid', workspaceId: 'wid', filePath: '/tmp/session.jsonl' };

// Minimal stand-in for the /api/events wire contract: replays snapshot events above the
// cursor, then streams live events. New generation is checked like server/index.ts.
function sse(state: SessionEvents): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const from = Number(url.searchParams.get('since') ?? 0);
    const generation = url.searchParams.get('generation') ?? '';
    const snapshot = state.snapshot();
    if (generation && generation !== snapshot.generation) { res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'event generation changed; reload snapshot' })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const ev of snapshot.events) if (ev.seq > from) res.write(`id: ${ev.seq}\nevent: execution\ndata: ${JSON.stringify(ev)}\n\n`);
    const unsubscribe = state.subscribe(ev => { if (!res.destroyed) res.write(`id: ${ev.seq}\nevent: execution\ndata: ${JSON.stringify(ev)}\n\n`); });
    req.on('close', unsubscribe);
  });
}

// Read exactly `frames` SSE event payloads from a never-ending stream, then abort.
// Fetch's response.text() on an open SSE stream never resolves, so bounded reads are
// mandatory — this is what made the previous version of this test hang forever.
async function readFrames(url: string, frames: number, ms = 10000): Promise<any[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timed out waiting for ${frames} SSE frames`)), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const out: any[] = [];
    try {
      while (out.length < frames) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, i); buffer = buffer.slice(i + 2);
          const data = chunk.split('\n').find(s => s.startsWith('data: '));
          if (data) out.push(JSON.parse(data.slice(6)));
        }
      }
    } finally { await reader.cancel().catch(() => {}); }
    return out;
  } finally { ctrl.abort(); clearTimeout(timer); }
}

// Mirrors the stale-event checks wired into web/main.tsx: a snapshot establishes the
// (generation, seq) baseline; events from another generation or a lower seq are rejected.
function clientApply(current: Snapshot | undefined, event: ExecutionEvent): { accepted: boolean; next: Snapshot | undefined } {
  if (!current || event.generation !== current.generation || event.seq <= current.seq) return { accepted: false, next: current };
  if (event.seq !== current.seq + 1) return { accepted: false, next: current }; // gap → caller refreshes
  return { accepted: true, next: { ...current, seq: event.seq, events: [...current.events, event].slice(-5000) } };
}

test('generation is stable across seq; a restart re-baselines clients and rejects stale seq', () => {
  const first = new SessionEvents(session, () => 'running');
  first.preparePrompt('one'); first.accepted(); first.ingest({ type: 'agent_settled' });
  const snapA = first.snapshot();
  assert.ok(snapA.generation);
  assert.ok(snapA.events.every(e => e.generation === first.generation && e.seq >= 1));

  const restarted = new SessionEvents(session, () => 'running');
  restarted.preparePrompt('two'); restarted.accepted(); restarted.ingest({ type: 'agent_settled' });
  const snapB = restarted.snapshot();
  assert.notEqual(snapB.generation, snapA.generation, 'a restarted server must mint a new generation');
  assert.equal(snapB.events[0].seq, 1, 'seq restarts low after a reboot');

  // clientApply never seeds a baseline from an event — only from a snapshot.
  assert.equal(clientApply(undefined, snapB.events[0]).accepted, false);
  // PC anchors the new generation via the snapshot; the phone's late old-generation
  // event (seq lower than the new baseline) must be dropped, not adopted.
  let client: Snapshot | undefined = snapB;
  const stale: ExecutionEvent = { ...snapA.events[0], seq: 0 }; // late event on the old connection
  assert.equal(clientApply(client, stale).accepted, false, 'old-generation event must not be applied');
  const live = { ...snapB.events.at(-1)!, eventId: 'live-next', seq: snapB.seq + 1 };
  const applied = clientApply(client, live);
  assert.equal(applied.accepted, true);
  client = applied.next;
  assert.equal(client?.seq, snapB.seq + 1);
});

test('server refuses to stream across a generation boundary and both clients converge on the new generation', { timeout: 30000 }, async () => {
  const oldState = new SessionEvents(session, () => 'running');
  oldState.preparePrompt('old'); oldState.accepted(); oldState.ingest({ type: 'agent_settled' });
  const newState = new SessionEvents(session, () => 'running');
  newState.preparePrompt('new'); newState.accepted(); newState.ingest({ type: 'agent_settled' });

  const oldServer = sse(oldState); oldServer.listen(0, '127.0.0.1'); await once(oldServer, 'listening');
  const newServer = sse(newState); newServer.listen(0, '127.0.0.1'); await once(newServer, 'listening');
  const oldPort = (oldServer.address() as AddressInfo).port;
  const newPort = (newServer.address() as AddressInfo).port;
  try {
    const pcBase = newState.snapshot(); // PC resumed first after the restart
    assert.equal(pcBase.seq > 0, true);

    // The phone still streams from the OLD server: it receives old-generation events.
    const late = readFrames(`http://127.0.0.1:${oldPort}/api/events?since=0`, 1);
    // ...and its cursor on the NEW server is rejected instead of silently adopted.
    const refused = await fetch(`http://127.0.0.1:${newPort}/api/events?since=${pcBase.seq + 100}&generation=${oldState.generation}`);
    assert.equal(refused.status, 409, 'a stale-generation cursor must not replay new events');
    assert.match(await refused.text(), /generation/);

    // Old-connection frames carry the old generation → client drops them even at seq 0/1.
    const oldFrames = await late;
    assert.ok(oldFrames.every(e => e.generation === oldState.generation));
    let phone: Snapshot | undefined = pcBase; // phone already re-resumed to the new gen
    for (const ev of oldFrames) assert.equal(clientApply(phone, ev).accepted, false, `stale frame ${ev.eventId} accepted`);

    // New-generation stream on the matching generation delivers contiguous seqs.
    const frames = await readFrames(`http://127.0.0.1:${newPort}/api/events?since=0&generation=${pcBase.generation}`, pcBase.seq);
    assert.deepEqual(frames.map(e => e.seq), pcBase.events.map(e => e.seq));
    assert.ok(frames.every(e => e.generation === newState.generation));
    for (const ev of frames) { const applied = clientApply(phone, ev); if (applied.accepted) phone = applied.next; }
    assert.equal(phone?.seq, pcBase.seq);
  } finally {
    oldServer.closeAllConnections?.(); newServer.closeAllConnections?.();
    const closed = Promise.all([new Promise<void>(r => oldServer.close(() => r())), new Promise<void>(r => newServer.close(() => r()))]);
    await Promise.race([closed, new Promise<void>(r => setTimeout(r, 3000))]);
  }
});
