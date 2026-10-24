import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStdioSession } from '../package/local-folder-mcp.mjs';
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'generic', version: 'dummy' } } };
test('initialize and tools/list finish without broker calls or any grant', async () => {
  const calls = [];
  const bridge = createStdioSession({ post: async (...args) => { calls.push(args); throw Error('NO_BROKER_AT_BOOTSTRAP'); } });
  try {
    const reply = await bridge.message(init);
    assert.equal(reply.result?.protocolVersion, '2025-11-25');
    await bridge.message({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const list = await bridge.message({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert(list.result.tools.some(t => t.name === 'begin_local_connection'));
    assert(list.result.tools.some(t => t.name === 'get_local_connection'));
    assert.equal(calls.length, 0);
  } finally { bridge.close(); }
});
