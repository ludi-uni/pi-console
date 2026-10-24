import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStdioSession } from '../package/local-folder-mcp.mjs';
import { harness, modernMeta } from './companion-fake.fixture.mjs';
const check = fn => async () => { const h = await harness(); try { await fn(h); } finally { h.cleanup(); } };
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
test('explicit begin is pending only; repeat and unknown status never resubmit', check(async h => {
  assert.equal((await h.status('never-started')).state, 'unknown'); assert.equal(h.calls.length, 0);
  const p = await h.start('one'); assert.equal(p.state, 'pending'); assert.equal(h.issues(), 1);
  assert.deepEqual(await h.start('one'), p); assert.equal((await h.status('one')).state, 'pending');
  assert.equal(h.calls.filter(x => x === 'request').length, 1); assert.equal(h.issues(), 1);
}));
test('pending management denied before any broker RPC or provider effect', check(async h => {
  const p = await h.start('one');
  assert((await h.call('list_allowed_parents', h.handle(p))).error);
  assert((await h.call('create_managed_workspace', { ...h.handle(p), requestId: 'create', parent: 'D:\\Allowed', name: 'Repo', repo: true, workspace: true })).error);
  assert(!h.calls.includes('rpc')); assert.equal(h.created.length, 0);
}));
test('owner approval + explicit status allows metadata/create and never outputs credentials', check(async h => {
  const c = await h.connect(); assert.equal(c.authority, 'shared_connection');
  const listed = await h.call('list_allowed_parents', h.handle(c)); assert.equal(listed.result.structuredContent.parents[0].path, 'd:\\allowed');
  const created = await h.call('create_managed_workspace', { ...h.handle(c), requestId: 'create', parent: 'D:\\Allowed', name: 'Repo', repo: true, workspace: true });
  assert.equal(created.result.structuredContent.state, 'completed'); assert.equal(h.created.length, 1); assert.equal(h.registered.length, 1);
  const text = JSON.stringify([c, listed, created]); for (let i = 1; i <= 5; i++) assert(!text.includes(i.toString(16).padStart(64, '0')));
}));
for (const parent of ['D:\\Outside', '\\\\server\\share', '\\\\?\\D:\\Allowed', 'D:\\Allowed\\..\\Outside', 'D:\\Allowed-sibling']) test('out of boundary path denied: ' + parent, check(async h => {
  const c = await h.connect(); assert((await h.call('create_managed_workspace', { ...h.handle(c), requestId: 'create', parent, name: 'Repo', repo: false, workspace: false })).error); assert.equal(h.created.length, 0);
}));
test('unapproved directory/repo/workspace scope denied with a valid connection', check(async h => {
  const c = await h.connect('one', ['list']); assert((await h.call('create_managed_workspace', { ...h.handle(c), requestId: 'create', parent: 'D:\\Allowed', name: 'Repo', repo: false, workspace: false })).error); assert.equal(h.created.length, 0);
}));
test('duplicate operation creates once and result reconciles', check(async h => {
  const c = await h.connect(), args = { ...h.handle(c), requestId: 'create', parent: 'D:\\Allowed', name: 'Repo', repo: false, workspace: true };
  const r = await Promise.all([h.call('create_managed_workspace', args), h.call('create_managed_workspace', args)]);
  assert.equal(r.filter(x => x.result).length, 1); assert.equal(h.created.length, 1);
  assert.equal((await h.call('get_operation', { ...h.handle(c), requestId: 'create' })).result.structuredContent.state, 'completed');
}));
for (const stage of ['git', 'workspace']) test('partial failure receipt retained: ' + stage, check(async h => {
  const c = await h.connect(); h.fail(stage); const args = { ...h.handle(c), requestId: 'create', parent: 'D:\\Allowed', name: 'Repo', repo: true, workspace: true };
  assert((await h.call('create_managed_workspace', args)).error);
  const r = (await h.call('get_operation', { ...h.handle(c), requestId: 'create' })).result.structuredContent;
  assert.equal(r.state, 'partial'); assert.equal(r.stage, stage); assert((await h.call('create_managed_workspace', args)).error); assert.equal(h.created.length, 1);
}));
for (const failure of ['reparse', 'replace']) test('changed parent denied: ' + failure, check(async h => {
  const c = await h.connect(); h[failure](); assert((await h.call('list_allowed_parents', h.handle(c))).error);
}));
test('pending and connected expiry refuse without reapplication', check(async h => {
  const p = await h.start('one'); h.advance(300001); assert.equal((await h.status('one')).state, 'expired'); assert.equal(h.issues(), 1);
  const c = await h.connect('two'); h.advance(60001); assert((await h.call('list_allowed_parents', h.handle(c))).error); assert.equal((await h.status('two')).state, 'expired'); assert.equal(h.calls.filter(x => x === 'request').length, 2);
}));
test('owner revocation cannot be revived by status or management', check(async h => {
  const c = await h.connect(); await h.app.revoke({ connectionId: c.connectionId, requestId: 'revoke' }, () => {});
  assert((await h.call('list_allowed_parents', h.handle(c))).error); assert.equal((await h.status('request-1')).state, 'unknown'); assert((await h.call('list_allowed_parents', h.handle(c))).error);
}));
test('local cancellation denies, late owner approval never restores and grant removal stays explicit', check(async h => {
  const p = await h.start('one'); await h.call('cancel_local_connection', { requestId: 'one', connectionGeneration: p.connectionGeneration }); await h.approve(p.connectionId);
  assert.equal((await h.status('one')).state, 'cancelled'); assert((await h.call('list_allowed_parents', h.handle(p))).error); assert.equal(h.app.view().connections[0].state, 'connected');
}));
test('disconnect/reconnect and stale handle do not inherit authority', check(async h => {
  const a = await h.connect('one'); await h.call('cancel_local_connection', { requestId: 'one', connectionGeneration: a.connectionGeneration });
  const b = await h.connect('two'); assert.notEqual(a.connectionGeneration, b.connectionGeneration); assert.notEqual(a.connectionId, b.connectionId);
  assert((await h.call('list_allowed_parents', h.handle(a))).error); assert((await h.call('list_allowed_parents', { connectionId: b.connectionId, connectionGeneration: a.connectionGeneration })).error);
  assert((await h.call('list_allowed_parents', h.handle(b))).result); assert.equal((await h.start('one')).state, 'cancelled'); assert.equal(h.calls.filter(x => x === 'request').length, 2);
}));
test('concurrent begin IDs never create a second request', async () => {
  const d = defer(); let entered = false;
  const h = await harness(async (f, route, ...args) => { if (route === 'request') { entered = true; await d.promise; } return f.post(route, ...args); });
  try {
    const a = h.start('one'); await new Promise(r => setImmediate(r)); assert(entered);
    assert.equal((await h.start('one')).state, 'requesting'); assert((await h.call('begin_local_connection', { requestId: 'two' })).error);
    d.resolve(); assert.equal((await a).state, 'pending'); assert.equal(h.calls.filter(x => x === 'request').length, 1);
  } finally { d.resolve(); h.cleanup(); }
});
test('duplicate in-flight RPC ID is rejected while original request remains reconcilable', async () => {
  const d = defer(); const h = await harness(async (f, route, ...args) => { if (route === 'request') await d.promise; return f.post(route, ...args); });
  try { const first = h.message('tools/call', { name: 'begin_local_connection', arguments: { requestId: 'one' } }, 'same-rpc'); await new Promise(r => setImmediate(r)); assert((await h.message('tools/call', { name: 'begin_local_connection', arguments: { requestId: 'two' } }, 'same-rpc')).error); d.resolve(); assert.equal((await first).result.structuredContent.state, 'pending'); assert.equal(h.calls.filter(x => x === 'request').length, 1); } finally { d.resolve(); h.cleanup(); }
});
test('expiry during broker response refuses a late successful result', async () => {
  const h = await harness(async (f, route, ...args) => { const value = await f.post(route, ...args); if (route === 'rpc') f.advance(60001); return value; });
  try { const c = await h.connect(); assert((await h.call('list_allowed_parents', h.handle(c))).error); assert.equal((await h.status('request-1')).state, 'expired'); } finally { h.cleanup(); }
});
test('cancellation of an active claim is bounded and status can reconcile without a new approval request', async () => {
  const d = defer(); let block = true; const h = await harness(async (f, route, ...args) => { const value = await f.post(route, ...args); if (route === 'claim' && block) await d.promise; return value; });
  try { const p = await h.start('one'); await h.approve(p.connectionId); const current = h.message('tools/call', { name: 'get_local_connection', arguments: { requestId: 'one' } }, 'cancelled-claim'); await new Promise(r => setImmediate(r)); await h.session.message({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'cancelled-claim' } }); assert.equal((await current).result.structuredContent.state, 'unknown'); block = false; d.resolve(); assert.equal((await h.status('one')).state, 'connected'); assert.equal(h.calls.filter(x => x === 'request').length, 1); } finally { d.resolve(); h.cleanup(); }
});
test('lost begin response is unknown; repeated ID/status never auto resubmits', async () => {
  const h = await harness(async (f, route, ...args) => { const value = await f.post(route, ...args); if (route === 'request') throw Error('DUMMY_RESPONSE_LOSS'); return value; });
  try { const p = await h.start('one'); assert.equal(p.state, 'unknown'); assert.equal((await h.start('one')).state, 'unknown'); assert.equal((await h.status('one')).state, 'unknown'); assert.equal(h.calls.filter(x => x === 'request').length, 1); assert((await h.call('begin_local_connection', { requestId: 'two' })).error); } finally { h.cleanup(); }
});
test('delayed claim cannot resurrect cancellation', async () => {
  const d = defer(); const h = await harness(async (f, route, ...args) => { const value = await f.post(route, ...args); if (route === 'claim') await d.promise; return value; });
  try { const p = await h.start('one'); await h.approve(p.connectionId); const status = h.status('one'); await new Promise(r => setImmediate(r)); await h.call('cancel_local_connection', { requestId: 'one', connectionGeneration: p.connectionGeneration }); d.resolve(); assert.equal((await status).state, 'cancelled'); assert((await h.call('list_allowed_parents', h.handle(p))).error); } finally { d.resolve(); h.cleanup(); }
});
test('begin is absolutely bounded and late successful response does not attach a token/proof', { timeout: 4000 }, async () => {
  const d = defer(); let signal;
  const h = await harness(async (f, route, body, token, s) => { signal = s; const value = await f.post(route, body, token); await d.promise; return value; });
  try { const before = performance.now(), p = await h.start('one'); assert(performance.now() - before < 1800); assert.equal(p.state, 'unknown'); assert(signal.aborted); d.resolve(); await new Promise(r => setImmediate(r)); assert.equal((await h.status('one')).state, 'unknown'); assert.equal(h.calls.filter(x => x === 'request').length, 1); } finally { d.resolve(); h.cleanup(); }
});
test('request cancellation only aborts that request and keeps shared protocol usable', check(async h => {
  const c = await h.connect(); await h.session.message({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'another-chat-request' } }); assert((await h.call('list_allowed_parents', h.handle(c))).result); assert((await h.message('tools/list')).result);
}));
test('close/EOF blocks all further activity', check(async h => {
  const c = await h.connect(); h.session.close(); assert((await h.call('list_allowed_parents', h.handle(c))).error); assert((await h.message('initialize', { protocolVersion: '2025-11-25' })).error);
}));
test('same-version reinitialize does not reset or create approval; different version refused', check(async h => {
  const c = await h.connect(); const before = h.issues(); assert((await h.message('initialize', { protocolVersion: '2025-11-25' })).result); assert((await h.call('list_allowed_parents', h.handle(c))).result); assert.equal(h.issues(), before); assert((await h.message('initialize', { protocolVersion: '2025-06-18' })).error);
}));
test('modern metadata is per request and discover/list never grant or call the broker', async () => {
  let calls = 0; const s = createStdioSession({ post: async () => { calls++; throw Error(); } });
  const msg = (method, _meta = modernMeta) => s.message({ jsonrpc: '2.0', id: 1, method, params: { _meta } });
  try { assert.equal((await msg('server/discover')).result.resultType, 'complete'); assert.equal((await msg('tools/list')).result.tools.length, 6); assert.equal(calls, 0); assert.equal((await msg('tools/list', { ...modernMeta, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' })).error.code, -32022); assert.equal((await msg('tools/list', { 'io.modelcontextprotocol/clientCapabilities': {} })).error.code, -32602); assert.equal((await msg('tools/list', { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' })).error.code, -32602); assert((await msg('tools/list', {})).error); } finally { s.close(); }
});
test('mixed modern and legacy requests retain explicit shared handle and no clientInfo authority', check(async h => {
  const c = await h.connect(); const r = await h.message('tools/call', { name: 'list_allowed_parents', arguments: h.handle(c), _meta: { ...modernMeta, 'io.modelcontextprotocol/clientInfo': { name: 'Dots', version: 'untrusted label' } } }); assert.equal(r.result.resultType, 'complete'); assert((await h.message('tools/call', { name: 'list_allowed_parents', arguments: {}, _meta: modernMeta })).error);
}));
test('request history capacity is bounded and old IDs never regain authorization', check(async h => {
  for (let n = 0; n < 32; n++) { const p = await h.start('capacity-' + n); assert.equal(p.state, 'pending'); await h.call('cancel_local_connection', { requestId: p.requestId, connectionGeneration: p.connectionGeneration }); h.advance(300001); }
  assert((await h.call('begin_local_connection', { requestId: 'capacity-overflow' })).error); assert.equal((await h.start('capacity-0')).state, 'cancelled'); assert.equal(h.calls.filter(x => x === 'request').length, 32);
}));
