// Shared lifecycle manager for the detached pi-console server.
// Used by the Pi extension (/pi-console), the packaged CLI (package/pi-console.mjs via
// scripts/pi-console.ps1) and the Windows Startup entry (package/startup.mjs), so every
// entry point manages the same server through the same state, lock and log files in the
// stable Console data directory — never inside the replaceable npm package.
//
// Ownership model: after spawn, readiness AND ownership are proven through the server's
// loopback-only /api/manage/identity route (pid must match the child we spawned). Stops go
// through the token-authenticated /api/manage/shutdown route; the per-start token lives in
// <data>/server-token. A stale state file, a reused PID or a foreign listener is reported,
// never killed.

import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { request } from 'node:http';
import { open, readFile, writeFile, rename, rm, mkdir, stat } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { consoleDataDir } from './data-directory.mjs';
import { loadConsoleEnvironment } from './environment.mjs';
import { resolvePiCli } from './launcher.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const serverEntry = fileURLToPath(new URL('../server/index.ts', import.meta.url));
const tsxSpecifier = import.meta.resolve('tsx');
const statePath = dir => join(dir, 'server-state.json');
const tokenPath = dir => join(dir, 'server-token');
const lockPath = dir => join(dir, 'server.lock');
const logPath = dir => join(dir, 'server.log');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

export function consolePort(env) {
  const port = Number(env.PORT ?? 31717);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  return port;
}

async function listening(port, timeoutMs = 1500) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(timeoutMs);
    const done = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(true)); // A timeout still proves a listener exists.
  });
}

/** GET/POST a management route. Resolves null on any connection failure or timeout.
 *  The WHOLE request/response is bounded by timeoutMs (headers+body+socket), the body is
 *  capped at 64 KiB, and the socket is always destroyed — a fake occupier can never hang
 *  or stream-flood the manager. */
function manageRequest(port, { method = 'GET', path = '/api/manage/identity', proof, challenge, identityChallenge, timeoutMs = 2500 } = {}) {
  return new Promise(resolve => {
    let finished = false;
    const done = value => { if (!finished) { finished = true; clearTimeout(absolute); req.destroy(); resolve(value); } };
    const req = request({ hostname: '127.0.0.1', port, path, method,
      headers: { host: `127.0.0.1:${port}`, ...(identityChallenge ? { 'x-pi-console-manage-challenge': identityChallenge } : {}), ...(proof ? { 'x-pi-console-manage-proof': proof, 'content-type': 'application/json' } : {}) } }, res => {
      let body = '', size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 64 * 1024) { done(null); return; } body += chunk.toString(); });
      res.on('end', () => { let json; try { json = JSON.parse(body); } catch { json = undefined; } done({ status: res.statusCode, body: json }); });
      res.on('error', () => done(null));
    });
    const absolute = setTimeout(() => done(null), timeoutMs); // whole request bounded, incl. trickle
    req.setTimeout(timeoutMs, () => done(null));
    req.on('error', () => done(null));
    if (method === 'POST') req.end(JSON.stringify({ challenge }));
    else req.end();
  });
}
const manageProofFor = (token, challenge) => createHmac('sha256', token).update(`pi-console-manage:${challenge}`).digest('hex');

const identity = async (port, token) => {
  const challenge = token ? randomBytes(24).toString('hex') : undefined;
  const reply = await manageRequest(port, { identityChallenge: challenge });
  if (token && reply?.body?.proof !== createHmac('sha256', token).update(`pi-console-identity:${challenge}`).digest('hex')) return null;
  return reply;
};
const isConsole = reply => reply?.body?.service === 'pi-console' ? reply.body : undefined;

async function readState(dir) {
  try {
    const state = JSON.parse(await readFile(statePath(dir), 'utf8'));
    if (state?.version !== 1 || !Number.isInteger(state.pid) || !Number.isInteger(state.port)) return undefined;
    return state;
  } catch { return undefined; } // Missing or corrupt state is treated as absent, never fatal.
}

async function readToken(dir) {
  try {
    const token = (await readFile(tokenPath(dir), 'utf8')).trim();
    return /^[0-9a-f]{48}$/.test(token) ? token : undefined;
  } catch { return undefined; }
}

async function writeState(dir, state) {
  const path = statePath(dir), temp = `${path}.${process.pid}.tmp`;
  try { await writeFile(temp, JSON.stringify(state, null, 1) + '\n'); await rename(temp, path); }
  finally { await rm(temp, { force: true }).catch(() => {}); }
}

async function clearState(dir) {
  await rm(statePath(dir), { force: true });
  await rm(tokenPath(dir), { force: true });
}

