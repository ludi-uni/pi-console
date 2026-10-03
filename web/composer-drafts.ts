// Browser-local, per-workspace/session drafts. IndexedDB keeps File bytes intact
// without Base64 inflation or localStorage's small quota. Never auto-send/evict.
export type ComposerDraft = { text: string; files: File[] };
export const composerDraftDatabase = 'pi-console-composer-drafts-v1';
const storeName = 'drafts';
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
export async function loadComposerDraft(scope: string): Promise<ComposerDraft> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(scope);
    transaction.oncomplete = () => {
      const value = request.result;
      if (value === undefined) return resolve({ text: '', files: [] });
      if (!value || typeof value.text !== 'string' || !Array.isArray(value.files) || !value.files.every((file: unknown) => file instanceof File)) {
        reject(Error('Stored draft could not be read')); return;
      }
      resolve(value);
    };
    transaction.onabort = () => reject(transaction.error ?? Error('Draft read aborted'));
  });
}
export async function saveComposerDraft(scope: string, draft: ComposerDraft): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    if (!draft.text && !draft.files.length) store.delete(scope);
    else store.put(draft, scope);
    // Resolve only after commit, not request success. Quota/transaction failures
    // retain the in-memory draft and trigger a visible warning in the composer.
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? Error('Draft save aborted'));
  });
}
