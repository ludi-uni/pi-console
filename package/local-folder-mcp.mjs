// Standard MCP stdio companion. Broker credentials never enter MCP results or argv.
import { CONFIRMATION_WAIT_MS, MAX_GRANT_MS, grantExpired } from './connection-expiry.mjs';
import { createInterface } from 'node:readline';
import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {createPiControlCompanion} from './pi-control-mcp.mjs';

export function ownerOrigin(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || u.username || u.password || u.search || u.hash || !['/', '/local-owner/'].includes(u.pathname)) throw Error('invalid_owner_address');
  return u.origin;
}
export function privatePost(origin, route, body, token, signal) {
  return new Promise((resolve, reject) => {
    const url = new URL(route.startsWith('pi/')?'/local-owner/pi-control/'+route.slice(3):'/local-owner/folder/'+route, ownerOrigin(origin));
    const req = request(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) } }, res => {
      let data = '', size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 65536) req.destroy(Error('response_limit')); else data += chunk; });
      res.on('end', () => { try { const v = JSON.parse(data); if (res.statusCode !== 200) reject(Error('broker_request_unavailable')); else resolve(v); } catch { reject(Error('broker_response_unavailable')); } });
      res.on('error', () => reject(Error('broker_response_unavailable')));
    });
    const deadline = setTimeout(() => req.destroy(Error('broker_timeout')), 5000);
    req.once('close', () => { clearTimeout(deadline); reject(Error('broker_response_unavailable')); });
    req.on('error', () => reject(Error('broker_request_unavailable'))); req.end(JSON.stringify(body));
  });
}
/** Discovery occurs only on explicit connection begin, never during initialize/list. */
export function discoverBroker(value, signal) {
  const origin = ownerOrigin(value);
  return new Promise((resolve, reject) => {
    const req = request(new URL('/api/local-mcp-discovery', origin), { method: 'GET', signal }, res => {
      let data = '', size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 2048) req.destroy(); else data += chunk; });
      res.on('error', () => reject(Error('local_discovery_unavailable')));
      res.on('end', () => { try { const v = JSON.parse(data); if (res.statusCode !== 200 || v.version !== 1 || Object.keys(v).some(k => !['version','brokerOrigin'].includes(k))) throw Error(); resolve(ownerOrigin(v.brokerOrigin)); } catch { reject(Error('start_local_connection_in_settings')); } });
    });
    const deadline = setTimeout(() => req.destroy(Error('local_discovery_unavailable')), 1000);
    req.once('close', () => { clearTimeout(deadline); reject(Error('local_discovery_unavailable')); });
    req.on('error', () => reject(Error('local_discovery_unavailable'))); req.end();
  });
}
const legacyVersions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const modernVersion = '2026-07-28';
const supported = [modernVersion, ...legacyVersions];
const serverInfo = { name: 'pi-console-folder-management', version: '2' };
const disclosure = 'Owner approval authorizes this shared companion connection, not a chat. No Pi command authority or run/history/final text.';
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const identifier = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const secret = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function exact(value, keys) { if (!object(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) throw Error(); }
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
const connectionFields = { connectionId: string, connectionGeneration: string };
function catalog() {
  return [
    { name: 'begin_local_connection', description: 'Explicitly request owner approval once per requestId; confirmation expires after five minutes. Match the returned NON-SECRET connection ID in Console Settings. No grant or operation starts here.', inputSchema: schema({ requestId: string }) },
    { name: 'get_local_connection', description: 'Check this explicit request only. Does not submit or resubmit approval. Returns non-secret connection state and generation.', inputSchema: schema({ requestId: string }) },
    { name: 'cancel_local_connection', description: 'Disconnect this shared companion connection. Does not revoke the owner grant, delete created repositories or retract sent content. Owner revocation is in Console Settings.', inputSchema: schema({ requestId: string, connectionGeneration: string }) },
    { name: 'list_allowed_parents', description: 'Approved folder metadata only. Requires the connected handle. No history/final text.', inputSchema: schema(connectionFields) },
    { name: 'get_operation', description: 'Reconcile a submitted folder operation receipt. Requires the connected handle.', inputSchema: schema({ ...connectionFields, requestId: string }) },
    { name: 'create_managed_workspace', description: 'Create NEW child only with explicit owner folder/operation approval. No clone/push/delete/command. A timeout may leave a partial artifact; reconcile requestId before retrying.', inputSchema: schema({ ...connectionFields, requestId: string, parent: string, name: string, repo: { type: 'boolean' }, workspace: { type: 'boolean' } }) }
  ];
}
export function createStdioSession({ post, controlPost, now = Date.now, generation = randomUUID }) {
  const piControl=controlPost?createPiControlCompanion({post:controlPost,now,generation}):undefined;
  const info=piControl?{...serverInfo,version:'3'}:serverInfo,description=piControl?'Folder approval grants no Pi control. A separate explicit owner-approved control connection authorizes one selected Pi session. No run/history/final text.':disclosure;
  let initialized = false, negotiated, closed = false, active;
  const requests = new Map(), flights = new Map(), ids = new Set();
  const wipe = r => { r.token = undefined; r.proof = undefined; };
  const expire = r => { if (r && !['cancelled', 'expired'].includes(r.state) && grantExpired(r.expiresAt, now())) { wipe(r); r.state = 'expired'; } };
  const view = r => {
    expire(r);
    return { state: r.state, requestId: r.requestId, connectionGeneration: r.generation, connectionId: r.connectionId ?? null, expiresAt: r.expiresAt ?? null, authority: 'shared_connection', disclosure, ...(Object.hasOwn(r, 'grantExpiresAt') ? { grantExpiresAt: r.grantExpiresAt } : {}) };
  };
  const broker = async (id, r, route, body, token) => {
    const control = new AbortController();
    const cancelled = new Promise((_, reject) => control.signal.addEventListener('abort', () => reject(Error('bounded_or_cancelled')), { once: true }));
    flights.set(id, { control, attempt: r });
    const timer = setTimeout(() => control.abort(), route === 'rpc' ? 5000 : 1000);
    try {
      const value = await Promise.race([Promise.resolve().then(() => post(route, body, token, control.signal)), cancelled]);
      expire(r);
      if (closed || active !== r || ['cancelled', 'expired'].includes(r.state) || control.signal.aborted) throw Error();
      return value;
    } finally { clearTimeout(timer); flights.delete(id); }
  };
  const begin = async (id, args) => {
    exact(args, ['requestId']); if (!identifier(args.requestId)) throw Error();
    if (requests.has(args.requestId)) return view(requests.get(args.requestId));
    expire(active);
    if (requests.size >= 32 || active && !['cancelled', 'expired'].includes(active.state)) throw Error();
    const g = generation(); if (!identifier(g) || [...requests.values()].some(r => r.generation === g)) throw Error();
    const r = { requestId: args.requestId, generation: g, state: 'requesting', expiresAt: now() + CONFIRMATION_WAIT_MS };
    requests.set(r.requestId, r); active = r;
    try {
      const p = await broker(id, r, 'request', { name: 'MCP shared stdio companion' });
      if (!object(p) || !identifier(p.connectionId) || !secret(p.proof) || !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= now() || p.expiresAt > r.expiresAt + 1000) throw Error();
      r.connectionId = p.connectionId; r.proof = p.proof; r.expiresAt = p.expiresAt; r.state = 'pending';
    } catch { if (r.state !== 'cancelled') { wipe(r); r.state = 'unknown'; } }
    return view(r);
  };
  const status = async (id, args) => {
    exact(args, ['requestId']); if (!identifier(args.requestId)) throw Error();
    const r = requests.get(args.requestId);
    if (!r) return { state: 'unknown', requestId: args.requestId, connectionGeneration: null, connectionId: null, expiresAt: null, authority: 'shared_connection', disclosure };
    expire(r);
    if (r !== active || !r.proof || !['pending', 'connected', 'unknown'].includes(r.state)) return view(r);
    try {
      const c = await broker(id, r, 'claim', { connectionId: r.connectionId, proof: r.proof });
      expire(r); if (r.state === 'expired') return view(r);
      if (c.state === 'pending' && r.state !== 'connected') { r.token = undefined; r.state = 'pending'; }
      else if (c.state === 'connected' && c.connectionId === r.connectionId && secret(c.token) && Number.isSafeInteger(c.expiresAt) && c.expiresAt > now() && c.expiresAt <= now() + MAX_GRANT_MS && (!Object.hasOwn(c, 'grantExpiresAt') || c.grantExpiresAt === null || Number.isSafeInteger(c.grantExpiresAt) && c.grantExpiresAt >= c.expiresAt && c.grantExpiresAt <= now() + MAX_GRANT_MS)) {
        r.token = c.token; r.expiresAt = c.expiresAt; r.grantExpiresAt = Object.hasOwn(c, 'grantExpiresAt') ? c.grantExpiresAt : c.expiresAt; r.state = 'connected';
      } else throw Error();
    } catch { if (!['cancelled', 'expired'].includes(r.state)) { r.token = undefined; r.state = 'unknown'; } }
    return view(r);
  };
  const cancel = args => {
    exact(args, ['requestId', 'connectionGeneration']);
    const r = requests.get(args.requestId); if (!r || r.generation !== args.connectionGeneration) throw Error();
    wipe(r); r.state = 'cancelled';
    for (const f of flights.values()) if (f.attempt === r) f.control.abort();
    return view(r);
  };
  return {
    async message(m) {
      let id = null, modern = false, admitted = false;
      try {
        if (!object(m) || m.jsonrpc !== '2.0' || typeof m.method !== 'string' || Object.keys(m).some(k => !['jsonrpc', 'id', 'method', 'params'].includes(k))) throw Error();
        if (m.id === undefined) {
          if (m.method === 'notifications/initialized' && negotiated) initialized = true;
          if (m.method === 'notifications/cancelled') flights.get(m.params?.requestId)?.control.abort();
          if (m.method === 'notifications/cancelled') piControl?.cancel(m.params?.requestId);
          return;
        }
        if (!(typeof m.id === 'string' || Number.isSafeInteger(m.id))) throw Error(); id = m.id;
        if (closed || ids.has(id) || ids.size >= 64) throw Error(); ids.add(id); admitted = true;
        const meta = m.params?._meta;
        if (meta && (!object(meta) || Object.hasOwn(meta, 'io.modelcontextprotocol/clientCapabilities') && !Object.hasOwn(meta, 'io.modelcontextprotocol/protocolVersion'))) throw Error();
        if (meta && Object.hasOwn(meta, 'io.modelcontextprotocol/protocolVersion')) {
          const requested = meta['io.modelcontextprotocol/protocolVersion'];
          if (typeof requested !== 'string') throw Error();
          if (requested !== modernVersion) return { jsonrpc: '2.0', id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported, requested: typeof requested === 'string' ? requested : null } } };
          if (!object(meta['io.modelcontextprotocol/clientCapabilities'])) throw Error(); modern = true;
        }
        if (m.method === 'initialize' && !modern) {
          if (!legacyVersions.includes(m.params?.protocolVersion) || negotiated && negotiated !== m.params.protocolVersion) throw Error();
          negotiated = m.params.protocolVersion;
          return { jsonrpc: '2.0', id, result: { protocolVersion: negotiated, capabilities: { tools: {} }, serverInfo:info, instructions:description } };
        }
        if (m.method === 'server/discover' && modern) return { jsonrpc: '2.0', id, result: { resultType: 'complete', supportedVersions: supported, capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': info }, instructions: description } };
        if (!modern && !initialized) throw Error();
        let result;
        if (m.method === 'ping') result = {};
        else if (m.method === 'tools/list') result = { tools: [...catalog(),...(piControl?.catalog()??[])] };
        else if (m.method === 'tools/call') {
          if (!object(m.params) || Object.keys(m.params).some(k => !['name', 'arguments', '_meta'].includes(k))) throw Error();
          const name = m.params.name, args = m.params.arguments ?? {};
          let value;
          if(piControl?.handles(name))value=await piControl.call(id,name,args);
          else if (name === 'begin_local_connection') value = await begin(id, args);
          else if (name === 'get_local_connection') value = await status(id, args);
          else if (name === 'cancel_local_connection') value = cancel(args);
          else {
            if (!['list_allowed_parents', 'get_operation', 'create_managed_workspace'].includes(name) || !object(args)) throw Error();
            expire(active);
            if (!active || active.state !== 'connected' || !active.token || args.connectionId !== active.connectionId || args.connectionGeneration !== active.generation) throw Error();
            const { connectionId, connectionGeneration, ...argumentsWithoutHandle } = args;
            result = await broker(id, active, 'rpc', { method: 'tools/call', name, arguments: argumentsWithoutHandle }, active.token);
          }
          if (value) result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
        } else return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method_not_supported' } };
        return { jsonrpc: '2.0', id, result: modern ? { ...result, resultType: 'complete' } : result };
      } catch { return id === null ? undefined : { jsonrpc: '2.0', id, error: { code: -32602, message: 'local_connection_or_scope_unavailable' } }; }
      finally { if (admitted) ids.delete(id); }
    },
    close() { closed = true;piControl?.close(); for (const f of flights.values()) f.control.abort(); requests.forEach(r => { wipe(r); r.state = 'cancelled'; }); }
  };
}
async function main() {
  const address = ownerOrigin(process.argv[2]);
  let origin,controlOrigin;
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const session = createStdioSession({ post: async (route, body, token, signal) => {
    // Pin this request to the discovered broker; never migrate an approved connection.
    if (route === 'request') origin = process.argv[3] === '--discover' ? await discoverBroker(address, signal) : address;
    if (!origin) throw Error();
    return privatePost(origin, route, body, token, signal);
  },controlPost:async(route,body,token,signal)=>{if(route==='request')controlOrigin=process.argv[3]==='--discover'?await discoverBroker(address,signal):address;if(!controlOrigin)throw Error('pi_broker_unavailable');return privatePost(controlOrigin,'pi/'+route,body,token,signal)} });
  input.on('line', line => {
    if (Buffer.byteLength(line) > 65536) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request_limit' } }) + '\n'); return; }
    let m; try { m = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse_error' } }) + '\n'); return; }
    if(Buffer.byteLength(line)>8192&&!(m.method==='tools/call'&&m.params?.name==='submit_instruction')){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32600,message:'request_limit'}})+'\n');return}
    void session.message(m).then(response => { if (response) process.stdout.write(JSON.stringify(response) + '\n'); }).catch(() => { process.stderr.write('Local MCP request unavailable.\n'); });
  });
  input.once('close', () => session.close());
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { process.stderr.write('Local MCP requires the verified literal loopback owner address.\n'); process.exitCode = 1; });
