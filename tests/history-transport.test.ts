import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiProcess } from '../server/adapters/pi/process.ts';
import { SessionEvents } from '../server/runtime/events.ts';
import { fixturePrelude } from './helpers/worker-fixture.ts';

// Fake Pi CLI implementing just enough RPC for the chunked history transport:
// get_state, get_commands (advertises pi-console-history-rpc), and a prompt handler that
// emits the configured snapshot as PI_CONSOLE_HISTORY_JSON widget chunks. `behavior`
// selects the payload or a fault mode.
const fakeCli = (behavior: string) => `${fixturePrelude()}const fs=require('fs'),path=require('path'),readline=require('readline');
const dir=process.argv.includes('--session-dir')?process.argv[process.argv.indexOf('--session-dir')+1]:process.env.PI_CODING_AGENT_SESSION_DIR;fs.mkdirSync(dir,{recursive:true});
const file=process.argv.includes('--session')?process.argv[process.argv.indexOf('--session')+1]:path.join(dir,'fake.jsonl');
if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({type:'session',id:'fake-history',cwd:process.cwd()})+'\\n');
const emit=r=>process.stdout.write(JSON.stringify(r)+'\\n');
const behavior=${JSON.stringify(behavior)};
const CHUNK=49152;
const sendChunks=(requestId,messages,opts={})=>{
  const data=Buffer.from(JSON.stringify({kind:'pi-console.history',version:1,requestId,sessionId:'fake-history',leafId:'leaf-1',dirty:!!opts.dirty,messages}),'utf8').toString('base64');
  const total=Math.max(1,Math.ceil(data.length/CHUNK));
  const order=[...Array(total).keys()];if(opts.shuffle)order.reverse();
  for(const seq of order){
    if(opts.drop!==undefined&&seq===opts.drop)continue;
    const line={kind:'pi-console.history-chunk',version:1,requestId,seq,total:opts.badTotal?total+1:total,data:data.slice(seq*CHUNK,(seq+1)*CHUNK)};
    emit({type:'extension_ui_request',id:'w'+seq,method:'setWidget',widgetKey:'pi-console-history',widgetLines:['PI_CONSOLE_HISTORY_JSON:'+JSON.stringify(line)]});
  }
};
readline.createInterface({input:process.stdin}).on('line',s=>{const c=JSON.parse(s);
if(c.type==='get_state')return emit({id:c.id,type:'response',success:true,data:{sessionId:'fake-history',sessionFile:file,isStreaming:false}});
if(c.type==='get_commands'){
  if(behavior==='no-command')return emit({id:c.id,type:'response',success:true,data:{commands:[]}});
  return emit({id:c.id,type:'response',success:true,data:{commands:[{name:'pi-console-history-rpc',source:'extension'}]}});
}
if(c.type==='prompt'&&/^\\/pi-console-history-rpc\\s/.test(c.message||'')){
  const requestId=c.message.split(/\\s+/)[1];
  if(behavior==='timeout')return emit({id:c.id,type:'response',success:true,data:{disposition:'handled'}}); // never send chunks
  if(behavior==='big-aggregate'){const m=[];for(let i=0;i<400;i++)m.push({role:'user',content:'x'.repeat(30000)});sendChunks(requestId,m);}
  else if(behavior==='big-single')sendChunks(requestId,[{role:'user',content:'y'.repeat(9*1024*1024)}]);
  else if(behavior==='unicode')sendChunks(requestId,[{role:'user',content:'前'.repeat(40000)+'😀'.repeat(20000)+'後'}]);
  else if(behavior==='shuffle')sendChunks(requestId,[{role:'user',content:'z'.repeat(200000)}],{shuffle:true});
  else if(behavior==='drop')sendChunks(requestId,[{role:'user',content:'z'.repeat(200000)}],{drop:1});
  else if(behavior==='bad-total')sendChunks(requestId,[{role:'user',content:'z'.repeat(200000)}],{badTotal:true});
  else if(behavior==='dirty')sendChunks(requestId,[],{dirty:true});
  else sendChunks(requestId,[{role:'user',content:'small'}]);
  return emit({id:c.id,type:'response',success:true,data:{disposition:'handled'}});
}
emit({id:c.id,type:'response',success:true,data:{}});});`;

