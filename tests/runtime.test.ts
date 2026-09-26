import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JsonlParser } from '../server/adapters/pi/parser.ts';
import { transition } from '../server/adapters/pi/process.ts';
import { SessionEvents, previewToolInput } from '../server/runtime/events.ts';
import { pathKey } from '../server/runtime/workspaces.ts';
const session = { id: 'sid', workspaceId: 'wid', filePath: '/tmp/session.jsonl' };
test('LF parser survives fragments and Unicode separators without false split', () => {
  const parser = new JsonlParser();
  assert.deepEqual(parser.push(Buffer.from('{"type":"message","text":"a\u2028b"}\n{"')), [{ type: 'message', text: 'a\u2028b' }]);
  assert.deepEqual(parser.push(Buffer.from('type":"done"}\r\n')), [{ type: 'done' }]);
  assert.throws(() => new JsonlParser(2).push(Buffer.from('123\n')), /too large/);
});
test('process transitions reject double start', () => {
  assert.equal(transition('stopped','starting'), 'starting'); assert.equal(transition('starting','running'),'running');
  assert.throws(() => transition('running','starting'));
});
test('real Pi-shaped fixture normalizes stream, tools and settled (not agent_end)', () => {
  const state = new SessionEvents(session, () => 'running');
  const run = state.preparePrompt('Use powershell');
  const lines = readFileSync(new URL('./fixtures/powershell.jsonl', import.meta.url), 'utf8').trim().split('\n');
  for (const line of lines) {
    const raw = JSON.parse(line); state.ingest(raw);
    if (raw.type === 'agent_end') assert.equal(state.activeRunId, run);
  }
  const events = state.events;
  assert.deepEqual(events.map(e => e.type), ['RunStarted','MessageStarted','MessageDelta','MessageCompleted','ToolStarted','ToolProgress','ToolCompleted','AgentSettled','RunCompleted']);
  assert.equal(events.find(e => e.type === 'ToolStarted')?.parentId, run);
  assert.equal(events.find(e => e.type === 'ToolCompleted')?.toolCallId, 'call-demo');
  const started=events.find(e=>e.type==='ToolStarted');
  assert.equal(started?.payload.commandPreview,'Write-Output PHASE0_OK');
  assert.equal(state.snapshot().execution.nodes.find(n=>n.id===started?.entityId)?.action,'Write-Output PHASE0_OK');
  assert.equal(state.chat.find(m => m.role === 'assistant')?.text, 'Hello');
  assert.equal(state.activeRunId, undefined);
  assert.ok(events.every((e, i) => e.seq === i+1 && e.sessionId === 'sid'));
});
test('tool preview is bounded, single-line, and only from explicit known argument fields',()=>{
  assert.equal(previewToolInput({command:'node run.js\n --check'}),'node run.js --check');
  assert.equal(previewToolInput({program:'python',args:['secret']}),'python');
  assert.equal(previewToolInput({token:'secret'}),'');
  assert.equal(previewToolInput({command:'x'.repeat(200)}).length,158);
});
test('terminal error, aborted, tool failure and crash are truthful', () => {
  const state = new SessionEvents(session, () => 'failed'); state.preparePrompt(); state.ingest({ type:'agent_start' });
  state.ingest({type:'tool_execution_end',toolCallId:'x',toolName:'powershell',isError:true});
  state.ingest({type:'message_end',message:{role:'assistant',content:[],stopReason:'error',errorMessage:'provider failed'}});
  state.ingest({type:'agent_settled'});
  assert.equal(state.events.at(-1)?.status,'failed');
  const interrupted = new SessionEvents(session, () => 'failed'); interrupted.preparePrompt(); interrupted.interrupted('process died');
  assert.equal(interrupted.events.at(-1)?.status,'interrupted');
  const stopped = new SessionEvents(session, () => 'running'); stopped.preparePrompt(); stopped.ingest({type:'agent_start'}); stopped.markStop(); stopped.ingest({type:'agent_settled'});
  assert.equal(stopped.events.at(-1)?.status,'cancelled');
  assert.equal(pathKey('C:\\Folder\\'), pathKey('c:\\folder'));
});
