import { promises as fs } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { WorkspaceStore } from './workspaces.ts';

const maxBytes = 256 * 1024;
const supported = new Set(['.txt', '.md', '.markdown']);

export async function readWorkspaceText(store: WorkspaceStore, workspaceId: string, path: string): Promise<{path:string;content:string;format:'markdown'|'text'}> {
  const workspace = store.get(workspaceId);
  if (typeof path !== 'string' || !path.trim() || path.length > 4096 || /[\x00-\x1f]/.test(path)) throw new Error('invalid file path');
  if (process.platform === 'win32' && (/^[A-Za-z]:(?![\\/])/.test(path) || (isAbsolute(path) && !/^[A-Za-z]:[\\/](?![\\/])/.test(path)))) throw new Error('invalid file path');
  const root = await fs.realpath(workspace.path);
  const target = await fs.realpath(isAbsolute(path) ? path : resolve(root, path)).catch(() => { throw new Error('file not found or unavailable'); });
  const within = relative(root, target);
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('file is outside the workspace');
  const extension = extname(target).toLowerCase();
  if (!supported.has(extension)) throw new Error('only text and Markdown files are supported');
  const handle = await fs.open(target, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxBytes) throw new Error('file is not a supported text file or exceeds 256 KiB');
    const buffer = await handle.readFile();
    if (buffer.length > maxBytes) throw new Error('file exceeds 256 KiB');
    const content = new TextDecoder('utf-8',{fatal:true}).decode(buffer);
    if (content.includes('\0')) throw new Error('file is not UTF-8 text');
    return {path:within || target,content,format:extension === '.txt' ? 'text' : 'markdown'};
  } finally { await handle.close(); }
}
