import { readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { orchestratorKit } from './start.ts';

type Models = { version: 1; backends: Record<string, { provider?: string; model?: string; thinking?: string }> };
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const optional = async (path: string, empty: object) => { try { return await json(path); } catch (error: any) { if (error.code === 'ENOENT') return empty; throw error; } };
const atomic = async (path: string, value: object) => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await rename(tmp, path); }
  finally { await rm(tmp, { force: true }).catch(() => {}); }
};
async function context() {
  const root = await orchestratorKit();
  if (!root) throw new Error('ludi-agent-kit is not installed or its API is unavailable');
  const load = (file: string) => import(pathToFileURL(join(root, file)).href);
  const [routingModule, registryModule, resolveModule] = await Promise.all([load('lib/routing.mjs'), load('lib/registry.mjs'), load('lib/resolve.mjs')]);
  const routingPath = join(root, 'routing/routing.json');
  const modelsPath = join(root, 'adapters/pi/models.json');
  const routingLocal = join(root, 'routing/routing.local.json');
  const packageModelsLocal = join(root, 'adapters/pi/models.local.json');
  const modelsLocal = join(resolve(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')), 'ludi-agent-kit', 'models.local.json');
  // Use the exact loader arguments used by the kit's orchestration runtime. The kit
  // owns user-level > package-local precedence and reports the effective source.
  const baseRouting = await json(routingPath);
  const routing = routingModule.loadRouting(routingPath);
  const loaded = registryModule.loadRegistry(modelsPath, packageModelsLocal, routing, modelsLocal);
  const localModels: Models = await optional(modelsLocal, { version: 1, backends: {} });
  const localRouting = await optional(routingLocal, { version: 1, capabilities: {} });
  const revision = createHash('sha256').update(JSON.stringify([baseRouting,localRouting,localModels])).digest('hex');
  return { root, routing, baseRouting, localRouting, models: loaded.registry, modelSource: loaded.sources.user ?? loaded.sources.local ?? loaded.sources.models, localModels,revision,
    routingLocal, modelsLocal, routingModule, registryModule, resolveModule };
}
export async function orchestratorSettings() {
  const c = await context();
  return {
    modelSource: c.modelSource,
    modelSavePath: c.modelsLocal,
    routingSavePath: c.routingLocal,
    revision: c.revision,
    disabledCapabilities: Object.entries(c.localRouting.capabilities ?? {}).filter(([name,value])=>value===null&&Object.hasOwn(c.baseRouting.capabilities,name)).map(([name])=>({name,description:c.baseRouting.capabilities[name]?.description ?? ''})),
    capabilities: Object.fromEntries(Object.entries(c.routing.capabilities).map(([name, cap]: [string, any]) => {
      const resolved = c.resolveModule.resolveCapability(c.routing, c.models, name);
      return [name, { description: cap.description ?? '', custom:!Object.hasOwn(c.baseRouting.capabilities,name), primary: cap.primary, fallback: cap.fallback ?? [],
        status: resolved.candidates.length ? 'bound' : resolved.placeholder.length ? 'placeholder' : 'unbound',
        candidates: resolved.candidates.map((candidate: any) => candidate.backend), placeholder: resolved.placeholder, unbound: resolved.unbound }];
    })),
    backends: Object.fromEntries(Object.entries(c.routing.backends).map(([name, backend]: [string, any]) => [name, {
      description: backend.description ?? '', vision: backend.vision === true, provider: c.models.backends[name]?.provider ?? '',
      model: c.models.backends[name]?.model ?? '', thinking: c.models.backends[name]?.thinking ?? '',
      status: !c.models.backends[name] ? 'unbound' : c.registryModule.isPlaceholder(c.models.backends[name]) ? 'placeholder' : 'bound',
    }])),
  };
}
export async function updateOrchestratorSettings(value: any) {
  const c = await context();
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['capability', 'backend'].includes(value.kind)) throw new Error('invalid setting');
  if(value.revision !== undefined && value.revision !== c.revision)throw new Error('settings changed elsewhere; reload before saving');
  if (value.kind === 'capability') {
    const name=value.name;
    if(typeof name!=='string'||name.length>64||!/^[-a-z0-9]+$/.test(name)||!/^[a-z]/.test(name))throw new Error('invalid capability name');
    const action=value.action??'update';
    const caps={...c.localRouting.capabilities};
    if(action==='delete'){
      if(value.confirmed!==true)throw new Error('confirm capability removal');
      if(!Object.hasOwn(c.routing.capabilities,name))throw new Error('unknown capability');
      if(Object.hasOwn(c.baseRouting.capabilities,name))caps[name]=null;
      else delete caps[name];
    }else if(action==='restore'){
      if(!Object.hasOwn(c.baseRouting.capabilities,name)||caps[name]!==null)throw new Error('capability is not disabled');
      delete caps[name];
    }else if(action==='update'||action==='create'){
      if(action==='create'?(Object.hasOwn(c.routing.capabilities,name)||Object.hasOwn(c.baseRouting.capabilities,name)):!Object.hasOwn(c.routing.capabilities,name))throw new Error('capability already exists or is not available');
      if(typeof value.primary!=='string'||!Object.hasOwn(c.routing.backends,value.primary)||!Array.isArray(value.fallback)||value.fallback.some((b:unknown)=>typeof b!=='string'||!Object.hasOwn(c.routing.backends,b)))throw new Error('invalid capability route');
      if(new Set([value.primary,...value.fallback]).size!==value.fallback.length+1)throw new Error('duplicate backends in capability route');
      if(value.description!==undefined&&(typeof value.description!=='string'||value.description.length>300||/[\x00-\x1f]/.test(value.description)))throw new Error('invalid capability description');
      caps[name]={...(caps[name]??{}),primary:value.primary,fallback:value.fallback,...(value.description!==undefined?{description:value.description.trim()}:{})};
    }else throw new Error('invalid capability action');
    const override={...c.localRouting,capabilities:caps};
    c.routingModule.mergeLocalRouting(c.baseRouting,override);
    await atomic(c.routingLocal,override);
    const result=await orchestratorSettings();
    if(action==='delete'&&Object.hasOwn(result.capabilities,name)||action==='restore'&&!Object.hasOwn(result.capabilities,name)||
      (action==='create'||action==='update')&&(result.capabilities[name]?.primary!==value.primary||JSON.stringify(result.capabilities[name]?.fallback)!==JSON.stringify(value.fallback)))
      throw new Error('capability saved but runtime reload did not confirm it');
    return result;
  }
  if(typeof value.name!=='string'||!Object.hasOwn(c.routing.backends,value.name))throw new Error('unknown backend');
  if(value.action==='delete'){
    if(value.confirmed!==true)throw new Error('confirm model removal');
    if(c.registryModule.isPlaceholder(c.models.backends[value.name]))throw new Error('backend has no assigned model');
    const next={...c.localModels,backends:{...c.localModels.backends,[value.name]:{...c.localModels.backends[value.name],provider:'TODO-unconfigured',model:'TODO-unconfigured'}}};
    const errors=c.registryModule.validateRegistry(next,c.routing);
    if(errors.length)throw new Error(errors.join('\n'));
    await atomic(c.modelsLocal,next);
    const result=await orchestratorSettings();
    if(result.backends[value.name]?.status!=='placeholder')throw new Error('model removed but runtime reload did not confirm it');
    return result;
  }
  if(value.action!==undefined&&value.action!=='update')throw new Error('invalid model action');
  if (typeof value.provider !== 'string' || typeof value.model !== 'string' || !value.provider.trim() || !value.model.trim() || value.provider.length > 120 || value.model.length > 200 || /[\r\n]/.test(value.provider + value.model)) throw new Error('provider and model are required');
  const provider = value.provider.trim(), model = value.model.trim();
  const next = { ...c.localModels, backends: { ...c.localModels.backends, [value.name]: { ...c.localModels.backends[value.name], provider, model } } };
  const errors = c.registryModule.validateRegistry(next, c.routing);
  if (errors.length) throw new Error(errors.join('\n'));
  await atomic(c.modelsLocal, next);
  const result = await orchestratorSettings();
  if (result.modelSource !== c.modelsLocal || result.backends[value.name]?.provider !== provider || result.backends[value.name]?.model !== model || result.backends[value.name]?.status !== 'bound') {
    throw new Error(`model saved to ${c.modelsLocal}, but the kit runtime loader did not confirm the binding; check kit version and source precedence`);
  }
  return result;
}
