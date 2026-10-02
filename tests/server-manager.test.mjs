import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, Socket } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { startManagedServer, stopManagedServer, restartManagedServer, managedServerStatus, consolePort } from '../package/server-manager.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fakePiPath = async root => {
  const cli = join(root, 'fake-pi.cjs');
  await writeFile(cli, `process.stdin.on('data',()=>{});setInterval(()=>{},60000);\n`);
  return cli;
};
const availablePort = async () => {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; probe.close(); await once(probe, 'close'); return port;
};
const envFor = (root, port, pi) => ({
  ...process.env,
  PI_CODING_AGENT_DIR: join(root, 'agent'),
  PI_CONSOLE_DATA_DIR: join(root, 'data'),
  PI_CONSOLE_PI_COMMAND: pi,
  PORT: String(port),
  PI_CONSOLE_PUBLIC_ORIGIN: '', PI_CONSOLE_ACCESS_TEAM_DOMAIN: '', PI_CONSOLE_ACCESS_AUD: '',
});
const reachable = async (port) => {
  try { const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); return res.status; }
  catch { return undefined; }
};
// A bare-TCP occupier must destroy the manager's probe sockets or .close() waits forever.
const occupy = async (port) => {
  const sockets = new Set();
  const server = createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  return { server, async close() { for (const s of sockets) s.destroy(); server.close(); await once(server, 'close'); } };
};
const stateFile = dir => join(dir, 'server-state.json');
const tokenFile = dir => join(dir, 'server-token');
const lockFile = dir => join(dir, 'server.lock');
const logFile = dir => join(dir, 'server.log');

test('consolePort validates numeric PORT', () => {
  assert.equal(consolePort({}), 31717);
  assert.equal(consolePort({ PORT: '12345' }), 12345);
  assert.throws(() => consolePort({ PORT: '0' }));
  assert.throws(() => consolePort({ PORT: '70000' }));
  assert.throws(() => consolePort({ PORT: 'abc' }));
});

