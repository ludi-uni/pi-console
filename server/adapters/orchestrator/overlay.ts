// Console-only model routing. Usage permissions do not grant tools or OS access.
import { readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { consoleDataDir } from '../../../package/data-directory.mjs';

export const MAX_USER_MODELS = 16;
export const SCOPES = ['planning', 'code', 'review', 'vision', 'browser'] as const;
export type Scope = typeof SCOPES[number];
export const SCOPE_LABELS: Record<Scope, [string, string]> = {
  planning: ['Planning / investigation', '計画・調査'], code: ['Coding / testing', 'コード作業・テスト'],
  review: ['Review', 'レビュー'], vision: ['Image inspection', '画像確認'], browser: ['Browser automation', 'ブラウザー操作'],
};
export type UserModel = { id:string; name:string; provider:string; model:string; thinking?:string; vision:boolean; scopes:Scope[]; capabilityClass?:string; costClass?:string };
export type CapabilityRoute = { primary:string; fallback:string[]; description?:string; scope?:Scope };
export type Overlay = { version:1; models:Record<string,UserModel>; capabilities?:Record<string,CapabilityRoute> };
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const THINKING = new Set(['off','minimal','low','medium','high','xhigh','max']);
const SECRET = /(sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN)/;
const CAP_SCOPES: Record<string,Scope> = { orchestration:'planning', 'cheap-code':'code', 'strong-code':'code', 'deep-review':'review', 'vision-reasoning':'vision', browser:'browser' };
// A model's scopes grant agent-role eligibility; `vision` on the model is the separate
// hardware fact that it accepts image input. Image review therefore needs BOTH the
// vision scope (capability routing) and review scope (the reviewer's role), while an
// image-taking scout/planner needs vision scope plus its planning role.
const SCOPE_ROLES: Record<Scope,string[]> = { planning:['orchestrator','design-planner','scout'], code:['coder','tester'], review:['reviewer'], vision:['visual'], browser:['browser'] };
export const backendName = (id:string) => `user-${id}`;
export const overlayPath = () => join(consoleDataDir(), 'orchestrator-models.json');
export const capabilityScope = (name:string, cap:any):Scope|undefined => CAP_SCOPES[name] ?? (cap.requires?.vision === true ? 'vision' : cap.scope);

export function validateUserModel(value:any, overlay:Overlay, existingId?:string):UserModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid model');
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || [...name].length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw Error('invalid display name');
  const provider = typeof value.provider === 'string' ? value.provider.trim() : '';
  const model = typeof value.model === 'string' ? value.model.trim() : '';
  if (!provider || !model || provider.length > 120 || model.length > 200 || /[\x00-\x1f\x7f]/.test(provider + model)) throw Error('provider and model are required');
  if (SECRET.test(provider + model)) throw Error('provider/model looks like a credential');
  if (value.thinking !== undefined && value.thinking !== '' && !THINKING.has(value.thinking)) throw Error('invalid thinking level');
  if (typeof value.vision !== 'boolean' || !Array.isArray(value.scopes) || value.scopes.some((s:unknown) => typeof s !== 'string' || !(SCOPES as readonly string[]).includes(s))) throw Error('invalid permission scopes');
  if(value.capabilityClass !== undefined && !['basic','standard','strong','expert'].includes(value.capabilityClass)) throw Error('invalid capability class');
  if(value.costClass !== undefined && !['free','included','low','paid','high'].includes(value.costClass)) throw Error('invalid cost class');
  if (Object.values(overlay.models).some(m => m.id !== existingId && m.name === name)) throw Error('display name already in use');
  return { id:existingId ?? '', name, provider, model, ...(value.thinking ? {thinking:value.thinking} : {}), vision:value.vision, scopes:[...new Set(value.scopes as Scope[])], capabilityClass:value.capabilityClass??'standard', costClass:value.costClass??'high' };
}
function validateOverlay(value:any):Overlay {
  if (!value || value.version !== 1 || !value.models || typeof value.models !== 'object' || Array.isArray(value.models) || Object.keys(value.models).length > MAX_USER_MODELS) throw Error('invalid orchestrator model settings');
  const models:Record<string,UserModel> = {};
  for (const [id, model] of Object.entries(value.models)) {
    if (!ID.test(id)) throw Error('invalid model ID');
    models[id] = validateUserModel(model, {version:1,models}, id);
  }
  if (value.capabilities !== undefined && (!value.capabilities || typeof value.capabilities !== 'object' || Array.isArray(value.capabilities))) throw Error('invalid capability settings');
  for (const [name, cap] of Object.entries(value.capabilities ?? {}) as [string,any][]) {
    if (!ID.test(name) || !cap || typeof cap.primary !== 'string' || !Array.isArray(cap.fallback) || cap.fallback.some((b:unknown) => typeof b !== 'string') || new Set([cap.primary,...cap.fallback]).size !== cap.fallback.length+1 || (cap.scope !== undefined && !(SCOPES as readonly string[]).includes(cap.scope))) throw Error('invalid capability settings');
  }
  return {version:1,models,...(value.capabilities ? {capabilities:value.capabilities} : {})};
}
export async function loadOverlay() {
  const path = overlayPath();
  let overlay:Overlay;
  try { overlay = validateOverlay(JSON.parse(await readFile(path,'utf8'))); }
  catch (error:any) { if (error.code !== 'ENOENT') throw error; overlay = {version:1,models:{}}; }
  return {overlay,path,revision:createHash('sha256').update(JSON.stringify(overlay)).digest('hex')};
}
async function persist(path:string, overlay:Overlay) {
  validateOverlay(overlay);
  await mkdir(dirname(path),{recursive:true});
  const tmp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(tmp,JSON.stringify(overlay,null,2)+'\n',{flag:'wx'}); await rename(tmp,path); }
  finally { await rm(tmp,{force:true}); }
  return (await loadOverlay()).overlay;
}
export async function saveOverlayCapabilities(capabilities:Record<string,CapabilityRoute>) {
  const {overlay,path} = await loadOverlay();
  return persist(path,{...overlay,capabilities});
}
export async function createUserModel(value:any) {
  const {overlay,path} = await loadOverlay();
  if (Object.keys(overlay.models).length >= MAX_USER_MODELS) throw Error(`model limit reached (max ${MAX_USER_MODELS})`);
  const id = `m-${randomUUID()}`, model = validateUserModel(value,overlay);
  return persist(path,{...overlay,models:{...overlay.models,[id]:{...model,id}}});
}
export async function updateUserModel(id:string,value:any,revision?:string) {
  const {overlay,path,revision:current} = await loadOverlay();
  if (revision !== undefined && revision !== current) throw Error('settings changed elsewhere; reload before saving');
  if (!Object.hasOwn(overlay.models,id)) throw Error('unknown model');
  return persist(path,{...overlay,models:{...overlay.models,[id]:validateUserModel(value,overlay,id)}});
}
export async function deleteUserModel(id:string,revision?:string) {
  const {overlay,path,revision:current} = await loadOverlay();
  if (revision !== undefined && revision !== current) throw Error('settings changed elsewhere; reload before saving');
  if (!Object.hasOwn(overlay.models,id)) throw Error('unknown model');
  const models = {...overlay.models}, capabilities = {...overlay.capabilities};
  delete models[id];
  for (const [name,cap] of Object.entries(capabilities)) {
    const chain = [cap.primary,...cap.fallback].filter(b => b !== backendName(id));
    if (!chain.length) delete capabilities[name];
    else capabilities[name] = {...cap,primary:chain[0],fallback:chain.slice(1)};
  }
  return persist(path,{...overlay,models,capabilities});
}

