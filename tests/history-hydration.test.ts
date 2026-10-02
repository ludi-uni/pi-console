import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyReplay } from '../server/runtime/history-hydration.ts';
import { SessionEvents } from '../server/runtime/events.ts';

const user = { role: 'user', content: 'repeat', timestamp: 1 };
const answer = { role: 'assistant', content: [{ type: 'text', text: 'answer' }], timestamp: 2 };
const records = [
  { type: 'agent_start' },
  { type: 'message_end', message: user },
  { type: 'message_start', message: { role: 'assistant' } },
  { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'answer' } },
  { type: 'message_end', message: answer },
  { type: 'agent_settled' },
];
test('a completion inside the history fetch appears exactly once after buffered replay', () => {
  const state = new SessionEvents({ id: 's', workspaceId: 'w', filePath: 'unused' }, () => 'running');
  state.load([user, answer]);
  for (const record of historyReplay([user, answer], records, records.length)) state.ingest(record);
  assert.deepEqual(state.chat.map(message => message.text), ['repeat', 'answer']);
  assert.equal(state.busy, false);
});
test('identical prompt text with a new timestamp, or after the boundary, is not suppressed', () => {
  const later = { type: 'message_end', message: { ...user, timestamp: 3 } };
  assert.deepEqual(historyReplay([user], [later], 1), [later]);
  const after = { type: 'message_end', message: user };
  assert.deepEqual(historyReplay([user], [after], 0), [after]);
});
test('an in-flight partial answer crosses the boundary without losing its start or deltas', () => {
  const partial = records.slice(0, 4);
  const replay = historyReplay([user], [...partial, ...records.slice(4)], partial.length);
  const state = new SessionEvents({ id: 's', workspaceId: 'w', filePath: 'unused' }, () => 'running');
  state.load([user]);
  for (const record of replay) state.ingest(record);
  assert.deepEqual(state.chat.map(message => message.text), ['repeat', 'answer']);
});