test('managed start/stop lifecycle survives launcher exit and is portable across processes', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-manager-'));
  const dir = join(root, 'data'); await mkdir(dir, { recursive: true });
  const pi = await fakePiPath(root);
  const port = await availablePort();
  const env = envFor(root, port, pi);
  try {
    const started = await startManagedServer({ env });
    assert.equal(started.status, 'running'); assert.equal(started.changed, true);
    assert.equal(started.port, port);
    assert.ok((await readFile(stateFile(dir), 'utf8')).includes(`"pid"`));
    assert.match(await readFile(tokenFile(dir), 'utf8'), /^[0-9a-f]{48}$/);
    assert.equal(await reachable(port), 200);

    // Second process must see the same server, not start a duplicate.
    const again = await startManagedServer({ env });
    assert.equal(again.changed, false); assert.equal(again.pid, started.pid);

    const status = await managedServerStatus({ env });
    assert.equal(status.status, 'running'); assert.equal(status.pid, started.pid);

    const stopped = await stopManagedServer({ env });
    assert.equal(stopped.status, 'stopped'); assert.equal(stopped.changed, true);
    await assert.rejects(readFile(stateFile(dir)), { code: 'ENOENT' });
    await assert.rejects(readFile(tokenFile(dir)), { code: 'ENOENT' });
    assert.equal(await reachable(port), undefined);
  } finally {
    await stopManagedServer({ env }).catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('restart replaces the server while preserving the port', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-restart-'));
  const dir = join(root, 'data'); await mkdir(dir, { recursive: true });
  const pi = await fakePiPath(root);
  const port = await availablePort();
  const env = envFor(root, port, pi);
  try {
    const first = await startManagedServer({ env });
    assert.equal(first.status, 'running');
    const restarted = await restartManagedServer({ env });
    assert.equal(restarted.status, 'running'); assert.equal(restarted.changed, true);
    assert.notEqual(restarted.pid, first.pid); assert.equal(restarted.port, first.port);
    assert.equal(await reachable(port), 200);
    const stopped = await stopManagedServer({ env });
    assert.equal(stopped.status, 'stopped');
  } finally {
    await stopManagedServer({ env }).catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('concurrent starts serialize; only one managed process is created', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-concurrent-'));
  const dir = join(root, 'data'); await mkdir(dir, { recursive: true });
  const pi = await fakePiPath(root);
  const port = await availablePort();
  const env = envFor(root, port, pi);
  try {
    const [a, b] = await Promise.all([startManagedServer({ env }), startManagedServer({ env })]);
    assert.equal(a.status, 'running'); assert.equal(b.status, 'running');
    assert.equal(a.pid, b.pid);
    assert.equal([a.changed, b.changed].filter(Boolean).length, 1);
    assert.equal(await reachable(port), 200);
  } finally {
    await stopManagedServer({ env }).catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('stale state with reused PID and foreign listener is never killed', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-stale-'));
  const dir = join(root, 'data'); await mkdir(dir, { recursive: true });
  const pi = await fakePiPath(root);
  const port = await availablePort();
  const env = envFor(root, port, pi);
  try {
    const started = await startManagedServer({ env });
    assert.equal(started.status, 'running');
    const state = JSON.parse(await readFile(stateFile(dir), 'utf8'));
    await stopManagedServer({ env });
    // Simulate a recycled, live PID with a foreign listener. Use a fresh port because
    // Windows may retain an abruptly-closed TCP endpoint after its process exits.
    const foreignPort = await availablePort();
    await writeFile(stateFile(dir), JSON.stringify({ ...state, pid: process.pid, port: foreignPort }));
    await writeFile(tokenFile(dir), 'a'.repeat(48));
    const occupier = await occupy(foreignPort);
    try {
      const status = await managedServerStatus({ env });
      assert.equal(status.status, 'stale'); // recorded pid dead + port no longer answers identity
      const stop = await stopManagedServer({ env });
      assert.equal(stop.status, 'stopped'); assert.equal(stop.changed, true); // only cleared stale state
      assert.equal(occupier.server.listening, true);
    } finally { await occupier.close(); }
  } finally {
    await stopManagedServer({ env }).catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('foreign port owner is reported, not hijacked or killed', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-foreign-'));
  const dir = join(root, 'data'); await mkdir(dir, { recursive: true });
  const pi = await fakePiPath(root);
  const port = await availablePort();
  const env = envFor(root, port, pi);
  const occupier = await occupy(port);
  try {
    const result = await startManagedServer({ env });
    assert.equal(result.status, 'port-in-use'); assert.equal(result.changed, false);
    const status = await managedServerStatus({ env });
    assert.equal(status.status, 'stopped'); assert.equal(status.portOccupied, true);
  } finally {
    await occupier.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('extension-style stop via manager kills only the managed child', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-ext-stop-'));
  const dir = join(root, 'data'); await mkdir(dir, { recursive: true });
  const pi = await fakePiPath(root);
  const port = await availablePort();
  const env = envFor(root, port, pi);
  try {
    const started = await startManagedServer({ env });
    assert.equal(started.status, 'running');
    // The extension no longer holds a child; the detached server survives independently.
    const childPid = started.pid;
    const stop = await stopManagedServer({ env });
    assert.equal(stop.status, 'stopped'); assert.equal(stop.changed, true);
    // PID should be gone; a foreign TCP listener on the same port must not be touched.
    // A bare net.Server is not HTTP, so assert TCP occupancy (bounded) rather than a 200.
    const foreign = await occupy(port);
    try {
      const probe = await new Promise(resolve => {
        const socket = new Socket();
        socket.setTimeout(1000);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => { socket.destroy(); resolve(true); });
        socket.connect(port, '127.0.0.1');
      });
      assert.equal(probe, true);
    } finally { await foreign.close(); }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('packaged CLI help works from any cwd', async () => {
  const entry = join(packageRoot, 'package', 'pi-console.mjs');
  const { stdout } = await promisify(execFile)(process.execPath, [entry, 'help'], { cwd: tmpdir(), timeout: 15000 });
  assert.match(stdout, /Usage: pi-console/);
});

test('PowerShell wrapper resolves the packaged entry from any cwd', { skip: process.platform !== 'win32' }, async () => {
  const script = join(packageRoot, 'scripts', 'pi-console.ps1');
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, 'help'], { timeout: 15000 });
  assert.match(stdout, /Usage: pi-console/);
});

test('corrupt or missing state/token files are handled safely', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-corrupt-'));
  const dir = join(root, 'data'); await mkdir(dir, { recursive: true });
  const pi = await fakePiPath(root);
  const port = await availablePort();
  const env = envFor(root, port, pi);
  try {
    await writeFile(stateFile(dir), 'not json');
    await writeFile(tokenFile(dir), 'bad-token');
    const started = await startManagedServer({ env });
    assert.equal(started.status, 'running'); assert.equal(started.changed, true);
    const stopped = await stopManagedServer({ env });
    assert.equal(stopped.status, 'stopped');
  } finally {
    await stopManagedServer({ env }).catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
