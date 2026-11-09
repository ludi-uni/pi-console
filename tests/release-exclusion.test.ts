// Release boundary: Dots and the console-hosted local MCP lanes are excluded
// for this release through the shared MCP_RELEASE_ENABLED const. Persisted
// configuration and env opt-ins must not reopen any lane, while the normal
// console, settings owner registration, speech and remote routes stay live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/css-stub-register.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MCP_RELEASE_ENABLED } from '../shared/release-availability.mjs';
import { defaultPreferences } from '../web/preferences.ts';

const { default: SettingsPage } = await import('../web/SettingsPage.tsx');
const { default: LocalOwner } = await import('../web/LocalOwner.tsx');

test('the release gate is a closed literal const', () => {
  assert.equal(MCP_RELEASE_ENABLED, false);
});

test('settings page hides the Local MCP section while remote connections and voice stay listed', () => {
  const s = renderToStaticMarkup(React.createElement(SettingsPage, {
    preferences: defaultPreferences, onChange: () => {}, onBack: () => {}, workspaceCount: 0, sessionCount: 0, connected: true,
  }));
  assert(!s.includes('Local MCP'));
  assert(!s.includes('ローカル MCP'));
  assert(s.includes('Remote connections'));
  assert(s.includes('Voice input'));
});

test('local owner page keeps owner registration and speech, hides MCP/Dots widgets', () => {
  const s = renderToStaticMarkup(React.createElement(LocalOwner));
  assert(!s.includes('Dots'));
  assert(!s.includes('local-resume'));
  assert(!s.includes('WorkspacePermissions'));
  // The login boundary itself is still rendered.
  assert(s.includes('本人') || s.includes('bootstrap'));
});

test('settings page hides the Local MCP section in Japanese too', () => {
  const s = renderToStaticMarkup(React.createElement(SettingsPage, {
    preferences: { ...defaultPreferences, language: 'ja' }, onChange: () => {}, onBack: () => {}, workspaceCount: 0, sessionCount: 0, connected: true,
  }));
  assert(!s.includes('ローカル MCP'));
  assert(s.includes('リモート接続'));
});

test('release boundary denies owner credential provisioning while owner login still works', async () => {
  const { ownerFixture } = await import('./local-owner.fixture.ts');
  const f = await ownerFixture({ credentials: false });
  try {
    const { cookie } = await f.login();
    // Owner session is established but the MCP credential profile lanes are closed.
    assert.equal((await f.browser('auth/status', {}, cookie)).status, 200);
    assert.equal((await f.browser('credentials/save', f.credentials(), cookie)).status, 404);
    assert.equal((await f.browser('credentials/result', { requestId: 'x' }, cookie)).status, 404);
  } finally {
    await f.cleanup();
  }
});

test('without the release flag the credential lane keeps default standalone behavior', async () => {
  const { ownerFixture } = await import('./local-owner.fixture.ts');
  const f = await ownerFixture();
  try {
    const { cookie } = await f.login();
    assert.equal((await f.browser('auth/status', {}, cookie)).status, 200);
    // Default lane preserved: provisioning is still reachable for unit tests.
    assert.notEqual((await f.browser('credentials/save', f.credentials(), cookie)).status, 404);
  } finally {
    await f.cleanup();
  }
});

const runCli = (args: string[], env: Record<string, string> = {}) => new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
  const proc = spawn(process.execPath, args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: 'pipe' });
  let stdout = '', stderr = '', done = false;
  const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); if (proc.exitCode === null) proc.kill(); resolve({ code, stdout, stderr }); };
  const timer = setTimeout(() => finish(proc.exitCode), 8000);
  proc.stdout.on('data', d => stdout += d.toString());
  proc.stderr.on('data', d => stderr += d.toString());
  proc.on('error', () => finish(-1));
  proc.on('close', code => finish(code));
});

test('pi-console local-resume refuses on stderr only, stdout stays RPC-clean', { timeout: 15000 }, async () => {
  const r = await runCli(['package/pi-console.mjs', 'local-resume', 'codex-local-v1']);
  assert.equal(r.stdout, '');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not available/i);
});

test('direct local-resume stdio entry cannot reopen MCP', { timeout: 15000 }, async () => {
  const r = await runCli(['package/local-resume-mcp.mjs', '--local-resume', 'codex-local-v1']);
  assert.equal(r.stdout, '');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not available/i);
});

test('direct local-folder stdio entry cannot reopen MCP', { timeout: 15000 }, async () => {
  const r = await runCli(['package/local-folder-mcp.mjs', 'http://127.0.0.1:1']);
  assert.equal(r.stdout, '');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not available/i);
});

test('server routes: MCP/Dots lanes and discovery 404 even with env opt-in; normal routes stay live', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-release-'));
  const port = 32000 + Math.floor(Math.random() * 10000);
  // Old persisted/env opt-ins must not reopen the release boundary.
  const proc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env, PORT: String(port), PI_CONSOLE_DATA_DIR: root,
      PI_CONSOLE_READONLY_MCP: '1',
      PI_CONSOLE_CONTROL_MCP_KEY: 'a'.repeat(64),
      PI_CONSOLE_MANAGEMENT_TOKEN: 'b'.repeat(48),
      PI_CONSOLE_PUBLIC_ORIGIN: '', PI_CONSOLE_ACCESS_TEAM_DOMAIN: '', PI_CONSOLE_ACCESS_AUD: '',
    }, stdio: 'pipe',
  });
  let output = ''; proc.stdout.on('data', d => output += d.toString()); proc.stderr.on('data', d => output += d.toString());
  try {
    const deadline = Date.now() + 12000;
    while (!output.includes('pi-console http:') && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    assert.match(output, /pi-console http:/);
    const request = (path: string, headers: Record<string, string> = {}, method = 'GET', body?: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
        let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode!, body: data }));
      });
      req.on('error', reject); if (body) req.write(body); req.end();
    });
    const post = (path: string) => request(path, { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }, 'POST', '{}');
    // Discovery and broker advertisement are gone.
    const discovery = await request('/api/local-mcp-discovery');
    assert.equal(discovery.status, 404);
    // Loopback MCP lanes are not mounted through the owner broker or public settings.
    for (const route of ['start', 'folder/status', 'pi-control/status'])
      assert.equal((await post(`/api/settings-local-mcp/${route}`)).status, 404, route);
    for (const route of ['/api/external-mcp/status', '/api/workspace-permissions/final/session', '/api/manage/local-resume/open'])
      assert.equal((await post(route)).status, 404, route);
    // The public MCP path fence still denies first.
    assert.equal((await request('/mcp/dots')).status, 404);
    assert.equal((await request('/mcp/anything')).status, 404);
    // Owner registration and tunnel (remote access) routes remain wired.
    const settingsStatus = await post('/api/settings-local-mcp/status');
    assert.notEqual(settingsStatus.status, 404);
    const tunnelStatus = await post('/api/settings-local-mcp/tunnel/status');
    assert.notEqual(tunnelStatus.status, 404);
    // Normal console APIs are unaffected.
    assert.equal((await request('/api/workspaces')).status, 200);
    assert.equal((await request('/api/startup')).status, 200);
    assert.equal((await request('/api/session-retention')).status, 200);
  } finally { proc.kill(); await once(proc, 'close').catch(() => {}); await rm(root, { recursive: true, force: true }); }
});
