import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceStore } from './workspaces.ts';

async function launchExplorer(path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe'), [path],
      { shell: false, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.off('error', reject); child.unref(); resolve(); });
  });
}

/** A browser supplies only a registered workspace ID, never a shell command or path. */
export async function openWorkspaceInExplorer(workspaces: WorkspaceStore, id: unknown,
  options: { platform?: NodeJS.Platform; launch?: (path: string) => Promise<void> } = {}): Promise<void> {
  if ((options.platform ?? process.platform) !== 'win32') throw new Error('Windows Explorer is only available on the Windows host');
  if (typeof id !== 'string' || !id) throw new Error('workspace ID required');
  const workspace = workspaces.get(id);
  const localDrive = /^[A-Za-z]:[\\/](?![\\/])/;
  if (!localDrive.test(workspace.path)) throw new Error('workspace must be a local Windows directory');
  const actual = await fs.realpath(workspace.path);
  if (!localDrive.test(actual) || !(await fs.stat(actual)).isDirectory())
    throw new Error('workspace must be a local Windows directory');
  await (options.launch ?? launchExplorer)(actual);
}
