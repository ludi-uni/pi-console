import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { StoredQueueItem, QueueItemStatus } from '../../shared/types.ts';
import { prepareAttachments } from './attachments.ts';

// Durable, owner-only per-session store for the console's pre-dispatch follow-up
// queue. Files live under <dataDir>/queue/<sessionId>.json; image payloads exist ONLY
// here (plus memory) — snapshots, SSE and logs see metadata. Writes are atomic
// (tmp+rename) with mode 0600. Bounds: 16 items, 64 MiB aggregate payload.
// `held` is persisted so a paused queue never drains after a restart.

export const MAX_QUEUE_ITEMS = 16;
export const MAX_QUEUE_BYTES = 64 * 1024 * 1024;
const VALID_STATUS = new Set<QueueItemStatus>(['pending', 'dispatching', 'held', 'failed']);

export interface QueueFile { version: 1; held: boolean; items: StoredQueueItem[] }

function isStoredItem(value: unknown): value is StoredQueueItem {
  const item = value as StoredQueueItem;
  if (!item || typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id)) return false;
  if (typeof item.text !== 'string' || item.text.length > 200_000) return false;
  if (!VALID_STATUS.has(item.status)) return false;
  if (typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 0) return false;
  if (typeof item.queuedAt !== 'string' || !Number.isFinite(Date.parse(item.queuedAt))) return false;
  if (!Array.isArray(item.attachments) || item.attachments.length > 4) return false;
  if (item.error !== undefined && typeof item.error !== 'string') return false;
  // Authoritative attachment validation = the same limits the enqueue path enforces:
  // a file that could never have been produced by this server must not load.
  try { prepareAttachments(item.text, item.attachments); } catch { return false; }
  return true;
}

const itemBytes = (item: StoredQueueItem) =>
  Buffer.byteLength(item.text) + item.attachments.reduce((sum, a) => sum + (a.kind === 'text' ? Buffer.byteLength(a.text) : Math.floor(a.data.length * 3 / 4)), 0);

export class QueueStore {
  constructor(readonly dir?: string) {}
  private file(sessionId: string) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) throw new Error('invalid session id for queue store');
    return join(this.dir!, `${sessionId}.json`);
  }
  // Fail closed: anything other than "no file" throws — a queue we cannot read is
  // never silently treated as empty, which could hide or duplicate user prompts.
  async load(sessionId: string): Promise<QueueFile> {
    if (!this.dir) return { version: 1, held: false, items: [] };
    let raw: string;
    try { raw = await readFile(this.file(sessionId), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, held: false, items: [] };
      throw new Error(`cannot read persisted queue for session ${sessionId}: ${(error as Error).message}`);
    }
    let data: QueueFile;
    try { data = JSON.parse(raw); } catch { throw new Error(`persisted queue for session ${sessionId} is corrupt; inspect ${this.file(sessionId)}`); }
    if (data?.version !== 1 || !Array.isArray(data.items)) throw new Error(`persisted queue for session ${sessionId} has an unsupported shape; inspect ${this.file(sessionId)}`);
    if (data.items.length > MAX_QUEUE_ITEMS) throw new Error(`persisted queue for session ${sessionId} exceeds ${MAX_QUEUE_ITEMS} items`);
    if (!data.items.every(isStoredItem)) throw new Error(`persisted queue for session ${sessionId} contains an invalid item; inspect ${this.file(sessionId)}`);
    const bytes = data.items.reduce((sum, item) => sum + itemBytes(item), 0);
    if (bytes > MAX_QUEUE_BYTES) throw new Error(`persisted queue for session ${sessionId} exceeds 64 MiB`);
    return { version: 1, held: data.held === true, items: data.items };
  }
  async exists(sessionId: string): Promise<boolean> {
    if (!this.dir) return false;
    return (await this.load(sessionId)).items.length > 0;
  }
  async save(sessionId: string, items: StoredQueueItem[], held: boolean): Promise<void> {
    if (!this.dir) return;
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const file = this.file(sessionId);
    if (!items.length) { await rm(file, { force: true }); return; }
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ version: 1, held, items }));
      await handle.sync();
      await handle.close();
      await rename(tmp, file);
    } catch (error) { try { await handle.close(); } catch { /* already closed */ } await rm(tmp, { force: true }); throw error; }
  }
  assertFits(existing: StoredQueueItem[], next: StoredQueueItem, replaceId?: string): void {
    const items = replaceId ? existing.map(i => i.id === replaceId ? next : i) : [...existing, next];
    if (items.length > MAX_QUEUE_ITEMS) throw new Error(`queue is full (max ${MAX_QUEUE_ITEMS} pending items)`);
    const bytes = items.reduce((sum, item) => sum + itemBytes(item), 0);
    if (bytes > MAX_QUEUE_BYTES) throw new Error('queued prompts exceed 64 MiB aggregate');
  }
}
