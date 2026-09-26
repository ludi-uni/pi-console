import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';

const waitFor = async (fn: () => boolean, ms = 120000) => { const until = Date.now()+ms; while (!fn() && Date.now()<until) await new Promise(r => setTimeout(r, 100)); assert.ok(fn(), 'timed out waiting for real Pi'); };
test('real Pi: create, stream, powershell progress, settle, resume, stop and shutdown', { timeout: 240000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-real-'));
  const store = new WorkspaceStore(join(root,'workspaces.json')); await store.load();
  const workspace = await store.add(root);
  const sessions = join(root, 'sessions');
  const manager = new RuntimeManager(store, sessions);
  try {
    const entry = await manager.create(workspace.id);
    assert.equal(entry.worker.state, 'running');
    assert.equal((await manager.sessions(workspace.id)).length, 1);
    const options=await manager.options(workspace.id,entry.session.id);
    assert.ok(options.models.length>0,'Pi returned no available models');
    assert.ok(options.model,'Pi did not select a model');
    assert.ok(options.thinkingLevels.includes(options.thinkingLevel));
    const selected=await manager.setModel(workspace.id,entry.session.id,options.model!.provider,options.model!.id);
    assert.deepEqual(selected.model,options.model);
    const thinking=await manager.setThinking(workspace.id,entry.session.id,options.thinkingLevel);
    assert.equal(thinking.thinkingLevel,options.thinkingLevel);
    const image=(await readFile(join(process.cwd(),'public','icon-192.png'))).toString('base64');
    const runId = await manager.prompt(workspace.id, entry.session.id, 'Use the powershell tool to execute Write-Output PHASE1_OK, then answer briefly.', [
      {kind:'text',name:'note.txt',mimeType:'text/plain',text:'Attachment marker: FILE_OK'},
      {kind:'image',name:'icon.png',mimeType:'image/png',data:image},
    ]);
    const messages=(await entry.worker.call('get_messages')).data?.messages;
    assert.ok(messages.some((m:any)=>m.role==='user'&&m.content.some((c:any)=>c.type==='image'&&c.mimeType==='image/png')),'Pi did not receive ImageContent');
    assert.ok(messages.some((m:any)=>m.role==='user'&&m.content.some((c:any)=>c.type==='text'&&c.text.includes('FILE_OK'))),'Pi did not receive text attachment');
    await waitFor(() => entry.state.events.some(e => e.type === 'RunCompleted'));
    const usage=(await manager.options(workspace.id,entry.session.id)).contextUsage;
    assert.ok(usage && typeof usage.contextWindow==='number' && typeof usage.percent==='number','Pi returned no context usage after a response');
    const types = entry.state.events.map(e => e.type);
    for (const type of ['RunStarted','MessageStarted','MessageDelta','MessageCompleted','ToolStarted','ToolProgress','ToolCompleted','AgentSettled','RunCompleted']) assert.ok(types.includes(type as any), `missing ${type}: ${types}`);
    assert.ok(entry.state.events.filter(e => e.type === 'ToolStarted').some(e => e.payload.toolName === 'powershell'));
    assert.equal(entry.state.events.find(e => e.type === 'RunCompleted')?.runId, runId);
    await manager.shutdown(); assert.equal(entry.worker.state, 'stopped');
    const resumed = await manager.open(workspace.id, entry.session.id);
    assert.ok(resumed.state.chat.some(m => m.role === 'assistant' && m.text.length > 0));
    // Stop is exercised on a long-running harmless tool; no additional writes.
    await manager.prompt(workspace.id, entry.session.id, 'Use powershell to execute Start-Sleep -Seconds 20 then respond.');
    await waitFor(() => resumed.state.events.some(e => e.type === 'ToolStarted'), 60000);
    await manager.stop(workspace.id, entry.session.id);
    await waitFor(() => resumed.state.events.some(e => e.type === 'RunFailed'), 30000);
    assert.equal(resumed.state.events.at(-1)?.status, 'cancelled');
    resumed.worker.killForTest();
    await waitFor(() => resumed.worker.state === 'failed', 10000);
  } finally { await manager.shutdown(); await rm(root, {recursive:true,force:true}); }
});
