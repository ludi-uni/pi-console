import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer, request, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAccessPrincipalVerifier, allowedHost, allowedPost, type VerifiedAccessPrincipal } from '../server/access.ts';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { WorkspacePermissions } from '../server/workspace-permissions.ts';
import { PromptReceipts } from '../server/runtime/prompt-receipts.ts';
import { createFinalOwnerComposition } from '../server/final-owner-composition.ts';
import { createTrustedLocalMcp } from '../server/trusted-local-mcp.ts';
import { dummyKeys } from './trusted-local.fixture.ts';
import type { ResultProjection } from '../shared/results-read.ts';
import type { SavedFinalAnswer } from '../server/runtime/final-answer-journal.ts';
test('same composition preserves persisted exact final review/save, independent key/scope, saved/ACK/expiry and release fences without SDK import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trusted-final-')), workspace = join(root, 'workspace');
    await mkdir(workspace);
    const store = new WorkspaceStore(join(root, 'workspaces.json'));
    await store.load();
    const w = await store.add(workspace), permissions = new WorkspacePermissions(join(root, 'permissions.json'));
    let app!: ReturnType<typeof createTrustedLocalMcp>, clock = Date.now();
    const access = { origin: 'https://console.example.com', host: 'console.example.com', issuer: 'https://dummy.cloudflareaccess.com', audience: 'a'.repeat(64) }, principals = new WeakMap<IncomingMessage, VerifiedAccessPrincipal>();
    const pair = await generateKeyPair('RS256'), jwk = await exportJWK(pair.publicKey);
    jwk.kid = 'dummy-final';
    const verify = createAccessPrincipalVerifier(access, createLocalJWKSet({ keys: [jwk] }));
    const sign = (sub: string) => new SignJWT({ type: 'app', sub }).setProtectedHeader({ alg: 'RS256', kid: 'dummy-final' }).setIssuer(access.issuer).setAudience(access.audience).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const token = await sign('dummy-owner'), other = await sign('dummy-other');
    const comp = createFinalOwnerComposition(store, permissions, { sessionsRoot: join(root, 'sessions'), reportRecoveryDir: join(root, 'reports'), queueDir: join(root, 'queue'), journalDir: join(root, 'journal') }, { enabled: true, accessMode: 'access', ownerRequest: req => app.ownerRequest(req), authentication: { mode: 'shared_secret', key: dummyKeys.final }, legacyCredentialKeys: [dummyKeys.read, dummyKeys.control, dummyKeys.owner], now: () => clock });
    const p: ResultProjection = { generation: 'g', seq: 1, observedAt: clock, live: true, truncated: false, nodes: [{ id: 'dummy-run', kind: 'run', sourceKind: 'pi', status: 'completed', correlation: 'explicit' }], events: [], coverage: { pi: 'incomplete', subagents: 'unknown', orchestrator: 'unknown', queue: 'unknown', background: 'unknown' }, historyState: 'available', metadata: { sessionName: null, savedModel: null } };
    const text = 'DUMMY_SAVED_FINAL_TEXT';
    let saved: SavedFinalAnswer = { storage: 'saved', deliveryConfirmed: true, foregroundStatus: 'completed', text, sha256: createHash('sha256').update(text).digest('hex'), binding: { runtimeInstance: 'dummy-runtime', workspaceId: w.id, sessionId: 's', generation: 'g', runId: 'dummy-run' } };
    // Only the producer evidence is fake. Existing final owner, CAS, ResultsReadService,
    // modern adapter and outer authority are real; no Pi/provider/discovery import.
    comp.runtime.readOnlyResultProjection = () => p;
    comp.runtime.readOnlyFinalAnswer = async () => saved;
    comp.runtime.readOnlySessions = async () => ({ sessions: [{ id: 's' }], unavailable: false, truncated: false, ambiguousSessionIds: [] } as any);
    comp.runtime.readOnlyObservation = () => ({ observation: 'observed', generation: 'g', truncated: false, nodes: p.nodes } as any);
    await permissions.replace(permissions.instance, 0, [{ id: w.id, path: w.path, scope: 'control', sessions: [{ id: 's', generation: 'g' }] }], async () => [{ id: w.id, path: w.path, eligible: true, sessions: [{ id: 's', generation: 'g' }] }]);
    app = createTrustedLocalMcp(comp.runtime, permissions, new PromptReceipts(join(root, 'receipts')), { grantFile: join(root, 'local.json'), finalAdapter: comp, now: () => clock }, { enabled: true, credentials: { ...dummyKeys, expiresAt: clock + 600000 }, owner: { mode: 'access-verified-owner', subject: 'dummy-owner', access, principal: req => principals.get(req) }, legacyCredentialKeys: [] });
    const ui = createServer((req, res) => void (async () => {
        const p = await verify(req.headers['cf-access-jwt-assertion']);
        if (!p || !allowedHost(req.headers.host, access) || !allowedPost(req, access)) {
            res.writeHead(401);
            res.end('{}');
            return;
        }
        principals.set(req, p);
        if (!await comp.owner(req, res)) {
            res.writeHead(404);
            res.end();
        }
    })());
    ui.listen(0, '127.0.0.1');
    await once(ui, 'listening');
    const uiPort = (ui.address() as any).port;
    const server = createServer((req, res) => void app.handle(req, res));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    app.bind(server, uiPort);
    const port = (server.address() as any).port;
    const post = (which: number, path: string, body: any, headers: Record<string, string>) => new Promise<any>((resolve, reject) => { const q = request({ host: '127.0.0.1', port: which, path, method: 'POST', headers: { host: `127.0.0.1:${which}`, 'content-type': 'application/json', ...headers } }, r => { const chunks: Buffer[] = []; r.on('data', b => chunks.push(b)); r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || 'null') })); }); q.on('error', reject); q.end(JSON.stringify(body)); });
    const owner = (route: string, b: any, jwt = token) => post(uiPort, '/api/workspace-permissions/final/' + route, b, { host: access.host, origin: access.origin, 'sec-fetch-site': 'same-origin', 'x-pi-console-admin': '1', 'cf-access-jwt-assertion': jwt });
    const rpc = (name: string, target: any, key = dummyKeys.final) => post(port, '/mcp/dots', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} }, name, arguments: target } }, { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': name, 'x-pi-console-dots-read-key': key });
    try {
        assert.equal((await owner('session', {}, other)).status, 403);
        const v = (await owner('session', {})).body;
        assert.equal(v.choices.length, 1);
        const target = v.choices[0].target;
        assert.equal((await rpc('read_final_answer', target)).body.result.isError, true, 'base control cannot imply final disclosure');
        saved = { ...saved, deliveryConfirmed: false };
        assert.equal((await owner('session', {})).body.choices.length, 0);
        saved = { ...saved, deliveryConfirmed: true };
        const review = (await owner('review', { instance: v.instance, revision: v.revision, target, expiresAt: clock + 1000 })).body;
        const committed = await owner('save', { reviewId: review.reviewId, requestId: review.requestId, confirmed: true });
        assert.equal(committed.status, 200);
        const disclosed = committed.body.publication.target;
        assert.equal((await permissions.snapshot()).version, 2);
        assert.equal((await owner('result', { requestId: review.requestId })).body.state, 'committed');
        const success = await rpc('read_final_answer', disclosed);
        assert.equal(success.status, 200);
        assert.equal(success.body.result.structuredContent.text, text);
        assert.equal(success.body.result.structuredContent.aggregateCompletionConfirmed, false);
        const forbidden = await rpc('read_history', disclosed);
        assert.equal(forbidden.status, 404);
        assert.equal(forbidden.body.error.message, 'read_final_answer_only');
        assert.equal((await rpc('read_final_answer', disclosed, dummyKeys.control)).status, 401);
        clock += 1001;
        assert.equal((await rpc('read_final_answer', disclosed)).body.result.isError, true);
        clock -= 1001;
        comp.runtime.readOnlyFinalAnswer = async () => { app.disable(); return saved; };
        assert.equal((await rpc('read_final_answer', disclosed)).status, 409);
        assert.equal(comp.runtime.controlIsolationVerified(), false);
    }
    finally {
        app.dispose();
        comp.dispose();
        for (const s of [server, ui]) {
            s.closeAllConnections();
            await new Promise<void>(r => s.close(() => r()));
        }
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
