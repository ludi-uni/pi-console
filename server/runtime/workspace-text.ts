import { promises as fs } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { WorkspaceStore } from './workspaces.ts';
import { workspaceFileFormat } from '../../shared/workspace-files.ts';

const maxBytes = 256 * 1024;

/** Windows aliases are resolved on the host, never in the browser or a shell. */
export function expandWindowsFilePath(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const lookup = (name: string) => {
    const key = Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase());
    const value = key === undefined ? undefined : env[key];
    if (!value) throw new Error('path environment variable is unavailable on the server');
    return value;
  };
  // One pass only: environment values are literal paths, not more expressions.
  const expanded = path.replace(/%([a-z_][a-z\d_]*)%|\$env:([a-z_][a-z\d_]*)|\$\{env:([a-z_][a-z\d_]*)\}|^~(?=[\\/]|$)/gi,
    (token, percent, powershell, braced) => lookup(token === '~' ? 'USERPROFILE' : percent ?? powershell ?? braced));
  if (!expanded.trim() || expanded.length > 4096 || /[\x00-\x1f]/.test(expanded)) throw new Error('invalid file path');
  return expanded;
}

export async function resolveWorkspaceFile(store: WorkspaceStore, workspaceId: string, path: string) {
  const workspace = store.get(workspaceId);
  if (typeof path !== 'string' || !path.trim() || path.length > 4096 || /[\x00-\x1f]/.test(path)) throw new Error('invalid file path');
  if (process.platform === 'win32') path = expandWindowsFilePath(path);
  if (process.platform === 'win32' && (/^[A-Za-z]:(?![\\/])/.test(path) || (isAbsolute(path) && !/^[A-Za-z]:[\\/](?![\\/])/.test(path)))) throw new Error('invalid file path');
  const root = await fs.realpath(workspace.path);
  const target = await fs.realpath(isAbsolute(path) ? path : resolve(root, path)).catch(() => { throw new Error('file not found or unavailable'); });
  const within = relative(root, target);
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('file is outside the workspace');
  return {root,target,within};
}

export async function readWorkspaceText(store: WorkspaceStore, workspaceId: string, path: string): Promise<{path:string;content:string;format:'markdown'|'text'|'code'}> {
  const {root,target,within}=await resolveWorkspaceFile(store,workspaceId,path);
  const extension = extname(target).toLowerCase();
  const format = workspaceFileFormat(extension);
  if (!format) throw new Error('unsupported text file extension');
  const handle = await fs.open(target, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxBytes) throw new Error('file is not a supported text file or exceeds 256 KiB');
    const verify = async () => {
      const currentPath = await fs.realpath(target);
      const rel = relative(root, currentPath);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('file changed while opening the preview');
      const current = await fs.stat(currentPath), opened = await handle.stat();
      for (const candidate of [current, opened]) {
        if (candidate.dev !== stats.dev || candidate.ino !== stats.ino || candidate.size !== stats.size || candidate.mtimeMs !== stats.mtimeMs) throw new Error('file changed while opening the preview');
      }
    };
    await verify();
    // A concurrent writer must not turn the size check into an unbounded read.
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new Error('file exceeds 256 KiB');
    await verify();
    const content = new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0, length));
    if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(content)) throw new Error('file is not UTF-8 text');
    return {path:within || target,content,format};
  } finally { await handle.close(); }
}
