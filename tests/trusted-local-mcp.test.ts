import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTrustedLocalMcp, denyPublicMcp, trustedLocalConfigured } from '../server/trusted-local-mcp.ts';
import { WorkspacePermissions } from '../server/workspace-permissions.ts';
import { PromptReceipts } from '../server/runtime/prompt-receipts.ts';
import type { RuntimeManager } from '../server/runtime/manager.ts';
import { localFixture, dummyKeys, dummyHeaders, dummyRequestId } from './trusted-local.fixture.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAccessPrincipalVerifier } from '../server/access.ts';
import { createLocalMcpOwner } from '../server/local-mcp-owner.ts';
import { LocalMcpGrants } from '../server/local-mcp-grants.ts';
const keys = { read: '1'.repeat(64), control: '2'.repeat(64), final: '3'.repeat(64), owner: '4'.repeat(64) };
test('default OFF and public denial cannot be opened with a credential or isolation flag', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trusted-local-red-'));
    const runtime = { controlIsolationVerified: () => false } as RuntimeManager;
    const app = createTrustedLocalMcp(runtime, new WorkspacePermissions(join(root, 'permissions.json')), new PromptReceipts(join(root, 'receipts')), { grantFile: join(root, 'grants.json') });
    const server = createServer((req, res) => void app.handle(req, res));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        app.bind(server, 1);
        assert.equal(app.status().enabled, false);
        assert.equal((await fetch(`http://127.0.0.1:${(server.address() as any).port}/mcp/dots`, { method: 'POST', headers: { 'x-pi-console-control-key': keys.control } })).status, 404);
        for (const url of ['/mcp', '/mcp/dots', '/%6dcp/dots', '/.well-known/oauth-protected-resource/mcp/dots', '/api/control/start']) {
            let code = 0;
            const response = { writeHead: (n: number) => { code = n; }, end: () => { } };
            assert.equal(denyPublicMcp({ url } as any, response as any), true);
            assert.equal(code, 404);
        }
        assert.equal(runtime.controlIsolationVerified(), false);
    }
    finally {
        app.dispose();
        server.closeAllConnections();
        await new Promise<void>(r => server.close(() => r()));
        await rm(root, { recursive: true, force: true });
    }
});
async function fixture(work: (f: Awaited<ReturnType<typeof localFixture>>) => Promise<void>, change: any = {}, options: any = {}) {
    const f = await localFixture(change, options);
    try {
        await work(f);
    }
    finally {
        await f.cleanup();
    }
}
test('dedicated authenticated catalogs separate status, control and final; management API never mounts privately', () => fixture(async (f) => {
    const catalog = await f.rpc('tools/list');
    assert.equal(catalog.status, 200);
    assert.deepEqual(catalog.body.result.tools.map((x: any) => x.name), ['submit_instruction', 'start_execution', 'cancel_instruction', 'stop_execution', 'get_request']);
    assert.deepEqual((await f.rpc('tools/list', undefined, {}, 'read')).body.result.tools.map((x: any) => x.name), ['get_status', 'get_progress']);
    assert.equal((await f.rpc('tools/call', 'read_final_answer', f.target)).status, 409);
    assert.equal((await f.rpc('tools/list', undefined, {}, 'final')).status, 409);
    assert.equal((await f.rpc('tools/call', 'get_status', {}, 'read')).status, 200);
    assert.equal((await f.rpc('tools/call', 'get_status', {}, 'control')).status, 409);
    for (const path of ['/api/manage/shutdown', '/api/workspace-permissions/save', '/api/local-mcp/save', '/', '/mcp/readonly', '/mcp/dots?x=1', 'http://127.0.0.1/mcp/dots'])
        assert.equal((await f.raw(f.base, path, 'POST', { 'host': `127.0.0.1:${f.port}`, [dummyHeaders.control]: dummyKeys.control }, '{}')).status, 404);
}));
test('missing/wrong/duplicate/mixed credentials and native-browser/proxy/Host boundaries fail closed', () => fixture(async (f) => {
    assert.equal((await f.rpc('tools/list', undefined, {}, 'owner')).status, 401);
    assert.equal((await f.rpc('tools/list', undefined, {}, 'control', { [dummyHeaders.control]: '9'.repeat(64) })).status, 401);
    assert.equal((await f.rpc('tools/list', undefined, {}, 'control', { [dummyHeaders.read]: dummyKeys.read })).status, 401);
    const duplicate = await f.raw(f.base, '/mcp/dots', 'POST', ['host', `127.0.0.1:${f.port}`, dummyHeaders.control, dummyKeys.control, dummyHeaders.control, dummyKeys.control], '{}');
    assert.equal(duplicate.status, 401);
    for (const extra of [{ origin: 'http://evil.invalid' }, { origin: 'null' }, { 'x-forwarded-for': '127.0.0.1' }, { forwarded: 'for=127.0.0.1' }, { 'cf-access-jwt-assertion': 'dummy' }, { 'sec-fetch-site': 'same-origin' }, { host: `localhost:${f.port}` }, { host: `[::1]:${f.port}` }, { host: `127.0.0.1:${f.uiPort}` }] as Record<string, string>[])
        assert.equal((await f.rpc('tools/list', undefined, {}, 'control', extra)).status, 403);
    assert.equal((await f.raw(f.base, '/mcp/dots', 'GET', { 'host': `127.0.0.1:${f.port}`, [dummyHeaders.control]: dummyKeys.control })).status, 405);
    assert.equal((await f.raw(f.base, '/.well-known/oauth-protected-resource', 'GET', { 'host': `127.0.0.1:${f.port}`, [dummyHeaders.control]: dummyKeys.control })).status, 404);
}));
test('public listener denies all aliases/methods/normalized routes even with valid keys and loopback peer; ordinary UI remains', () => fixture(async (f) => {
    for (const p of ['/mcp', '/mcp/dots', '/mcp/unknown', '//mcp/dots', '/%6dcp/dots', '/mcp%2fdots', '/x/../mcp/dots', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/oauth/token', '/authorize', '/api/control/start', '/api/integration/main', '/api/%63ontrol/start'])
        for (const method of ['GET', 'POST', 'PUT'])
            assert.equal((await f.raw(f.uiBase, p, method, { host: `127.0.0.1:${f.uiPort}`, [dummyHeaders.control]: dummyKeys.control, 'cf-access-jwt-assertion': 'dummy' })).status, 404, p);
    assert.equal((await f.raw(f.uiBase, '/', 'GET', { host: `127.0.0.1:${f.uiPort}` })).text, 'DUMMY_LOCAL_UI');
}));
test('no base scope or control key can replace explicit expiring reviewed grant', () => fixture(async (f) => {
    const a = { ...f.target, requestId: dummyRequestId, message: 'DUMMY_INSTRUCTION' };
    assert.equal((await f.rpc('tools/call', 'submit_instruction', a)).status, 409);
    assert.equal(f.counts().prompts, 0);
    const view = (await f.owner('status', {})).body;
    assert.equal((await f.owner('review', { instance: view.instance, revision: view.revision, target: f.target, expiresAt: Date.now() + 86400001 })).status, 409);
    assert.equal((await f.owner('review', { instance: view.instance, revision: view.revision, target: { ...f.target, sessionId: 'foreign' }, expiresAt: Date.now() + 60000 })).status, 409);
    assert.equal((await f.owner('status', {}, { 'x-pi-console-local-owner-key': dummyKeys.control })).status, 403);
    const r = (await f.owner('review', { instance: view.instance, revision: view.revision, target: f.target, expiresAt: Date.now() + 60000 })).body;
    assert.equal((await f.owner('save', { reviewId: r.reviewId, requestId: r.requestId, confirmed: false })).status, 409);
    const saved = await f.owner('save', { reviewId: r.reviewId, requestId: r.requestId, confirmed: true });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.status.osIsolation, 'unverified');
    assert.equal(saved.body.grant.active, true);
    assert.equal((await f.owner('save', { reviewId: r.reviewId, requestId: r.requestId, confirmed: true })).status, 409);
    assert.equal((await f.owner('result', { requestId: r.requestId })).body.state, 'committed');
    assert.equal((await f.rpc('tools/call', 'submit_instruction', a)).status, 200);
    assert.equal((await f.rpc('tools/call', 'start_execution', { ...f.target, requestId: dummyRequestId })).status, 200);
    assert.equal(f.counts().prompts, 1);
}));
test('start retry/conflicting request IDs, exact stop and request result never dispatch twice', () => fixture(async (f) => {
    await f.grant();
    const a = { ...f.target, requestId: dummyRequestId };
    assert.equal((await f.rpc('tools/call', 'submit_instruction', { ...a, message: 'DUMMY' })).status, 200);
    assert.equal((await f.rpc('tools/call', 'submit_instruction', { ...a, message: 'OTHER' })).status, 409);
    assert.equal((await f.rpc('tools/call', 'start_execution', a)).status, 200);
    assert.equal((await f.rpc('tools/call', 'start_execution', a)).status, 200);
    assert.equal(f.counts().prompts, 1);
    assert.equal((await f.rpc('tools/call', 'get_request', a)).body.result.structuredContent.state, 'accepted');
    const stop = { ...f.target, requestId: '00000000-0000-4000-8000-000000000002', runId: 'dummy-run' };
    assert.equal((await f.rpc('tools/call', 'stop_execution', stop)).status, 200);
    assert.equal((await f.rpc('tools/call', 'stop_execution', stop)).status, 200);
    assert.equal(f.counts().stops, 1);
    assert.equal((await f.rpc('tools/call', 'stop_execution', { ...stop, runId: 'replacement' })).status, 409);
    const record = JSON.parse(await readFile(join(f.root, 'receipts', dummyRequestId + '.json'), 'utf8'));
    assert.equal(record.state, 'accepted');
    assert(!JSON.stringify(record).includes('DUMMY'));
    const binding = JSON.stringify({ instance: f.target.instance, revision: 1, workspaceId: 'w', path: f.workspace, sessionId: 's', generation: f.target.generation });
    assert.equal(await new PromptReceipts(join(f.root, 'receipts')).execute(dummyRequestId, { binding, action: 'start', message: 'DUMMY' }, async () => { assert.fail('restart redispatch'); }), 'dummy-run');
}));
test('ACK/response loss creates uncertain durable outcome and never retries dispatch', () => fixture(async (f) => {
    await f.grant();
    f.onPrompt(async () => { throw Error('DUMMY_ACK_LOST'); });
    const a = { ...f.target, requestId: dummyRequestId };
    await f.rpc('tools/call', 'submit_instruction', { ...a, message: 'DUMMY' });
    assert.equal((await f.rpc('tools/call', 'start_execution', a)).status, 409);
    assert.equal((await f.rpc('tools/call', 'start_execution', a)).status, 409);
    assert.equal(f.counts().prompts, 1);
    assert.equal(JSON.parse(await readFile(join(f.root, 'receipts', dummyRequestId + '.json'), 'utf8')).state, 'uncertain');
    assert.equal((await f.rpc('tools/call', 'get_request', a)).body.result.structuredContent.state, 'uncertain');
}));
test('scope expiry, credential expiry, generation change, revoke and disable deny without OS readiness', async () => {
    let clock = Date.now();
    await fixture(async (f) => {
        await f.grant(clock + 1000);
        const a = { ...f.target, requestId: dummyRequestId, message: 'DUMMY' };
        clock += 1001;
        assert.equal((await f.rpc('tools/call', 'submit_instruction', a)).status, 409);
        clock -= 1001;
        await f.grant(clock + 2000);
        f.generation('replacement');
        assert.equal((await f.rpc('tools/call', 'submit_instruction', a)).status, 409);
        f.generation(f.target.generation);
        assert.equal((await f.grant(clock + 2000, null)).saved.status, 200);
        assert.equal((await f.rpc('tools/call', 'submit_instruction', a)).status, 409);
        f.app.disable();
        assert.equal((await f.rpc('tools/list')).status, 404);
        assert.equal(f.runtime.controlIsolationVerified(), false);
        assert.equal(f.counts().prompts, 0);
    }, {}, { now: () => clock });
    clock = Date.now();
    await fixture(async (f) => { clock += 600001; assert.equal(f.app.status().reason, 'credential_expired'); assert.equal((await f.rpc('tools/list')).status, 404); }, {}, { now: () => clock });
});
test('revocation immediately before dispatch and response release fences fail closed', () => fixture(async (f) => {
    await f.grant();
    const a = { ...f.target, requestId: dummyRequestId };
    await f.rpc('tools/call', 'submit_instruction', { ...a, message: 'DUMMY' });
    f.onAdmission(async () => f.app.disable());
    assert.equal((await f.rpc('tools/call', 'start_execution', a)).status, 409);
    assert.equal(f.counts().prompts, 0);
}));
test('revocation while a dispatched request settles suppresses success without claiming rollback', () => fixture(async (f) => {
    await f.grant();
    const a = { ...f.target, requestId: dummyRequestId };
    await f.rpc('tools/call', 'submit_instruction', { ...a, message: 'DUMMY' });
    f.onPrompt(async () => f.app.disable());
    assert.equal((await f.rpc('tools/call', 'start_execution', a)).status, 409);
    assert.equal(f.counts().prompts, 1);
    const receipt = JSON.parse(await readFile(join(f.root, 'receipts', dummyRequestId + '.json'), 'utf8'));
    assert.equal(receipt.state, 'accepted');
}));
test('protocol/header/name, query, slash instructions and oversized body cannot fall back', () => fixture(async (f) => {
    await f.grant();
    for (const extra of [{ 'mcp-protocol-version': '2025-06-18' }, { 'mcp-method': 'initialize' }, { 'content-type': 'text/plain' }, { accept: 'application/json' }] as Record<string, string>[])
        assert.equal((await f.rpc('tools/list', undefined, {}, 'control', extra)).status, 409);
    assert.equal((await f.rpc('initialize')).status, 409);
    assert.equal((await f.rpc('tools/call', 'submit_instruction', { ...f.target, requestId: dummyRequestId, message: '/run' })).status, 409);
    assert.equal((await f.rpc('tools/call', 'submit_instruction', { ...f.target, requestId: dummyRequestId, message: 'x'.repeat(40000) })).status, 409);
    assert.equal(f.counts().prompts, 0);
}));
test('bad/unseparated/unknown key configuration and binding cannot confer authority', async () => {
    for (const cfg of [{ credentials: undefined }, { credentials: { read: dummyKeys.read, control: dummyKeys.read, final: dummyKeys.final, expiresAt: Date.now() + 10000 } }, { owner: undefined }, { owner: { mode: 'unknown' } }, { legacyCredentialKeys: undefined }, { legacyCredentialKeys: [dummyKeys.control] }])
        await fixture(async (f) => { assert.equal(f.app.status().enabled, false); assert.equal((await f.rpc('tools/list')).status, 404); }, cfg);
    await fixture(async (f) => { assert.throws(() => f.app.bind(f.server, f.port), /invalid_local_listener/); });
});
test('durable grant corruption/save failure and concurrent CAS reject instead of resurrecting permission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'local-grant-store-'));
    try {
        const store = new LocalMcpGrants(join(root, 'g.json'));
        const save = (id: string) => store.save('dummy-instance', 0, id, 'dummy-epoch', null, async () => { });
        const outcomes = await Promise.allSettled([save('dummy-one'), save('dummy-two')]);
        assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
        await writeFile(store.file, 'broken');
        await assert.rejects(store.snapshot(), /local_grant_unavailable/);
        const failure = new LocalMcpGrants(join(root, 'bad'));
        await mkdir(failure.file);
        await assert.rejects(failure.save('dummy-instance', 0, 'r', 'e', null, async () => { }));
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test('Access owner requires verified exact subject, issuer/audience and browser CSRF; public MCP still denied', async () => {
    const access = { origin: 'https://console.example.com', host: 'console.example.com', issuer: 'https://dummy.cloudflareaccess.com', audience: 'a'.repeat(64) };
    const pair = await generateKeyPair('RS256'), jwk = await exportJWK(pair.publicKey);
    jwk.kid = 'dummy';
    const verify = createAccessPrincipalVerifier(access, createLocalJWKSet({ keys: [jwk] }));
    const sign = (sub: string) => new SignJWT({ type: 'app', sub }).setProtectedHeader({ alg: 'RS256', kid: 'dummy' }).setIssuer(access.issuer).setAudience(access.audience).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const token = await sign('dummy-owner'), other = await sign('dummy-other');
    await fixture(async (f) => {
        const h = { 'cf-access-jwt-assertion': token };
        assert.equal((await f.owner('status', {}, h)).status, 200);
        assert.equal((await f.grant(Date.now() + 60000, f.target, h)).saved.status, 200);
        assert.equal((await f.owner('status', {}, { 'cf-access-jwt-assertion': other })).status, 403);
        assert.equal((await f.owner('status', {}, { ...h, origin: 'https://evil.invalid' })).status, 403);
        assert.equal((await f.owner('status', {}, { ...h, 'sec-fetch-site': 'cross-site' })).status, 403);
        assert.equal((await f.owner('status', {})).status, 401);
        assert.equal((await f.raw(f.uiBase, '/mcp/dots', 'POST', { host: access.host, ...h, [dummyHeaders.control]: dummyKeys.control })).status, 404);
    }, { owner: { mode: 'access-verified-owner', subject: 'dummy-owner', access, principal: () => undefined } }, { access, verify });
    const forged = createLocalMcpOwner({ mode: 'access-verified-owner', subject: 'dummy-owner', access, principal: () => ({ subject: 'dummy-owner', issuer: access.issuer, audience: access.audience, expiresAt: Date.now() + 60000 }) }, () => true);
    assert.equal(forged.verify({ headers: {}, rawHeaders: [] } as any), false);
    forged.dispose();
});
test('concurrent duplicate starts dispatch once and result remains inspectable', () => fixture(async (f) => {
    await f.grant();
    const a = { ...f.target, requestId: dummyRequestId };
    await f.rpc('tools/call', 'submit_instruction', { ...a, message: 'DUMMY' });
    const results = await Promise.all([f.rpc('tools/call', 'start_execution', a), f.rpc('tools/call', 'start_execution', a)]);
    assert(results.every(r => [200, 409].includes(r.status)));
    assert(results.some(r => r.status === 200));
    assert.equal(f.counts().prompts, 1);
    assert.equal((await f.rpc('tools/call', 'get_request', a)).body.result.structuredContent.state, 'accepted');
}));
test('persisted grant cannot resume after a new process-local credential epoch', () => fixture(async (f) => {
    await f.grant();
    const next = createTrustedLocalMcp(f.runtime as any, f.permissions, new PromptReceipts(join(f.root, 'receipts')), { grantFile: join(f.root, 'local-grants.json') }, f.cfg);
    try {
        next.bind(f.server, f.uiPort);
        assert.equal(next.status().enabled, true);
        assert.equal((await next.view()).grant?.active, false);
        assert.equal(next.status().osIsolation, 'unverified');
    }
    finally {
        next.dispose();
    }
    assert.equal(trustedLocalConfigured({ ...f.cfg, owner: undefined }), false);
    const bad = createTrustedLocalMcp(f.runtime as any, f.permissions, new PromptReceipts(join(f.root, 'receipts')), { grantFile: join(f.root, 'unused.json') }, f.cfg);
    try {
        for (const address of ['0.0.0.0', '::1', '::'])
            assert.throws(() => bad.bind({ address: () => ({ address, family: address === '0.0.0.0' ? 'IPv4' : 'IPv6', port: 33333 }) } as any, f.uiPort), /invalid_local_listener/);
    }
    finally {
        bad.dispose();
    }
}));
test('owner review expires and damaged grant store disables the local authority', async () => {
    let clock = Date.now();
    await fixture(async (f) => {
        const v = (await f.owner('status', {})).body;
        const r = (await f.owner('review', { instance: v.instance, revision: v.revision, target: f.target, expiresAt: clock + 120000 })).body;
        clock += 60001;
        assert.equal((await f.owner('save', { reviewId: r.reviewId, requestId: r.requestId, confirmed: true })).status, 409);
        assert.equal((await f.app.view()).grant, null);
        await writeFile(join(f.root, 'local-grants.json'), 'DUMMY_CORRUPT');
        assert.equal((await f.owner('status', {})).status, 409);
        assert.equal(f.app.status().enabled, false);
        assert.equal((await f.rpc('tools/list')).status, 404);
        assert.equal(f.counts().prompts, 0);
    }, {}, { now: () => clock });
});
