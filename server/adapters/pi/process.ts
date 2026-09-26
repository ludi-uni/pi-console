import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { once } from 'node:events';
import { JsonlParser } from './parser.ts';
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
  const roots = [process.env.APPDATA && join(process.env.APPDATA, 'npm', 'node_modules'),
    join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.npm-global', 'lib', 'node_modules'),
    '/usr/local/lib/node_modules'];
  const file = roots.filter(Boolean).map(root => join(root!, '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js')).find(existsSync);
  if (!file) throw new Error('Pi CLI not found; set PI_CONSOLE_PI_COMMAND to its cli.js path');
  return file;
}

export class PiProcess {
  state: ProcessState = 'stopped';
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve: (r: RecordValue) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private inspections = new Map<string, { resolve: (r: RecordValue) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private serial = Promise.resolve();
  private seq = 0;
  private intendedStop = false;
  private stderr = '';
  onRecord: (record: RecordValue) => void = () => {};
  onState: (state: ProcessState, reason?: string) => void = () => {};
  constructor(readonly cwd: string, readonly sessionPath?: string, readonly sessionDir?: string) {}
  private set(next: ProcessState, reason?: string) { this.state = transition(this.state, next); this.onState(this.state, reason); }
  async start(): Promise<void> {
    if (this.state !== 'stopped') throw new Error('worker already started');
    this.set('starting');
    const parser = new JsonlParser();
    try {
      const args = [piExecutable(), '--mode', 'rpc', ...(this.sessionPath ? ['--session', this.sessionPath] : []), ...(this.sessionDir ? ['--session-dir', this.sessionDir] : [])];
      const child = spawn(process.execPath, args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.child = child;
      child.stderr.on('data', (data: Buffer) => { this.stderr = (this.stderr + data.toString('utf8')).slice(-4096); });
      child.stdout.on('data', (data: Buffer) => {
        try { for (const record of parser.push(data) as RecordValue[]) this.handle(record); }
        catch (error) { this.fail(error as Error); child.kill(); }
      });
      child.on('error', error => this.fail(error));
      child.on('close', (code, signal) => {
        try { parser.finish(); } catch (error) { this.fail(error as Error); }
        if (this.state === 'failed') return;
        if (this.intendedStop) { if (this.state !== 'stopping') this.set('stopping'); this.set('stopped'); }
        else this.fail(new Error(`Pi exited unexpectedly (${code ?? signal}); ${this.stderr.slice(-500)}`));
      });
      await once(child, 'spawn');
      this.set('running');
    } catch (error) { this.fail(error as Error); throw error; }
  }
  private fail(error: Error) {
    if (this.state !== 'failed' && this.state !== 'stopped') this.set('failed', error.message);
    for (const [id, task] of this.pending) { clearTimeout(task.timer); task.reject(error); this.pending.delete(id); }
    for (const [id, task] of this.inspections) { clearTimeout(task.timer); task.reject(error); this.inspections.delete(id); }
  }
  private handle(record: RecordValue) {
    if (record.type === 'extension_ui_request' && record.method === 'setWidget' && record.widgetKey === 'subagent-inspect') {
      const line = record.widgetLines?.[0];
      if (Array.isArray(record.widgetLines) && record.widgetLines.length === 1 && typeof line === 'string' && line.length <= 65536 && line.startsWith('PI_SUBAGENT_INSPECT_JSON:')) {
        try { const reply = JSON.parse(line.slice('PI_SUBAGENT_INSPECT_JSON:'.length));
          if (reply.kind === 'pi-subagents.inspect-reply' && reply.version === 1 && typeof reply.requestId === 'string') {
            const task = this.inspections.get(reply.requestId);
            if (task) { this.inspections.delete(reply.requestId); clearTimeout(task.timer); task.resolve(reply); }
          }
        } catch { /* Invalid or unrelated extension widget; let the request time out. */ }
      }
      return; // Inspection content is private to the requesting HTTP call, not an execution event.
    }
    if (record.type === 'response' && typeof record.id === 'string' && this.pending.has(record.id)) {
      const task = this.pending.get(record.id)!; this.pending.delete(record.id); clearTimeout(task.timer);
      record.success ? task.resolve(record) : task.reject(new Error(String(record.error ?? 'RPC rejected')));
      return;
    }
    if (record.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(record.method)) {
      // Phase 1 has no interactive extension UI; fail closed rather than hang Pi.
      void this.write({ type: 'extension_ui_response', id: record.id, cancelled: true }).catch(() => {});
      this.onRecord({ type: 'console_dialog_cancelled', method: record.method });
      return;
    }
    this.onRecord(record);
  }
  private write(command: RecordValue): Promise<void> {
    const task = this.serial.then(async () => {
      if (!this.child || this.state !== 'running') throw new Error('Pi not running');
      if (!this.child.stdin.write(JSON.stringify(command) + '\n')) await once(this.child.stdin, 'drain');
    });
    this.serial = task.catch(() => {});
    return task;
  }
  async call(type: string, fields: RecordValue = {}, timeoutMs = 30000): Promise<RecordValue> {
    const id = `console-${++this.seq}`;
    if (this.state !== 'running') throw new Error('Pi not running');
    const result = new Promise<RecordValue>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`RPC ${type} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    try { await this.write({ id, type, ...fields }); } catch (error) {
      const task = this.pending.get(id); if (task) { clearTimeout(task.timer); this.pending.delete(id); task.reject(error as Error); }
    }
    return result;
  }
  async inspectSubagent(asyncId: string, childId?: string): Promise<RecordValue> {
    const safe = (id: string) => /^[A-Za-z0-9_.:-]{1,256}$/.test(id);
    if (!safe(asyncId) || childId !== undefined && !safe(childId)) throw new Error('subagent ID cannot be inspected through Pi RPC');
    const commands = (await this.call('get_commands')).data?.commands;
    if (!Array.isArray(commands) || !commands.some((command: RecordValue) => command.name === 'subagents-inspect-rpc' && command.source === 'extension')) throw new Error('This Pi session does not provide background subagent inspection');
    const requestId = randomUUID().replaceAll('-', '');
    const reply = new Promise<RecordValue>((resolve, reject) => {
      const timer = setTimeout(() => { this.inspections.delete(requestId); reject(new Error('Subagent inspection timed out')); }, 10000);
      this.inspections.set(requestId, { resolve, reject, timer });
    });
    void reply.catch(() => {}); // The widget may time out before the prompt command rejects.
    try {
      await this.call('prompt', { message: `/subagents-inspect-rpc ${requestId} ${asyncId}${childId ? ` ${childId}` : ''} --lines 30` }, 10000);
      const result = await reply;
      if (result.error) throw new Error(String(result.error.message ?? 'Subagent inspection failed'));
      return result;
    } finally {
      const task = this.inspections.get(requestId);
      if (task) { this.inspections.delete(requestId); clearTimeout(task.timer); task.reject(new Error('Subagent inspection cancelled')); }
    }
  }
  async close(): Promise<void> {
    if (!this.child || this.state === 'stopped') return;
    this.intendedStop = true;
    if (this.state !== 'stopping') this.set('stopping');
    const child = this.child;
    for (const [id, task] of this.pending) { clearTimeout(task.timer); task.reject(new Error('Pi worker shutting down')); this.pending.delete(id); }
    for (const [id, task] of this.inspections) { clearTimeout(task.timer); task.reject(new Error('Pi worker shutting down')); this.inspections.delete(id); }
    const closed = once(child, 'close').catch(() => {});
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 3500);
    await closed; clearTimeout(timer);
  }
  // Test-only failure injection: still goes through OS process lifecycle.
  killForTest(): void { this.child?.kill(); }
}
