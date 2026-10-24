import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { LocalOwnerProfile } from '../server/local-owner-profile.ts';
import { createLocalMcpOwner } from '../server/local-mcp-owner.ts';
import { requestManagedOwnerLogin } from '../package/server-manager.mjs';
import { ownerFixture, token, nonce, keys } from './local-owner.fixture.ts';
import { createTrustedLocalMcp } from '../server/trusted-local-mcp.ts';
import { WorkspacePermissions } from '../server/workspace-permissions.ts';
import { PromptReceipts } from '../server/runtime/prompt-receipts.ts';
const fixture = async (fn: (f: Awaited<ReturnType<typeof ownerFixture>>) => Promise<void>, options: any = {}) => {
    const f = await ownerFixture(options);
    try {
        await fn(f);
    }
    finally {
        await f.cleanup();
    }
};
test('owner setup is OFF without an explicit valid management credential', () => fixture(async (f) => { assert.equal((await f.issue()).status, 403); assert(!f.app.status().listening); }, { managementToken: undefined }));
test('management possession proof is nonce/request bound and cannot use shutdown proof', () => fixture(async (f) => {
    const b = { challenge: nonce, requestId: randomUUID() };
    for (const proof of ['0'.repeat(64), createHmac('sha256', token).update(`pi-console-manage:${nonce}`).digest('hex')])
        assert.equal((await f.issue(b, { 'x-pi-console-manage-proof': proof })).status, 403);
    assert.equal((await f.issue({ ...b, challenge: 'c'.repeat(32) })).status, 403);
    assert(!f.app.status().listening);
}));
test('manager bootstrap denies browser, proxy, foreign Host and malformed request id', () => fixture(async (f) => {
    for (const h of [{ origin: 'http://127.0.0.1' }, { 'sec-fetch-site': 'same-origin' }, { 'cf-ray': 'dummy' }, { 'x-forwarded-proto': 'https' }, { host: 'localhost' }])
        assert.equal((await f.issue(undefined, h)).status, 403);
    assert.equal((await f.issue({ challenge: nonce, requestId: 'invalid' })).status, 403);
    assert(!f.app.status().listening);
}));
test('authenticated issue never replays its one-time secret', () => fixture(async (f) => { const b = { challenge: nonce, requestId: randomUUID() }, r = await f.issue(b); assert.equal(r.status, 200); assert.equal(new URL(r.body.url).hostname, '127.0.0.1'); assert.equal(new URL(r.body.url).search, ''); const again = await f.issue(b); assert.equal(again.status, 409); assert(!again.text.includes(r.body.code)); }));
test('bootstrap has short expiry, consumes once and cookie has HttpOnly/path/SameSite', () => fixture(async (f) => { const expired = await f.issue(); f.advance(120001); assert.equal((await f.browser('auth/claim', { code: expired.body.code })).status, 401); const l = await f.login(); assert.match(l.claim.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Max-Age=600/); assert.match(l.claim.headers['set-cookie'][0], /Path=\/local-owner/); assert.equal((await f.browser('auth/claim', { code: l.issued.body.code })).status, 401); assert(!l.claim.text.includes(l.issued.body.code)); }));
test('literal localhost or static admin/key header alone is never owner identity', () => fixture(async (f) => { await f.issue(); assert.equal((await f.browser('auth/status', {}, undefined, { 'x-pi-console-admin': '1', 'x-pi-console-local-owner-key': '5'.repeat(64) })).status, 401); assert.equal((await f.browser('credentials/save', {})).status, 401); }));
test('owner cookie does not bypass Origin, fetch-site, Host or proxy checks', () => fixture(async (f) => {
    const { cookie } = await f.login();
    for (const h of [{ origin: 'http://127.0.0.1:1' }, { host: 'localhost' }, { 'sec-fetch-site': 'cross-site' }, { 'x-real-ip': '127.0.0.1' }, { 'cf-access-jwt-assertion': 'dummy' }])
        assert.equal((await f.browser('auth/status', {}, cookie, h)).status, 403);
    assert.equal((await f.browser('auth/status', {}, cookie, {}, 'GET')).status, 403);
}));
test('logout and expiry revoke cookie; a restarted listener accepts no old cookie', () => fixture(async (f) => { const l = await f.login(); assert.equal((await f.browser('auth/logout', {}, l.cookie)).status, 200); assert.equal((await f.browser('auth/status', {}, l.cookie)).status, 401); const next = await f.login(); f.advance(600001); assert.equal((await f.browser('auth/status', {}, next.cookie)).status, 401); await f.app.dispose(); assert(!f.app.status().listening); await fixture(async (newer) => { await newer.issue(); assert.equal((await newer.browser('auth/status', {}, next.cookie)).status, 401); }); }));
test('invalid bootstrap attempts are bounded and fresh explicit issue resets them', () => fixture(async (f) => {
    const r = await f.issue();
    for (let i = 0; i < 8; i++)
        assert.equal((await f.browser('auth/claim', { code: '0'.repeat(64) })).status, 401);
    assert.equal((await f.browser('auth/claim', { code: r.body.code })).status, 401);
    await f.login();
}));
test('owner HTML is nonsecret and resolves built assets under its isolated prefix', () => fixture(async (f) => { const r = await f.issue(), html = await f.browser('', {}, undefined, {}, 'GET'); assert.equal(html.status, 200); assert(!html.text.includes(r.body.code) && !html.text.includes(token)); assert.match(html.text, /\/local-owner\/assets\/owner.js/); assert.equal((await f.browser('assets/owner.js', {}, undefined, {}, 'GET')).status, 200); assert.equal((await f.call(f.app.status().port!, '/api/manage/shutdown')).status, 404); }));
test('explicit distinct credentials save disabled profile, return no keys or automatic grant', () => fixture(async (f) => {
    const l = await f.login(), id = randomUUID(), body = { requestId: id, revision: 0, credentials: f.credentials(), confirmed: true };
    const saved = await f.browser('credentials/save', body, l.cookie);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.enabled, false);
    for (const k of Object.values(keys))
        assert(!saved.text.includes(k));
    const p = JSON.parse(await readFile(join(f.root, 'credentials.json'), 'utf8'));
    assert.equal(p.enabled, false);
    assert.equal(p.revision, 1);
    const r = await f.browser('credentials/result', { requestId: id }, l.cookie);
    assert.equal(r.body.state, 'committed');
    assert.equal((await f.browser('credentials/save', body, l.cookie)).status, 409);
    assert.equal((await f.browser('credentials/result', { requestId: randomUUID() }, l.cookie)).body.state, 'unknown');
}));
test('credential provisioning denies legacy/bootstrap/session reuse, duplicates and omitted confirmation', () => fixture(async (f) => {
    const l = await f.login();
    for (const c of [{ ...f.credentials(), read: '4'.repeat(64) }, { ...f.credentials(), read: l.issued.body.code }, { ...f.credentials(), read: l.cookie.split('=')[1] }, { ...f.credentials(), control: keys.read }, { ...f.credentials(), expiresAt: f.now() }, { ...f.credentials(), expiresAt: f.now() + 86400001 }])
        assert.equal((await f.browser('credentials/save', { requestId: randomUUID(), revision: 0, credentials: c, confirmed: true }, l.cookie)).status, 409);
    assert.equal((await f.browser('credentials/save', { requestId: randomUUID(), revision: 0, credentials: f.credentials(), confirmed: false }, l.cookie)).status, 409);
    assert.equal((await f.app.profile.view()).configured, false);
}));
test('credential CAS, strict result identifier and corrupt/enabled profile fail closed', () => fixture(async (f) => { const l = await f.login(); assert.equal((await f.browser('credentials/save', { requestId: randomUUID(), revision: 1, credentials: f.credentials(), confirmed: true }, l.cookie)).status, 409); assert.equal((await f.browser('credentials/result', { requestId: { unexpected: 'object' } }, l.cookie)).status, 409); await writeFile(join(f.root, 'credentials.json'), JSON.stringify({ enabled: true })); assert.equal((await f.browser('auth/status', {}, l.cookie)).status, 409); }));
test('session expiry during asynchronous status read suppresses successful response', () => fixture(async (f) => { const l = await f.login(), view = f.app.profile.view.bind(f.app.profile); f.app.profile.view = async () => { const v = await view(); f.advance(600001); return v; }; assert.equal((await f.browser('auth/status', {}, l.cookie)).status, 409); }));
test('base scope owner verifier accepts real cookie while MCP OFF, denies admin-only request', async () => {
    let f: Awaited<ReturnType<typeof ownerFixture>>;
    f = await ownerFixture({ delegate: async (req: any, res: any) => {
            const owner = createLocalMcpOwner({ mode: 'local-session', verify: f.app.verify }, () => false);
            try {
                res.writeHead(owner.verify(req) ? 200 : 403);
                res.end('{}');
                return true;
            }
            finally {
                owner.dispose();
            }
        } });
    try {
        const { cookie } = await f.login();
        assert.equal((await f.browser('api/workspace-permissions/review', {}, undefined, { 'x-pi-console-admin': '1' })).status, 401);
        assert.equal((await f.browser('api/workspace-permissions/review', {}, cookie)).status, 403);
        assert.equal((await f.browser('api/workspace-permissions/review', {}, cookie, { 'x-pi-console-admin': '1' })).status, 200);
    }
    finally {
        await f.cleanup();
    }
});
test('manager helper uses dummy managed state, signed identity and no lifecycle/process calls', () => fixture(async (f) => { await writeFile(join(f.root, 'server-token'), token); await writeFile(join(f.root, 'server-state.json'), JSON.stringify({ version: 1, pid: 1234, port: f.managerPort, startedAt: 'dummy-start' })); const v = await requestManagedOwnerLogin({ env: { PI_CONSOLE_DATA_DIR: f.root } }); assert.equal(new URL(v.url).port, String(f.app.status().port)); assert.equal((await f.browser('auth/claim', { code: v.code })).status, 200); }));
test('manager helper rejects stale identity before issuing bootstrap', () => fixture(async (f) => { await writeFile(join(f.root, 'server-token'), token); await writeFile(join(f.root, 'server-state.json'), JSON.stringify({ version: 1, pid: 1235, port: f.managerPort, startedAt: 'dummy-start' })); await assert.rejects(() => requestManagedOwnerLogin({ env: { PI_CONSOLE_DATA_DIR: f.root } }), /identity unavailable/); assert(!f.app.status().listening); }));
test('revocation immediately before profile rename prevents durable credential write', () => fixture(async (f) => {
    const p = new LocalOwnerProfile(join(f.root, 'standalone.json')), id = randomUUID();
    let checks = 0;
    await assert.rejects(() => p.save({ requestId: id, revision: 0, credentials: f.credentials(), confirmed: true }, () => {
        if (++checks === 2)
            throw Error('DUMMY_REVOKE');
    }));
    await assert.rejects(() => readFile(p.file));
}));
test('real permission and local MCP owner handlers work with owner session but remain OFF and ungranted', async () => {
    let f: Awaited<ReturnType<typeof ownerFixture>>, app: ReturnType<typeof createTrustedLocalMcp> | undefined;
    f = await ownerFixture({ delegate: async (req: any, res: any) => await app!.handleOwner(req, res) || await app!.handleOwnerScope(req, res) });
    try {
        const permissions = new WorkspacePermissions(join(f.root, 'permissions.json')), runtime = { workspaces: { list: () => [] }, open: () => { throw Error('REAL_PI_FORBIDDEN'); } } as any;
        app = createTrustedLocalMcp(runtime, permissions, new PromptReceipts(join(f.root, 'receipts')), { grantFile: join(f.root, 'grants.json') }, { enabled: false, owner: { mode: 'local-session', verify: f.app.verify }, legacyCredentialKeys: [] });
        const { cookie } = await f.login(), headers = { 'x-pi-console-admin': '1' };
        const review = await f.browser('api/workspace-permissions/session', {}, cookie, headers);
        assert.equal(review.status, 200);
        assert.deepEqual(review.body.snapshot.workspaces, []);
        assert.equal(review.body.controlAvailable, false);
        const status = await f.browser('api/local-mcp/status', {}, cookie, headers);
        assert.equal(status.status, 200);
        assert.equal(status.body.status.enabled, false);
        assert.equal(status.body.grant, null);
        assert.equal((await f.browser('api/workspace-permissions/review', {}, undefined, headers)).status, 401);
        assert.equal((await f.browser('../mcp/dots', {}, cookie, headers)).status, 404);
    }
    finally {
        app?.dispose();
        await f.cleanup();
    }
});
test('bootstrap issuance capacity is bounded without leaking previous codes', () => fixture(async (f) => {
    for (let i = 0; i < 64; i++)
        assert.equal((await f.issue()).status, 200);
    const rejected = await f.issue();
    assert.equal(rejected.status, 409);
    assert.deepEqual(rejected.body, { error: 'bootstrap_capacity' });
}));
test('dispose during lazy listener startup returns no bootstrap and awaits owned listener close', () => fixture(async (f) => { const issue = f.app.issue.bind(f.app); f.app.issue = async (req, res, body) => { const pending = issue(req, res, body); await f.app.dispose(); await pending; }; const r = await f.issue(); assert.notEqual(r.status, 200); assert(!r.body.code); assert(!f.app.status().listening); assert.equal(f.app.status().port, null); }));
test('duplicate manager proof or duplicate cookie cannot be accepted', () => fixture(async (f) => { const b = { challenge: nonce, requestId: randomUUID() }, proof = createHmac('sha256', token).update(`pi-console-local-owner:${nonce}:${b.requestId}`).digest('hex'); assert.equal((await f.issue(b, { 'x-pi-console-manage-proof': [proof, proof] })).status, 403); const { cookie } = await f.login(); assert.equal((await f.browser('auth/status', {}, cookie, { cookie: [cookie, cookie] })).status, 401); }));
test('CLI owner bootstrap preserves TTY/confirmation and startup never enables from provisioned profile', async () => { const cli = await readFile(new URL('../package/pi-console.mjs', import.meta.url), 'utf8'), helper = await readFile(new URL('../package/owner-login.mjs', import.meta.url), 'utf8'), index = await readFile(new URL('../server/index.ts', import.meta.url), 'utf8'); const command = cli.slice(cli.indexOf("case 'owner-login':"), cli.indexOf("case 'start':")); assert(command.includes('await runOwnerLogin()')); assert(helper.indexOf('input.isTTY') < helper.indexOf('await requestLogin()')); assert(helper.includes("confirmed!=='yes'")); assert(helper.indexOf('await requestLogin()') < helper.indexOf('await openBrowser(url)')); assert(index.includes('const trustedLocalConfig:TrustedLocalMcpConfig={enabled:false}')); assert(!/trustedLocalConfig\.enabled\s*=(?!=)/.test(index)); assert(index.includes("mode:'local-session',verify:localOwnerBootstrap.verify")); assert(index.indexOf('knownLegacyKeys:string[]') < index.indexOf('createLocalOwnerBootstrap({')); });
