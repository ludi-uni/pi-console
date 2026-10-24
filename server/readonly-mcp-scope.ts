import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export type ReadOnlyMcpScope = { version: 1; workspaces: { id: string; path: string; sessionIds: string[] }[] };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value);
export function validateReadOnlyMcpScope(value: unknown): ReadOnlyMcpScope {
  const invalid = () => { throw new Error('Invalid read-only MCP scope'); };
  if (!record(value) || value.version !== 1 || Object.keys(value).some(key => !['version','workspaces'].includes(key)) ||
    !Array.isArray(value.workspaces) || !value.workspaces.length || value.workspaces.length > 100) return invalid();
  const ids = new Set<string>();
  const workspaces = value.workspaces.map(entry => {
    if (!record(entry) || Object.keys(entry).some(key => !['id','path','sessionIds'].includes(key)) || !identifier(entry.id) || ids.has(entry.id) ||
      typeof entry.path !== 'string' || entry.path.length > 2048 || !isAbsolute(entry.path) || entry.path.startsWith('\\\\') || entry.path.startsWith('//') ||
      !Array.isArray(entry.sessionIds) || !entry.sessionIds.length || entry.sessionIds.length > 1024 || !entry.sessionIds.every(identifier) ||
      new Set(entry.sessionIds).size !== entry.sessionIds.length) return invalid();
    ids.add(entry.id);
    return { id: entry.id, path: entry.path, sessionIds: [...entry.sessionIds] };
  });
  return { version: 1, workspaces };
}
// Called only when explicitly enabled, with a server-owned fixed data-directory path.
// Never load environment or secret files, and never echo invalid scope values.
export async function loadReadOnlyMcpScope(file: string): Promise<ReadOnlyMcpScope> {
  let handle;
  try {
    handle = await open(file,'r'); const info = await handle.stat();
    if (!info.isFile() || info.size > 16*1024) throw new Error();
    const bytes = Buffer.alloc(16*1024+1); const { bytesRead } = await handle.read(bytes,0,bytes.length,0);
    if (bytesRead > 16*1024) throw new Error();
    return validateReadOnlyMcpScope(JSON.parse(bytes.subarray(0,bytesRead).toString('utf8')));
  } catch { throw new Error('Read-only MCP requires a valid readonly-mcp-scope.json'); }
  finally { await handle?.close(); }
}
