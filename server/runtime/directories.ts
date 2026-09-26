import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_ENTRIES = 200;
const MAX_SCAN = 2000;
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

export interface DirectoryEntry { name: string; path: string }
export interface DirectoryListing { path?: string; parent?: string; entries: DirectoryEntry[]; truncated?: boolean }

const normalize = (path: string) => {
  const trimmed = path.replace(/[\\/]+$/, '');
  return /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
};

async function roots(): Promise<DirectoryEntry[]> {
  const seen = new Set<string>();
  const entries: DirectoryEntry[] = [];
  const push = async (path: string, name?: string) => {
    if (!DRIVE_PATH.test(path)) return;
    // Mapped network drives can stat successfully but realpath to UNC, which this local-only picker rejects.
    const local = await fs.realpath(path).then(target => DRIVE_PATH.test(target), () => false);
    if (!local) return;
    const key = path.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ name: name ?? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path, path });
  };
  await push(homedir(), 'Home');
  await push(process.cwd(), 'Current directory');
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`;
    if (await fs.stat(root).then(s => s.isDirectory(), () => false)) await push(root, `${letter}:\\`);
  }
  return entries;
}

export async function listDirectories(path?: string): Promise<DirectoryListing> {
  if (!path?.trim()) return { entries: await roots() };
  const input = path.trim();
  if (!DRIVE_PATH.test(input)) throw new Error('absolute drive-letter path required');
  const canonical = normalize(await fs.realpath(input));
  if (!DRIVE_PATH.test(canonical)) throw new Error('path must resolve to a drive-letter root');
  if (!(await fs.stat(canonical)).isDirectory()) throw new Error('not a directory');
  const isRoot = /^[A-Za-z]:\\$/.test(canonical);
  let parent: string | undefined;
  if (!isRoot) {
    const cut = canonical.lastIndexOf('\\');
    parent = cut <= 2 ? `${canonical.slice(0, 2)}\\` : canonical.slice(0, cut);
  }
  const entries: DirectoryEntry[] = [];
  let truncated = false;
  let scanned = 0;
  for await (const dirent of await fs.opendir(canonical)) {
    if (++scanned > MAX_SCAN || entries.length >= MAX_ENTRIES) { truncated = true; break; }
    const child = join(canonical, dirent.name);
    const directory = dirent.isDirectory() ||
      (dirent.isSymbolicLink() && await fs.stat(child).then(s => s.isDirectory(), () => false));
    if (directory) entries.push({ name: dirent.name, path: child });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { path: canonical, parent, entries, truncated: truncated || undefined };
}
