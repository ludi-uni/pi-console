import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FolderMcp, canonicalParent, childName, unavailableFolderProvider } from '../server/folder-mcp.ts';
import { setup } from './helpers/folder-mcp.fixture.ts';

test('parent path is case insensitive and never accepts escape spellings', () => {
  assert.equal(canonicalParent('D:\\Develop\\Allowed'), 'd:\\develop\\allowed');
  for (const path of ['D:relative', '\\\\server\\share', '\\\\?\\D:\\safe', '\\\\.\\C:', 'D:\\x\\..\\escape', 'D:\\x:stream', 'D:\\x.', 'D:\\x ', 'D:\\CON', 'D:\\safe\\\\x', 'D:/safe', 'D:\\']) assert.throws(() => canonicalParent(path));
  for (const name of ['..', '../x', 'a/b', 'a\\b', 'NUL.txt', 'com1', 'x:', 'x.', ' x', 'x ']) assert.throws(() => childName(name));
  assert.equal(childName('new-repo'), 'new-repo');
});

test('no generated role credentials until explicit approval; masked views; distinct internal roles', async () => {
  const x = setup(), p = x.pair(); assert.equal(x.issues(), 1);
  const r = await x.app.review({ connectionId: p.connectionId, parent: 'D:\\Allowed', operations: ['list'], expiresAt: x.time() + 50000 });
  assert.equal(x.issues(), 1); assert.equal(x.app.claim({ connectionId: p.connectionId, proof: p.proof }).state, 'pending');
  await assert.rejects(x.app.approve({ reviewId: r.reviewId, requestId: r.requestId, confirmed: false }, () => {}));
  await x.app.approve({ reviewId: r.reviewId, requestId: r.requestId, confirmed: true }, () => {});
  assert.equal(x.issues(), 5); const c: any = x.app.claim({ connectionId: p.connectionId, proof: p.proof }); assert.equal(c.state, 'connected');
  const view = JSON.stringify(x.app.view()); assert(!view.includes(p.proof)); assert(!view.includes(c.token));
  assert.equal(x.app.result(r.requestId).state, 'committed');
  await assert.rejects(x.app.approve({ reviewId: r.reviewId, requestId: r.requestId, confirmed: true }, () => {}));
  assert.equal(x.issues(), 5); assert.deepEqual(x.app.claim({ connectionId: p.connectionId, proof: p.proof }), c);
});
test('double submit serializes and duplicate request never creates twice', async () => {
  const x = setup(), { claim } = await x.approve(x.pair());
  const args = { requestId: 'dummy-create-1', parent: 'd:\\allowed', name: 'Repo', repo: true, workspace: true };
  const outcomes = await Promise.allSettled([x.app.call(claim.token, 'create_managed_workspace', args), x.app.call(claim.token, 'create_managed_workspace', args)]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1); assert.equal(x.f.created.length, 1); assert.equal(x.f.registered.length, 1);
  const receipt: any = await x.app.call(claim.token, 'get_operation', { requestId: args.requestId }); assert.equal(receipt.state, 'completed');
});
test('back and cancel issue no credentials and canceled reviews cannot be submitted', async () => {
  const x = setup(), p = x.pair(), r = await x.app.review({ connectionId: p.connectionId, parent: 'D:\\Allowed', operations: ['list'], expiresAt: x.time() + 1000 });
  await x.app.cancel(r.reviewId); assert.equal(x.issues(), 1); assert.equal(x.app.result(r.requestId).state, 'cancelled');
  await assert.rejects(x.app.approve({ reviewId: r.reviewId, requestId: r.requestId, confirmed: true }, () => {}));
});
test('multiple clients, scope, expiry, revoke and result are isolated', async () => {
  const x = setup(), a = await x.approve(x.pair()), b = await x.approve(x.pair(), ['list']);
  await assert.rejects(x.app.call(b.claim.token, 'create_managed_workspace', { requestId: 'b', parent: 'D:\\Allowed', name: 'B', repo: false, workspace: false }));
  await x.app.revoke({ connectionId: a.claim.connectionId, requestId: 'revoke-a' }, () => {});
  await assert.rejects(x.app.call(a.claim.token, 'list_allowed_parents', {}));
  assert.equal((await x.app.call(b.claim.token, 'list_allowed_parents', {}) as any).parents.length, 1);
  await assert.rejects(x.app.call(b.claim.token, 'get_operation', { requestId: 'b' }));
  x.advance(60001); await assert.rejects(x.app.call(b.claim.token, 'list_allowed_parents', {}));
});
for (const failure of ['outside', 'parent-replaced', 'reparse', 'owner-expired', 'review-expired', 'unknown-field']) test('fail closed: ' + failure, async () => {
  const x = setup(), p = x.pair();
  const r = await x.app.review({ connectionId: p.connectionId, parent: 'D:\\Allowed', operations: ['list', 'directory'], expiresAt: x.time() + 60000 });
  if (failure === 'parent-replaced') x.f.replace(); if (failure === 'reparse') x.f.reparse(); if (failure === 'review-expired') x.advance(60001);
  if (['parent-replaced', 'reparse', 'owner-expired', 'review-expired'].includes(failure)) {
    await assert.rejects(x.app.approve({ reviewId: r.reviewId, requestId: r.requestId, confirmed: true }, () => { if (failure === 'owner-expired') throw Error(); })); assert.equal(x.issues(), 1); return;
  }
  await x.app.approve({ reviewId: r.reviewId, requestId: r.requestId, confirmed: true }, () => {}); const c: any = x.app.claim({ connectionId: p.connectionId, proof: p.proof });
  await assert.rejects(x.app.call(c.token, 'create_managed_workspace', { requestId: 'escape', parent: failure === 'outside' ? 'D:\\Allowed-sibling' : 'D:\\Allowed', name: 'X', repo: false, workspace: false, ...(failure === 'unknown-field' ? { cloneUrl: 'dummy.invalid' } : {}) })); assert.equal(x.f.created.length, 0);
});
for (const stage of ['git', 'workspace']) test('partial failure preserves artifacts and receipt: ' + stage, async () => {
  const x = setup(), { claim } = await x.approve(x.pair()); x.f.fail(stage);
  const args = { requestId: 'partial', parent: 'D:\\Allowed', name: 'Partial', repo: true, workspace: true };
  await assert.rejects(x.app.call(claim.token, 'create_managed_workspace', args));
  const receipt: any = await x.app.call(claim.token, 'get_operation', { requestId: 'partial' }); assert.equal(receipt.state, 'partial'); assert.equal(receipt.stage, stage); assert.equal(receipt.artifact.path, 'd:\\allowed\\Partial');
  await assert.rejects(x.app.call(claim.token, 'create_managed_workspace', args)); assert.equal(x.f.created.length, 1);
});
test('expiry during create prevents next stage, records partial receipt', async () => {
  const x = setup(), { claim } = await x.approve(x.pair()); x.f.callback(() => x.advance(60001));
  await assert.rejects(x.app.call(claim.token, 'create_managed_workspace', { requestId: 'expiry', parent: 'D:\\Allowed', name: 'E', repo: true, workspace: true })); assert.equal(x.f.created.length, 1); assert.equal(x.f.registered.length, 0);
});
test('production provider refuses until handle anchored safety is supplied', async () => {
  const app = new FolderMcp(unavailableFolderProvider, {secret:()=> 'a'.repeat(64)}); const p = app.request({ name: 'dummy' });
  await assert.rejects(app.review({ connectionId: p.connectionId, parent: 'D:\\Allowed', operations: ['directory'], expiresAt: Date.now() + 60000 }));
});
test('case-equivalent existing name refuses overwrite and retains operation result', async () => {
  const x = setup(), { claim } = await x.approve(x.pair());
  await x.app.call(claim.token, 'create_managed_workspace', { requestId: 'first', parent: 'D:\\Allowed', name: 'Existing', repo: false, workspace: false });
  await assert.rejects(x.app.call(claim.token, 'create_managed_workspace', { requestId: 'second', parent: 'd:\\allowed', name: 'existing', repo: false, workspace: false }));
  assert.equal(x.f.created.length, 1); assert.equal((await x.app.call(claim.token, 'get_operation', { requestId: 'second' }) as any).state, 'unknown');
});
test('parent replaced after connection fails both enumeration and creation', async () => {
  const x = setup(), { claim } = await x.approve(x.pair()); x.f.replace();
  await assert.rejects(x.app.call(claim.token, 'list_allowed_parents', {}));
  await assert.rejects(x.app.call(claim.token, 'create_managed_workspace', { requestId: 'replaced', parent: 'D:\\Allowed', name: 'Child', repo: false, workspace: false })); assert.equal(x.f.created.length, 0);
});
test('all revocation invalidates pending review and token handoff', async () => {
  const x = setup(), a = await x.approve(x.pair()), p = x.pair();
  const r = await x.app.review({ connectionId: p.connectionId, parent: 'D:\\Allowed', operations: ['list'], expiresAt: x.time() + 60000 });
  await x.app.revoke({ connectionId: 'all', requestId: 'all' }, () => {});
  await assert.rejects(x.app.approve({ reviewId: r.reviewId, requestId: r.requestId, confirmed: true }, () => {}));
  assert.throws(() => x.app.claim({ connectionId: p.connectionId, proof: p.proof })); await assert.rejects(x.app.call(a.claim.token, 'list_allowed_parents', {}));
});
test('credential collision refuses atomic approval without an active grant', async () => {
  const x = setup(), app = new FolderMcp(x.f.provider, { now: x.time, secret: () => 'a'.repeat(64) }), p = app.request({ name: 'dummy' });
  const r = await app.review({ connectionId: p.connectionId, parent: 'D:\\Allowed', operations: ['list'], expiresAt: x.time() + 60000 });
  await assert.rejects(app.approve({ reviewId: r.reviewId, requestId: r.requestId, confirmed: true }, () => {})); assert.equal(app.view().connections[0].state, 'pending');
});
test('lost request that never committed can be abandoned; late resend cannot activate', async () => {
  const x = setup(), p = x.pair(), r = await x.app.review({ connectionId: p.connectionId, parent: 'D:\\Allowed', operations: ['list'], expiresAt: x.time() + 60000 });
  assert.equal(x.app.result(r.requestId).state, 'unknown');
  assert.equal((await x.app.abandon(r.requestId, () => {})).state, 'cancelled');
  await assert.rejects(x.app.approve({ reviewId: r.reviewId, requestId: r.requestId, confirmed: true }, () => {})); assert.equal(x.issues(), 1);
  const a = await x.approve(p); assert.equal((await x.app.abandon(a.review.requestId, () => {})).state, 'committed'); assert.equal(x.app.tools(a.claim.token).length, 3);
});
test('pending capacity is bounded and expiry/revoke releases connection slots', async () => {
  const x = setup(); for (let i = 0; i < 16; i++) x.pair(); assert.throws(() => x.pair());
  x.advance(300001); const p = x.pair(); assert.equal(x.app.view().connections.length, 1);
  await x.app.revoke({ connectionId: p.connectionId, requestId: 'capacity' }, () => {}); x.pair(); assert.equal(x.app.view().connections.length, 1);
});
