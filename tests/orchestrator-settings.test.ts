import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { orchestratorSettings, updateOrchestratorSettings } from '../server/adapters/orchestrator/settings.ts';

test('orchestrator settings show runtime binding status/source and verify persistent saves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-settings-'));
  const agentDir = join(root, 'agent');
  const userFile = join(agentDir, 'ludi-agent-kit', 'models.local.json');
  const previousRoot = process.env.PI_CONSOLE_KIT_ROOT, previousAgent = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CONSOLE_KIT_ROOT = root;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    for (const dir of ['routing', 'lib/orchestrator', 'adapters/pi/lib']) await mkdir(join(root, dir), { recursive: true });
    const files: Record<string, string> = {
      'lib/orchestrator/api.mjs': '',
      'adapters/pi/lib/invoke.mjs': '', 'adapters/pi/lib/subagent.mjs': '',
      'lib/routing.mjs': `import {readFileSync,existsSync} from 'node:fs';import {join,dirname} from 'node:path';
export const mergeLocalRouting=(base,local)=>{const caps={...base.capabilities};for(const [name,value] of Object.entries(local.capabilities)){if(value===null){delete caps[name];continue}caps[name]={...caps[name],...value}}for(const value of Object.values(caps)){if(!base.backends[value.primary]||value.fallback?.some(b=>!base.backends[b]||b===value.primary))throw Error('invalid route')}return {...base,capabilities:caps}};
export const loadRouting=path=>{const base=JSON.parse(readFileSync(path));const local=join(dirname(path),'routing.local.json');return existsSync(local)?mergeLocalRouting(base,JSON.parse(readFileSync(local))):base};`,
      'lib/registry.mjs': `import {readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';
export const validateRegistry=(models)=>Object.values(models.backends).some(b=>/sk-[A-Za-z0-9]{20,}/.test(b.model??''))?['credential']:[];
export const mergeRegistries=(base,local)=>({backends:{...base.backends,...(local?.backends??{})}});
export const isPlaceholder=b=>!b?.provider||!b?.model||b.provider.startsWith('TODO')||b.model.startsWith('TODO');
export const loadRegistry=(basePath,packagePath,routing,userPath)=>{const local=existsSync(packagePath)?JSON.parse(readFileSync(packagePath)):null;const user=!process.env.PI_CONSOLE_TEST_OLD_LOADER&&userPath&&existsSync(userPath)?JSON.parse(readFileSync(userPath)):null;return {registry:mergeRegistries(mergeRegistries(JSON.parse(readFileSync(basePath)),local),user),sources:{models:basePath,local:local?packagePath:null,user:user?userPath:null}}};`,
      'lib/resolve.mjs': `import {isPlaceholder} from './registry.mjs';export const resolveCapability=(routing,registry,name)=>{const chain=[routing.capabilities[name].primary,...(routing.capabilities[name].fallback??[])];return {candidates:chain.filter(b=>registry.backends[b]&&!isPlaceholder(registry.backends[b])).map(backend=>({backend})),placeholder:chain.filter(b=>registry.backends[b]&&isPlaceholder(registry.backends[b])),unbound:chain.filter(b=>!registry.backends[b])}};`,
      'routing/routing.json': JSON.stringify({ version: 1, backends: { first: {}, second: {}, third: {} }, capabilities: { orchestration: { primary: 'first', fallback: ['second', 'third'], description: 'planner' }, 'strong-code': { primary: 'second', fallback: [] } } }),
      'adapters/pi/models.json': JSON.stringify({ version: 1, backends: { first: { provider: 'TODO-provider', model: 'TODO-model' }, second: { provider: 'b', model: 'two' } } }),
      'adapters/pi/models.local.json': JSON.stringify({ version: 1, backends: { second: { provider: 'package', model: 'fallback' } } }),
      'routing/routing.local.json': JSON.stringify({ version: 1, capabilities: { 'strong-code': { primary: 'first', fallback: [] } } }),
    };
    for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
    let settings = await orchestratorSettings();
    assert.equal(settings.modelSource, join(root, 'adapters/pi/models.local.json'));
    assert.equal(settings.modelSavePath, userFile);
    assert.equal(settings.backends.first.status, 'placeholder');
    assert.equal(settings.backends.second.model, 'fallback');
    assert.equal(settings.backends.third.status, 'unbound');
    assert.deepEqual(settings.capabilities.orchestration.placeholder, ['first']);
    assert.deepEqual(settings.capabilities.orchestration.unbound, ['third']);
    assert.equal(settings.capabilities.orchestration.status, 'bound');
    assert.equal(settings.capabilities['strong-code'].status, 'placeholder');
    await assert.rejects(updateOrchestratorSettings({ kind: 'capability', name: 'orchestration', primary: 'missing', fallback: [] }), /invalid capability route/);
    await assert.rejects(updateOrchestratorSettings({ kind: 'backend', name: 'first', provider: 'a', model: 'sk-123456789012345678901234' }), /credential/);
    settings = await updateOrchestratorSettings({ kind: 'backend', name: 'first', provider: 'openai', model: 'gpt-test' });
    assert.equal(settings.modelSource, userFile);
    assert.equal(settings.backends.first.model, 'gpt-test');
    assert.equal(settings.backends.first.status, 'bound');
    assert.equal(settings.backends.second.model, 'fallback'); // untouched backends keep the package-local migration fallback
    assert.equal(settings.capabilities['strong-code'].status, 'bound');
    assert.equal(JSON.parse(await readFile(userFile, 'utf8')).backends.first.model, 'gpt-test');
    assert.equal(JSON.parse(await readFile(join(root, 'adapters/pi/models.local.json'), 'utf8')).backends.second.model, 'fallback');
    settings = await updateOrchestratorSettings({ kind: 'capability', name: 'orchestration', primary: 'second', fallback: ['first'] });
    assert.deepEqual(settings.capabilities.orchestration.candidates, ['second', 'first']);
    const local = JSON.parse(await readFile(join(root, 'routing/routing.local.json'), 'utf8'));
    assert.equal(local.capabilities['strong-code'].primary, 'first');
    assert.equal(local.capabilities.orchestration.primary, 'second');
    assert.equal(JSON.parse(await readFile(join(root, 'routing/routing.json'), 'utf8')).capabilities.orchestration.primary, 'first');
    // A kit still using the old package-only loader must not receive a false success response.
    process.env.PI_CONSOLE_TEST_OLD_LOADER = '1';
    await assert.rejects(updateOrchestratorSettings({ kind: 'backend', name: 'first', provider: 'openai', model: 'newer' }), /runtime loader did not confirm/);
  } finally {
    delete process.env.PI_CONSOLE_TEST_OLD_LOADER;
    if (previousRoot === undefined) delete process.env.PI_CONSOLE_KIT_ROOT; else process.env.PI_CONSOLE_KIT_ROOT = previousRoot;
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgent;
    await rm(root, { recursive: true, force: true });
  }
});
