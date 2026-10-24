import { FolderMcp, canonicalParent } from '../server/folder-mcp.ts';
import { createStdioSession } from '../package/local-folder-mcp.mjs';
export function fakeBroker() {
  let time = Date.now(), issueCount = 0, identity = 'volume:file:1', reparse = false, failure = '';
  const created = [], registered = [], calls = [];
  const provider = {
    kind: 'fake', inspect: async path => { if (reparse) throw Error(); return { path: canonicalParent(path), identity }; },
    withParent: async (pin, guard, work) => {
      if (reparse || pin.identity !== identity) throw Error(); guard();
      return work({ createDirectory: async name => { guard(); if (created.some(x => x.name.toLowerCase() === name.toLowerCase())) throw Error(); const item = { name, path: pin.path + '\\' + name }; created.push(item); return item; },
        gitInit: async () => { guard(); if (failure === 'git') throw Error(); }, registerWorkspace: async item => { guard(); if (failure === 'workspace') throw Error(); const w = { id: 'workspace-' + registered.length, path: item.path }; registered.push(w); return w; } });
    }
  };
  const app = new FolderMcp(provider, { now: () => time, secret: () => (++issueCount).toString(16).padStart(64, '0') });
  const post = async (route, body, token) => {
    calls.push(route);
    if (route === 'request') return app.request(body);
    if (route === 'claim') return app.claim(body);
    if (route === 'rpc') { const value = await app.call(token, body.name, body.arguments); return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }; }
    throw Error();
  };
  const approve = async (connectionId, operations = ['list', 'directory', 'repo', 'workspace']) => {
    const r = await app.review({ connectionId, parent: 'D:\\Allowed', operations, expiresAt: time + 60000 });
    await app.approve({ reviewId: r.reviewId, requestId: r.requestId, confirmed: true }, () => {});
  };
  return { app, post, approve, calls, created, registered, issues: () => issueCount, now: () => time, advance: ms => { time += ms; }, replace: () => { identity = 'volume:file:2'; }, reparse: () => { reparse = true; }, fail: stage => { failure = stage; } };
}
export async function harness(override) {
  const f = fakeBroker(); let next = 0, g = 0;
  const session = createStdioSession({ post: override ? (...args) => override(f, ...args) : f.post, now: f.now, generation: () => 'generation-' + ++g });
  const message = (method, params = {}, id = ++next) => session.message({ jsonrpc: '2.0', id, method, params });
  await message('initialize', { protocolVersion: '2025-11-25' }); await session.message({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = (name, arguments_ = {}) => message('tools/call', { name, arguments: arguments_ });
  const start = async requestId => (await call('begin_local_connection', { requestId })).result.structuredContent;
  const status = async requestId => (await call('get_local_connection', { requestId })).result.structuredContent;
  const connect = async (requestId = 'request-1', operations) => { const p = await start(requestId); await f.approve(p.connectionId, operations); return status(requestId); };
  return { ...f, session, message, call, start, status, connect, handle: r => ({ connectionId: r.connectionId, connectionGeneration: r.connectionGeneration }), cleanup: () => { session.close(); f.app.dispose(); } };
}
export const modernMeta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'arbitrary MCP client', version: 'dummy' } };