async function spawnWorker(behavior: string) {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-history-'));
  const cli = join(root, 'fake-pi.cjs');
  await writeFile(cli, fakeCli(behavior));
  const sessions = join(root, 'sessions');
  await mkdir(sessions, { recursive: true });
  const sessionFile = join(sessions, 'fake.jsonl');
  await writeFile(sessionFile, JSON.stringify({ type: 'session', id: 'fake-history', cwd: root }) + '\n');
  const previous = process.env.PI_CONSOLE_WORKER_COMMAND;
  process.env.PI_CONSOLE_WORKER_COMMAND = cli;
  const worker = new PiProcess(root, sessionFile, sessions);
  await worker.start();
  const cleanup = async () => {
    await worker.close();
    if (previous === undefined) delete process.env.PI_CONSOLE_WORKER_COMMAND; else process.env.PI_CONSOLE_WORKER_COMMAND = previous;
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { worker, cleanup };
}

test('aggregate history larger than 8 MiB reassembles in order', { timeout: 60000 }, async () => {
  const { worker, cleanup } = await spawnWorker('big-aggregate');
  try {
    const messages = await worker.getMessages();
    assert.equal(messages.length, 400);
    assert.equal(messages[0].content.length, 30000);
    assert.equal(messages[399].role, 'user');
  } finally { await cleanup(); }
});

test('a single message larger than 8 MiB survives chunking', { timeout: 60000 }, async () => {
  const { worker, cleanup } = await spawnWorker('big-single');
  try {
    const messages = await worker.getMessages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content.length, 9 * 1024 * 1024);
  } finally { await cleanup(); }
});

test('multibyte characters split across chunk boundaries decode intact', { timeout: 60000 }, async () => {
  const { worker, cleanup } = await spawnWorker('unicode');
  try {
    const messages = await worker.getMessages();
    const expected = '前'.repeat(40000) + '😀'.repeat(20000) + '後';
    // '😀' is a surrogate pair: 2 UTF-16 code units. Compare the actual string, not a
    // code-point count misapplied to .length — the transport must return identical bytes.
    assert.equal(messages[0].content, expected);
    assert.ok(messages[0].content.endsWith('後'));
    assert.ok(messages[0].content.includes('😀'));
  } finally { await cleanup(); }
});

test('out-of-order chunks reassemble correctly', { timeout: 60000 }, async () => {
  const { worker, cleanup } = await spawnWorker('shuffle');
  try {
    const messages = await worker.getMessages();
    assert.equal(messages[0].content.length, 200000);
  } finally { await cleanup(); }
});

test('a missing chunk fails by timeout instead of resolving a torn snapshot', { timeout: 60000 }, async () => {
  const { worker, cleanup } = await spawnWorker('drop');
  try {
    await assert.rejects(worker.getMessages(3000), /timed out/);
  } finally { await cleanup(); }
});

test('an inconsistent declared total fails without resolving', { timeout: 60000 }, async () => {
  const { worker, cleanup } = await spawnWorker('bad-total');
  try {
    await assert.rejects(worker.getMessages(3000), /timed out|chunk count|malformed/);
  } finally { await cleanup(); }
});

test('a dirty snapshot (branch moved mid-read) is rejected for retry', { timeout: 60000 }, async () => {
  const { worker, cleanup } = await spawnWorker('dirty');
  try {
    await assert.rejects(worker.getMessages(), /changed while the history snapshot was taken/);
  } finally { await cleanup(); }
});

test('missing bundled history command fails fast without falling back to get_messages', { timeout: 60000 }, async () => {
  const { worker, cleanup } = await spawnWorker('no-command');
  try {
    await assert.rejects(worker.getMessages(5000), /history command missing/);
  } finally { await cleanup(); }
});

// The reported race: live events ingested before a late load() must not be dropped.
// preparePrompt('hello'); accepted(); message_start; text_delta; then load() wipes the
// partial bubble; a final message_end must still land and agent_settled must complete the run.
test('live reply arriving across a history load is not lost', () => {
  const state = new SessionEvents({ id: 's', workspaceId: 'w', filePath: '/tmp/x.jsonl' }, () => 'running');
  const runId = state.preparePrompt('hello');
  state.accepted();
  state.ingest({ type: 'message_start', message: { role: 'assistant', content: [] } });
  state.ingest({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'reply' } });
  state.load([{ role: 'user', content: 'hello' }]); // snapshot arrives after the live deltas
  state.ingest({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'reply completed' }], stopReason: 'stop' } });
  state.ingest({ type: 'agent_settled' });
  const chat = state.snapshot().chat;
  assert.equal(chat.filter(m => m.role === 'user').length, 1);
  const reply = chat.find(m => m.role === 'assistant');
  assert.equal(reply?.text, 'reply completed');
  assert.equal(reply?.complete, true);
  assert.equal(state.snapshot().activeRunId, undefined);
  assert.ok(state.events.some(e => e.type === 'RunCompleted'));
});
