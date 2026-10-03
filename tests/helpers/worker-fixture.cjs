// Explicit test-only adapter: old behavioral RPC fixtures speak the new framed
// worker protocol. Production never executes this or falls back to standard RPC.
const { PassThrough } = require('node:stream');
const { FrameDecoder, FrameLineReader, TransportWriter } = require('../../package/worker-transport.mjs');
const generation = process.argv[process.argv.indexOf('--generation') + 1];
const originalInput = process.stdin, originalWrite = process.stdout.write.bind(process.stdout);
const output = new (require('node:stream').Writable)({ write(chunk, encoding, cb) { originalWrite(chunk, encoding, cb); } });
const writer = new TransportWriter(output, generation);
const input = new PassThrough(); Object.defineProperty(process, 'stdin', { value: input });
const histories = new Map(); let oldBuffer = '';
const emit = record => writer.send(record).catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
process.stdout.write = (chunk, encoding, cb) => {
  oldBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
  let end;
  while ((end = oldBuffer.indexOf('\n')) >= 0) {
    const line = oldBuffer.slice(0, end); oldBuffer = oldBuffer.slice(end + 1); if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.type === 'extension_ui_request' && record.widgetKey === 'pi-console-history' && record.widgetLines?.[0]) {
      const chunk = JSON.parse(record.widgetLines[0].slice('PI_CONSOLE_HISTORY_JSON:'.length));
      const task = histories.get(chunk.requestId); if (!task) continue;
      task.total ??= chunk.total; if (task.total !== chunk.total) { task.invalid = true; continue; }
      task.chunks[chunk.seq] = chunk.data;
      if (!task.invalid && Object.keys(task.chunks).length === task.total) {
        const data = JSON.parse(Buffer.from(Array.from({ length: task.total }, (_, i) => task.chunks[i]).join(''), 'base64').toString('utf8'));
        emit({ id: task.id, type: 'response', command: 'get_history', success: true, data }); histories.delete(chunk.requestId);
      }
      continue;
    }
    if (record.type === 'response' && histories.has(record.id)) continue; // legacy history prompt ACK is not the snapshot
    emit(record);
  }
  if (typeof encoding === 'function') encoding(); else cb?.(); return true;
};
const lines = new FrameLineReader(), decoder = new FrameDecoder({ generation });
originalInput.on('data', bytes => {
  try { for (const frame of lines.push(bytes)) { const command = decoder.accept(frame); if (!command) continue;
    if (command.type === 'get_history') {
      histories.set(command.id, { id: command.id, chunks: {} });
      input.write(JSON.stringify({ ...command, type: 'prompt', message: '/pi-console-history-rpc ' + command.id }) + '\n');
    } else input.write(JSON.stringify(command) + '\n');
  } } catch (error) { process.stderr.write(error.message); process.exit(1); }
});
originalInput.on('end', () => input.end());
originalInput.on('error', () => input.destroy());
void emit({ type: 'console_ready', protocolVersion: 1, capabilities: ['chunked-records', 'direct-history', 'preflight-ack'] });
