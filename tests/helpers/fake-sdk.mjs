// Offline SDK double. It never imports a provider or invokes a real model/tool.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
export const getAgentDir = () => process.env.PI_CODING_AGENT_DIR;
export class SettingsManager { static create() { return { getGlobalSettings: () => ({}) }; } }
export class ProjectTrustStore { get() { return null; } }
export const hasTrustRequiringProjectResources = () => false;
export const createCodemodeExtension = () => () => {};
export const createToolSearchExtension = () => () => {};
export const createMcpExtension = () => () => {};
export class SessionManager {
  static create(cwd, dir) { mkdirSync(dir, { recursive: true }); const file = join(dir, 'fake-sdk.jsonl'); if (!existsSync(file)) writeFileSync(file, JSON.stringify({ type: 'session', id: 'fake-sdk', cwd }) + '\n'); return this.open(file); }
  static open(file) { return { file, getLeafId: () => 'leaf', getSessionId: () => 'fake-sdk', buildSessionProjection: () => ({ messages: current.messages }) }; }
}
let current;
export async function createAgentSessionServices(options) { return { ...options, diagnostics: [] }; }
export async function createAgentSessionFromServices({ sessionManager }) {
  const listeners = [], pressure = [], controller = new AbortController(); let release;
  const emit = async event => { for (const fn of listeners) fn(event); for (const fn of pressure) await fn(event, controller.signal); };
  const commands = [{ invocationName: 'pi-console-history-rpc' }];
  current = {
    sessionManager, sessionId: 'fake-sdk', sessionFile: sessionManager.file, messages: [], isStreaming: false,
    promptTemplates: [], resourceLoader: { getSkills: () => ({ skills: [] }) }, modelRuntime: { getAvailableSnapshot: () => [] },
    extensionRunner: { getRegisteredCommands: () => commands },
    agent: { subscribe(fn) { pressure.push(fn); return () => pressure.splice(pressure.indexOf(fn), 1); } },
    subscribe(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    async bindExtensions(bindings) { this.bindings = bindings; },
    getSessionStats: () => ({}), getAvailableThinkingLevels: () => ['off'], clearQueue: () => ({}),
    setThinkingLevel(level) { this.thinkingLevel = level; }, setSessionName(name) { this.sessionName = name; },
    async waitForIdle() {}, async reload() {}, async steer() { return 'queued'; },
    async abort() { if (this.isStreaming) { this.isStreaming = false; controller.abort(); await emit({ type: 'agent_settled' }); release?.(); } },
    async prompt(text, options) {
      if (text === '/reject') { await new Promise(r => setTimeout(r, 20)); throw Error('preflight refused'); }
      if (text === '/slow') await new Promise(r => setTimeout(r, 40));
      options.preflightResult('started'); this.isStreaming = true;
      await emit({ type: 'agent_start' });
      if (text === '/slow') return new Promise(resolve => { release = resolve; });
      if (options.images) await emit({ type: 'fake_images', data: options.images[0].data });
      const content = 'x'.repeat(9 * 1024 * 1024) + '日本😀';
      const message = { role: 'assistant', timestamp: 1, content: [{ type: 'text', text: content }], stopReason: 'stop' };
      await emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
      await emit({ type: 'message_update', message, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'preview', partial: message } });
      await emit({ type: 'tool_execution_end', toolCallId: 't', toolName: 'fake', result: { content: [{ type: 'text', text: content }] }, isError: false });
      this.messages.push(message); await emit({ type: 'message_end', message });
      await emit({ type: 'agent_end', messages: [message, message] }); this.isStreaming = false;
      await emit({ type: 'agent_settled' });
    },
    dispose() {},
  };
  return { session: current };
}
export async function createAgentSessionRuntime(factory, options) {
  const created = await factory(options); return { session: created.session, setRebindSession() {}, async dispose() { await created.session.abort(); } };
}
