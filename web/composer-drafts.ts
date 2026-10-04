// Browser-local, per-workspace/session drafts. Bytes, not File objects, are
// persisted for WebKit. Revisions and tombstones make writes atomic across tabs.
export type PendingSubmission = { requestId: string; text: string; files: File[]; mode?: 'followUp' | 'steer' };
export type ComposerDraft = { text: string; files: File[]; submission?: PendingSubmission };
type StoredFile = { name: string; type: string; lastModified: number; size: number; bytes: ArrayBuffer };
const writes = new Map<string, Promise<void>>();
const revisions = new Map<string, number>();
export class DraftConflictError extends Error { constructor() { super('Draft changed in another tab'); } }
function restoreFile(value: unknown): File {
  if (value instanceof File) return value;
  if (value && typeof value === 'object') {
    const file = value as Partial<StoredFile>;
    if (typeof file.name === 'string' && typeof file.type === 'string' &&
        typeof file.lastModified === 'number' && Number.isFinite(file.lastModified) &&
        file.bytes instanceof ArrayBuffer && file.size === file.bytes.byteLength) {
      return new File([file.bytes], file.name, { type: file.type, lastModified: file.lastModified });
    }
  }
  throw Error('Stored draft could not be read');
}
function restoreDraft(value: any): ComposerDraft {
  if (value === undefined) return { text: '', files: [] };
  if (!value || typeof value.text !== 'string' || !Array.isArray(value.files)) throw Error('Stored draft could not be read');
  const draft: ComposerDraft = { text: value.text, files: value.files.map(restoreFile) };
  if (value.submission !== undefined) {
    const s = value.submission;
    if (!s || typeof s.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(s.requestId) || typeof s.text !== 'string' || !Array.isArray(s.files) || s.mode !== undefined && s.mode !== 'followUp' && s.mode !== 'steer') throw Error('Stored submission could not be read');
    draft.submission = { requestId: s.requestId, text: s.text, files: s.files === value.files ? draft.files : s.files.map(restoreFile), ...(s.mode ? { mode: s.mode } : {}) };
  }
  return draft;
}
function revisionOf(value: any): number {
  const revision = value?.revision ?? 0; // Legacy drafts have revision zero.
  if (!Number.isSafeInteger(revision) || revision < 0) throw Error('Stored draft revision could not be read');
  return revision;
}
const storeFiles = (files: File[]): Promise<StoredFile[]> => Promise.all(files.map(async file => ({
  name: file.name, type: file.type, lastModified: file.lastModified, size: file.size, bytes: await file.arrayBuffer(),
})));
export const composerDraftDatabase = 'pi-console-composer-drafts-v1';
const storeName = 'drafts', notificationKey = 'pi-console-draft-change';
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(composerDraftDatabase, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onerror = () => reject(request.error ?? Error('Draft storage unavailable'));
      request.onblocked = () => reject(Error('Draft storage blocked by another tab'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
    }).catch(error => { database = undefined; throw error; });
  }
  return database;
}
export async function readComposerDraft(scope: string): Promise<{ draft: ComposerDraft; revision: number }> {
  await writes.get(scope)?.catch(() => {});
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(scope);
    transaction.oncomplete = () => {
      try { resolve({ draft: restoreDraft(request.result), revision: revisionOf(request.result) }); }
      catch (error) { reject(error); }
    };
    transaction.onabort = () => reject(transaction.error ?? Error('Draft read aborted'));
  });
}
export function composerDraftRevision(scope: string): number { return revisions.get(scope) ?? 0; }
export function adoptComposerDraftRevision(scope: string, revision: number): void { revisions.set(scope, revision); }
export async function loadComposerDraft(scope: string): Promise<ComposerDraft> {
  const value = await readComposerDraft(scope);
  adoptComposerDraftRevision(scope, value.revision);
  return value.draft;
}
export function saveComposerDraft(scope: string, draft: ComposerDraft): Promise<void> {
  // Serialize within this tab; the read/write transaction is the cross-tab CAS.
  const write = (writes.get(scope) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const files = await storeFiles(draft.files);
    const submission = draft.submission ? { ...draft.submission, files: draft.submission.files === draft.files ? files : await storeFiles(draft.submission.files) } : undefined;
    const db = await openDatabase();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName), request = store.get(scope);
      let nextRevision = 0, failure: unknown;
      request.onsuccess = () => {
        try {
          const current = revisionOf(request.result);
          if (current !== (revisions.get(scope) ?? 0)) throw new DraftConflictError();
          nextRevision = current + 1;
          // Keep empty tombstones: deleting the record would let a stale tab
          // overwrite an acknowledged clear using the old revision zero.
          store.put({ text: draft.text, files, revision: nextRevision, ...(submission ? { submission } : {}) }, scope);
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => {
        revisions.set(scope, nextRevision);
        try { localStorage.setItem(notificationKey, JSON.stringify({ scope, nonce: `${Date.now()}-${Math.random()}` })); } catch { /* CAS still protects storage; focus refresh covers missed notifications. */ }
        resolve();
      };
      transaction.onabort = () => reject(failure ?? transaction.error ?? Error('Draft save aborted'));
    });
  });
  writes.set(scope, write);
  const cleanup = () => { if (writes.get(scope) === write) writes.delete(scope); };
  void write.then(cleanup, cleanup);
  return write;
}
export function subscribeComposerDrafts(listener: (scope?: string) => void): () => void {
  const storage = (event: StorageEvent) => {
    if (event.key !== notificationKey || !event.newValue) return;
    try { const value = JSON.parse(event.newValue); if (typeof value.scope === 'string') listener(value.scope); } catch { /* Ignore unrelated/malformed notifications. */ }
  };
  const focus = () => listener();
  window.addEventListener('storage', storage); window.addEventListener('focus', focus);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener('focus', focus); };
}