/** Serialize start/stop/restart across CLI, extension and Startup processes. */
async function withLock(dir, fn, timeoutMs = 30000) {
  const path = lockPath(dir);
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      await handle.close();
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let lock;
      try { lock = JSON.parse(await readFile(path, 'utf8')); } catch {
        // An empty/partial/unparseable lock could be a live creator mid-write — never
        // steal it. Fail closed with the remediation path.
        if (Date.now() > until) throw new Error(`server lock ${path} exists but is unreadable; remove it manually only after confirming no pi-console command is running`);
        await sleep(100); continue;
      }
      const stale = Number.isInteger(lock?.pid) && Number.isInteger(lock?.at) && !pidAlive(lock.pid) && Date.now() - lock.at > 10 * 60 * 1000;
      if (stale) throw new Error(`stale server lock ${path}; remove it manually only after confirming no pi-console command is running`);
      if (Date.now() > until) throw new Error(`another pi-console command is still in progress; retry shortly (lock: ${path})`);
      await sleep(100);
    }
  }
  try { return await fn(); }
  finally { await rm(path, { force: true }).catch(() => {}); }
}

async function tailLog(dir, limit = 2000) {
  try {
    const text = await readFile(logPath(dir), 'utf8');
    return text.trim().slice(-limit);
  } catch { return ''; }
}

async function rotateLog(dir) {
  try {
    if ((await stat(logPath(dir))).size > 1024 * 1024)
      await rename(logPath(dir), `${logPath(dir)}.1`).catch(() => {});
  } catch { /* No log yet. */ }
}

