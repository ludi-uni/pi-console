import { createWindowsFolderProvider } from './windows-folder-provider.ts';
import type { WindowsFolderPort } from './windows-folder-provider.ts';
import type { WorkspaceStore } from './runtime/workspaces.ts';

/** Source-only assembly seam, never called by default Console composition.
 * Native handles remain open while the existing Console registry appends one new row.
 * Stable volume paths are internal verified values, never accepted from HTTP/tool args. */
export function managedFolderProvider(port: WindowsFolderPort, store: Pick<WorkspaceStore, 'registerManagedNew' | 'managedRegistryDirectory'>) {
  return createWindowsFolderProvider(port, async (entry, guard) => {
    const workspace = await store.registerManagedNew(entry, guard);
    return { id: workspace.id, path: entry.displayPath };
  }, store.managedRegistryDirectory());
}
