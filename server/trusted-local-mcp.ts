import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { RuntimeManager } from './runtime/manager.ts';
import type { PromptReceipts } from './runtime/prompt-receipts.ts';
import { WorkspacePermissions, PermissionFault, strictPermissionObject } from './workspace-permissions.ts';
import { createDotsPermissionsApi } from './dots-permissions-api.ts';
import { readOnlyMcpNativeDenialReasons } from './readonly-mcp.ts';
import { LocalMcpGrants, validateLocalTarget } from './local-mcp-grants.ts';
import { createLocalMcpOwner, dedicatedKey, type LocalMcpOwnerConfig } from './local-mcp-owner.ts';
import type { LocalControlTarget, LocalMcpStatus, LocalOwnerReview, LocalOwnerView } from '../shared/trusted-local-mcp.ts';
const protocol = '2026-07-28';
const keyHeaders = { read: 'x-pi-console-readonly-key', control: 'x-pi-console-control-key', final: 'x-pi-console-dots-read-key' } as const;
type Role = keyof typeof keyHeaders;
export interface TrustedLocalMcpConfig {
    enabled?: boolean;
    credentials?: {
        read: string;
        control: string;
        final: string;
        expiresAt: number;
    };
    owner?: LocalMcpOwnerConfig;
    legacyCredentialKeys?: readonly string[];
}
interface Paths {
    grantFile: string;
    finalAdapter?: {
        handle: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
    };
    now?: () => number;
}
const controlTools = ['submit_instruction', 'start_execution', 'cancel_instruction', 'stop_execution', 'get_request'];
const targetKeys = ['instance', 'revision', 'workspaceId', 'sessionId', 'generation'];
const toolKeys: Record<string, string[]> = { get_status: [], get_progress: targetKeys, submit_instruction: [...targetKeys, 'requestId', 'message'], start_execution: [...targetKeys, 'requestId'], cancel_instruction: [...targetKeys, 'requestId'], stop_execution: [...targetKeys, 'requestId', 'runId'], get_request: [...targetKeys, 'requestId'] };
const send = (res: ServerResponse, status: number, value?: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(value === undefined ? '' : JSON.stringify(value)); };
function fault(s: string): never { throw new PermissionFault(s); }
/** Pure preflight for composition. No credential discovery, listener or file access. */
export function trustedLocalConfigured(config: TrustedLocalMcpConfig, now = Date.now()): boolean {
    const c = config.credentials, legacy = config.legacyCredentialKeys;
    const values = c ? [c.read, c.control, c.final, ...(config.owner?.mode === 'local' ? [config.owner.key] : [])] : [];
    const owner = createLocalMcpOwner(config.owner, () => false);
    const ownerConfigured = owner.configured;
    owner.dispose();
    return !!(ownerConfigured && c && legacy && legacy.length <= 31 && legacy.every(dedicatedKey) && !values.some(k => legacy.includes(k)) && values.every(dedicatedKey) && new Set(values).size === values.length && Number.isSafeInteger(c.expiresAt) && c.expiresAt > now);
}
/** Public origin is never an MCP entry, including when cloudflared's peer is loopback.
 * Inspect raw and normalized spellings; malformed encodings terminate here too. */
export function denyPublicMcp(req: IncomingMessage, res: ServerResponse): boolean {
    const raw = (req.url ?? '/').split('?')[0];
    let paths: string[] = [raw];
    try {
        let p = raw;
        for (let i = 0; i < 3; i++) {
            p = decodeURIComponent(p);
            paths.push(p);
            paths.push(new URL(p.replaceAll('\\', '/'), 'http://localhost').pathname);
        }
    }
    catch {
        send(res, 404);
        return true;
    }
    if (paths.some(p => { p = p.replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase(); return p.startsWith('/local-owner/resume/') || p.startsWith('/local-owner/folder/') || p.startsWith('/local-owner/pi-control/') || p === '/mcp' || p.startsWith('/mcp/') || p.startsWith('/.well-known/oauth') || p === '/oauth' || p.startsWith('/oauth/') || ['/authorize', '/token', '/register'].includes(p) || /^\/api\/(control|integration)(\/|$)/.test(p) || p.startsWith('/api/dots/control'); })) {
        req.resume?.();
        send(res, 404);
        return true;
    }
    return false;
}
/** Explicit trusted-Pi mode. No environment/file credential discovery, OS setup,
 * fallback, new runtime, or persisted ready. Bootstrap default remains OFF. */
