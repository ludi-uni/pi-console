import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { managedServerStatus, stopManagedServer, startManagedServer } from '../package/server-manager.mjs';

const envFor = root => ({ ...process.env, PI_CONSOLE_DATA_DIR: root, PI_CODING_AGENT_DIR: join(root, 'agent'),
  PI_CONSOLE_PUBLIC_ORIGIN: '', PI_CONSOLE_ACCESS_TEAM_DOMAIN: '', PI_CONSOLE_ACCESS_AUD: '' });

test('a foreign HTTP listener cannot forge managed identity or receive a shutdown proof', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-fake-identity-'));
  let shutdowns = 0;
  const server = createServer((req, res) => {
    if (req.method === 'POST') shutdowns++;
    assert.equal(req.headers['x-pi-console-manage-token'], undefined);
    res.end(JSON.stringify({ service: 'pi-console', pid: process.pid, startedAt: 'fake', nonce: 'a'.repeat(32) }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port, env = { ...envFor(root), PORT: String(port) };
  try {
    await writeFile(join(root, 'server-state.json'), JSON.stringify({ version: 1, pid: process.pid, port, startedAt: 'fake' }));
    await writeFile(join(root, 'server-token'), 'b'.repeat(48));
    assert.equal((await managedServerStatus({ env })).status, 'stale');
    assert.equal((await stopManagedServer({ env })).status, 'stopped');
    assert.equal(shutdowns, 0);
    assert.equal(server.listening, true);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});

test('old locks are not stolen and the lock file is preserved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-stale-lock-'));
  const file = join(root, 'server.lock');
  try {
    const lock = JSON.stringify({ pid: 2147483647, at: 0 });
    await writeFile(file, lock);
    await assert.rejects(stopManagedServer({ env: envFor(root) }), /stale server lock/);
    assert.equal(await readFile(file, 'utf8'), lock);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('management rejects proxied requests and invalid shutdown proof while valid ownership remains usable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-manage-auth-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const cli = join(root, 'fake-pi.cjs'); await writeFile(cli, 'process.stdin.resume();');
  const env = { ...envFor(root), PORT: String(port), PI_CONSOLE_PI_COMMAND: cli };
  try {
    await startManagedServer({ env });
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/manage/identity`, { headers: { 'cf-ray': 'test' } })).status, 404);
    assert.equal((await fetch(`${base}/api/manage/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge: 'a'.repeat(32) }) })).status, 401);
    assert.equal((await managedServerStatus({ env })).status, 'running');
  } finally { await stopManagedServer({ env }); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
