import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const piCli = process.env.PI_CONSOLE_PI_COMMAND || join(process.env.APPDATA || '', 'npm', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');
const exec = promisify(execFile);
const availablePort = async () => {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; probe.close(); await once(probe, 'close'); return port;
};

test('installed local Pi package exposes /pi-console and connects a real isolated SDK worker', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-package-'));
  const port = await availablePort();
  const env = { ...process.env, PI_CODING_AGENT_DIR: join(root, 'agent'), PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions'),
    PI_CONSOLE_DATA_DIR: join(root, 'data'), PI_CONSOLE_PI_COMMAND: '', PI_CONSOLE_WORKER_COMMAND: '', PORT: String(port), PI_OFFLINE: '1',
    PI_CONSOLE_PUBLIC_ORIGIN: '', PI_CONSOLE_ACCESS_TEAM_DOMAIN: '', PI_CONSOLE_ACCESS_AUD: '' };
  let rpc;
  try {
    await exec(process.execPath, [piCli, 'install', packageRoot], { cwd: root, env, timeout: 20000 });
    rpc = spawn(process.execPath, [piCli, '--mode', 'rpc', '--no-session', '--no-context-files', '--no-approve', '--offline'],
      { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let buffer = '', stderr = ''; const pending = new Map();
    rpc.stderr.on('data', chunk => stderr = (stderr + chunk.toString()).slice(-1200));
    rpc.stdout.on('data', chunk => {
      buffer += chunk.toString(); let cut;
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut).trim(); buffer = buffer.slice(cut + 1);
        if (!line) continue;
        const record = JSON.parse(line);
        if (record.type === 'response' && pending.has(record.id)) { pending.get(record.id)(record); pending.delete(record.id); }
      }
    });
    const call = async (id, type, fields = {}) => {
      const reply = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`RPC ${type} timed out: ${stderr}`)); }, 15000);
        pending.set(id, record => { clearTimeout(timeout); resolve(record); });
      });
      rpc.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
      const result = await reply; assert.equal(result.success, true, `${type}: ${result.error || stderr}`); return result.data;
    };
    const commands = await call('commands', 'get_commands');
    assert.ok(commands.commands.some(c => c.name === 'pi-console' && c.source === 'extension' && c.sourceInfo.origin === 'package'));
    await call('launch', 'prompt', { message: '/pi-console' });
    const base = `http://127.0.0.1:${port}`;
    const until = Date.now() + 10000; let page;
    while (Date.now() < until) {
      try { page = await fetch(base + '/'); if (page.ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    assert.equal(page?.status, 200, `package server not available: ${stderr}`);
    assert.match(await page.text(), /assets\/index-/);
    const post = async (route, data) => {
      const res = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
      const value = await res.json(); assert.equal(res.status, 200, JSON.stringify(value)); return value;
    };
    const workspace = (await post('/api/workspaces', { path: root })).workspace;
    const session = (await post('/api/sessions', { workspaceId: workspace.id })).session;
    const state = await (await fetch(`${base}/api/state?workspaceId=${workspace.id}&sessionId=${session.id}`)).json();
    assert.equal(state.runtime, 'running');
    assert.equal(state.session.id, session.id);
    assert.deepEqual(state.chat, [], 'direct SDK history must not become a chat prompt or model call');
    await post('/api/close', { workspaceId: workspace.id, sessionId: session.id });
    await call('stop', 'prompt', { message: '/pi-console stop' });
    let stopped = false; const stopBy = Date.now() + 8000;
    while (!stopped && Date.now() < stopBy) {
      try { await fetch(base + '/', { signal: AbortSignal.timeout(1000) }); }
      catch { stopped = true; }
      if (!stopped) await new Promise(resolve => setTimeout(resolve, 80));
    }
    assert.equal(stopped, true, 'stop command did not close the loopback server');
    const nextPort = await availablePort();
    await call('relaunch', 'prompt', { message: `/pi-console ${nextPort}` });
    const nextBase = `http://127.0.0.1:${nextPort}`;
    const nextPage = await fetch(nextBase + '/'); assert.equal(nextPage.status, 200);
    rpc.stdin.end();
    let exitTimer;
    try { await Promise.race([once(rpc, 'close'), new Promise((_, reject) => { exitTimer = setTimeout(() => reject(new Error('host Pi did not exit')), 8000); })]); }
    finally { clearTimeout(exitTimer); }
    rpc = undefined;
    // 0.4.3: the managed detached server intentionally survives the host Pi exit.
    const survived = await fetch(nextBase + '/', { signal: AbortSignal.timeout(4000) });
    assert.equal(survived.status, 200, 'managed server should survive host Pi exit');
    // Clean it up through the shared manager, as a later invocation would.
    const { stopManagedServer } = await import('../package/server-manager.mjs');
    const stopResult = await stopManagedServer({ env });
    assert.equal(stopResult.status, 'stopped', JSON.stringify(stopResult));
    await assert.rejects(fetch(nextBase + '/', { signal: AbortSignal.timeout(4000) }));
  } finally {
    if (rpc && rpc.exitCode === null) { rpc.kill(); await once(rpc, 'close').catch(() => {}); }
    try { const { stopManagedServer } = await import('../package/server-manager.mjs'); await stopManagedServer({ env }); } catch {}
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  }
});
