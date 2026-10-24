import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RuntimeManager } from './runtime/manager.ts';
import { realpath } from 'node:fs/promises';
import { pathKey } from './runtime/workspaces.ts';
import { validateReadOnlyMcpScope, type ReadOnlyMcpScope } from './readonly-mcp-scope.ts';
import { createReadOnlyMcpAuthentication, type ReadOnlyMcpAuthentication } from './readonly-mcp-auth.ts';

export function readOnlyMcpEnabled(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === '0') return false;
  if (value === '1') return true;
  throw new Error('PI_CONSOLE_READONLY_MCP must be 0 or 1');
}
const legacyVersions = ['2025-03-26', '2025-06-18'];
const modernVersion = '2026-07-28';
const versions = [modernVersion, ...legacyVersions.slice().reverse()];
const metaProtocol = 'io.modelcontextprotocol/protocolVersion';
const metaCapabilities = 'io.modelcontextprotocol/clientCapabilities';
const metaClient = 'io.modelcontextprotocol/clientInfo';
const metaServer = 'io.modelcontextprotocol/serverInfo';
const statuses = new Set(['queued','running','waiting','blocked','completed','failed','cancelled','interrupted','unknown']);
const kinds = new Set(['run','orchestrator','task','agent','tool','decision']);
const processes = new Set(['stopped','starting','running','stopping','failed']);
const sources = new Set(['pi','pi-subagents','orchestrator']);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
class Invalid extends Error { constructor() { super('Invalid arguments or stale/unavailable target; refresh status and session listing.'); } }
class ProtocolError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) { super(message); }
}
const strict = (value: unknown, keys: string[], required: string[] = []): Record<string, any> => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new Invalid();
  return value;
};
const requestParams = (value: unknown, keys: string[], required: string[] = []) => {
  const args = strict(value === undefined ? {} : value, [...keys,'_meta'],required);
  if (Object.hasOwn(args,'_meta') && !object(args._meta)) throw new Invalid();
  return args;
};
const paging = (args: Record<string, any>) => {
  if (Object.hasOwn(args,'limit') && typeof args.limit !== 'number' || Object.hasOwn(args,'offset') && typeof args.offset !== 'number') throw new Invalid();
  const limit = args.limit ?? 50, offset = args.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000) throw new Invalid();
  return { limit, offset };
};
const iso = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const enumValue = (value: unknown, allowed: Set<string>) => typeof value === 'string' && allowed.has(value) ? value : 'unknown';
const handleSchema = { type: 'string', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 };
const serverSchema = { type: 'string', pattern: '^[a-f0-9-]{36}$', minLength: 36, maxLength: 36 };
const pageSchema = { limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }, offset: { type: 'integer', minimum: 0, maximum: 1000, default: 0 } };
const tools = [
  { name: 'get_status', description: 'Read server identity and opaque workspace IDs. No names, paths or conversation content.', properties: {}, required: [] },
  { name: 'list_sessions', description: 'Read bounded session metadata and run targets. Unobserved means no live projection; never opens a worker.',
    properties: { serverId: serverSchema, workspaceId: handleSchema, ...pageSchema }, required: ['serverId','workspaceId'] },
  { name: 'get_progress', description: 'Read structured progress for one explicitly listed target. Use its exact generation and runId; null runId is valid only if there are no observed runs. Cached progress is not current completion.',
    properties: { serverId: serverSchema, workspaceId: handleSchema, sessionId: handleSchema,
      generation: { anyOf: [handleSchema, { type: 'null' }] }, runId: { anyOf: [handleSchema, { type: 'null' }] }, ...pageSchema },
    required: ['serverId','workspaceId','sessionId','generation','runId'] },
].map(({ properties, required, ...tool }) => ({ ...tool,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}));

