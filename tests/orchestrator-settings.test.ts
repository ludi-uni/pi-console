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
  const previousRoot = process.env.PI_CONSOLE_KIT_ROOT, previousAgent = process.env.PI_CODING_AGENT_DIR, previousData = process.env.PI_CONSOLE_DATA_DIR;
  try {
    process.env.PI_CONSOLE_KIT_ROOT = root;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_CONSOLE_DATA_DIR = join(root,'console');
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
    const stale=settings.revision;
    settings=await updateOrchestratorSettings({kind:'capability',action:'create',name:'custom-review',description:'Independent review',primary:'second',fallback:['first'],revision:settings.revision});
    assert.equal(settings.capabilities['custom-review'].custom,true);
    assert.equal(settings.capabilities['custom-review'].description,'Independent review');
    await assert.rejects(updateOrchestratorSettings({kind:'backend',action:'delete',name:'first',revision:stale}),/settings changed elsewhere/);
    settings=await updateOrchestratorSettings({kind:'capability',name:'custom-review',description:'Reviewed',primary:'first',fallback:['second'],revision:settings.revision});
    assert.equal(settings.capabilities['custom-review'].description,'Reviewed');
    await assert.rejects(updateOrchestratorSettings({kind:'capability',action:'create',name:'not valid',primary:'first',fallback:[],revision:settings.revision}),/invalid capability name/);
    await assert.rejects(updateOrchestratorSettings({kind:'capability',action:'delete',name:'strong-code',revision:settings.revision}),/confirm capability removal/);
    settings=await updateOrchestratorSettings({kind:'capability',action:'delete',name:'strong-code',confirmed:true,revision:settings.revision});
    assert.equal(settings.capabilities['strong-code'],undefined);
    assert.equal(settings.disabledCapabilities.some((item:any)=>item.name==='strong-code'),true);
    assert.equal(JSON.parse(await readFile(join(root,'routing/routing.local.json'),'utf8')).capabilities['strong-code'],null);
    settings=await updateOrchestratorSettings({kind:'capability',action:'restore',name:'strong-code',revision:settings.revision});
    assert.equal(settings.capabilities['strong-code'].primary,'second');
    settings=await updateOrchestratorSettings({kind:'capability',action:'delete',name:'custom-review',confirmed:true,revision:settings.revision});
    assert.equal(settings.capabilities['custom-review'],undefined);
    assert.equal(Object.hasOwn(JSON.parse(await readFile(join(root,'routing/routing.local.json'),'utf8')).capabilities,'custom-review'),false);
    await assert.rejects(updateOrchestratorSettings({kind:'backend',action:'delete',name:'first',revision:settings.revision}),/confirm model removal/);
    settings=await updateOrchestratorSettings({kind:'backend',action:'delete',name:'first',confirmed:true,revision:settings.revision});
    assert.equal(settings.backends.first.status,'placeholder');
    assert.equal(settings.backends.second.model,'fallback');
    assert.equal(JSON.parse(await readFile(userFile,'utf8')).backends.first.model,'TODO-unconfigured');
    settings=await updateOrchestratorSettings({kind:'backend',name:'first',provider:'openai',model:'gpt-test',revision:settings.revision});
    assert.equal(settings.backends.first.status,'bound');
    // Freely named registrations use Console storage, not the replaceable kit files.
    const modelDraft={name:'日本語のモデル / ⭐',provider:'openai',model:'named-model',vision:false,scopes:['code']};
    const kitBefore=await readFile(join(root,'routing/routing.local.json'),'utf8');
    settings=await updateOrchestratorSettings({kind:'usermodel',action:'create',...modelDraft,revision:settings.revision});
    const registered=settings.userModels[0], backend=registered.backend;
    assert.equal(registered.name,modelDraft.name);
    assert.equal(settings.maxUserModels,16);
    assert.equal(settings.overlayPath,join(root,'console','orchestrator-models.json'));
    await assert.rejects(updateOrchestratorSettings({kind:'backend',name:backend,provider:'x',model:'y'}),/unknown backend/);
    settings=await updateOrchestratorSettings({kind:'capability',name:'strong-code',primary:backend,fallback:['second'],revision:settings.revision});
    assert.deepEqual(settings.capabilities['strong-code'].candidates,[backend,'second']);
    settings=await updateOrchestratorSettings({kind:'usermodel',action:'update',id:registered.id,...modelDraft,name:'自由に改名',revision:settings.revision});
    assert.equal(settings.userModels[0].id,registered.id);
    assert.equal(settings.capabilities['strong-code'].primary,backend);
    assert.deepEqual(settings.capabilities['strong-code'].candidates,[backend,'second']);
    const beforeConcurrent=settings.revision;
    const concurrent=await Promise.allSettled(['A','B'].map(suffix=>updateOrchestratorSettings({kind:'usermodel',action:'create',...modelDraft,name:`別モデル${suffix}`,revision:beforeConcurrent})));
    assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
    assert.match(String((concurrent.find(r=>r.status==='rejected') as PromiseRejectedResult).reason),/settings changed elsewhere/);
    settings=await orchestratorSettings();
    settings=await updateOrchestratorSettings({kind:'capability',action:'create',name:'named-review',scope:'review',primary:backend,fallback:[],revision:settings.revision});
    assert.deepEqual(settings.capabilities['named-review'].candidates,[]); // code permission is not review permission
    settings=await updateOrchestratorSettings({kind:'usermodel',action:'update',id:registered.id,...modelDraft,name:'自由に改名',scopes:[],revision:settings.revision});
    assert.deepEqual(settings.capabilities['strong-code'].candidates,['second']);
    assert.equal(settings.capabilities['strong-code'].primary,backend); // preserve desired route while denied
    settings=await updateOrchestratorSettings({kind:'capability',name:'strong-code',primary:'first',fallback:['second'],revision:settings.revision});
    assert.deepEqual(settings.capabilities['strong-code'].candidates,['first','second']); // replacing an overlay route works
    settings=await updateOrchestratorSettings({kind:'usermodel',action:'update',id:registered.id,...modelDraft,name:'自由に改名',scopes:['review'],revision:settings.revision});
    assert.deepEqual(settings.capabilities['named-review'].candidates,[backend]); // editing a model preserves custom routes
    assert.equal(await readFile(join(root,'routing/routing.local.json'),'utf8'),kitBefore);
    settings=await updateOrchestratorSettings({kind:'usermodel',action:'delete',id:registered.id,confirmed:true,revision:settings.revision});
    assert.equal(settings.capabilities['named-review'],undefined);
    assert.equal(settings.backends[backend],undefined);
    for(let i=settings.userModels.length;i<16;i++)settings=await updateOrchestratorSettings({kind:'usermodel',action:'create',...modelDraft,name:`モデル ${i}`,revision:settings.revision});
    assert.equal((await orchestratorSettings()).userModels.length,16);
    await assert.rejects(updateOrchestratorSettings({kind:'usermodel',action:'create',...modelDraft,name:'17件目',revision:settings.revision}),/model limit reached/);
    const savedModels=JSON.parse(await readFile(settings.overlayPath,'utf8'));
    assert.equal(Object.keys(savedModels.models).length,16);
    assert.equal(savedModels.capabilities['strong-code'].primary,'first');
    // A kit still using the old package-only loader must not receive a false success response.
    process.env.PI_CONSOLE_TEST_OLD_LOADER = '1';
    await assert.rejects(updateOrchestratorSettings({ kind: 'backend', name: 'first', provider: 'openai', model: 'newer' }), /runtime loader did not confirm/);
  } finally {
    delete process.env.PI_CONSOLE_TEST_OLD_LOADER;
    if (previousRoot === undefined) delete process.env.PI_CONSOLE_KIT_ROOT; else process.env.PI_CONSOLE_KIT_ROOT = previousRoot;
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgent;
    if(previousData===undefined)delete process.env.PI_CONSOLE_DATA_DIR;else process.env.PI_CONSOLE_DATA_DIR=previousData;
    await rm(root, { recursive: true, force: true });
  }
});