// Both settings preview and start/resume use this exact effective routing view.
// Empty chains point at an intentionally unbound backend, never back at a denied model.
export function applyOverlay(routing:any, registry:any, overlay:Overlay) {
  if (!Object.keys(overlay.models).length && !Object.keys(overlay.capabilities ?? {}).length) return {routing,registry};
  const backends = {...routing.backends}, bindings = {...registry?.backends};
  const userByBackend = new Map(Object.values(overlay.models).map(m => [backendName(m.id),m]));
  const denied = 'console-denied';
  backends[denied] = {description:'No permitted model',vision:true,availability_class:'disabled'};
  delete bindings[denied];
  for (const [backend,m] of userByBackend) {
    const metadata = {description:m.name,vision:m.vision,capability_class:m.capabilityClass??'standard',cost_class:m.costClass??'high',roles:[...new Set(m.scopes.flatMap(s => SCOPE_ROLES[s]))], availability_class:m.scopes.length ? 'available' : 'disabled'};
    backends[backend] = metadata;
    bindings[backend] = {provider:m.provider,model:m.model,...(m.thinking ? {thinking:m.thinking} : {}),vision:m.vision,capability_class:metadata.capability_class,cost_class:metadata.cost_class,roles:metadata.roles,availability_class:metadata.availability_class};
  }
  const allCaps = {...routing.capabilities};
  for (const [name,cap] of Object.entries(overlay.capabilities ?? {})) allCaps[name] = {...routing.capabilities[name],...cap};
  const capabilities = Object.fromEntries(Object.entries(allCaps).map(([name,cap]:[string,any]) => {
    const scope = capabilityScope(name,cap);
    // A capability that requires image input needs ALL of: the capability's scope
    // permission, the vision checkbox permission, and the model's image-input flag.
    // A review-scoped model with vision:true but no vision scope must NOT run image
    // review — the vision checkbox and the image-input fact are separate gates.
    const needsVision = scope === 'vision' || cap.requires?.vision === true;
    const chain = [cap.primary,...(cap.fallback ?? [])].filter(b => {
      const m = userByBackend.get(b);
      if (!m) return !b.startsWith('user-') && Object.hasOwn(backends,b); // legacy kit backends stay unfiltered
      return !!scope && m.scopes.includes(scope) && (!needsVision || (m.vision && m.scopes.includes('vision')));
    });
    return [name,{...cap,primary:chain[0] ?? denied,fallback:chain.slice(1)}];
  }));
  return {routing:{...routing,backends,capabilities},registry:{...registry,backends:bindings}};
}

// A task may override its capability while keeping its assigned agent. Enforce the
// agent's permitted role too, so e.g. a browser cannot borrow a code-only model. A role
// that takes image input (visual/reviewer/scout/design-planner) additionally requires
// the model's vision flag when the routed capability demands image input.
export function routingForRole(routing:any, registry:any, role:string) {
  if (!Object.keys(registry?.backends ?? {}).some(b=>b.startsWith('user-'))) return routing;
  const imageRole = ['visual','reviewer','scout','design-planner'].includes(role);
  const capabilities = Object.fromEntries(Object.entries(routing.capabilities).map(([name,cap]:[string,any])=>{
    const needsVision = capabilityScope(name,cap) === 'vision' || cap.requires?.vision === true;
    const chain = [cap.primary,...(cap.fallback ?? [])].filter(b=>!b.startsWith('user-') || (registry.backends[b]?.roles?.includes(role) && (!needsVision || !imageRole || registry.backends[b]?.vision === true)));
    return [name,{...cap,primary:chain[0]??'console-denied',fallback:chain.slice(1)}];
  }));
  return {...routing,capabilities};
}
