import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { appendFile } from 'node:fs/promises';
import { folderFixture } from './helpers/folder-mcp.fixture.ts';
test('owned Node stdio companion exchanges newline JSON-RPC, emits no role/proof/token', { timeout: 20000 }, async () => {
  const f = await folderFixture();
  try {
  const issued = await f.issue(), { cookie } = await f.login();
  const script = fileURLToPath(new URL('../package/local-folder-mcp.mjs', import.meta.url));
  const env: Record<string, string> = { TEMP: f.root, TMP: f.root };
  for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'ComSpec']) if (process.env[name]) env[name] = process.env[name]!;
  const child = spawn(process.execPath, [script, issued.body.url], { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', exited = false, lines: string[] = [];
  child.stdout.on('data', b => { stdout += b; lines = stdout.trim().split('\n').filter(Boolean); }); child.stderr.on('data', b => { stderr += b; }); child.once('exit', () => { exited = true; });
  const lifecycle = process.env.FOLDER_MCP_LIFECYCLE!;
  const send = (m: any) => child.stdin.write(JSON.stringify(m) + '\n');
  const until = async (predicate: () => boolean) => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 50)); } throw Error('dummy_stdio_timeout'); };
  try {
    await once(child, 'spawn'); await appendFile(lifecycle, JSON.stringify({ phase: 'created', kind: 'dummy-node-stdio', pid: child.pid, root: f.root, argvSecrets: false }) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'generic fake protocol driver', version: 'dummy' } } });
    await until(() => lines.length >= 1); assert.equal(JSON.parse(lines[0]).result.protocolVersion, '2025-11-25'); assert.equal(f.folders.app.view().connections.length, 0);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' }); send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }); await until(() => lines.length >= 2);
    assert.equal(JSON.parse(lines[1]).result.tools.length, 6); assert.equal(f.folders.app.view().connections.length, 0);
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'begin_local_connection', arguments: { requestId: 'dummy-pair' } } }); await until(() => lines.length >= 3);
    const pending = JSON.parse(lines[2]).result.structuredContent, connectionId = pending.connectionId;
    const review = await f.browser('folder/review', { connectionId, parent: 'D:\\Allowed', operations: ['list'], expiresAt: f.folders.time() + 60000 }, cookie);
    assert.equal(review.status, 200); assert.equal((await f.browser('folder/approve', { reviewId: review.body.reviewId, requestId: review.body.requestId, confirmed: true }, cookie)).status, 200);
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_local_connection', arguments: { requestId: 'dummy-pair' } } }); await until(() => lines.length >= 4); assert.equal(JSON.parse(lines[3]).result.structuredContent.state, 'connected');
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_allowed_parents', arguments: { connectionId, connectionGeneration: pending.connectionGeneration } } }); await until(() => lines.length >= 5);
    assert.equal(JSON.parse(lines[4]).result.structuredContent.parents[0].path, 'd:\\allowed');
    for (let n = 1; n <= 5; n++) assert(!(stdout + stderr).includes(n.toString(16).padStart(64, '0')));
    assert.equal(lines.length, 5); child.stdin.end(); await until(() => exited);
  } finally {
    if (!exited) { child.kill(); await until(() => exited); }
    assert(exited); await appendFile(lifecycle, JSON.stringify({ phase: 'closed', kind: 'dummy-node-stdio', pid: child.pid, childExited: true }) + '\n'); 
  }
  } finally { await f.cleanup(); }
});
