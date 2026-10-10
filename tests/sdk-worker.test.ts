import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiProcess, piExecutable } from '../server/adapters/pi/process.ts';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { resolvePiSdk } from '../package/pi-sdk-resolver.mjs';
import { SessionEvents } from '../server/runtime/events.ts';

async function fakeWorker() {
  const root = await mkdtemp(join(tmpdir(), 'console-sdk-fake-'));
  const entry = join(root, 'worker.mjs');
  await writeFile(entry, `process.argv.push('--sdk-entry',${JSON.stringify(fileURLToPath(new URL('./helpers/fake-sdk.mjs', import.meta.url)))},'--sdk-version','1.0.2'); await import(${JSON.stringify(new URL('../package/sdk-worker.mjs', import.meta.url).href)});`);
  const previous = process.env.PI_CONSOLE_WORKER_COMMAND; process.env.PI_CONSOLE_WORKER_COMMAND = entry;
  const worker = new PiProcess(root, undefined, join(root, 'sessions'));
  try { await worker.start(); } catch (e) { await worker.close(); if (previous === undefined) delete process.env.PI_CONSOLE_WORKER_COMMAND; else process.env.PI_CONSOLE_WORKER_COMMAND = previous; await rm(root, { recursive: true, force: true }); throw e; }
  return { worker, async cleanup() { await worker.close(); if (previous === undefined) delete process.env.PI_CONSOLE_WORKER_COMMAND; else process.env.PI_CONSOLE_WORKER_COMMAND = previous; await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}

test('SDK resolver accepts only verified versions and gives actionable guidance for 0.99.0', async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-sdk-resolver-'));
  try {
    await mkdir(join(root, 'dist')); const cli = join(root, 'dist', 'cli.js');
    await writeFile(cli, ''); await writeFile(join(root, 'sdk.mjs'), 'export {};');
    for (const version of ['0.99.2', '1.0.0', '1.0.2', '1.1.0', '0.99.0', '1.0.3', '2.0.0']) {
      await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version, exports: { '.': { import: './sdk.mjs' } } }));
      if (version === '0.99.0') assert.throws(() => resolvePiSdk(cli), /Unsupported Pi SDK 0\.99\.0.*Update the selected Pi installation \(PI_CONSOLE_PI_COMMAND\)/);
      else if (version === '1.0.3' || version === '2.0.0') assert.throws(() => resolvePiSdk(cli), new RegExp(`Unsupported Pi SDK ${version.replaceAll('.', '\\.')}.*Update the selected Pi installation`));
      else assert.deepEqual(resolvePiSdk(cli), { entry: join(root, 'sdk.mjs'), version, packageRoot: root });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('SDK worker exports its selected Pi host before SDK loading, replaces stale inherited discovery and passes it to children', { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-sdk-host-'));
  const keys = ['PI_CONSOLE_PI_COMMAND', 'PI_CONSOLE_WORKER_COMMAND', 'PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let worker: PiProcess | undefined;
  try {
    const host = join(root, 'selected-host'), cwd = join(root, 'workspace');
    await mkdir(join(host, 'dist'), { recursive: true }); await mkdir(cwd);
    const cli = join(host, 'dist', 'cli.js'); await writeFile(cli, '');
    await writeFile(join(host, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.0.2', exports: { '.': { import: './sdk.mjs' } } }));
    const fake = new URL('./helpers/fake-sdk.mjs', import.meta.url).href;
    await writeFile(join(host, 'sdk.mjs'), `
      import {execFileSync} from 'node:child_process';
      import {createAgentSessionFromServices as create} from ${JSON.stringify(fake)};
      export * from ${JSON.stringify(fake)};
      const hostAtImport = process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT;
      export async function createAgentSessionFromServices(options) {
        const created = await create(options);
        created.session.getSessionStats = () => ({ hostAtImport,
          childHost: execFileSync(process.execPath, ['-p', 'process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT'], {encoding:'utf8'}).trim() });
        return created;
      }
    `);
    process.env.PI_CONSOLE_PI_COMMAND = cli; process.env.PI_CONSOLE_WORKER_COMMAND = '';
    // Repeat without and with a stale inherited value; both must select this SDK.
    for (const inherited of [undefined, join(root, 'wrong-host')]) {
      if (inherited === undefined) delete process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT;
      else process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT = inherited;
      worker = new PiProcess(cwd, undefined, join(root, 'sessions'));
      await worker.start();
      assert.deepEqual((await worker.call('get_session_stats')).data, { hostAtImport: host, childHost: host });
      assert.equal(process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT, inherited, 'server environment must stay unchanged');
      await worker.close(); worker = undefined;
    }
  } finally {
    await worker?.close();
    for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('SDK worker transfers huge live final/tool/aggregate events and image commands without stopping or truncating', { timeout: 30000 }, async () => {
  const { worker, cleanup } = await fakeWorker();
  try {
    const state = new SessionEvents({ id: 'fake-sdk', workspaceId: 'w', filePath: 'unused' }, () => worker.state);
    const records: any[] = [];
    let done!: () => void; const settled = new Promise<void>(resolve => { done = resolve; });
    worker.onRecord = record => { records.push(record); state.ingest(record); if (record.type === 'agent_settled') done(); };
    state.preparePrompt('large');
    await worker.call('prompt', { message: '/large', images: [{ type: 'image', mimeType: 'image/png', data: 'a'.repeat(9 * 1024 * 1024) }] }); state.accepted();
    await settled;
    const text = 'x'.repeat(9 * 1024 * 1024) + '日本😀';
    assert.equal(state.snapshot().chat.find(m => m.role === 'assistant')?.text, text);
    assert.equal(records.find(r => r.type === 'tool_execution_end').result.content[0].text, text);
    assert.equal(records.find(r => r.type === 'agent_end').messages.length, 2);
    assert.equal(records.find(r => r.type === 'fake_images').data.length, 9 * 1024 * 1024);
    const update = records.find(r => r.type === 'message_update');
    assert.equal(update.message, undefined); assert.equal(update.assistantMessageEvent.partial, undefined);
    assert.equal((await worker.getMessages())[0].content[0].text, text);
    assert.equal(worker.state, 'running');
  } finally { await cleanup(); }
});

test('preflight rejects before acknowledgement and accepted prompt does not block state/abort commands', { timeout: 10000 }, async () => {
  const { worker, cleanup } = await fakeWorker();
  try {
    const records: any[] = []; worker.onRecord = r => records.push(r);
    await assert.rejects(worker.call('prompt', { message: '/reject' }), /preflight refused/);
    assert.equal(records.some(r => r.type === 'agent_start'), false);
    let accepted = false; const ack = worker.call('prompt', { message: '/slow' }).then(r => { accepted = true; return r; });
    assert.equal((await worker.call('get_state')).data.isStreaming, false);
    assert.equal(accepted, false);
    assert.equal((await ack).data.disposition, 'started');
    assert.equal((await worker.call('get_state')).data.isStreaming, true);
    await worker.call('abort'); assert.equal((await worker.call('get_state')).data.isStreaming, false);
    assert.ok(records.some(r => r.type === 'agent_settled'));
    records.length = 0;
    const interrupted = worker.call('prompt', { message: '/slow' }); void interrupted.catch(() => {});
    await worker.call('abort');
    await assert.rejects(interrupted, /interrupted before acceptance/);
    assert.equal(records.some(r => r.type === 'agent_start'), false);
  } finally { await cleanup(); }
});

test('real isolated SDK initializes, preserves RPC extension UI/log isolation, directly reads history and shuts down without a model call', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'console-sdk-smoke-'));
  const keys = ['PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR', 'PI_CONSOLE_WORKER_COMMAND', 'PI_OFFLINE'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let worker: PiProcess | undefined;
  try {
    const agent = join(root, 'agent'), extensions = join(agent, 'extensions'); await mkdir(extensions, { recursive: true });
    await writeFile(join(extensions, 'test.ts'), `export default function(pi){
      pi.registerCommand('subagents-inspect-rpc',{handler:async(args,ctx)=>{const requestId=args.split(' ')[0];ctx.ui.setWidget('subagent-inspect',['PI_SUBAGENT_INSPECT_JSON:'+JSON.stringify({kind:'pi-subagents.inspect-reply',version:1,requestId,text:'inspected'})]);}});
      const hostAtLoad=process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT;
      pi.registerCommand('sdk-host',{handler:async(_args,ctx)=>{ctx.ui.setStatus('sdk-host',hostAtLoad);}});
      pi.registerCommand('sdk-log',{handler:async(_args,ctx)=>{console.log('ordinary extension log, not JSON');if(ctx.mode!=='rpc'||!ctx.hasUI)throw Error('wrong mode');if(await ctx.ui.confirm('should cancel','no browser dialog'))throw Error('unexpected approval');ctx.ui.setStatus('sdk-test','ready');}});
    }`);
    const projectExtensions = join(root, '.pi', 'extensions'), marker = join(root, 'project-loaded');
    await mkdir(projectExtensions, { recursive: true });
    await writeFile(join(projectExtensions, 'project.ts'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'executed');export default pi=>{pi.registerCommand('sdk-project',{handler:async(_args,ctx)=>{if(!ctx.isProjectTrusted())throw Error('not trusted');}});};`);
    process.env.PI_CODING_AGENT_DIR = agent; process.env.PI_CODING_AGENT_SESSION_DIR = join(root, 'sessions'); process.env.PI_OFFLINE = '1'; process.env.PI_CONSOLE_WORKER_COMMAND = '';
    worker = new PiProcess(root, undefined, join(root, 'sessions'));
    const events: any[] = []; worker.onRecord = record => events.push(record);
    await worker.start(); assert.equal(worker.state, 'running');
    const state = (await worker.call('get_state')).data;
    assert.equal(typeof state.sessionId, 'string'); assert.equal(state.isStreaming, false);
    assert.deepEqual(await worker.getMessages(), []);
    const commands = (await worker.call('get_commands')).data.commands;
    assert.ok(commands.some((c: any) => c.name === 'sdk-log'), JSON.stringify(commands));
    assert.ok(!commands.some((c: any) => c.name === 'sdk-project')); assert.equal(existsSync(marker), false);
    assert.equal((await worker.call('prompt', { message: '/sdk-log' })).data.disposition, 'handled');
    assert.ok(events.some(event => event.method === 'setStatus' && event.statusKey === 'sdk-test'));
    await worker.call('prompt', { message: '/sdk-host' });
    assert.ok(events.some(event => event.method === 'setStatus' && event.statusKey === 'sdk-host' && event.statusText === resolvePiSdk(piExecutable()).packageRoot), 'real extensions must see the selected host before loading');
    assert.equal((await worker.inspectSubagent('test-async')).text, 'inspected');
    await worker.call('set_session_name', { name: '<pi-console:kit-report:1>' });
    await worker.call('set_session_name', { name: 'SDK smoke' });
    assert.equal((await worker.call('get_state')).data.sessionName, 'SDK smoke');
    assert.deepEqual(await worker.getMessages(), []);
    assert.ok(!events.some(event => event.type === 'agent_start'), 'no provider run may start');
    await worker.close(); assert.equal(worker.state, 'stopped');
    const sdk = await import(pathToFileURL(resolvePiSdk(piExecutable()).entry).href);
    new sdk.ProjectTrustStore(agent).set(root, true); // Only the isolated fixture is trusted.
    const manager = sdk.SessionManager.create(root, join(root, 'sessions'));
    const large = 'x'.repeat(9 * 1024 * 1024) + '日本😀';
    manager.appendMessage({ role: 'user', timestamp: 1, content: [{ type: 'text', text: large }] });
    worker = new PiProcess(root, manager.getSessionFile(), join(root, 'sessions')); worker.onRecord = record => events.push(record);
    await worker.start(); assert.equal(existsSync(marker), true);
    assert.equal((await worker.getMessages())[0].content[0].text, large);
    const restoredCommands = (await worker.call('get_commands')).data.commands;
    assert.ok(restoredCommands.some((c: any) => c.name === 'sdk-project'));
    await worker.call('prompt', { message: '/sdk-project' });
    assert.ok(!events.some(event => event.type === 'agent_start'));
    await worker.close(); assert.equal(worker.state, 'stopped');
  } finally {
    await worker?.close(); for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
