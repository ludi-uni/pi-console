import { timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';

export const readOnlyMcpAuthHeader = 'x-pi-console-readonly-key';
export type ReadOnlyMcpAuthentication = { mode: 'shared_secret'; key: string };
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const invalidConfiguration = () => new Error('Read-only MCP authentication requires a dedicated 64-character lowercase hex key; configuration was not accepted.');

/** Called only when MCP is enabled. Native mode never reads any key file.
 * The file is operator-owned local configuration, never an RPC-selected path.
 * All errors are fixed text: no key, filesystem error, path or header value.
 */
export async function loadReadOnlyMcpAuthentication(env: NodeJS.ProcessEnv, dataDir: string): Promise<ReadOnlyMcpAuthentication | undefined> {
  const mode = env.PI_CONSOLE_READONLY_MCP_AUTH;
  if (mode === undefined || mode === '' || mode === 'native') {
    if (env.PI_CONSOLE_READONLY_MCP_KEY !== undefined) throw invalidConfiguration();
    return undefined;
  }
  if (mode !== 'shared_secret') throw invalidConfiguration();
  try {
    let key = env.PI_CONSOLE_READONLY_MCP_KEY;
    if (key === undefined) {
      const path = join(dataDir, 'readonly-mcp.key');
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size < 64 || info.size > 66 || process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw invalidConfiguration();
      key = (await readFile(path, 'utf8')).replace(/\r?\n$/, '');
    }
    if (!validKey(key)) throw invalidConfiguration();
    return { mode: 'shared_secret', key };
  } catch { throw invalidConfiguration(); }
}

/** Keep only the decoded key in this matcher. Explicit shutdown wipes its
 * buffer; JS/environment/file copies still require the documented lifecycle.
 */
export function createReadOnlyMcpAuthentication(configuration?: ReadOnlyMcpAuthentication) {
  if (configuration && (configuration.mode !== 'shared_secret' || !validKey(configuration.key))) throw invalidConfiguration();
  const expected = configuration ? Buffer.from(configuration.key, 'hex') : undefined;
  let disposed = false;
  return {
    required: expected !== undefined,
    supplied(req: IncomingMessage) { return req.rawHeaders.some((value, i) => i % 2 === 0 && value.toLowerCase() === readOnlyMcpAuthHeader); },
    verify(req: IncomingMessage) {
      const count = req.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === readOnlyMcpAuthHeader).length;
      const value = req.headers[readOnlyMcpAuthHeader];
      const valid = validKey(value);
      const candidate = valid ? Buffer.from(value, 'hex') : Buffer.alloc(32);
      // Always compare fixed-size buffers, including missing, wrong-length and
      // duplicate values. A supplied key can never configure the expected key.
      const match = timingSafeEqual(expected ?? Buffer.alloc(32), candidate);
      candidate.fill(0);
      return !disposed && expected !== undefined && count === 1 && valid && match;
    },
    dispose() { disposed = true; expected?.fill(0); },
  };
}
