import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderFixture } from './helpers/folder-mcp.fixture.ts';
import { createStdioSession, ownerOrigin, privatePost } from '../package/local-folder-mcp.mjs';
import { denyPublicMcp } from '../server/trusted-local-mcp.ts';
import { request } from 'node:http';

const fixture = async (work: (f: Awaited<ReturnType<typeof folderFixture>>) => Promise<void>) => { const f = await folderFixture(); try { await work(f); } finally { await f.cleanup(); } };
test('private broker shares verified owner; browser/proxy/duplicate/raw query attempts denied', () => fixture(async f => {
  const issued = await f.issue(), port = f.app.status().port!;
  assert.equal(issued.status, 200);
  for (const headers of [{ origin: 'http://127.0.0.1:' + port }, { cookie: 'untrusted=1' }, { 'x-forwarded-host': 'public.example' }]) {
    assert([403, 409].includes((await f.call(port, '/local-owner/folder/request', { name: 'dummy' }, headers)).status));
  }
  const duplicateHost = await new Promise<number>((resolve, reject) => {
    const q = request({ hostname: '127.0.0.1', port, path: '/local-owner/folder/request', method: 'POST', agent: false, headers: ['Host', '127.0.0.1:' + port, 'Host', '127.0.0.1:' + port, 'Content-Type', 'application/json'] }, r => { r.resume(); r.on('end', () => resolve(r.statusCode!)); }); q.on('error', reject); q.end(JSON.stringify({ name: 'duplicate' }));
  }); assert([400, 403, 409].includes(duplicateHost));
  assert.equal((await f.call(port, '/local-owner/folder/request?key=dummy', { name: 'dummy' })).status, 404);
  assert.equal((await f.call(port, '/local-owner/folder/status', {})).status, 409);
  const login = await f.login(); assert.equal((await f.browser('folder/status', {}, login.cookie)).status, 200);
  assert.equal((await f.browser('folder/request', { name: 'browser client' }, login.cookie)).status, 409);
}));
test('standard stdio initialized/list/call without custom headers or clientInfo identity', () => fixture(async f => {
  const issued = await f.issue(), url = issued.body.url, origin = ownerOrigin(url), { cookie } = await f.login();
  const post = (route: string, body: any, token?: string, signal?: AbortSignal) => privatePost(origin, route, body, token, signal);
  const bridge = createStdioSession({ post, now: f.folders.time });
  const initialized = await bridge.message({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'not Dots', version: 'dummy' } } });
  assert.equal(initialized.result.protocolVersion, '2025-11-25'); assert.equal(f.folders.app.view().connections.length, 0);
  assert.equal(await bridge.message({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  const tools = await bridge.message({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(tools.result.tools.length, 6); assert.equal(f.folders.app.view().connections.length, 0);
  const p = (await bridge.message({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'begin_local_connection', arguments: { requestId: 'bridge-pair' } } })).result.structuredContent;
  const handle = { connectionId: p.connectionId, connectionGeneration: p.connectionGeneration };
  assert((await bridge.message({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_allowed_parents', arguments: handle } })).error);
  const review = await f.browser('folder/review', { connectionId: p.connectionId, parent: 'D:\\Allowed', operations: ['list', 'directory', 'repo', 'workspace'], expiresAt: f.folders.time() + 60000 }, cookie);
  assert.equal(review.status, 200); assert.equal((await f.browser('folder/approve', { reviewId: review.body.reviewId, requestId: review.body.requestId, confirmed: true }, cookie)).status, 200);
  assert.equal((await bridge.message({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_local_connection', arguments: { requestId: 'bridge-pair' } } })).result.structuredContent.state, 'connected');
  const created = await bridge.message({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'create_managed_workspace', arguments: { ...handle, requestId: 'bridge-1', parent: 'D:\\Allowed', name: 'DummyRepo', repo: true, workspace: true } } });
  assert.equal(created.result.structuredContent.state, 'completed');
  const list = await bridge.message({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_allowed_parents', arguments: handle } }); assert.equal(list.result.structuredContent.workspaces.length, 1);
  const denied = await bridge.message({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_final_answer', arguments: {} } }); assert(denied.error);
  assert.equal(f.folders.f.created.length, 1); bridge.close();
}));
test('public listener aliases cannot expose private pairing or standard discovery', () => {
  for (const url of ['/local-owner/folder/request', '/%6cocal-owner/folder/claim', '/LOCAL-OWNER//FOLDER/rpc', '/mcp/dots', '/.well-known/oauth-authorization-server']) {
    let status = 0; assert(denyPublicMcp({ url, resume() {} } as any, { writeHead(n: number) { status = n; }, end() {} } as any)); assert.equal(status, 404);
  }
});
test('companion address forbids public/credential/query/fragment/schemeless routes', () => {
  for (const url of ['https://example.com/', 'http://localhost:2/', 'http://127.0.0.1:3/?token=dummy', 'http://user:pass@127.0.0.1:4/', 'http://127.0.0.1:3/#secret', 'http://127.0.0.1:4/api/']) assert.throws(() => ownerOrigin(url));
});
test('approval timeout and browser denied-owner never create grants', () => fixture(async f => {
  const issued = await f.issue();
  const bridge = createStdioSession({ post: (route: string, body: any, token?: string, signal?: AbortSignal) => privatePost(ownerOrigin(issued.body.url), route, body, token, signal), now: f.folders.time });
  assert((await bridge.message({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })).result);
  await bridge.message({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await bridge.message({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'begin_local_connection', arguments: { requestId: 'expired' } } });
  f.folders.advance(300001);
  const response = await bridge.message({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_local_connection', arguments: { requestId: 'expired' } } }); assert.equal(response.result.structuredContent.state, 'expired');
  assert.equal(f.folders.issues(), 1); assert(f.folders.app.view().connections.every((c: any) => c.state === 'expired')); bridge.close();
}));
