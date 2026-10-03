import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { JsonlParser } from './parser.ts';
import { FrameDecoder, TransportWriter } from '../../../package/worker-transport.mjs';
import { resolvePiSdk } from '../../../package/pi-sdk-resolver.mjs';
import type { ProcessState } from '../../../shared/types.ts';

type RecordValue = Record<string, any>;
export function transition(state: ProcessState, next: ProcessState): ProcessState {
  const allowed: Record<ProcessState, ProcessState[]> = {
    stopped: ['starting'], starting: ['running', 'failed', 'stopping'], running: ['stopping', 'failed'],
    stopping: ['stopped', 'failed'], failed: ['starting', 'stopping', 'stopped'],
  };
  if (!allowed[state].includes(next)) throw new Error(`invalid process transition ${state} -> ${next}`);
  return next;
}
export function piExecutable(): string {
  const override = process.env.PI_CONSOLE_PI_COMMAND;
  if (override) { if (!isAbsolute(override) || !existsSync(override)) throw new Error('PI_CONSOLE_PI_COMMAND must be an absolute existing CLI script'); return override; }
  const roots = [process.env.APPDATA && join(process.env.APPDATA, 'npm', 'node_modules'), join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.npm-global', 'lib', 'node_modules'), '/usr/local/lib/node_modules'];
  const file = roots.filter(Boolean).map(root => join(root!, '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')).find(existsSync);
  if (!file) throw new Error('Pi CLI not found; set PI_CONSOLE_PI_COMMAND to its cli.js path');
  return file;
}
export function consoleExtension(): string {
  const file = fileURLToPath(new URL('../../../extensions/pi-console-session.mjs', import.meta.url));
  if (!existsSync(file)) throw new Error('Pi Console report safety extension is missing');
  return file;
}
export class PiProcess {
  state: ProcessState = 'stopped';
  private child?: ChildProcessWithoutNullStreams;
  private writer?: TransportWriter;
  private decoder?: FrameDecoder;
  private pending = new Map<string, { resolve: (r: RecordValue) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; onStart?: () => void }>();
  private inspections = new Map<string, { resolve: (r: RecordValue) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private seq = 0;
  private intendedStop = false;
  private stderr = '';
  private closed = Promise.resolve();
  private exited = false;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private sessionId?: string;
  private handshakeReceived = false;
  private expectedSdkVersion?: string;
  onRecord: (record: RecordValue) => void = () => {};
  onState: (state: ProcessState, reason?: string) => void = () => {};
  constructor(readonly cwd: string, readonly sessionPath?: string, readonly sessionDir?: string) {}
  private set(next: ProcessState, reason?: string) { this.state = transition(this.state, next); this.onState(this.state, reason); }
  async start(): Promise<void> {
    if (this.state !== 'stopped') throw new Error('worker already started');
    this.set('starting');
    const parser = new JsonlParser(); // The physical 8 MiB guard is deliberately unchanged.
    const generation = randomUUID();
    const ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    void ready.catch(() => {});
    let timer: NodeJS.Timeout | undefined;
    try {
      // Explicit test seam, never an automatic fallback from an unsupported SDK.
      const fixture = process.env.PI_CONSOLE_WORKER_COMMAND || undefined;
      if (fixture && (!isAbsolute(fixture) || !existsSync(fixture))) throw new Error('PI_CONSOLE_WORKER_COMMAND must be an absolute existing worker script');
      const sdk = fixture ? undefined : resolvePiSdk(piExecutable());
      this.expectedSdkVersion = sdk?.version;
      const entry = fixture ?? fileURLToPath(new URL('../../../package/sdk-worker.mjs', import.meta.url));
      const args = [entry, '--generation', generation, '--extension', consoleExtension(), ...(sdk ? ['--sdk-entry', sdk.entry, '--sdk-version', sdk.version] : []), ...(this.sessionPath ? ['--session', this.sessionPath] : []), ...(this.sessionDir ? ['--session-dir', this.sessionDir] : [])];
      const child = spawn(process.execPath, args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.child = child;
      child.stdin.on('error', error => { if (!this.intendedStop) { this.fail(error); child.kill(); } });
      this.writer = new TransportWriter(child.stdin, generation);
      this.decoder = new FrameDecoder({ generation, onStart: meta => { if (meta.type === 'response' && meta.id) this.pending.get(meta.id)?.onStart?.(); }, onError: error => { this.fail(error); child.kill(); } });
      this.closed = new Promise<void>((resolve, reject) => {
        child.once('close', () => { this.exited = true; resolve(); });
        child.once('error', error => { if (!this.exited) reject(error); });
      });
      void this.closed.catch(() => {});
      child.stderr.on('data', (data: Buffer) => { this.stderr = (this.stderr + data.toString('utf8')).slice(-4096); });
      child.stdout.on('data', (data: Buffer) => {
        try { for (const frame of parser.push(data)) { const record = this.decoder!.accept(frame); if (record) this.handle(record); } }
        catch (error) { this.fail(error as Error); child.kill(); }
      });
      child.on('error', error => this.fail(error));
      child.on('close', (code, signal) => {
        this.writer?.close();
        try { parser.finish(); this.decoder?.finish(); } catch (error) { this.fail(error as Error); }
        this.decoder?.close();
        if (this.state === 'failed') return;
        if (this.intendedStop) { if (this.state === 'stopping') this.set('stopped'); }
        else this.fail(new Error(`Pi SDK worker exited unexpectedly (${code ?? signal}); ${this.stderr.slice(-500)}`));
      });
      await once(child, 'spawn');
      timer = setTimeout(() => { const error = new Error(`Pi SDK worker startup timed out; ${this.stderr.slice(-500)}`); this.fail(error); child.kill(); }, 60000);
      await ready;
      this.set('running');
    } catch (error) { this.fail(error as Error); throw error; }
    finally { if (timer) clearTimeout(timer); this.readyResolve = undefined; this.readyReject = undefined; }
  }
  private fail(error: Error) {
    if (this.state !== 'failed' && this.state !== 'stopped') this.set('failed', error.message);
    this.readyReject?.(error); this.writer?.close(); this.decoder?.close();
    for (const [id, task] of this.pending) { clearTimeout(task.timer); task.reject(error); this.pending.delete(id); }
    for (const [id, task] of this.inspections) { clearTimeout(task.timer); task.reject(error); this.inspections.delete(id); }
  }
  private handle(record: RecordValue) {
    if (record.type === 'console_ready') {
      if (!this.readyResolve || this.handshakeReceived || this.expectedSdkVersion && (record.sdkVersion !== this.expectedSdkVersion || typeof record.sessionId !== 'string' || !record.sessionId) || record.protocolVersion !== 1 || !Array.isArray(record.capabilities) || !['chunked-records', 'direct-history', 'preflight-ack'].every(c => record.capabilities.includes(c))) throw new Error('Invalid SDK worker ready handshake');
      this.handshakeReceived = true; this.sessionId = record.sessionId; this.readyResolve(); return;
    }
    if (record.type === 'extension_ui_request' && record.method === 'setWidget' && record.widgetKey === 'subagent-inspect') {
      const line = record.widgetLines?.[0];
      if (Array.isArray(record.widgetLines) && record.widgetLines.length === 1 && typeof line === 'string' && line.length <= 65536 && line.startsWith('PI_SUBAGENT_INSPECT_JSON:')) {
        try { const reply = JSON.parse(line.slice('PI_SUBAGENT_INSPECT_JSON:'.length));
          if (reply.kind === 'pi-subagents.inspect-reply' && reply.version === 1 && typeof reply.requestId === 'string') {
            const task = this.inspections.get(reply.requestId);
            if (task) { this.inspections.delete(reply.requestId); clearTimeout(task.timer); task.resolve(reply); }
          }
        } catch { /* Let invalid widgets time out without leaking inspection contents. */ }
      }
      return;
    }
    if (record.type === 'extension_ui_request' && record.widgetKey === 'pi-console-history') return;
    if (record.type === 'response' && typeof record.id === 'string') {
      const task = this.pending.get(record.id);
      if (task) { this.pending.delete(record.id); clearTimeout(task.timer); record.success ? task.resolve(record) : task.reject(new Error(String(record.error ?? 'SDK operation rejected'))); }
      return;
    }
    if (record.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(record.method)) {
      this.onRecord({ type: 'console_dialog_cancelled', method: record.method }); return;
    }
    this.onRecord(record);
  }
  private write(command: RecordValue): Promise<void> {
    if (!this.writer || this.state !== 'running') return Promise.reject(new Error('Pi not running'));
    return this.writer.send(command);
  }
  async call(type: string, fields: RecordValue = {}, timeoutMs = 30000, onStart?: () => void): Promise<RecordValue> {
    const id = `console-${++this.seq}`;
    if (this.state !== 'running') throw new Error('Pi not running');
    const result = new Promise<RecordValue>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`SDK ${type} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, onStart });
    });
    void result.catch(() => {});
    try { await this.write({ ...fields, id, type }); } catch (error) {
      const task = this.pending.get(id); if (task) { clearTimeout(task.timer); this.pending.delete(id); task.reject(error as Error); }
    }
    return result;
  }
  async getMessages(timeoutMs = 60000, onSnapshotStart?: () => void): Promise<RecordValue[]> {
    const commands = (await this.call('get_commands')).data?.commands;
    if (!Array.isArray(commands) || !commands.some((c: RecordValue) => c.name === 'pi-console-history-rpc' && c.source === 'extension')) throw new Error('Pi Console history command missing; the bundled safety extension did not load');
    const data = (await this.call('get_history', {}, timeoutMs, onSnapshotStart)).data;
    if (!data || !Array.isArray(data.messages) || typeof data.sessionId !== 'string' || this.sessionId && data.sessionId !== this.sessionId) throw new Error('Invalid SDK history snapshot identity');
    if (data.dirty) throw new Error('session changed while the history snapshot was taken; retry');
    return data.messages;
  }
  async inspectSubagent(asyncId: string, childId?: string): Promise<RecordValue> {
    const safe = (id: string) => /^[A-Za-z0-9_.:-]{1,256}$/.test(id);
    if (!safe(asyncId) || childId !== undefined && !safe(childId)) throw new Error('subagent ID cannot be inspected through Pi RPC');
    const commands = (await this.call('get_commands')).data?.commands;
    if (!Array.isArray(commands) || !commands.some((c: RecordValue) => c.name === 'subagents-inspect-rpc' && c.source === 'extension')) throw new Error('This Pi session does not provide background subagent inspection');
    const requestId = randomUUID().replaceAll('-', '');
    const reply = new Promise<RecordValue>((resolve, reject) => {
      const timer = setTimeout(() => { this.inspections.delete(requestId); reject(new Error('Subagent inspection timed out')); }, 10000);
      this.inspections.set(requestId, { resolve, reject, timer });
    });
    void reply.catch(() => {});
    try {
      await this.call('prompt', { message: `/subagents-inspect-rpc ${requestId} ${asyncId}${childId ? ` ${childId}` : ''} --lines 30` }, 10000);
      const result = await reply; if (result.error) throw new Error(String(result.error.message ?? 'Subagent inspection failed')); return result;
    } finally {
      const task = this.inspections.get(requestId); if (task) { this.inspections.delete(requestId); clearTimeout(task.timer); task.reject(new Error('Subagent inspection cancelled')); }
    }
  }
  async close(): Promise<void> {
    if (!this.child || this.state === 'stopped') return;
    this.intendedStop = true;
    if (this.state !== 'stopping') this.set('stopping');
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('Pi worker shutting down')); } this.pending.clear();
    for (const task of this.inspections.values()) { clearTimeout(task.timer); task.reject(new Error('Subagent inspection cancelled')); } this.inspections.clear();
    this.readyReject?.(new Error('Pi worker shutting down')); this.writer?.close();
    try { this.child.stdin.end(); } catch { /* Pipe already closed. */ }
    const child = this.child;
    const timer = setTimeout(() => { try { child.kill(); } catch { /* Already gone. */ } }, 3500); timer.unref();
    await this.closed.catch(() => {}); clearTimeout(timer);
    if (this.state === 'stopping') this.set('stopped');
  }
  killForTest(): void { this.child?.kill(); }
}
