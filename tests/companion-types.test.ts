import { createStdioSession, privatePost, discoverBroker } from '../package/local-folder-mcp.mjs';
// Compile-only contract: importing this file starts no connection or network operation.
export function checkCompanionTypes(signal: AbortSignal) {
  const session = createStdioSession({ post: (route, body, token, abort) => privatePost('http://127.0.0.1:1', route, body, token, abort), generation: () => 'typed-dummy' });
  void session.message({ jsonrpc: '2.0', id: 1, method: 'tools/list' }); session.close();
  const discovery: Promise<string> = discoverBroker('http://127.0.0.1:1', signal);
  return discovery;
}
