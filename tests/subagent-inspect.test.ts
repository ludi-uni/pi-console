import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PiProcess } from '../server/adapters/pi/process.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';

const root = 'pi-subagent-async:["run-123"]';

test('inspect command uses a correlated private widget and never sends a model prompt when extension is absent', async () => {
  const worker = new PiProcess(process.cwd());
  let prompts = 0;
  (worker as any).call = async (type: string, fields?: { message?: string }) => {
    if (type === 'get_commands') return { data: { commands: [{ name: 'subagents-inspect-rpc', source: 'extension' }] } };
    assert.equal(type, 'prompt'); prompts++;
    const requestId = fields!.message!.split(' ')[1];
    queueMicrotask(() => (worker as any).handle({ type: 'extension_ui_request', method: 'setWidget', widgetKey: 'subagent-inspect', widgetLines: [`PI_SUBAGENT_INSPECT_JSON:${JSON.stringify({ kind: 'pi-subagents.inspect-reply', version: 1, requestId: 'other', finalOutput: 'wrong' })}`] }));
    queueMicrotask(() => (worker as any).handle({ type: 'extension_ui_request', method: 'setWidget', widgetKey: 'subagent-inspect', widgetLines: [`PI_SUBAGENT_INSPECT_JSON:${JSON.stringify({ kind: 'pi-subagents.inspect-reply', version: 1, requestId, finalOutput: 'CHILD_OK' })}`] }));
    return { success: true };
  };
  assert.equal((await worker.inspectSubagent('run-123')).finalOutput, 'CHILD_OK');
  assert.equal(prompts, 1);
  (worker as any).call = async () => ({ data: { commands: [] } });
  await assert.rejects(worker.inspectSubagent('run-123'), /does not provide/);
  await assert.rejects(worker.inspectSubagent('run id'), /cannot be inspected/);
  assert.equal(prompts, 1);
});

test('inspection only accepts background nodes from the selected session', async () => {
  const manager = new RuntimeManager({ get: () => ({ id: 'w' }) } as any);
  const calls: string[][] = [];
  const worker = { inspectSubagent: async (...args: string[]) => { calls.push(args); return { finalOutput: 'CHILD_OK' }; } };
  const node = { id: root, nativeId: 'run-123', sourceKind: 'pi-subagents' };
  (manager as any).open = async (_workspace: string, session: string) => ({ worker, state: { execution: { snapshot: () => ({ nodes: session === 's' ? [node] : [] }) } } });
  assert.equal((await manager.inspectSubagent('w', 's', root)).finalOutput, 'CHILD_OK');
  assert.deepEqual(calls, [['run-123', undefined]]);
  await assert.rejects(manager.inspectSubagent('w', 'other', root), /not available/);
  await assert.rejects(manager.inspectSubagent('w', 's', 'pi-subagent-async:["foreign"]'), /not available/);
});
