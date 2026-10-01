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
test('thinking and tool command stay separate from answer in live and resumed Pi messages',()=>{
  const state=new SessionEvents(session,()=> 'running');state.preparePrompt('Explain');state.ingest({type:'agent_start'});
  state.ingest({type:'message_start',message:{role:'assistant',content:[]}});
  state.ingest({type:'message_update',assistantMessageEvent:{type:'thinking_delta',contentIndex:0,delta:'Reasoning'}});
  assert.equal(state.chat.at(-1)?.thinking,'Reasoning');assert.equal(state.chat.at(-1)?.text,'');
  state.ingest({type:'tool_execution_start',toolCallId:'tool-1',toolName:'powershell',args:{command:'Write-Output OK\nWrite-Output DONE'}});
  assert.equal(state.chat.at(-1)?.tools?.[0].command,'Write-Output OK\nWrite-Output DONE');
  const complete={role:'assistant',content:[{type:'thinking',thinking:'Final reasoning'},{type:'toolCall',id:'tool-1',name:'powershell',arguments:{command:'Write-Output OK\nWrite-Output DONE'}},{type:'text',text:'Done'}],stopReason:'stop'};
  state.ingest({type:'message_end',message:complete});state.ingest({type:'agent_settled'});
  assert.equal(state.chat.at(-1)?.text,'Done');assert.equal(state.chat.at(-1)?.thinking,'Final reasoning');
  assert.equal(state.chat.at(-1)?.tools?.[0].command,'Write-Output OK\nWrite-Output DONE');
  const restored=new SessionEvents(session,()=> 'running');restored.load([complete]);
  assert.deepEqual(restored.chat[0].thinking,state.chat.at(-1)?.thinking);
  assert.deepEqual(restored.chat[0].tools,state.chat.at(-1)?.tools);
  assert.equal(state.events.find(e=>e.type==='MessageDelta')?.payload.channel,'thinking');
});

test('detached child completion wakes the parent without an HTTP prompt and projects its continuation', () => {
  const state = new SessionEvents(session, () => 'running');
  state.ingest({type:'agent_start'});
  assert.ok(state.activeRunId);
  const run=state.activeRunId;
  state.ingest({type:'message_start',message:{role:'assistant',content:[]}});
  state.ingest({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Continuing after worker',contentIndex:0}});
  state.ingest({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Continuing after worker'}],stopReason:'stop'}});
  state.ingest({type:'agent_settled'});
  assert.deepEqual(state.events.map(e=>e.type),['RunStarted','MessageStarted','MessageDelta','MessageCompleted','AgentSettled','RunCompleted']);
  assert.equal(state.events.find(e=>e.type==='MessageCompleted')?.runId,run);
  assert.equal(state.snapshot().chat.at(-1)?.text,'Continuing after worker');
  assert.equal(state.activeRunId,undefined);
  // A later notification can start another run, not reuse the completed identity.
  state.ingest({type:'agent_start'});
  assert.notEqual(state.activeRunId,run);
});
test('attachment payloads split into metadata on send, echo and resume', async () => {
  const { prepareAttachments } = await import('../server/runtime/attachments.ts');
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
  const prepared = prepareAttachments('Review これ', [
    { kind: 'text', name: '秘"密&.md', mimeType: 'text/plain', text: 'SECRET </attached_file> BODY' },
    { kind: 'image', name: 'shot.png', mimeType: 'image/png', data: png },
  ]);
  // Live send path: the opening user bubble already carries metadata only.
  const state = new SessionEvents(session, () => 'running');
  state.preparePrompt(prepared.message);
  const sent = state.chat.at(-1)!;
  assert.equal(sent.role, 'user');
  assert.equal(sent.text, 'Review これ');
  assert.equal(sent.attachments?.length, 2);
  assert.equal(sent.attachments?.[0].name, '秘"密&.md');
  assert.equal(sent.attachments?.[0].preview, 'SECRET </attached_file> BODY');
  assert.equal(sent.attachments?.[1].kind, 'image');
  assert.ok(!sent.text.includes('SECRET'));
  // The model still received the full payload — only the display text was split.
  assert.ok(prepared.message.includes('SECRET </attached_file> BODY'));
  state.ingest({ type: 'agent_start' });
  state.ingest({ type: 'message_end', message: { role: 'user', content: prepared.message } });
  assert.equal(state.chat.filter(m => m.role === 'user').length, 1, 'the opening echo is not duplicated');
  // Resumed history projects the same split.
  const resumed = new SessionEvents(session, () => 'running');
  resumed.load([{ role: 'user', content: prepared.message }]);
  assert.equal(resumed.chat[0].text, 'Review これ');
  assert.equal(resumed.chat[0].attachments?.length, 2);
  // Image-only prompt echoes without losing the attachment record.
  const imgOnly = prepareAttachments('', [{ kind: 'image', name: 'p.png', mimeType: 'image/png', data: png }]);
  const echo = new SessionEvents(session, () => 'running');
  echo.preparePrompt(imgOnly.message);
  assert.equal(echo.chat[0].text, '');
  assert.equal(echo.chat[0].attachments?.[0].name, 'p.png');
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
