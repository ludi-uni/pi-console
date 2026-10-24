import { canonicalParent, childName } from './folder-mcp.ts';
import type { FolderProvider, FolderTransaction } from './folder-mcp.ts';
import { PermissionFault } from './workspace-permissions.ts';

function fail(code: string): never { throw new PermissionFault(code); }
export type WindowsHandle = object;
export interface WindowsHandleInfo {
  volume: string; fileId: string; volumeGuid: string; stablePath: string;
  directory: boolean; reparse: boolean; reparseTag: number; caseSensitive: boolean; created: boolean;
}
/** Semantic requirements, NOT an unverified translation to numeric Win32 flags.
 * Native implementation must open one component relative to a live directory handle,
 * never follow reparse points and use noninheritable handles. Selected parent and
 * newly created children deny writer/delete sharing; ancestors are traversal leases.
 * Existing opens must never create; creates must return FILE_CREATED or throw.
 * Failure after acquiring a handle must close it inside the bridge before throwing.
 * There is intentionally no native loader or environment-configurable readiness here. */
export const windowsDirectoryPolicy = Object.freeze({
  relativeSingleComponent: true, denyReparse: true, caseInsensitive: true,
  shareRead: true, shareWrite: false, shareDelete: false, inherit: false,
  openExistingOnly: true, createExclusiveOnly: true
});
export const windowsTraversalPolicy = Object.freeze({
  ...windowsDirectoryPolicy, shareWrite: true, shareDelete: true
});
export type WindowsOpenPolicy = typeof windowsDirectoryPolicy | typeof windowsTraversalPolicy;
export interface WindowsFolderPort {
  implementation: 'mock' | 'native';
  openVolumeRoot(drive: string, policy: typeof windowsTraversalPolicy): WindowsHandle;
  openDirectory(parent: WindowsHandle, name: string, policy: WindowsOpenPolicy): WindowsHandle;
  info(handle: WindowsHandle): WindowsHandleInfo;
  /** Refuse remote, removable, redirected/non-NTFS and unprovable volume characteristics. */
  assertLocalNtfs(root: WindowsHandle): void;
  createDirectory(parent: WindowsHandle, name: string, policy: typeof windowsDirectoryPolicy): WindowsHandle;
  /** Exclusive relative create; bounded bytes, complete write and flush before return. */
  createFile(parent: WindowsHandle, name: string, bytes: Uint8Array, policy: typeof windowsDirectoryPolicy): WindowsHandle;
  close(handle: WindowsHandle): void;
}
// Fixed empty nonbare Git repository layout. No Git process/config/templates/hooks.
// Native/Git recognition of the resulting layout still requires a separately authorized test.
export const emptyRepositoryLayout = Object.freeze({
  directories: Object.freeze(['.git', '.git/objects', '.git/objects/info', '.git/objects/pack', '.git/refs', '.git/refs/heads', '.git/refs/tags']),
  files: Object.freeze([
    Object.freeze({ path: '.git/HEAD', content: 'ref: refs/heads/main\n' }),
    Object.freeze({ path: '.git/config', content: '[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = true\n\tignorecase = true\n\tsymlinks = false\n' }),
    Object.freeze({ path: '.git/description', content: 'Local managed empty repository.\n' })
  ])
});
export interface ManagedFolderEntry {
  displayPath: string; stablePath: string; volume: string; fileId: string; name: string;
}
type Registrar = (entry: ManagedFolderEntry, guard: () => void) => Promise<{ id: string; path: string }>;
type Lease = { handle: WindowsHandle; info: WindowsHandleInfo };
const identity = (i: WindowsHandleInfo) => i.volume + ':' + i.fileId;

// Internal existing Console metadata may use .pi. This never accepts a grant/child path.
// Keep the same drive/component/device limits, then prove every component by native handles.
function canonicalRegistryDirectory(value: string): string {
  if (value.length > 220 || !/^[A-Za-z]:\\[^\\]/.test(value)) fail('invalid_parent_path');
  for (const part of value.slice(3).split('\\')) {
    if (part === '.' || part === '..') fail('invalid_child_name');
    childName(part.startsWith('.') ? '_' + part.slice(1) : part);
  }
  return value.toLowerCase();
}

/** Source orchestration only. This factory does NOT prove a native port's contract.
 * Console composition remains unavailableFolderProvider until native implementation
 * and Windows race/reparse/share-mode acceptance have been explicitly authorized. */
