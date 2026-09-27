import { promises as fs } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { WorkspaceStore } from './workspaces.ts';
import { workspaceFileFormat } from '../../shared/workspace-files.ts';

const maxBytes = 256 * 1024;

export async function resolveWorkspaceFile(store: WorkspaceStore, workspaceId: string, path: string) {
  const workspace = store.get(workspaceId);
  if (typeof path !== 'string' || !path.trim() || path.length > 4096 || /[\x00-\x1f]/.test(path)) throw new Error('invalid file path');
  if (process.platform === 'win32' && (/^[A-Za-z]:(?![\\/])/.test(path) || (isAbsolute(path) && !/^[A-Za-z]:[\\/](?![\\/])/.test(path)))) throw new Error('invalid file path');
  const root = await fs.realpath(workspace.path);
  const target = await fs.realpath(isAbsolute(path) ? path : resolve(root, path)).catch(() => { throw new Error('file not found or unavailable'); });
  const within = relative(root, target);
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('file is outside the workspace');
  return {root,target,within};
}

export async function readWorkspaceText(store: WorkspaceStore, workspaceId: string, path: string): Promise<{path:string;content:string;format:'markdown'|'text'|'code'}> {
  const {target,within}=await resolveWorkspaceFile(store,workspaceId,path);
  const extension = extname(target).toLowerCase();
  const format = workspaceFileFormat(extension);
  if (!format) throw new Error('unsupported text file extension');
  const handle = await fs.open(target, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxBytes) throw new Error('file is not a supported text file or exceeds 256 KiB');
    const buffer = await handle.readFile();
    if (buffer.length > maxBytes) throw new Error('file exceeds 256 KiB');
    const content = new TextDecoder('utf-8',{fatal:true}).decode(buffer);
    if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(content)) throw new Error('file is not UTF-8 text');
    return {path:within || target,content,format};
  } finally { await handle.close(); }
}