async function startInner(dir, env, { port, timeoutMs = 20000 } = {}) {
  const state = await readState(dir);
  if (state) {
    const token = await readToken(dir);
    const current = token && isConsole(await identity(state.port, token));
    if (current?.pid === state.pid && current.startedAt === state.startedAt && pidAlive(state.pid))
      return { changed: false, status: 'running', managed: true, pid: state.pid, port: state.port, url: state.url, note: 'already running' };
    // The recorded server is gone, replaced or unverifiable. Drop the stale record only;
    // whatever owns the PID or port now is left untouched.
    await clearState(dir);
  }
  const chosen = port ?? consolePort(env);
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > 65535) throw new Error('port must be an integer from 1 to 65535');
  if (await listening(chosen)) {
    const other = isConsole(await identity(chosen));
    if (other) return { changed: false, status: 'running', managed: false, pid: other.pid, port: chosen, url: env.PI_CONSOLE_PUBLIC_ORIGIN || `http://127.0.0.1:${chosen}`, note: 'an unmanaged pi-console server already owns this port' };
    return { changed: false, status: 'port-in-use', port: chosen };
  }
  const piCli = resolvePiCli(env);
  const token = randomBytes(24).toString('hex');
  await rotateLog(dir);
  const log = await open(logPath(dir), 'a');
  await log.appendFile(`\n--- pi-console start ${new Date().toISOString()} port ${chosen} ---\n`);
  const child = spawn(process.execPath, ['--import', tsxSpecifier, serverEntry], {
    cwd: packageRoot, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
    env: {
      ...env,
      PORT: String(chosen),
      PI_CONSOLE_DATA_DIR: dir,
      PI_CONSOLE_MANAGEMENT_TOKEN: token,
      PI_CONSOLE_PI_COMMAND: piCli,
    },
  });
  await log.close();
  child.unref();
  let exited = false, exitCode;
  child.once('exit', code => { exited = true; exitCode = code; });
  child.once('error', error => { exited = true; exitCode = error.message; });
  const url = env.PI_CONSOLE_PUBLIC_ORIGIN || `http://127.0.0.1:${chosen}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`pi-console exited during startup (${exitCode ?? 'signal'}): ${await tailLog(dir) || 'no server log output'}`);
    const current = isConsole(await identity(chosen, token));
    // The fresh challenge is answered using the secret passed only to our child.
    if (current?.pid === child.pid && /^[0-9a-f]{32}$/.test(current.nonce)) {
      await writeFile(tokenPath(dir), token, { mode: 0o600 });
      await writeState(dir, { version: 1, pid: child.pid, port: chosen, url, startedAt: current.startedAt ?? new Date().toISOString() });
      return { changed: true, status: 'running', managed: true, pid: child.pid, port: chosen, url };
    }
    await sleep(120);
  }
  try { child.kill(); } catch { /* Already gone. */ }
  throw new Error(`pi-console startup timed out after ${timeoutMs}ms: ${await tailLog(dir) || 'no server log output'}`);
}

async function stopInner(dir, env, { timeoutMs = 10000 } = {}) {
  const state = await readState(dir);
  if (!state) {
    // A console started outside this manager (legacy or standalone) is reported, never killed.
    let port;
    try { port = consolePort(env); } catch { return { changed: false, status: 'stopped' }; }
    const other = isConsole(await identity(port));
    if (other) return { changed: false, status: 'running', managed: false, pid: other.pid, port, note: 'server is not managed by this installation; stop it from its own process' };
    return { changed: false, status: 'stopped', port };
  }
  const token = await readToken(dir);
  const current = token && isConsole(await identity(state.port, token));
  if (!token) return { changed: false, status: 'unknown', pid: state.pid, port: state.port, error: 'management token is missing; process and state left untouched' };
  if (current?.pid !== state.pid || current.startedAt !== state.startedAt || !pidAlive(state.pid)) {
    // Dead, replaced by another process, or a different console now owns the port.
    await clearState(dir);
    return { changed: true, status: 'stopped', note: 'removed stale server state; the recorded process was not touched' };
  }
  if (!token) return { changed: false, status: 'running', managed: true, pid: state.pid, port: state.port, error: 'management token is missing; refusing to signal the process' };
  // Proof without ever transmitting the token: answer the server's per-start nonce
  // with an HMAC. A listener that fakes identity cannot mint the proof and learns
  // nothing usable from the exchange.
  const challenge = current.nonce;
  const reply = await manageRequest(state.port, { method: 'POST', path: '/api/manage/shutdown', challenge, proof: manageProofFor(token, challenge) });
  if (reply && reply.status !== 200)
    return { changed: false, status: 'running', managed: true, pid: state.pid, port: state.port, error: `management shutdown rejected (${reply.status}); process left untouched` };
  // Accepted (or the connection dropped mid-shutdown): wait for a real exit, bounded.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(state.pid)) { await clearState(dir); return { changed: true, status: 'stopped', pid: state.pid, port: state.port }; }
    await sleep(150);
  }
  // No signal fallback: pid+identity are not proof enough to kill a process — a
  // recycled PID could belong to anything. Report stopping/unknown instead.
  const still = isConsole(await identity(state.port));
  return { changed: false, status: 'stopping', pid: state.pid, port: state.port, error: `process did not exit within the shutdown window${still?.pid === state.pid ? '; the managed server is still reachable' : '; identity no longer verifiable'} — refusing to signal it` };
}

/** Options: env (defaults to process.env merged with the stable Console .env), port, timeoutMs. */
export async function startManagedServer({ env = process.env, port, timeoutMs } = {}) {
  env = await loadConsoleEnvironment(env);
  const dir = consoleDataDir(env);
  await mkdir(dir, { recursive: true });
  return withLock(dir, () => startInner(dir, env, { port, timeoutMs }));
}

export async function stopManagedServer({ env = process.env, timeoutMs } = {}) {
  env = await loadConsoleEnvironment(env);
  const dir = consoleDataDir(env);
  await mkdir(dir, { recursive: true });
  return withLock(dir, () => stopInner(dir, env, { timeoutMs }));
}

export async function restartManagedServer({ env = process.env, port, timeoutMs } = {}) {
  env = await loadConsoleEnvironment(env);
  const dir = consoleDataDir(env);
  await mkdir(dir, { recursive: true });
  return withLock(dir, async () => {
    const stopped = await stopInner(dir, env, {});
    if (stopped.error) return { ...stopped, action: 'restart' };
    // Default restart keeps the running server's port; an explicit port overrides it.
    return { ...(await startInner(dir, env, { port: port ?? stopped.port, timeoutMs })), action: 'restart' };
  });
}

export async function managedServerStatus({ env = process.env } = {}) {
  env = await loadConsoleEnvironment(env);
  const dir = consoleDataDir(env);
  const state = await readState(dir);
  if (state) {
    const token = await readToken(dir);
    const current = token && isConsole(await identity(state.port, token));
    const alive = pidAlive(state.pid);
    if (current?.pid === state.pid && current.startedAt === state.startedAt && alive)
      return { status: 'running', managed: true, pid: state.pid, port: state.port, url: state.url, startedAt: state.startedAt, version: current.version };
    return { status: 'stale', managed: true, pid: state.pid, port: state.port, pidAlive: alive, note: 'recorded state does not match a live pi-console; start/stop will clear it safely' };
  }
  let port;
  try { port = consolePort(env); } catch { return { status: 'stopped' }; }
  const other = isConsole(await identity(port));
  if (other) return { status: 'running', managed: false, pid: other.pid, port, url: env.PI_CONSOLE_PUBLIC_ORIGIN || `http://127.0.0.1:${port}`, version: other.version, note: 'server is not managed by this installation' };
  if (await listening(port)) return { status: 'stopped', port, portOccupied: true };
  return { status: 'stopped', port };
}
