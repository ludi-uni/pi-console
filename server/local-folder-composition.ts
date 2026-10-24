import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { type FolderProvider, FolderMcp } from './folder-mcp.ts';
import { managedFolderProvider } from './managed-workspace-registration.ts';
import { windowsDirectoryPolicy, windowsTraversalPolicy } from './windows-folder-provider.ts';
import type { WorkspaceStore } from './runtime/workspaces.ts';
import { nativePort } from '../package/native/windows-folder-port.mjs';

const SOURCE_SHA = '17400635999615e1bc5fe3d0b9cdaaf85d171e55de79eadd090f5495fcea652e';
const reviewedRuntime = Object.freeze({ platform: 'win32', arch: 'x64', node: 'v24.22.1', napi: 10, modules: 137 });
const requiredExports = ['candidateOnly','policyVersion','openVolumeRoot','openDirectory','createDirectory','createFile','info','assertLocalNtfs','close','audit','closeAll'];
const descriptorFile = fileURLToPath(new URL('../package/native/windows-folder.provider.json', import.meta.url));
const binaryFile = fileURLToPath(new URL('../package/native/windows-folder.node', import.meta.url));
type Runtime = { platform: string; arch: string; node: string; napi: number; modules: number };
type Store = Pick<WorkspaceStore, 'registerManagedNew' | 'managedRegistryDirectory'>;
// Only source tests inject these dependencies. HTTP, environment and descriptor cannot choose paths/loaders.
type Options = {
  runtime?: Runtime; read?: (path: string) => Promise<Buffer>; load?: (path: string) => unknown;
  folderOptions?: ConstructorParameters<typeof FolderMcp>[1];
};
function fail(code: string): never { throw Error(code); }
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function exact(v: Record<string, unknown>, keys: string[]) { return Reflect.ownKeys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)); }
function runtimeMatches(v: unknown): v is Runtime {
  return object(v) && exact(v, Object.keys(reviewedRuntime)) && Object.entries(reviewedRuntime).every(([k,value]) => v[k] === value);
}
/** Trusted installed-code composition; OFF until an explicitly reviewed non-probe build is placed.
 * No listener activation, owner authentication, grant approval or credential generation here.
 * The directory containing installed code/descriptor is trusted, like Pi/SDK/extensions.
 * SHA is an artifact consistency check, not authentication of hostile local installed code.
 */
export async function loadLocalFolderMcp(store: Store, options: Options = {}): Promise<{ folders: FolderMcp; provider?:FolderProvider; state: 'disabled' | 'candidate' }> {
  const read = options.read ?? (path => readFile(path));
  let buffer: Buffer;
  try { buffer = await read(descriptorFile); }
  catch (e) {
    if (object(e) && e.code === 'ENOENT') return { folders: new FolderMcp(undefined, options.folderOptions), state: 'disabled' };
    return fail('folder_binding_configuration_unreadable');
  }
  let config: unknown;
  try { if (buffer.length > 4096) throw Error(); config = JSON.parse(buffer.toString('utf8')); }
  catch { return fail('folder_binding_configuration_invalid'); }
  if (object(config) && exact(config, ['enabled']) && config.enabled === false) return { folders: new FolderMcp(undefined, options.folderOptions), state: 'disabled' };
  if (!object(config) || !exact(config, ['enabled','contract','fixtureProbes','sourceSha256','binarySha256','runtime']) || config.enabled !== true || config.contract !== 2 || config.fixtureProbes !== false || config.sourceSha256 !== SOURCE_SHA || typeof config.binarySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(config.binarySha256) || !runtimeMatches(config.runtime)) return fail('folder_binding_configuration_invalid');
  const runtime = options.runtime ?? { platform: process.platform, arch: process.arch, node: process.version, napi: Number(process.versions.napi), modules: Number(process.versions.modules) };
  if (!runtimeMatches(runtime)) return fail('folder_binding_runtime_mismatch');
  let binary: Buffer;
  try { binary = await read(binaryFile); } catch { return fail('folder_binding_binary_unreadable'); }
  if (!binary.length || binary.length > 16 * 1024 * 1024 || createHash('sha256').update(binary).digest('hex') !== config.binarySha256) return fail('folder_binding_hash_mismatch');
  let binding: unknown;
  try { binding = (options.load ?? createRequire(import.meta.url))(binaryFile); }
  catch { return fail('folder_binding_load_failed'); }
  if (!object(binding) || !exact(binding, requiredExports) || binding.candidateOnly !== true || binding.policyVersion !== 2 || requiredExports.slice(2).some(k => typeof binding[k] !== 'function')) return fail('folder_binding_contract_invalid');
  try {
    const port = nativePort(binding, windowsDirectoryPolicy, windowsTraversalPolicy);
    const provider=managedFolderProvider(port,store);
    return { folders: new FolderMcp(provider, options.folderOptions),provider,state:'candidate' };
  } catch { return fail('folder_binding_contract_invalid'); }
}
