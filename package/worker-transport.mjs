import { createHash } from 'node:crypto';
import { once } from 'node:events';

export const FRAME_BYTES = 64 * 1024;
export const CHUNK_BYTES = 32 * 1024;
// Independent of the unchanged 8 MiB physical JSONL parser guard. This exceeds
// 0.4.3's 144 MiB decoded history capacity; overflow is an error, never truncation.
export const RECORD_BYTES = 192 * 1024 * 1024;
export const QUEUED_BYTES = 256 * 1024 * 1024;
const protocol = 'pi-console-worker';
const validGeneration = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const error = reason => new Error(`Console worker transport: ${reason}`);

export function serializeRecord(value, maxBytes = RECORD_BYTES) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (!bytes.length || bytes.length > maxBytes) throw error('record resource limit exceeded');
  return bytes;
}
export function* recordFrames(bytes, generation, seq, hint = {}) {
  if (!validGeneration(generation) || !Number.isSafeInteger(seq) || seq < 0) throw error('invalid sender identity');
  const base = { protocol, version: 1, generation, seq };
  const total = Math.ceil(bytes.length / CHUNK_BYTES);
  yield { ...base, kind: 'begin', bytes: bytes.length, total, id: typeof hint.id === 'string' ? hint.id : undefined, type: hint.type };
  for (let index = 0; index < total; index++) yield { ...base, kind: 'chunk', index, data: bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).toString('base64') };
  yield { ...base, kind: 'end', sha256: digest(bytes) };
}
export class FrameDecoder {
  constructor({ generation, maxBytes = RECORD_BYTES, timeoutMs = 60000, onStart = () => {}, onError = () => {} } = {}) {
    if (generation !== undefined && !validGeneration(generation)) throw error('invalid generation');
    this.generation = generation; this.maxBytes = maxBytes; this.timeoutMs = timeoutMs; this.onStart = onStart; this.onError = onError;
    this.seq = 0; this.active = undefined; this.failed = false;
  }
  accept(frame) {
    try {
      if (this.failed) throw error('decoder closed');
      if (!frame || frame.protocol !== protocol || frame.version !== 1 || !validGeneration(frame.generation) || frame.seq !== this.seq) throw error('invalid protocol, generation or sequence');
      this.generation ??= frame.generation;
      if (frame.generation !== this.generation || Buffer.byteLength(JSON.stringify(frame)) > FRAME_BYTES) throw error('generation or frame size mismatch');
      if (frame.kind === 'begin') {
        if (this.active || !Number.isSafeInteger(frame.bytes) || frame.bytes < 1 || frame.bytes > this.maxBytes || frame.total !== Math.ceil(frame.bytes / CHUNK_BYTES) || (frame.id !== undefined && (typeof frame.id !== 'string' || frame.id.length > 256)) || (frame.type !== undefined && (typeof frame.type !== 'string' || frame.type.length > 128))) throw error('invalid transfer declaration');
        const timer = setTimeout(() => { this.close(); this.onError(error('transfer timed out')); }, this.timeoutMs); timer.unref();
        this.active = { bytes: frame.bytes, total: frame.total, chunks: [], received: 0, timer, id: frame.id, type: frame.type };
        this.onStart({ id: frame.id, type: frame.type }); return;
      }
      const task = this.active;
      if (!task) throw error('transfer missing begin');
      if (frame.kind === 'chunk') {
        if (frame.index !== task.chunks.length || frame.index >= task.total || typeof frame.data !== 'string' || frame.data.length > Math.ceil(CHUNK_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)) throw error('invalid chunk');
        const bytes = Buffer.from(frame.data, 'base64');
        const expected = Math.min(CHUNK_BYTES, task.bytes - task.received);
        if (bytes.length !== expected || bytes.toString('base64') !== frame.data) throw error('invalid chunk bytes');
        task.chunks.push(bytes); task.received += bytes.length; return;
      }
      if (frame.kind !== 'end' || task.received !== task.bytes || task.chunks.length !== task.total) throw error('incomplete transfer');
      const bytes = Buffer.concat(task.chunks, task.bytes);
      if (digest(bytes) !== frame.sha256) throw error('checksum mismatch');
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw error('invalid UTF-8 or JSON record'); }
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.id !== task.id || value.type !== task.type) throw error('record identity mismatch');
      clearTimeout(task.timer); this.lastRecordBytes = task.bytes; this.active = undefined; this.seq++; return value;
    } catch (e) { this.close(); throw e; }
  }
  finish() { if (this.active) { this.close(); throw error('EOF inside transfer'); } }
  close() { if (this.active) clearTimeout(this.active.timer); this.active = undefined; this.failed = true; }
}