// Local native-client boundary, independent of (and never weakening) browser
// Host/Access/Origin gates. This is not authentication for a public MCP endpoint.
export type NativeDenialReason = 'peer_not_loopback' | 'host_mismatch' | 'origin_present' | 'proxy_header_present' | 'cloudflare_header_present' | 'fetch_site_denied' | 'mcp_auth_failed';
export function readOnlyMcpNativeDenialReasons(req: IncomingMessage): NativeDenialReason[] {
  const reasons: NativeDenialReason[] = [];
  if (!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) reasons.push('peer_not_loopback');
  if (req.headers.host !== `127.0.0.1:${req.socket.localPort}`) reasons.push('host_mismatch');
  const keys = Object.keys(req.headers);
  if (keys.includes('origin')) reasons.push('origin_present');
  if (keys.some(key => key === 'forwarded' || key === 'via' || key === 'x-real-ip' || key.startsWith('x-forwarded-'))) reasons.push('proxy_header_present');
  if (keys.some(key => key.startsWith('cf-'))) reasons.push('cloudflare_header_present');
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'none') reasons.push('fetch_site_denied');
  return reasons;
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  const timeout = setTimeout(() => req.destroy(), 5000); timeout.unref();
  try {
    for await (const part of req.iterator({ destroyOnReturn: false })) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      size += chunk.length;
      if (size > 16 * 1024) { req.resume(); throw new RangeError(); }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { clearTimeout(timeout); }
}

