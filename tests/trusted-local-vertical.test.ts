import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { WorkspacePermissions } from '../server/workspace-permissions.ts';
import { PromptReceipts } from '../server/runtime/prompt-receipts.ts';
import { SessionEvents } from '../server/runtime/events.ts';
import { FinalAnswerJournal } from '../server/runtime/final-answer-journal.ts';
import { createFinalOwnerComposition } from '../server/final-owner-composition.ts';
import { createTrustedLocalMcp, denyPublicMcp } from '../server/trusted-local-mcp.ts';
import { allowedHost, allowedPost } from '../server/access.ts';
import { dummyKeys, dummyHeaders, dummyRequestId } from './trusted-local.fixture.ts';
// No PiProcess/open(), SDK, provider, auth discovery or child is invoked. Only
// the transport worker/producer is fake; runtime, events, journal, receipt,
// permission services and HTTP adapters execute their production source.
async function vertical(root: string, label: string, ackLost = false) {
    const servers: {
        server: Server;
        kind: string;
        closed: boolean;
        port: number | null;
    }[] = [];
    let app: ReturnType<typeof createTrustedLocalMcp> | undefined;
    let comp: ReturnType<typeof createFinalOwnerComposition> | undefined;
    let state: SessionEvents | undefined;
    let closed = false;
    const cleanup = async () => {
        if (closed)
            return;
        closed = true;
        app?.dispose();
        comp?.dispose();
        await state?.flushFinalAnswers();
        for (const entry of servers) {
            entry.server.closeAllConnections();
            if (entry.server.listening)
                await new Promise<void>(r => entry.server.close(() => r()));
            entry.closed = !entry.server.listening;
            assert(entry.closed);
        }
        if (comp)
            (comp.runtime as any).active.clear();
    };
    try {
        const workspace = join(root, 'workspace'), sessions = join(root, 'sessions');
        await mkdir(workspace, { recursive: true });
        await mkdir(sessions, { recursive: true });
        const store = new WorkspaceStore(join(root, 'workspaces.json'));
        await store.load();
        const w = store.list()[0] ?? await store.add(workspace);
        const permissions = new WorkspacePermissions(join(root, 'permissions.json'));
        comp = createFinalOwnerComposition(store, permissions, { sessionsRoot: sessions, reportRecoveryDir: join(root, 'reports'), queueDir: join(root, 'queue'), journalDir: join(root, 'journal') }, { enabled: true, accessMode: 'local', authentication: { mode: 'shared_secret', key: dummyKeys.final }, legacyCredentialKeys: [dummyKeys.read, dummyKeys.control, dummyKeys.owner], ownerRequest: req => app?.ownerRequest(req) === true });
        const runtime = comp.runtime;
        runtime.setExternalAdmissionGuard(async () => { throw Error('ISOLATION_GATE_CLOSED'); });
        let opens = 0;
        runtime.open = async () => { opens++; throw Error('REAL_WORKER_OPEN_FORBIDDEN'); };
        const session = { id: 'dummy-vertical-session', workspaceId: w.id, filePath: join(root, 'dummy-session.jsonl') };
        state = new SessionEvents(session, () => 'running');
        const journal = new FinalAnswerJournal(join(root, 'journal'), { runtimeInstance: (runtime as any).resultsInstance, workspaceId: w.id, sessionId: session.id, generation: state.generation });
        state.setFinalAnswerJournal(journal);
        const calls: {
            type: string;
            runId: string;
            receiptState: string;
        }[] = [];
        const worker = { state: 'running', call: async (type: string, payload: any) => {
                assert.equal(type, 'prompt');
                assert.equal(payload.message, 'DUMMY_VERTICAL_INSTRUCTION');
                assert.equal(payload.requireIdle, true);
                const receipt = JSON.parse(await readFile(join(root, 'receipts', dummyRequestId + '.json'), 'utf8'));
                assert.equal(receipt.state, 'pending');
                calls.push({ type, runId: payload.consoleRunId, receiptState: receipt.state });
                await writeFile(join(root, label + '-fake-worker-record.json'), JSON.stringify(calls));
                if (ackLost)
                    throw Error('DUMMY_ACK_LOST');
                return { data: { disposition: 'started' } };
            } };
        (runtime as any).active.set(session.id, { session, state, worker });
        const receiptStore = new PromptReceipts(join(root, 'receipts'));
        app = createTrustedLocalMcp(runtime, permissions, receiptStore, { grantFile: join(root, 'local-grants.json'), finalAdapter: comp }, { enabled: true, credentials: { ...dummyKeys, expiresAt: Date.now() + 600000 }, owner: { mode: 'local', key: dummyKeys.owner }, legacyCredentialKeys: [] });
        const listen = async (kind: string, handler: (req: IncomingMessage, res: any) => void) => {
            const server = createServer(handler), record = { server, kind, closed: false, port: null as number | null };
            servers.push(record);
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            const address = server.address();
            assert(address && typeof address === 'object' && address.address === '127.0.0.1' && address.family === 'IPv4');
            record.port = address.port;
            assert(![31717, 31718, 31719].includes(address.port));
            return address.port;
        };
        const uiPort = await listen('dummy-public-ui', (req, res) => void (async () => {
            if (denyPublicMcp(req, res))
                return;
            if (!allowedHost(req.headers.host) || !allowedPost(req)) {
                res.writeHead(403);
                res.end('{}');
                return;
            }
            if (await app!.handleOwner(req, res) || await app!.handleOwnerScope(req, res) || await comp!.owner(req, res))
                return;
            res.writeHead(404);
            res.end('{}');
        })().catch(() => { res.writeHead(500); res.end('{}'); }));
        let loseNextReply = false;
        const port = await listen('dummy-private-mcp', (req, res) => {
            if (loseNextReply) {
                loseNextReply = false;
                // Lose only the reply after the real handler has committed its
                // receipt. This cannot forge an ACK or bypass admission.
                res.end = () => { res.destroy(); return res; };
            }
            void app!.handle(req, res);
        });
        app.bind(servers[1].server, uiPort);
        const post = (which: number, path: string, body: any, headers: Record<string, string>) => new Promise<{
            status: number;
            body: any;
        }>((resolve, reject) => {
            const q = request({ hostname: '127.0.0.1', port: which, path, method: 'POST', headers: { host: `127.0.0.1:${which}`, 'content-type': 'application/json', ...headers } }, res => { const chunks: Buffer[] = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString() || 'null') })); });
            q.on('error', reject);
            q.end(JSON.stringify(body));
        });
        const owner = (namespace: string, route: string, body: any, extra: Record<string, string> = {}) => post(uiPort, '/api/' + namespace + '/' + route, body, { origin: `http://127.0.0.1:${uiPort}`, 'sec-fetch-site': 'same-origin', 'x-pi-console-admin': '1', 'x-pi-console-local-owner-key': dummyKeys.owner, ...extra });
        const rpc = (name: string, args: any, role: 'read' | 'control' | 'final' = 'control') => post(port, '/mcp/dots', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} }, name, arguments: args } }, { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': name, [dummyHeaders[role]]: dummyKeys[role] });
        const grant = async () => {
            // Explicit dummy owner actions, never automatic restart scope restoration.
            const base = (await owner('workspace-permissions', 'session', {})).body;
            const saved = await owner('workspace-permissions', 'save', { instance: base.instance, revision: base.snapshot.revision, confirmed: true, workspaces: [{ id: w.id, path: w.path, scope: 'control', sessions: [{ id: session.id, generation: state!.generation }] }] }, { 'x-pi-console-permission-grant': base.grant });
            assert.equal(saved.status, 200, JSON.stringify(saved.body));
            const target = { instance: permissions.instance, revision: (await permissions.snapshot()).revision, workspaceId: w.id, sessionId: session.id, generation: state!.generation };
            const view = (await owner('local-mcp', 'status', {})).body;
            const review = await owner('local-mcp', 'review', { instance: view.instance, revision: view.revision, target, expiresAt: Date.now() + 60000 });
            assert.equal(review.status, 200);
            assert.equal((await owner('local-mcp', 'save', { reviewId: review.body.reviewId, requestId: review.body.requestId, confirmed: true })).status, 200);
            return target;
        };
        return { app, comp, runtime, permissions, state, journal, calls, rpc, owner, grant, cleanup, servers, opens: () => opens, loseNextResponse: () => { loseNextReply = true; } };
    }
    catch (e) {
        await cleanup();
        throw e;
    }
}
async function proof(name: string, value: unknown) {
    const dir = process.env.TRUSTED_LOCAL_TEST_ACCEPTANCE_EVIDENCE;
    if (!dir)
        return;
    assert(resolve(dir).replaceAll(String.fromCharCode(92),'/').startsWith(resolve(process.env.TRUSTED_LOCAL_TEST_REPORTS_ROOT ?? resolve('..', 'reports')).replaceAll(String.fromCharCode(92),'/') + '/'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name + '.json'), JSON.stringify(value) + '\n');
}
test('single HTTP -> real RuntimeManager -> durable receipt -> fixed fake worker -> journal saved/ACK -> independent final scope -> HTTP result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trusted-vertical-'));
    let f: Awaited<ReturnType<typeof vertical>> | undefined;
    try {
        f = await vertical(root, 'single');
        const target = await f.grant(), args = { ...target, requestId: dummyRequestId };
        assert.equal((await f.rpc('submit_instruction', { ...args, message: 'DUMMY_VERTICAL_INSTRUCTION' })).status, 200);
        f.loseNextResponse();
        await assert.rejects(f.rpc('start_execution', args), /socket hang up|ECONNRESET/);
        const observed = await f.rpc('get_request', args);
        assert.equal(observed.status, 200);
        assert.equal(observed.body.result.structuredContent.state, 'accepted');
        const runId = observed.body.result.structuredContent.runId;
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0].runId, runId);
        assert.equal(f.state.activeRunId, runId);
        assert.equal(f.opens(), 0);
        assert.equal((await f.rpc('start_execution', args)).body.result.structuredContent.runId, runId);
        assert.equal(f.calls.length, 1);
        const receipt = JSON.parse(await readFile(join(root, 'receipts', dummyRequestId + '.json'), 'utf8'));
        assert.equal(receipt.state, 'accepted');
        assert.equal(receipt.runId, runId);
        assert.equal((await f.rpc('get_request', args)).body.result.structuredContent.state, 'accepted');
        const text = 'DUMMY_VERTICAL_SAVED_FINAL';
        f.state.ingest({ type: 'console_final_answer_saved', sessionId: 'dummy-vertical-session', runId, state: 'saved', text, sha256: createHash('sha256').update(text).digest('hex'), sourceEntryId: 'dummy-entry' });
        f.state.ingest({ type: 'agent_settled' });
        await f.state.flushFinalAnswers();
        const saved = await f.runtime.readOnlyFinalAnswer(target.workspaceId, target.sessionId, target.generation, runId);
        assert.equal(saved?.storage, 'saved');
        assert.equal(saved?.deliveryConfirmed, true);
        assert.equal(saved?.foregroundStatus, 'completed');
        assert.equal((await f.rpc('read_final_answer', { ...target, runId }, 'final')).body.result.isError, true);
        const view = (await f.owner('workspace-permissions/final', 'session', {})).body;
        assert.equal(view.choices.length, 1);
        assert.equal(view.choices[0].target.runId, runId);
        const review = (await f.owner('workspace-permissions/final', 'review', { instance: view.instance, revision: view.revision, target: view.choices[0].target, expiresAt: Date.now() + 60000 })).body;
        const committed = await f.owner('workspace-permissions/final', 'save', { reviewId: review.reviewId, requestId: review.requestId, confirmed: true });
        assert.equal(committed.status, 200);
        const result = await f.rpc('read_final_answer', committed.body.publication.target, 'final');
        assert.equal(result.status, 200);
        assert.equal(result.body.result.structuredContent.text, text);
        assert.equal(result.body.result.structuredContent.aggregateCompletionConfirmed, false);
        assert.equal((await f.rpc('read_final_answer', committed.body.publication.target, 'control')).status, 409);
        assert.equal(f.calls.length, 1);
        assert.equal(f.opens(), 0);
        assert.equal(f.runtime.controlIsolationVerified(), false);
    }
    finally {
        await f?.cleanup();
        await rm(root, { recursive: true, force: true });
        await proof('single', { servers: f?.servers.map(({ kind, closed, port }) => ({ kind, closed, port })), tempRemoved: true, childSpawn: false, realRuntimeManager: true, fakeWorker: true, startResponseLost: true, receiptInspection: true, dummyProducerEvidence: true, actualSdk: false });
    }
});
test('restart cannot reconstruct scoped state from hash-only receipts: authenticated lookup returns unknown/no resend; accepted and uncertain receipts still block redispatch', async () => {
    for (const ackLost of [false, true]) {
        const root = await mkdtemp(join(tmpdir(), 'trusted-restart-'));
        let first: Awaited<ReturnType<typeof vertical>> | undefined, next: Awaited<ReturnType<typeof vertical>> | undefined;
        try {
            first = await vertical(root, 'before', ackLost);
            const target = await first.grant(), args = { ...target, requestId: dummyRequestId };
            await first.rpc('submit_instruction', { ...args, message: 'DUMMY_VERTICAL_INSTRUCTION' });
            assert.equal((await first.rpc('start_execution', args)).status, ackLost ? 409 : 200);
            assert.equal(first.calls.length, 1);
            const before = await readFile(join(root, 'receipts', dummyRequestId + '.json'), 'utf8');
            assert.equal(JSON.parse(before).state, ackLost ? 'uncertain' : 'accepted');
            await first.cleanup();
            next = await vertical(root, 'after');
            assert.equal((await next.app.view()).grant?.active, false);
            assert.equal((await next.rpc('get_request', args)).status, 409);
            const fresh = await next.grant(), lookup = { ...fresh, requestId: dummyRequestId };
            const unknown = await next.rpc('get_request', lookup);
            assert.equal(unknown.status, 200);
            assert.deepEqual(unknown.body.result.structuredContent, { requestId: dummyRequestId, state: 'unknown', runId: null, reason: 'request_binding_unavailable', retryAllowed: false });
            assert.equal((await next.rpc('start_execution', lookup)).status, 409);
            assert.equal(next.calls.length, 0);
            assert.equal(next.opens(), 0);
            // Even an explicit fresh submission with this ID cannot bypass the durable
            // receipt. New instance/generation changes its hash and rejects dispatch.
            assert.equal((await next.rpc('submit_instruction', { ...lookup, message: 'DUMMY_VERTICAL_INSTRUCTION' })).status, 200);
            assert.equal((await next.rpc('start_execution', lookup)).status, 409);
            assert.equal(next.calls.length, 0);
            assert.equal(await readFile(join(root, 'receipts', dummyRequestId + '.json'), 'utf8'), before);
            assert.equal((await next.permissions.snapshot()).finalPublication ?? null, null);
        }
        finally {
            await first?.cleanup();
            await next?.cleanup();
            await rm(root, { recursive: true, force: true });
            await proof('restart-' + (ackLost ? 'uncertain' : 'accepted'), { servers: [...first?.servers ?? [], ...next?.servers ?? []].map(({ kind, closed, port }) => ({ kind, closed, port })), tempRemoved: true, childSpawn: false, automaticGrant: false, automaticResend: false, actualSdk: false });
        }
    }
});
test('static source bootstrap is literal default OFF, shares finalOwner.runtime, denies public MCP first, and only starts private listener under explicit opt-in', async () => {
    const text = await readFile(new URL('../server/index.ts', import.meta.url), 'utf8'), source = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true);
    const declarations: ts.VariableDeclaration[] = [], calls: ts.CallExpression[] = [], assignments: ts.BinaryExpression[] = [];
    const walk = (n: ts.Node) => {
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken)
            assignments.push(n);
        if (ts.isVariableDeclaration(n))
            declarations.push(n);
        if (ts.isCallExpression(n))
            calls.push(n);
        ts.forEachChild(n, walk);
    };
    walk(source);
    const config = declarations.find(n => n.name.getText(source) === 'trustedLocalConfig')!;
    assert(config && config.initializer && ts.isObjectLiteralExpression(config.initializer));
    assert.equal(config.initializer.properties.length, 1);
    assert.equal(config.initializer.properties[0].getText(source), 'enabled:false');
    const runtime = declarations.find(n => n.name.getText(source) === 'runtime')!;
    assert.equal(runtime.initializer!.getText(source), 'finalOwner.runtime');
    const create = calls.find(n => n.expression.getText(source) === 'createTrustedLocalMcp')!;
    assert.equal(create.arguments[0].getText(source), 'runtime');
    assert.equal(create.arguments[4].getText(source), 'trustedLocalConfig');
    const publicServer = declarations.find(n => n.name.getText(source) === 'server')!.initializer!;
    const serverText = publicServer.getText(source);
    assert(serverText.indexOf('denyPublicMcp(req,res)') >= 0);
    assert(serverText.indexOf('denyPublicMcp(req,res)') < serverText.indexOf('allowedHost('));
    assert(!serverText.includes('externalMcp.handle('));
    assert(!serverText.includes('readOnlyMcp.handle('));
    const start = calls.find(n => n.expression.getText(source) === 'startTrustedLocalListener')!;
    let parent: ts.Node = start;
    while (parent.parent && !ts.isIfStatement(parent))
        parent = parent.parent;
    assert(ts.isIfStatement(parent));
    assert.equal(parent.expression.getText(source), 'trustedLocalConfig.enabled===true');
    assert(!assignments.some(n => n.left.getText(source) === 'trustedLocalConfig.enabled' || n.left.getText(source) === 'trustedLocalConfig'));
    assert(!text.includes('process.env.PI_CONSOLE_TRUSTED_LOCAL'));
    assert(!text.includes('loadTrustedLocalCredentials'));
    assert.equal(calls.filter(n => n.expression.getText(source) === 'startTrustedLocalListener').length, 1);
});