export class TransportWriter {
  constructor(stream, generation, { maxBytes = RECORD_BYTES, queuedBytes = QUEUED_BYTES, timeoutMs = 15000 } = {}) {
    this.stream = stream; this.generation = generation; this.maxBytes = maxBytes; this.limit = queuedBytes; this.timeoutMs = timeoutMs;
    this.pendingBytes = 0; this.seq = 0; this.tail = Promise.resolve(); this.closed = false; this.abort = new AbortController();
    this.onClose = () => this.close();
    stream.on('error', this.onClose); stream.on('close', this.onClose);
  }
  send(value) {
    if (this.closed) return Promise.reject(error('writer closed'));
    let bytes;
    try { bytes = serializeRecord(value, this.maxBytes); } catch (e) { return Promise.reject(e); }
    if (this.pendingBytes + bytes.length > this.limit) return Promise.reject(error('queued resource limit exceeded'));
    this.pendingBytes += bytes.length;
    // Serialize now: SDK event objects can be mutated before an asynchronous write.
    const hint = { id: value.id, type: value.type };
    const work = this.tail.then(async () => {
      if (this.closed) throw error('writer closed');
      const timer = setTimeout(() => this.close(), this.timeoutMs); timer.unref();
      try {
        for (const frame of recordFrames(bytes, this.generation, this.seq, hint)) {
          if (this.closed) throw error('writer disconnected or timed out');
          const line = JSON.stringify(frame) + '\n';
          if (Buffer.byteLength(line) > FRAME_BYTES) throw error('frame resource limit exceeded');
          if (!this.stream.write(line)) await once(this.stream, 'drain', { signal: this.abort.signal });
        }
        this.seq++;
      } finally { clearTimeout(timer); }
    }).finally(() => { this.pendingBytes -= bytes.length; });
    this.tail = work.catch(() => { this.close(); });
    return work;
  }
  flush() { return this.tail.then(() => { if (this.closed) throw error('writer closed'); }); }
  close() { if (this.closed) return; this.closed = true; this.abort.abort(); this.stream.removeListener('error', this.onClose); this.stream.removeListener('close', this.onClose); }
}

// Abort releases SDK event listeners without dropping/reordering records already
// queued for the pipe. Disconnect still closes the writer and rejects all sends.
export function waitForPressure(writer, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', aborted);
    const aborted = () => { cleanup(); resolve(); };
    signal.addEventListener('abort', aborted, { once: true });
    writer.flush().then(() => { cleanup(); resolve(); }, e => { cleanup(); reject(e); });
    if (signal.aborted) aborted();
  });
}

// Native worker reader; LF bytes only (U+2028/U+2029 are legal JSON string data).
export class FrameLineReader {
  constructor() { this.pending = Buffer.alloc(0); }
  push(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]); const frames = []; let end;
    while ((end = this.pending.indexOf(10)) >= 0) {
      if (end > FRAME_BYTES) throw error('physical frame too large');
      const line = this.pending.subarray(0, end); this.pending = this.pending.subarray(end + 1);
      try { frames.push(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))); }
      catch { throw error('invalid UTF-8 or JSON frame'); }
    }
    if (this.pending.length > FRAME_BYTES) throw error('physical frame too large');
    return frames;
  }
  finish() { if (this.pending.length) throw error('EOF inside frame'); }
}
