import { opendir, open, lstat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import type { Workspace } from '../../shared/types.ts';
import { pathKey } from './workspaces.ts';

// Only configured session storage is traversed. Parse a bounded session header.
// Conversation lines, titles, attachments and arbitrary paths are never projected.
export async function readOnlySessionHeaders(workspace: Workspace, root: string) {
  const sessions: { id: string; updatedAt: string }[] = [];
  let visited = 0, truncated = false, unavailable = false;
  const scan = async (directory: string, descend: boolean): Promise<void> => {
    let entries;
    try { entries = await opendir(directory, { bufferSize: 32 }); }
    catch { unavailable = true; return; }
    try {
      for await (const entry of entries) {
        if (++visited > 1024) { truncated = true; break; }
        const file = join(directory, entry.name);
        if (descend && entry.isDirectory() && !entry.isSymbolicLink()) {
          await scan(file, false); if (truncated) break;
        }
        if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.jsonl')) continue;
        let handle;
        try {
          if (!(await lstat(file)).isFile()) continue;
          handle = await open(file, 'r');
          const info = await handle.stat(); if (!info.isFile()) continue;
          const buffer = Buffer.alloc(4096);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          const text = buffer.subarray(0, bytesRead).toString('utf8');
          const newline = text.indexOf('\n');
          if (newline < 0 && info.size > bytesRead) { truncated = true; continue; }
          const header = JSON.parse(newline < 0 ? text : text.slice(0, newline));
          if (header.type !== 'session' || typeof header.id !== 'string' || !header.id || header.id.length > 200 ||
            typeof header.cwd !== 'string' || header.cwd.length > 2048) continue;
          // Header-controlled paths must never trigger filesystem/network probes.
          // The registered workspace path is canonical; ambiguous aliases are omitted.
          if (!isAbsolute(header.cwd) || header.cwd.startsWith('\\\\') || header.cwd.startsWith('//')) continue;
          if (pathKey(header.cwd) === pathKey(workspace.path)) sessions.push({ id: header.id, updatedAt: info.mtime.toISOString() });
        } catch { unavailable = true; }
        finally { await handle?.close(); }
      }
    } catch { unavailable = true; }
  };
  await scan(root, true);
  return { sessions, truncated, unavailable };
}
