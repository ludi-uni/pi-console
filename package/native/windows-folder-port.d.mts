import type { WindowsFolderPort, windowsDirectoryPolicy, windowsTraversalPolicy } from '../../server/windows-folder-provider.ts';
export function nativePort(binding: unknown, pin: typeof windowsDirectoryPolicy, traversal: typeof windowsTraversalPolicy): WindowsFolderPort;
