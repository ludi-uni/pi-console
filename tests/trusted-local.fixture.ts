import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, appendFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTrustedLocalMcp, denyPublicMcp, type TrustedLocalMcpConfig } from '../server/trusted-local-mcp.ts';
import { WorkspacePermissions } from '../server/workspace-permissions.ts';
import { PromptReceipts } from '../server/runtime/prompt-receipts.ts';
import { allowedHost, allowedPost, type VerifiedAccessPrincipal } from '../server/access.ts';
import type { RuntimeManager } from '../server/runtime/manager.ts';
export const dummyKeys = { read: '1'.repeat(64), control: '2'.repeat(64), final: '3'.repeat(64), owner: '4'.repeat(64) };
export const dummyRequestId = '00000000-0000-4000-8000-000000000001';
export const dummyHeaders = { read: 'x-pi-console-readonly-key', control: 'x-pi-console-control-key', final: 'x-pi-console-dots-read-key' };
export async function localFixture(change: Partial<TrustedLocalMcpConfig> = {}, options: {
    access?: any;
    verify?: (t: unknown) => Promise<VerifiedAccessPrincipal | undefined>;
    now?: () => number;
    finalAdapter?: any;
    ui?: (req: IncomingMessage, res: any) => Promise<boolean>;
} = {}) {
    const root = await mkdtemp(join(tmpdir(), 'trusted-local-dummy-')), workspace = join(root, 'workspace');
    if(process.env.PI_CONSOLE_TEST_EVIDENCE_ROOT)await appendFile(join(process.env.PI_CONSOLE_TEST_EVIDENCE_ROOT,'pi-fixtures.jsonl'),JSON.stringify({root,pid:process.pid,phase:'created',provider:'legacy-fake-loopback'})+'\n');
    await mkdir(workspace);
    let generation = 'dummy-generation', prompts = 0, stops = 0, beforePrompt = async () => { }, beforeAdmission = async () => { }, beforeObservation = () => { };
    const runtime = { controlIsolationVerified: () => false, workspaces: { list: () => [{ id: 'w', path: workspace }] },
        readOnlySessions: async () => ({ sessions: [{ id: 's' }], unavailable: false, truncated: false, ambiguousSessionIds: [] }),
        readOnlyObservation: () => { beforeObservation(); return { observation: 'observed', generation, runtime: 'running', seq: 1, truncated: false, nodes: [{ id: 'dummy-run', kind: 'run', sourceKind: 'pi', status: 'running' }] }; },
        controlState: () => ({ generation, activeRunId: 'dummy-run' }), controlAdmission: async () => { await beforeAdmission(); },
        prompt: async () => { prompts++; await beforePrompt(); return 'dummy-run'; }, stop: async () => { stops++; } };
    const permissions = new WorkspacePermissions(join(root, 'permissions.json'));
    await permissions.replace(permissions.instance, 0, [{ id: 'w', path: workspace, scope: 'control', sessions: [{ id: 's', generation }] }], async () => [{ id: 'w', path: workspace, eligible: true, sessions: [{ id: 's', generation }] }]);
    const cfg: TrustedLocalMcpConfig = { enabled: true, credentials: { ...dummyKeys, expiresAt: (options.now ?? Date.now)() + 600000 }, owner: { mode: 'local', key: dummyKeys.owner }, legacyCredentialKeys: ['5'.repeat(64)], ...change };
    let app!: ReturnType<typeof createTrustedLocalMcp>;
    const principals = new WeakMap<IncomingMessage, VerifiedAccessPrincipal>();
    if (cfg.owner?.mode === 'access-verified-owner')
        cfg.owner = { ...cfg.owner, principal: req => principals.get(req) };
    const ui = createServer((req, res) => void (async () => {
        if (denyPublicMcp(req, res))
            return;
        if (!allowedHost(req.headers.host, options.access) || req.method === 'POST' && !allowedPost(req, options.access)) {
            res.writeHead(403);
            res.end('{}');
            return;
        }
        if (options.verify) {
            const p = await options.verify(req.headers['cf-access-jwt-assertion']);
            if (!p) {
                res.writeHead(401);
                res.end('{}');
                return;
            }
            principals.set(req, p);
        }
        if (await app.handleOwner(req, res) || await app.handleOwnerScope(req, res))
            return;
        if (options.ui && await options.ui(req, res))
            return;
        if (req.url === '/') {
            res.writeHead(200);
            res.end('DUMMY_LOCAL_UI');
            return;
        }
        res.writeHead(404);
        res.end('{}');
    })().catch(() => { res.writeHead(500); res.end('{}'); }));
    ui.listen(0, '127.0.0.1');
    await once(ui, 'listening');
    const uiPort = (ui.address() as any).port;
    app = createTrustedLocalMcp(runtime as unknown as RuntimeManager, permissions, new PromptReceipts(join(root, 'receipts')), { grantFile: join(root, 'local-grants.json'), now: options.now, finalAdapter: options.finalAdapter }, cfg);
    const server = createServer((req, res) => void app.handle(req, res));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        assert.equal((server.address() as any).address, '127.0.0.1');
        assert.equal((server.address() as any).family, 'IPv4');
        app.bind(server, uiPort);
    }
    catch (e) {
        app.dispose();
        for (const s of [server, ui]) {
            s.closeAllConnections();
            await new Promise<void>(r => s.close(() => r()));
        }
        await rm(root, { recursive: true, force: true });
        throw e;
    }
    const port = (server.address() as any).port;
    assert(![31717, 31718, 31719].includes(port));
    assert(![31717, 31718, 31719].includes(uiPort));
    const base = `http://127.0.0.1:${port}`, uiBase = `http://127.0.0.1:${uiPort}`;
    const target = { instance: permissions.instance, revision: 1, workspaceId: 'w', sessionId: 's', generation };
    const raw = (url: string, path: string, method: string, headers: Record<string, string> | string[], body = '') => new Promise<{
        status: number;
        body: any;
        text: string;
    }>((resolve, reject) => {
        const u = new URL(url);
        const q = request({ hostname: u.hostname, port: u.port, path, method, headers }, r => {
            const chunks: Buffer[] = [];
            r.on('data', b => chunks.push(b));
            r.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                let b;
                try {
                    b = JSON.parse(text);
                }
                catch {
                    b = null;
                }
                resolve({ status: r.statusCode!, body: b, text });
            });
        });
        q.on('error', reject);
        q.end(body);
    });
    const owner = async (route: string, body: unknown, extra: Record<string, string> = {}, namespace = 'local-mcp') => raw(uiBase, '/api/' + namespace + '/' + route, 'POST', { 'host': options.access?.host ?? `127.0.0.1:${uiPort}`, origin: options.access?.origin ?? uiBase, 'sec-fetch-site': 'same-origin', 'x-pi-console-admin': '1', 'x-pi-console-local-owner-key': dummyKeys.owner, 'content-type': 'application/json', ...extra }, JSON.stringify(body));
    const rpc = async (method: string, name?: string, args: unknown = {}, role: keyof typeof dummyKeys = 'control', extra: Record<string, string> = {}) => {
        const params: any = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } };
        if (name) {
            params.name = name;
            params.arguments = args;
        }
        return raw(base, '/mcp/dots', 'POST', { 'host': `127.0.0.1:${port}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(name ? { 'mcp-name': name } : {}), ...(role === 'owner' ? {} : { [dummyHeaders[role]]: dummyKeys[role] }), ...extra }, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
    };
    const grant = async (expiresAt = (options.now ?? Date.now)() + 60000, t: typeof target | null = target, headers: Record<string, string> = {}) => { const v = await owner('status', {}, headers); assert.equal(v.status, 200); const r = await owner('review', { instance: permissions.instance, revision: v.body.revision, target: t, expiresAt: t ? expiresAt : null }, headers); assert.equal(r.status, 200); const saved = await owner('save', { reviewId: r.body.reviewId, requestId: r.body.requestId, confirmed: true }, headers); return { review: r.body, saved }; };
    return { root, workspace, cfg, runtime, permissions, app, ui, server, base, uiBase, port, uiPort, target, raw, owner, rpc, grant, counts: () => ({ prompts, stops }), generation: (g: string) => { generation = g; }, onPrompt: (fn: () => Promise<void>) => { beforePrompt = fn; }, onAdmission: (fn: () => Promise<void>) => { beforeAdmission = fn; }, onObservation: (fn: () => void) => { beforeObservation = fn; }, cleanup: async () => {
            app.dispose();
            for (const s of [server, ui]) {
                s.closeAllConnections();
                await new Promise<void>(r => s.close(() => r()));
            }
            assert.equal((await realpath(root)).toLowerCase(),root.toLowerCase());
            await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
            if(process.env.PI_CONSOLE_TEST_EVIDENCE_ROOT)await appendFile(join(process.env.PI_CONSOLE_TEST_EVIDENCE_ROOT,'pi-fixtures.jsonl'),JSON.stringify({root,pid:process.pid,phase:'removed',provider:'legacy-fake-loopback',realPiCalls:0})+'\n');
        } };
}
