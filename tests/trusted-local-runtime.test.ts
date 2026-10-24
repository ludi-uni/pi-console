import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeManager } from '../server/runtime/manager.ts';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { SessionEvents } from '../server/runtime/events.ts';
import { localControlExpectation } from '../server/runtime/local-control-ticket.ts';
import { piWorkerEnvironment } from '../server/adapters/pi/worker-environment.ts';
test('Console environment allowlist in worker is empty; trusted Pi/provider environment and verified SDK root remain', () => {
    const parent = { HOME: 'DUMMY_HOME', OPENAI_API_KEY: 'DUMMY_PROVIDER', PI_CONSOLE_MANAGEMENT_TOKEN: 'DUMMY_OWNER', PI_CONSOLE_CONTROL_MCP_KEY: 'DUMMY_CONTROL', pi_console_readonly_mcp_key: 'DUMMY_READ', PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT: 'STALE_SDK', pi_subagents_pi_coding_agent_package_root: 'STALE_LOWERCASE_SDK', PI_OFFLINE: '1' };
    assert.deepEqual(piWorkerEnvironment(parent, 'DUMMY_VERIFIED_SDK'), { HOME: 'DUMMY_HOME', OPENAI_API_KEY: 'DUMMY_PROVIDER', PI_OFFLINE: '1', PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT: 'DUMMY_VERIFIED_SDK' });
    assert.equal(parent.PI_CONSOLE_MANAGEMENT_TOKEN, 'DUMMY_OWNER');
    assert.equal(piWorkerEnvironment(parent).PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT, undefined);
});
test('real RuntimeManager accepts only process-local capability, retains ordinary UI and stop/generation fences', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trusted-runtime-'));
    try {
        const store = new WorkspaceStore(join(root, 'workspaces.json'));
        await store.load();
        const w = await store.add(root);
        const runtime = new RuntimeManager(store, join(root, 'sessions'), join(root, 'reports'), join(root, 'queue'));
        runtime.setExternalAdmissionGuard(async () => { throw Error('OLD_ISOLATION_GATE_CLOSED'); });
        assert.equal(runtime.controlIsolationVerified(), false);
        const session = { id: 'dummy-session', workspaceId: w.id, filePath: join(root, 'dummy.jsonl') }, state = new SessionEvents(session, () => 'running'), calls: string[] = [];
        const worker = { state: 'running', call: async (name: string) => { calls.push(name); return { data: { disposition: 'started' } }; } };
        const active = { session, state, worker };
        (runtime as any).active.set(session.id, active);
        await assert.rejects(runtime.prompt(w.id, session.id, 'DUMMY', [], undefined, JSON.parse(JSON.stringify({ generation: state.generation, requestId: 'dummy', trustedLocal: true }))), /OLD_ISOLATION_GATE_CLOSED/);
        assert.deepEqual(calls, []);
        let revoked = false;
        const check = () => {
            if (revoked)
                throw Error('LOCAL_TICKET_REVOKED');
        };
        const ticket = localControlExpectation({ generation: state.generation, requestId: 'dummy' }, check);
        const run = await runtime.prompt(w.id, session.id, 'DUMMY', [], undefined, ticket);
        assert.deepEqual(calls, ['prompt']);
        assert.equal(state.activeRunId, run);
        const stop = localControlExpectation({ generation: state.generation, requestId: 'stop', runId: run }, check);
        const pause = state.pauseQueue.bind(state);
        state.pauseQueue = async () => { await pause(); revoked = true; };
        await assert.rejects(runtime.stop(w.id, session.id, stop), /LOCAL_TICKET_REVOKED/);
        assert.deepEqual(calls, ['prompt']);
        const freshState = new SessionEvents({ ...session, id: 'ordinary' }, () => 'running');
        (runtime as any).active.set('ordinary', { session: { ...session, id: 'ordinary' }, state: freshState, worker });
        let opened = 0;
        (runtime as any).open = async () => { opened++; return { worker, state: freshState }; };
        await runtime.prompt(w.id, 'ordinary', 'DUMMY_UI');
        assert.equal(opened, 1);
        assert.equal(calls.filter(x => x === 'prompt').length, 2);
        revoked = false;
        await assert.rejects(runtime.prompt(w.id, session.id, 'DUMMY', [], undefined, localControlExpectation({ generation: 'replaced', requestId: 'r' }, check)), /generation_changed/);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