export function createTrustedLocalMcp(runtime: RuntimeManager, permissions: WorkspacePermissions, receipts: PromptReceipts, paths: Paths, config: TrustedLocalMcpConfig = {}) {
    const now = paths.now ?? Date.now, c = config.credentials ? { ...config.credentials } : undefined, epoch = randomUUID(), grants = new LocalMcpGrants(paths.grantFile);
    const keyValues = c ? [c.read, c.control, c.final, ...(config.owner?.mode === 'local' ? [config.owner.key] : [])] : [];
    const legacy = config.legacyCredentialKeys ? [...config.legacyCredentialKeys] : undefined;
    const configured = trustedLocalConfigured(config, now());
    let enabled = config.enabled === true && configured, disposed = false, server: Server | undefined, publicPort: number | null = null, port: number | null = null, revision = 0, inFlight = 0;
    const buffers = Object.fromEntries((['read', 'control', 'final'] as Role[]).map(r => [r, configured ? Buffer.from(c![r], 'hex') : Buffer.alloc(32)])) as Record<Role, Buffer>;
    const active = () => enabled && !disposed && !!server?.listening && port !== null && c!.expiresAt > now();
    const owner = createLocalMcpOwner(config.owner, active, now);
    if (!owner.configured)
        enabled = false;
    const reviews = new Map<string, LocalOwnerReview & {
        deadline: number;
        authority: number;
    }>();
    let grantRevision = 0, grant: Awaited<ReturnType<LocalMcpGrants['snapshot']>>['grant'] = null;
    const status = (): LocalMcpStatus => ({ mode: 'trusted-local', workerTrust: 'trusted', osIsolation: 'unverified', enabled: active(), reason: disposed ? 'disposed' : config.enabled !== true ? 'disabled' : !configured || !owner.configured ? 'unconfigured' : c!.expiresAt <= now() ? 'credential_expired' : !enabled ? 'disabled' : !server?.listening ? 'unbound' : 'active', port, revision, credentialExpiresAt: c?.expiresAt ?? null });
    const assertAuthority = (r: number) => {
        if (!active() || revision !== r)
            fault('local_authority_changed');
    };
    const same = (a: LocalControlTarget, b: LocalControlTarget) => targetKeys.every(k => (a as any)[k] === (b as any)[k]);
    const eligible = async (t: LocalControlTarget) => {
        validateLocalTarget(t);
        const s = await permissions.snapshot();
        if (t.instance !== permissions.instance || t.revision !== s.revision || !s.workspaces.some(w => w.id === t.workspaceId && w.scope === 'control' && w.sessions.some(x => x.id === t.sessionId && x.generation === t.generation)))
            fault('local_scope_denied');
        const v = (await api.inventory()).find(w => w.id === t.workspaceId && w.eligible);
        if (!v?.sessions.some(x => x.id === t.sessionId && x.generation === t.generation))
            fault('target_unavailable');
    };
    const assertGrant = (t: LocalControlTarget, r: number, g: number) => {
        assertAuthority(r);
        if (grantRevision !== g || !grant || grant.credentialEpoch !== epoch || grant.expiresAt <= now() || !same(grant.target, t))
            fault('local_scope_denied');
    };
    const admission = async (args: unknown) => {
        if (!args || typeof args !== 'object')
            fault('invalid_target');
        const t = Object.fromEntries(targetKeys.map(k => [k, (args as any)[k]])) as LocalControlTarget;
        validateLocalTarget(t);
        const r = revision;
        assertAuthority(r);
        const s = await grants.snapshot();
        grant = s.grant;
        grantRevision = s.revision;
        const g = s.revision;
        assertGrant(t, r, g);
        await eligible(t);
        assertGrant(t, r, g);
        return () => assertGrant(t, r, g);
    };
    const api = createDotsPermissionsApi(runtime, permissions, receipts, { ...(configured ? { authentication: { mode: 'shared_secret' as const, key: c!.read }, controlKey: c!.control } : {}), trustedLocal: { available: active, admission, owner: owner.verify } });
    async function view(): Promise<LocalOwnerView> {
        const s = await grants.snapshot(), p = await permissions.snapshot();
        grant = s.grant;
        grantRevision = s.revision;
        const choices: LocalControlTarget[] = [];
        if (active())
            for (const w of p.workspaces.filter(w => w.scope === 'control')) {
                const inv = (await api.inventory()).find(x => x.id === w.id && x.eligible);
                for (const x of w.sessions)
                    if (inv?.sessions.some(y => y.id === x.id && y.generation === x.generation))
                        choices.push({ instance: permissions.instance, revision: p.revision, workspaceId: w.id, sessionId: x.id, generation: x.generation });
            }
        return { status: status(), instance: permissions.instance, revision: s.revision, choices, grant: s.grant ? { target: s.grant.target, expiresAt: s.grant.expiresAt, active: active() && s.grant.credentialEpoch === epoch && s.grant.expiresAt > now() && choices.some(x => same(x, s.grant!.target)) } : null };
    }
    async function body(req: IncomingMessage) {
        const parts: Buffer[] = [];
        let size = 0;
        const timer = setTimeout(() => req.destroy(), 5000);
        timer.unref();
        try {
            for await (const chunk of req.iterator({ destroyOnReturn: false })) {
                const b = Buffer.from(chunk);
                size += b.length;
                if (size > 32768) {
                    req.resume();
                    fault('body_limit');
                }
                parts.push(b);
            }
            return JSON.parse(Buffer.concat(parts).toString('utf8'));
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function handleOwner(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
        if (!req.url?.startsWith('/api/local-mcp/'))
            return false;
        if (!owner.verify(req)) {
            send(res, 403, { error: 'verified_owner_required' });
            return true;
        }
        try {
            const b = await body(req), route = req.url.slice('/api/local-mcp/'.length);
            if (route === 'status') {
                strictPermissionObject(b, []);
                send(res, 200, await view());
                return true;
            }
            if (route === 'review') {
                strictPermissionObject(b, ['instance', 'revision', 'target', 'expiresAt']);
                const s = await grants.snapshot();
                if (b.instance !== permissions.instance || b.revision !== s.revision)
                    fault('local_grant_stale');
                if (b.target !== null) {
                    validateLocalTarget(b.target);
                    await eligible(b.target);
                    if (!Number.isSafeInteger(b.expiresAt) || b.expiresAt <= now() || b.expiresAt > Math.min(now() + 24 * 60 * 60 * 1000, c!.expiresAt))
                        fault('expiry_invalid');
                }
                else if (b.expiresAt !== null)
                    fault('invalid_arguments');
                for (const [id, r] of reviews)
                    if (r.deadline <= now())
                        reviews.delete(id);
                if (reviews.size >= 16)
                    fault('review_capacity');
                const r = { reviewId: randomUUID(), requestId: randomUUID(), instance: permissions.instance, revision: s.revision, target: b.target, expiresAt: b.expiresAt, deadline: now() + 60000, authority: revision };
                reviews.set(r.reviewId, r);
                const { deadline: _, authority: __, ...v } = r;
                send(res, 200, v);
                return true;
            }
            if (route === 'cancel') {
                strictPermissionObject(b, ['reviewId', 'requestId']);
                const r = reviews.get(b.reviewId);
                if (r?.requestId === b.requestId)
                    reviews.delete(b.reviewId);
                send(res, 200, { cancelled: !!r });
                return true;
            }
            if (route === 'save') {
                strictPermissionObject(b, ['reviewId', 'requestId', 'confirmed']);
                const r = reviews.get(b.reviewId);
                if (!r || r.requestId !== b.requestId || b.confirmed !== true || r.deadline <= now())
                    fault('owner_confirmation_required');
                reviews.delete(r.reviewId);
                assertAuthority(r.authority);
                const s = await grants.save(r.instance, r.revision, r.requestId, epoch, r.target ? { target: r.target, expiresAt: r.expiresAt!, credentialEpoch: epoch } : null, async () => {
                    assertAuthority(r.authority);
                    if (r.deadline <= now() || r.target && r.expiresAt! <= now())
                        fault('review_stale');
                    if (r.target)
                        await eligible(r.target);
                    assertAuthority(r.authority);
                });
                grant = s.grant;
                grantRevision = s.revision;
                revision++;
                reviews.clear();
                send(res, 200, await view());
                return true;
            }
            if (route === 'result') {
                strictPermissionObject(b, ['requestId']);
                const s = await grants.snapshot(), r = s.requests.find(r => r.requestId === b.requestId);
                send(res, 200, { state: !r ? 'unknown' : r.instance === permissions.instance && r.credentialEpoch === epoch ? 'committed' : 'committed_inactive', revision: r?.revision ?? null, current: await view() });
                return true;
            }
            send(res, 404);
        }
        catch (e) {
            if (e instanceof PermissionFault && ['local_grant_unavailable', 'local_grant_save_failed', 'request_capacity'].includes(e.code))
                disable();
            send(res, 409, { error: e instanceof PermissionFault ? e.code : 'local_owner_unavailable' });
        }
        return true;
    }
    const authenticate = (req: IncomingMessage): Role | undefined => {
        const roles = (Object.keys(keyHeaders) as Role[]).filter(r => req.rawHeaders.some((v, i) => i % 2 === 0 && v.toLowerCase() === keyHeaders[r]));
        if (roles.length !== 1)
            return;
        const r = roles[0], v = req.headers[keyHeaders[r]], valid = dedicatedKey(v), b = valid ? Buffer.from(v, 'hex') : Buffer.alloc(32);
        const matched = timingSafeEqual(buffers[r], b);
        b.fill(0);
        return valid && matched && req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === keyHeaders[r]).length === 1 ? r : undefined;
    };
    async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
        const metadata = ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp/dots'].includes(req.url ?? '');
        if (req.url !== '/mcp/dots' && !metadata) {
            req.resume();
            send(res, 404);
            return true;
        }
        if (!active()) {
            req.resume();
            send(res, 404);
            return true;
        }
        if (req.socket.localAddress !== '127.0.0.1' || req.socket.localPort !== port || readOnlyMcpNativeDenialReasons(req).length || req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === 'host').length !== 1) {
            req.resume();
            send(res, 403, { error: 'native_boundary_rejected' });
            return true;
        }
        const role = authenticate(req);
        if (!role) {
            req.resume();
            send(res, 401, { error: 'dedicated_authentication_required' });
            return true;
        }
        if (metadata) {
            req.resume();
            send(res, req.method === 'GET' ? 404 : 405);
            return true;
        }
        if (req.method !== 'POST') {
            req.resume();
            send(res, 405);
            return true;
        }
        if (inFlight >= 4) {
            req.resume();
            send(res, 429);
            return true;
        }
        inFlight++;
        const authority = revision;
        let id: string | number | null = null;
        try {
            assertAuthority(authority);
            if (role === 'final') {
                if (!paths.finalAdapter)
                    fault('final_unconfigured');
                await bufferedFinal(req, res, authority);
                return true;
            }
            const m = await body(req);
            strictPermissionObject(m, ['jsonrpc', 'id', 'method', 'params']);
            if (m.jsonrpc !== '2.0' || !(typeof m.id === 'string' && m.id.length <= 128 || typeof m.id === 'number' && Number.isSafeInteger(m.id)) || typeof m.id === 'string' && [...keyValues, ...legacy ?? []].some(k => m.id.includes(k)))
                fault('invalid_rpc');
            id = m.id;
            const count = (n: string) => req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === n).length;
            if (req.headers['content-type']?.split(';')[0] !== 'application/json' || !String(req.headers.accept ?? '').split(',').map(s => s.trim().split(';')[0]).includes('text/event-stream') || !String(req.headers.accept ?? '').includes('application/json'))
                fault('content_type');
            if (!m.params || typeof m.params !== 'object' || Array.isArray(m.params) || !m.params._meta || typeof m.params._meta !== 'object' || Array.isArray(m.params._meta) || !m.params._meta['io.modelcontextprotocol/clientCapabilities'] || typeof m.params._meta['io.modelcontextprotocol/clientCapabilities'] !== 'object' || Array.isArray(m.params._meta['io.modelcontextprotocol/clientCapabilities']))
                fault('metadata_required');
            if (count('mcp-protocol-version') !== 1 || count('mcp-method') !== 1 || req.headers['mcp-protocol-version'] !== protocol || m.params._meta['io.modelcontextprotocol/protocolVersion'] !== protocol || req.headers['mcp-method'] !== m.method)
                fault('protocol_header_mismatch');
            const names = role === 'control' ? controlTools : ['get_status', 'get_progress'];
            let result: any;
            if (['server/discover', 'tools/list'].includes(m.method)) {
                strictPermissionObject(m.params, ['_meta']);
                result = m.method === 'server/discover' ? { supportedVersions: [protocol], capabilities: { tools: {} }, ttlMs: 0, cacheScope: 'private' } : { tools: names.map(name => ({ name, inputSchema: { type: 'object', properties: Object.fromEntries(toolKeys[name].map(k => [k, k === 'revision' ? { type: 'integer', minimum: 0 } : { type: 'string' }])), required: toolKeys[name], additionalProperties: false }, annotations: { readOnlyHint: role === 'read' || name === 'get_request', openWorldHint: false } })), ttlMs: 0, cacheScope: 'private' };
            }
            else if (m.method === 'tools/call') {
                strictPermissionObject(m.params, ['_meta', 'name', 'arguments']);
                if (count('mcp-name') !== 1 || req.headers['mcp-name'] !== m.params.name || !names.includes(m.params.name))
                    fault('tool_not_authorized');
                strictPermissionObject(m.params.arguments, toolKeys[m.params.name]);
                assertAuthority(authority);
                const value = await api.call(m.params.name, m.params.arguments);
                result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
            }
            else
                fault('method_not_supported');
            assertAuthority(authority);
            const serialized = JSON.stringify(result);
            if ([...keyValues, ...legacy ?? []].some(k => serialized.includes(k)) || Buffer.byteLength(serialized) > 2 * 1024 * 1024)
                fault('response_unavailable');
            send(res, 200, { jsonrpc: '2.0', id, result: { ...result, resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'pi-console-trusted-local', version: '1' } } } });
        }
        catch (e) {
            if (e instanceof PermissionFault && ['local_grant_unavailable', 'local_grant_save_failed'].includes(e.code))
                disable();
            if (!res.writableEnded && !res.destroyed)
                send(res, 409, { jsonrpc: '2.0', id, error: { code: -32602, message: e instanceof PermissionFault ? e.code : 'local_request_unavailable' } });
        }
        finally {
            inFlight--;
        }
        return true;
    }
    async function bufferedFinal(req: IncomingMessage, res: ServerResponse, r: number) {
        let status = 200, headers: Record<string, any> = {}, chunks: Buffer[] = [], size = 0, ended = false;
        const buffered = new Proxy(res, { get(target, k) {
                if (k === 'writeHead')
                    return (code: number, h: any) => { status = code; headers = { ...headers, ...h }; return buffered; };
                if (k === 'write')
                    return (b: any) => {
                        const v = Buffer.isBuffer(b) ? b : Buffer.from(b);
                        size += v.length;
                        if (size > 2 * 1024 * 1024)
                            fault('response_limit');
                        chunks.push(v);
                        return true;
                    };
                if (k === 'end')
                    return (b?: any) => {
                        if (ended)
                            return buffered;
                        if (b !== undefined)
                            buffered.write(b);
                        ended = true;
                        return buffered;
                    };
                if (k === 'flushHeaders')
                    return () => { };
                const v = Reflect.get(target, k, target);
                return typeof v === 'function' ? v.bind(target) : v;
            } }) as ServerResponse;
        if (!await paths.finalAdapter!.handle(req, buffered) || !ended)
            fault('final_unavailable');
        assertAuthority(r);
        const output = Buffer.concat(chunks);
        if ([...keyValues, ...legacy ?? []].some(k => output.includes(Buffer.from(k))))
            fault('response_unavailable');
        res.writeHead(status, headers);
        res.end(output);
    }
    function bind(s: Server, uiPort: number) {
        const a = s.address();
        if (server || disposed || !a || typeof a === 'string' || a.address !== '127.0.0.1' || a.family !== 'IPv4' || !Number.isInteger(uiPort) || uiPort < 1 || uiPort > 65535 || a.port === uiPort)
            throw Error('invalid_local_listener');
        server = s;
        publicPort = uiPort;
        port = a.port;
        revision++;
        s.once('close', () => disable());
    }
    function disable() { enabled = false; revision++; reviews.clear(); grant = null; }
    // Trusted installed controller entrypoints, never routed from an unverified HTTP body.
    async function approveExactControl(target: LocalControlTarget, expiresAt: number, requestId: string, checkOwner: () => void) {
        checkOwner(); const authority = revision; assertAuthority(authority); await eligible(target);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= now() || expiresAt > Math.min(now() + 24 * 60 * 60 * 1000, c!.expiresAt)) fault('expiry_invalid');
        const snapshot = await grants.snapshot();
        const saved = await grants.save(permissions.instance, snapshot.revision, requestId, epoch, {target, expiresAt, credentialEpoch: epoch}, async () => {checkOwner(); assertAuthority(authority); await eligible(target); checkOwner(); assertAuthority(authority)});
        grant = saved.grant; grantRevision = saved.revision;
    }
    async function revokeExactControl(requestId: string, checkOwner: () => void) {
        checkOwner(); disable(); const snapshot = await grants.snapshot();
        await grants.save(permissions.instance, snapshot.revision, requestId, epoch, null, async () => {checkOwner()});
    }
    async function callReviewedControl(name: string, args: any) {
        const authority = revision; assertAuthority(authority);
        if (!['get_status', ...controlTools].includes(name)) fault('tool_not_authorized');
        if (keyValues.some(k => JSON.stringify(args).includes(k))) fault('invalid_arguments');
        const value = await api.call(name, args); assertAuthority(authority);
        if (keyValues.some(k => JSON.stringify(value).includes(k))) fault('response_unavailable');
        return value;
    }
    return { approveExactControl, revokeExactControl, callReviewedControl, handle, handleOwner, ownerRequest: owner.verify, permissionApi: api, status, view, bind, disable, dispose() {
            if (disposed)
                return;
            disposed = true;
            disable();
            api.dispose();
            owner.dispose();
            for (const b of Object.values(buffers))
                b.fill(0);
        }, async handleOwnerScope(req: IncomingMessage, res: ServerResponse) {
            if (!req.url?.startsWith('/api/workspace-permissions/') || req.url.startsWith('/api/workspace-permissions/final/'))
                return false;
            return api.handle(req, res);
        } };
}
export async function startTrustedLocalListener(app: ReturnType<typeof createTrustedLocalMcp>, port: number, publicPort: number): Promise<Server> {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === publicPort)
        throw Error('invalid_local_listener');
    if (app.status().reason !== 'unbound')
        throw Error('local_configuration_required');
    const server = createServer((req, res) => void app.handle(req, res).catch(() => {
        if (!res.writableEnded)
            send(res, 503);
    }));
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    try {
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
        app.bind(server, publicPort);
        server.on('error', () => app.disable());
        return server;
    }
    catch (e) {
        app.disable();
        server.closeAllConnections();
        if (server.listening)
            await new Promise<void>(r => server.close(() => r()));
        throw e;
    }
}