export function createReadOnlyMcp(runtime: RuntimeManager, suppliedOptions: { enabled?: boolean; version?: string; scope?: ReadOnlyMcpScope; authentication?: ReadOnlyMcpAuthentication; onNativeDenial?: (reasons: NativeDenialReason[]) => void } = {}) {
  const { authentication, ...options } = suppliedOptions;
  const auth = createReadOnlyMcpAuthentication(authentication);
  const scope = options.enabled ? validateReadOnlyMcpScope(options.scope) : undefined;
  const allowedWorkspaces = async () => {
    if (!scope) throw new Invalid();
    const allowed = [];
    for (const rule of scope.workspaces) {
      const registered = runtime.workspaces.list().find(item => item.id === rule.id);
      if (!registered || pathKey(registered.path) !== pathKey(rule.path)) throw new Invalid();
      const actual = await realpath(registered.path).catch(() => undefined);
      if (!actual || pathKey(actual) !== pathKey(rule.path)) throw new Invalid();
      allowed.push({ ...registered, sessionIds: rule.sessionIds });
    }
    return allowed;
  };
  const serverId = randomUUID(), key = randomBytes(32), startedAt = new Date().toISOString();
  const opaque = (...parts: string[]) => createHmac('sha256', key).update(JSON.stringify(parts)).digest('hex');
  const workspaceHandle = (id: string) => opaque('workspace', id);
  const sessionHandle = (wid: string, sid: string) => opaque('session', wid, sid);
  const generationHandle = (wid: string, sid: string, generation: string) => opaque('generation', wid, sid, generation);
  const nodeHandle = (wid: string, sid: string, generation: string, id: string) => opaque('node', wid, sid, generation, id);
  const workspace = async (args: Record<string, any>) => {
    if (args.serverId !== serverId || typeof args.workspaceId !== 'string') throw new Invalid();
    const match = (await allowedWorkspaces()).find(item => workspaceHandle(item.id) === args.workspaceId);
    if (!match) throw new Invalid(); return match;
  };
  const observation = (wid: string, sid: string) => runtime.readOnlyObservation(wid, sid);
  const runNodes = (state: ReturnType<typeof observation>) => state?.nodes.filter(node => node.kind === 'run' || node.kind === 'orchestrator') ?? [];
  const sessionProjection = (wid: string, sid: string, updatedAt?: string) => {
    const state = observation(wid, sid);
    const generation = state?.generation ? generationHandle(wid, sid, state.generation) : null;
    const runs = runNodes(state);
    return { sessionId: sessionHandle(wid, sid), observation: state?.observation ?? 'unobserved',
      runtime: enumValue(state?.runtime, processes), generation, updatedAt: iso(updatedAt),
      runs: runs.slice(-20).map(node => ({ runId: nodeHandle(wid,sid,state!.generation!,node.id),
        kind: node.kind === 'run' ? 'pi' : 'orchestrator', status: enumValue(node.status, statuses) })), runsTruncated: runs.length > 20 };
  };
  const call = async (name: string, value: unknown) => {
    const tool = tools.find(item => item.name === name); if (!tool) throw new Invalid();
    const args = strict(value === undefined ? {} : value, Object.keys(tool.inputSchema.properties), tool.inputSchema.required);
    if (name === 'get_status') {
      const workspaces = await allowedWorkspaces();
      return { serverId, readOnly: true, version: options.version ?? '0.5.0', startedAt, runtime: runtime.readOnlyRuntimeStatus(workspaces), workspaces: workspaces.slice(0,100).map(w => ({ workspaceId: workspaceHandle(w.id) })), truncated: workspaces.length > 100 };
    }
    const ws = await workspace(args), { limit, offset } = paging(args);
    const listing = await runtime.readOnlySessions(ws.id, ws.sessionIds);
    listing.sessions = listing.sessions.filter(session => ws.sessionIds.includes(session.id));
    // The fixed allowlist is authoritative. Global scan truncation is retained;
    // completeness is proven only when every allowed ID was actually found.
    const foundIds = new Set(listing.sessions.map(session => session.id));
    const scopeComplete = !listing.unavailable && ws.sessionIds.every(id => foundIds.has(id));
    listing.sessions.sort((a,b) => sessionHandle(ws.id,a.id).localeCompare(sessionHandle(ws.id,b.id)));
    if (name === 'list_sessions') return { serverId, workspaceId: args.workspaceId,
      sessions: listing.sessions.slice(offset,offset+limit).map(s => sessionProjection(ws.id,s.id,s.updatedAt)),
      nextOffset: offset+limit < listing.sessions.length && offset+limit <= 1000 ? offset+limit : null,
      scanTruncated: listing.truncated, scanUnavailable: listing.unavailable, scopeComplete };
    const session = listing.sessions.find(s => sessionHandle(ws.id,s.id) === args.sessionId);
    if (!session) throw new Invalid();
    const state = observation(ws.id,session.id);
    const generation = state?.generation ? generationHandle(ws.id,session.id,state.generation) : null;
    if (args.generation !== generation) throw new Invalid();
    const runs = runNodes(state);
    const run = runs.find(node => nodeHandle(ws.id,session.id,state!.generation!,node.id) === args.runId);
    if (args.runId !== null && !run || args.runId === null && runs.length) throw new Invalid();
    const nodes = state?.nodes ?? [];
    // Only explicit parent ancestry belongs to a selected run. Unattached nodes
    // are never guessed into a run, even if they share a source/workspace.
    const members = new Set<string>(); if (run) members.add(run.id);
    const children = new Map<string,string[]>();
    for (const node of nodes) if (node.parentId) { const list = children.get(node.parentId) ?? []; list.push(node.id); children.set(node.parentId,list); }
    const pending = [...members];
    for (let i = 0; i < pending.length; i++) for (const child of children.get(pending[i]) ?? []) if (!members.has(child)) { members.add(child); pending.push(child); }
    const selected = nodes.filter(node => members.has(node.id));
    const source = state?.observation === 'observed' ? 'live' : state?.generation ? 'cached' : 'none';
    return { serverId, workspaceId: args.workspaceId, sessionId: args.sessionId, generation, runId: args.runId,
      observation: state?.observation ?? 'unobserved', source, runtime: enumValue(state?.runtime, processes),
      seq: Number.isSafeInteger(state?.seq) && state!.seq! >= 0 ? state!.seq : null,
      currentStatus: source === 'live' && run ? enumValue(run.status,statuses) : 'unknown',
      summary: run ? { nodeCount: selected.length, running: selected.filter(n => n.status === 'running').length,
        waiting: selected.filter(n => n.status === 'waiting').length, failed: selected.filter(n => n.status === 'failed').length } : null,
      nodes: selected.slice(offset,offset+limit).map(node => ({ nodeId: nodeHandle(ws.id,session.id,state!.generation!,node.id),
        parentId: node.parentId && members.has(node.parentId) ? nodeHandle(ws.id,session.id,state!.generation!,node.parentId) : null,
        kind: enumValue(node.kind,kinds), status: enumValue(node.status,statuses), source: enumValue(node.sourceKind,sources),
        startedAt: iso(node.startedAt), updatedAt: iso(node.updatedAt), endedAt: iso(node.endedAt) })),
      nextOffset: offset+limit < selected.length && offset+limit <= 1000 ? offset+limit : null,
      truncated: (state?.truncated ?? false) || offset+limit < selected.length && offset+limit > 1000 };
  };
  const reportedDenials = new Set<string>(); // At most 127 combinations; no request values retained.
  let inFlight = 0;
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const metadata = ['/.well-known/oauth-protected-resource/mcp/readonly','/.well-known/oauth-protected-resource'].includes(url.pathname);
    // These exact native-only absence responses never expose browser resources.
    // When OFF, preserve normal routing for metadata paths.
    if (metadata && !options.enabled) return false;
    if (url.pathname !== '/mcp/readonly' && !metadata) return false;
    const send = (status: number, value?: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(value === undefined ? undefined : JSON.stringify(value)); };
    if (!options.enabled) { send(404, { error: 'not found' }); return true; }
    const nativeReasons = readOnlyMcpNativeDenialReasons(req);
    const deny = (status: number, denialReasons: NativeDenialReason[]) => {
      const signature = denialReasons.join(',');
      if (!reportedDenials.has(signature)) {
        reportedDenials.add(signature);
        try { options.onNativeDenial?.([...denialReasons]); } catch { /* Diagnostics must never change access decisions. */ }
      }
      res.setHeader('x-pi-console-mcp-denial', signature);
      send(status, { error: status === 401 ? 'MCP authentication required' : 'native loopback client required', denialReasons });
      return true;
    };
    // Never relax peer, Host, Origin, Cloudflare or Fetch Metadata checks.
    // Proxy header values are never consulted; only their presence is allowed
    // after matching the independently configured local credential.
    if (nativeReasons.some(reason => reason !== 'proxy_header_present')) return deny(403, nativeReasons);
    const authenticated = auth.verify(req);
    if ((auth.required || auth.supplied(req)) && !authenticated) return deny(401, ['mcp_auth_failed']);
    if (nativeReasons.includes('proxy_header_present') && !authenticated) return deny(403, nativeReasons);
    if (url.search) { send(400, { error: 'query parameters are not supported' }); return true; }
    if (metadata) {
      if (req.method !== 'GET') { res.setHeader('Allow','GET'); send(405); return true; }
      send(404, { error: 'not found' }); return true;
    }
    if (req.method !== 'POST') { res.setHeader('Allow','POST'); send(405); return true; }
    const headerVersion = String(req.headers['mcp-protocol-version'] ?? '');
    if (headerVersion && !versions.includes(headerVersion) && !(/^\d{4}-\d\d-\d\d$/.test(headerVersion) && headerVersion >= modernVersion)) {
      send(400, { error: 'unsupported MCP protocol version' }); return true;
    }
    const accept = String(req.headers.accept ?? '').split(',').map(v => v.trim().split(';')[0]);
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) { send(406); return true; }
    if (String(req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') { send(415); return true; }
    if (inFlight >= 8) { send(429); return true; }
    inFlight++;
    let id: string | number | null = null;
    let modern = headerVersion >= modernVersion;
    const rpcError = (code: number, message: string, data?: unknown) => {
      const status = modern ? code === -32601 ? 404 : [-32602,-32020,-32022].includes(code) ? 400 : 200 : 200;
      send(status, { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
    };
    try {
      let message;
      try { message = await body(req); }
      catch (error) { send(error instanceof RangeError ? 413 : 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid or oversized JSON body' } }); return true; }
      if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || message.method.length > 100 ||
        Object.keys(message).some(k => !['jsonrpc','id','method','params'].includes(k)) || Object.hasOwn(message,'params') && !object(message.params)) {
        send(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } }); return true;
      }
      if (Object.hasOwn(message,'id')) {
        if (typeof message.id === 'string' && message.id.length <= 128 || typeof message.id === 'number' && Number.isSafeInteger(message.id)) id = message.id;
        else { send(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request ID' } }); return true; }
      }
      const meta = message.params?._meta;
      if (meta !== undefined && !object(meta)) throw new ProtocolError(-32602, 'Invalid request metadata');
      const perRequestVersion = meta?.[metaProtocol];
      modern = modern || typeof perRequestVersion === 'string' && perRequestVersion >= modernVersion;
      // SEP-2575 / SEP-2243: each sessionless request declares its protocol and
      // client capabilities, with matching HTTP protocol/method/name headers.
      if (modern || perRequestVersion !== undefined) {
        if (!headerVersion) throw new ProtocolError(-32020, 'Mcp-Protocol-Version header required');
        if (typeof perRequestVersion !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(perRequestVersion)) throw new ProtocolError(-32602, 'Missing or invalid protocol metadata');
        if (headerVersion !== perRequestVersion) throw new ProtocolError(-32020, 'Protocol header and metadata mismatch');
      }
      if (modern) {
        if (!object(meta?.[metaCapabilities])) throw new ProtocolError(-32602, 'Missing or invalid client capabilities metadata');
        const client = meta?.[metaClient];
        if (client !== undefined && (!object(client) || typeof client.name !== 'string' || !client.name || client.name.length > 128 || typeof client.version !== 'string' || client.version.length > 128)) throw new ProtocolError(-32602, 'Invalid client identity metadata');
        if (req.headers['mcp-method'] !== message.method) throw new ProtocolError(-32020, 'Missing or mismatched Mcp-Method header');
        if (message.method === 'tools/call' && (typeof message.params?.name !== 'string' || req.headers['mcp-name'] !== message.params.name)) throw new ProtocolError(-32020, 'Missing or mismatched Mcp-Name header');
        if (!versions.includes(headerVersion)) throw new ProtocolError(-32022, 'Unsupported protocol version', { supported: versions, requested: perRequestVersion });
        if (['initialize','ping','notifications/initialized'].includes(message.method)) throw new ProtocolError(-32601, 'Method not supported in sessionless protocol');
      }
      if (!Object.hasOwn(message,'id')) {
        if (!['notifications/initialized','notifications/cancelled'].includes(message.method)) {
          send(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Unsupported notification' } }); return true;
        }
        send(202); return true;
      }
      let result: unknown;
      if (message.method === 'server/discover' && modern) {
        requestParams(message.params, []);
        result = { supportedVersions: versions, capabilities: { tools: {} }, ttlMs: 0, cacheScope: 'private' };
      } else if (message.method === 'initialize') {
        const params = requestParams(message.params, ['protocolVersion','capabilities','clientInfo'], ['protocolVersion','capabilities','clientInfo']);
        if (typeof params.protocolVersion !== 'string' || !object(params.capabilities) || !object(params.clientInfo) || typeof params.clientInfo.name !== 'string' || !params.clientInfo.name || params.clientInfo.name.length > 128 || typeof params.clientInfo.version !== 'string' || params.clientInfo.version.length > 128) throw new Invalid();
        result = { protocolVersion: legacyVersions.includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18', capabilities: { tools: {} },
          serverInfo: { name: 'pi-console-readonly', version: options.version ?? '0.5.0' } };
      } else if (message.method === 'ping') { requestParams(message.params, []); result = {}; }
      else if (message.method === 'tools/list') { requestParams(message.params, []); result = { tools }; }
      else if (message.method === 'tools/call') {
        const params = requestParams(message.params, ['name','arguments'], ['name']);
        if (typeof params.name !== 'string') throw new Invalid();
        const data = await call(params.name, params.arguments);
        result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } else { rpcError(-32601, 'Method not found'); return true; }
      if (modern && object(result)) {
        result.resultType = 'complete';
        result._meta = { [metaServer]: { name: 'pi-console-readonly', version: options.version ?? '0.5.0' } };
        if (message.method === 'tools/list') { result.ttlMs = 0; result.cacheScope = 'private'; }
      }
      send(200, { jsonrpc: '2.0', id, result });
    } catch (error) {
      rpcError(error instanceof ProtocolError ? error.code : error instanceof Invalid ? -32602 : -32603,
        error instanceof ProtocolError || error instanceof Invalid ? error.message : 'Read-only observation unavailable',
        error instanceof ProtocolError ? error.data : undefined);
    } finally { inFlight--; }
    return true;
  };
  return { serverId, handle, dispose: () => auth.dispose() };
}