export function createWindowsFolderProvider(port: WindowsFolderPort, register: Registrar, registryDirectory?: string): FolderProvider {
  if (port.implementation === 'native' && registryDirectory === undefined) fail('registry_placement_unverified');
  const registryPath = registryDirectory === undefined ? undefined : canonicalRegistryDirectory(registryDirectory);
  let poisoned = false;
  const available = () => { if (poisoned) fail('folder_provider_requires_recovery'); };
  const validate = (info: WindowsHandleInfo, directory: boolean, expectedPath: string, created: boolean) => {
    if (!/^[a-f0-9]{16}$/.test(info.volume) || !/^[a-f0-9]{32}$/.test(info.fileId) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(info.volumeGuid)
      || info.directory !== directory || info.reparse || info.reparseTag !== 0 || directory && info.caseSensitive
      || info.created !== created || info.stablePath.toLowerCase() !== expectedPath.toLowerCase()) fail('unsafe_folder_handle');
  };
  const release = (leases: Lease[]) => {
    let failed = false;
    for (const lease of leases.reverse()) { try { port.close(lease.handle); } catch { failed = true; } }
    leases.length = 0;
    if (failed) { poisoned = true; fail('folder_handle_release_failed'); }
  };
  const acquire = (leases: Lease[], open: () => WindowsHandle, directory: boolean, expectedPath?: string, created = false): Lease => {
    const handle = open(), lease = { handle, info: undefined as unknown as WindowsHandleInfo };
    // Own the handle before querying it: even an inspection exception must release it.
    leases.push(lease); lease.info = port.info(handle);
    if (!expectedPath) expectedPath = '\\\\?\\Volume{' + lease.info.volumeGuid + '}\\';
    validate(lease.info, directory, expectedPath, created);
    if (leases.length > 1 && (lease.info.volume !== leases[0].info.volume || lease.info.volumeGuid !== leases[0].info.volumeGuid)) fail('volume_changed');
    return lease;
  };
  const chain = (path: string, leases: Lease[], guard: () => void, finalPolicy: WindowsOpenPolicy = windowsDirectoryPolicy) => {
    available(); guard(); const root = acquire(leases, () => port.openVolumeRoot(path.slice(0, 2), windowsTraversalPolicy), true);
    port.assertLocalNtfs(root.handle); let parent = root;
    const components = path.slice(3).split('\\');
    for (let index = 0; index < components.length; index++) {
      const component = components[index], policy = index === components.length - 1 ? finalPolicy : windowsTraversalPolicy;
      guard(); const next = acquire(leases, () => port.openDirectory(parent.handle, component, policy), true, parent.info.stablePath + (parent.info.stablePath.endsWith('\\') ? '' : '\\') + component);
      if (next.info.volume !== root.info.volume || next.info.volumeGuid !== root.info.volumeGuid) fail('volume_changed'); parent = next;
    }
    return parent;
  };
  const checkRegistryPlacement = (parent: WindowsHandleInfo) => {
    if (!registryPath) return;
    const registryLeases: Lease[] = [];
    try {
      // Physical GUID paths also catch drive aliases; registry handles never pin ancestors.
      const actual = chain(registryPath, registryLeases, () => {}, windowsTraversalPolicy).info.stablePath.toLowerCase();
      const selected = parent.stablePath.toLowerCase();
      if (actual === selected || actual.startsWith(selected + '\\')) fail('registry_inside_allowed_parent');
    } finally { release(registryLeases); }
  };
  return {
    kind: port.implementation === 'mock' ? 'fake' : 'handle-anchored',
    async inspect(input) {
      available(); const path = canonicalParent(input), leases: Lease[] = [];
      try { const parent = chain(path, leases, () => {}); checkRegistryPlacement(parent.info); return { path, identity: identity(parent.info) }; }
      finally { release(leases); }
    },
    async withParent(pin, guard, work) {
      available(); const path = canonicalParent(pin.path), leases: Lease[] = [];
      let active = true;
      try {
        const parent = chain(path, leases, guard);
        if (identity(parent.info) !== pin.identity) fail('parent_replaced');
        checkRegistryPlacement(parent.info);
        const check = () => {
          available(); if (!active) fail('folder_lease_closed'); guard();
          for (const lease of leases) {
            const current = port.info(lease.handle);
            validate(current, lease.info.directory, lease.info.stablePath, lease.info.created);
            if (identity(current) !== identity(lease.info) || current.volumeGuid !== lease.info.volumeGuid) fail('folder_handle_changed');
          }
          checkRegistryPlacement(parent.info);
        };
        const artifacts = new Map<object, { lease: Lease; init: 'none' | 'started' | 'complete'; registration: boolean }>();
        const names = new Set<string>();
        const artifactLease = (artifact: object) => {
          check(); const owned = artifacts.get(artifact); if (!owned) fail('foreign_folder_artifact'); return owned;
        };
        const tx: FolderTransaction = {
          async createDirectory(input) {
            const name = childName(input); check(); if (names.has(name.toLowerCase())) fail('child_already_requested'); names.add(name.toLowerCase());
            const lease = acquire(leases, () => port.createDirectory(parent.handle, name, windowsDirectoryPolicy), true, parent.info.stablePath + '\\' + name, true);
            const artifact = Object.freeze({ name, path: path + '\\' + name }); artifacts.set(artifact, { lease, init: 'none', registration: false }); return artifact;
          },
          async gitInit(artifact) {
            const owned = artifactLease(artifact); if (owned.init !== 'none' || owned.registration) fail('repository_already_requested'); owned.init = 'started';
            const dirs = new Map<string, Lease>([['', owned.lease]]);
            for (const relative of emptyRepositoryLayout.directories) {
              const components = relative.split('/'), name = components.pop()!, p = dirs.get(components.join('/'))!;
              check(); const d = acquire(leases, () => port.createDirectory(p.handle, name, windowsDirectoryPolicy), true, p.info.stablePath + '\\' + name, true); dirs.set(relative, d);
            }
            for (const file of emptyRepositoryLayout.files) {
              const components = file.path.split('/'), name = components.pop()!, p = dirs.get(components.join('/'))!;
              check(); acquire(leases, () => port.createFile(p.handle, name, Buffer.from(file.content), windowsDirectoryPolicy), false, p.info.stablePath + '\\' + name, true);
            }
            owned.init = 'complete';
          },
          async registerWorkspace(artifact) {
            const owned = artifactLease(artifact); if (owned.registration || owned.init === 'started') fail('workspace_already_requested'); owned.registration = true;
            const i = owned.lease.info;
            return register({ name: artifact.name, displayPath: artifact.path, stablePath: i.stablePath, volume: i.volume, fileId: i.fileId }, check);
          }
        };
        check(); return await work(tx);
      } finally { active = false; release(leases); }
    }
  };
}
