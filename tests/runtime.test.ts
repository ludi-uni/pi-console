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
  assert.deepEqual(events.map(e => e.type), ['MessageCompleted','RunStarted','MessageStarted','MessageDelta','MessageCompleted','ToolStarted','ToolProgress','ToolCompleted','AgentSettled','RunCompleted']);
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
  assert.deepEqual(restored.chat[0].tools,state.chat.at(-1)?.tools?.map(({status,...tool})=>tool));
  assert.equal(state.chat.at(-1)?.tools?.[0].status,'running');
  assert.equal(restored.chat[0].tools?.[0].status,undefined);
  assert.equal(state.events.find(e=>e.type==='MessageDelta')?.payload.channel,'thinking');
});

test('tool output is correlated after assistant completion, streamed, and restored by call id', () => {
  const state = new SessionEvents(session, () => 'running'); state.preparePrompt('Check'); state.ingest({type:'agent_start'});
  const assistant={role:'assistant',content:[{type:'thinking',thinking:'  \n '},{type:'toolCall',id:'goal-1',name:'update_goal',arguments:{status:'complete'}}],stopReason:'toolUse'};
  state.ingest({type:'message_end',message:assistant});
  assert.equal(state.chat.at(-1)?.thinking,undefined);
  assert.match(state.chat.at(-1)?.tools?.[0].input??'',/complete/);
  state.ingest({type:'tool_execution_start',toolCallId:'goal-1',toolName:'update_goal',args:{status:'complete'}});
  state.ingest({type:'tool_execution_update',toolCallId:'goal-1',partialResult:{content:[{type:'text',text:'Reviewing…'}]}});
  assert.equal(state.chat.at(-1)?.tools?.[0].output,'Reviewing…');
  state.ingest({type:'tool_execution_end',toolCallId:'goal-1',toolName:'update_goal',isError:false,result:{content:[{type:'text',text:'Goal audit approved.\nGoal complete.'}]}});
  const tool=state.chat.at(-1)?.tools?.[0]; assert.equal(tool?.status,'completed'); assert.equal(tool?.output,'Goal audit approved.\nGoal complete.');
  assert.equal(state.events.find(e=>e.type==='ToolCompleted')?.payload.chatMessageId,state.chat.at(-1)?.id);
  assert.deepEqual(state.events.find(e=>e.type==='ToolCompleted')?.payload.chatTool,tool);
  const restored=new SessionEvents(session,()=> 'running'); restored.load([assistant,{role:'toolResult',toolCallId:'unmatched',content:[{type:'text',text:'Wrong result'}]}, {role:'toolResult',toolCallId:'goal-1',content:[{type:'text',text:'Goal audit approved.\nGoal complete.'}],isError:false}]);
  assert.deepEqual(restored.chat[0].tools, state.chat.at(-1)?.tools);
});
test('tool output errors and non-text results are bounded; message end retains early results', () => {
  const state=new SessionEvents(session,()=> 'running'); state.ingest({type:'agent_start'}); state.ingest({type:'message_start',message:{role:'assistant'}});
  state.ingest({type:'tool_execution_start',toolCallId:'early',toolName:'custom',args:{value:1}});
  state.ingest({type:'tool_execution_end',toolCallId:'early',isError:true,result:{content:[{type:'text',text:'x'.repeat(17000)},{type:'image',data:'DO_NOT_PROJECT_IMAGE_BYTES'}]}});
  state.ingest({type:'message_end',message:{role:'assistant',content:[{type:'toolCall',id:'early',name:'custom',arguments:{value:1}}]}});
  const tool=state.chat[0].tools![0]; assert.equal(tool.output?.length,16000); assert.equal(tool.outputTruncated,true); assert.equal(tool.status,'failed'); assert.ok(!tool.output?.includes('DO_NOT_PROJECT_IMAGE_BYTES'));
  const restored=new SessionEvents(session,()=> 'running'); restored.load([{role:'assistant',content:[{type:'toolCall',id:'image',name:'custom',arguments:{}}]},{role:'toolResult',toolCallId:'image',content:[{type:'image',data:'PRIVATE_IMAGE'}],isError:false}]);
  assert.equal(restored.chat[0].tools![0].output,'[Non-text output: image]');
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
test('opening prompts are published to live subscribers once with the snapshot identity', () => {
  const state = new SessionEvents(session, () => 'running');
  const received: typeof state.events = [];
  state.subscribe(event => received.push(event));
  const run = state.preparePrompt('Show this instruction');
  const user = state.snapshot().chat[0];
  const event = received.find(event => event.type === 'MessageCompleted' && event.payload.role === 'user');
  assert.ok(event, 'the opening instruction must not depend on a later HTTP snapshot refresh');
  assert.equal(event.entityId, user.id);
  assert.equal(event.runId, run);
  assert.equal(event.payload.text, user.text);
  assert.equal(event.seq, state.snapshot().seq);
  state.accepted();
  state.ingest({ type: 'message_end', message: { role: 'user', content: 'Show this instruction' } });
  assert.equal(received.filter(event => event.type === 'MessageCompleted' && event.payload.role === 'user').length, 1);
  assert.equal(state.chat.filter(message => message.role === 'user').length, 1);
});

test('a steered instruction is not mistaken for a missing opening echo', () => {
  const state = new SessionEvents(session, () => 'running');
  state.preparePrompt('Original instruction'); state.accepted();
  // Some workers do not echo the opening prompt; the first user event can instead
  // be a later delivered steering instruction, which must not be discarded.
  state.queuePrompt('Steered instruction');
  state.ingest({ type: 'message_end', message: { role: 'user', content: 'Steered instruction' } });
  const user = state.chat.find(message => message.text === 'Steered instruction');
  assert.ok(user);
  const event = state.events.find(event => event.type === 'MessageCompleted' && event.payload.text === user.text);
  assert.equal(event?.entityId, user.id);
  assert.equal(state.snapshot().execution.nodes.find(node => node.id.startsWith('pi-queued:'))?.status, 'completed');
});

test('an identical steer after assistant output is not suppressed as the opening echo', () => {
  const state = new SessionEvents(session, () => 'running');
  state.preparePrompt('Same instruction'); state.accepted();
  state.ingest({ type: 'message_start', message: { role: 'assistant', content: [] } });
  state.queuePrompt('Same instruction');
  state.ingest({ type: 'message_end', message: { role: 'user', content: 'Same instruction' } });
  assert.equal(state.chat.filter(message => message.role === 'user').length, 2);
  assert.equal(state.events.filter(event => event.type === 'MessageCompleted' && event.payload.role === 'user').length, 2);
});

test('repeated identical instructions in separate runs are each published', () => {
  const state = new SessionEvents(session, () => 'running');
  for (let i = 0; i < 2; i++) {
    state.preparePrompt('Same instruction'); state.accepted();
    state.ingest({ type: 'message_end', message: { role: 'user', content: 'Same instruction' } });
    state.ingest({ type: 'agent_settled' });
  }
  const users = state.chat.filter(message => message.role === 'user');
  const events = state.events.filter(event => event.type === 'MessageCompleted' && event.payload.role === 'user');
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.entityId), users.map(user => user.id));
  assert.notEqual(users[0].id, users[1].id);
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
