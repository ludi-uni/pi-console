// Console-owned isolated Pi SDK host. Native .mjs: no added runtime dependency.
import { randomUUID } from 'node:crypto';
import { FinalAnswerEvidence } from './final-answer-evidence.mjs';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { FrameDecoder, FrameLineReader, TransportWriter, QUEUED_BYTES, waitForPressure } from './worker-transport.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const generation = option('--generation');
// Keep extension console.log/process.stdout.write out of the protocol, as CLI RPC
// does. Direct native writes to fd1 remain unsupported and fail framing visibly.
const rawWrite = process.stdout.write.bind(process.stdout);
const protocolOutput = new Writable({ write(chunk, encoding, callback) { rawWrite(chunk, encoding, callback); } });
process.stdout.write = process.stderr.write.bind(process.stderr);
const writer = new TransportWriter(protocolOutput, generation);
let runtime, session, stopping = false, unsubscribe, unsubscribePressure;
let abortEpoch = 0, commandCount = 0, commandBytes = 0;
let activeConsoleRunId, pendingConsoleRunId;
const finalEvidence = args.includes('--final-answer-evidence') ? new FinalAnswerEvidence() : undefined;
const consoleRunIdValid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const checkRunFence = command => {
  if (command.expectedConsoleRunId !== undefined && (!consoleRunIdValid(command.expectedConsoleRunId) || command.expectedConsoleRunId !== activeConsoleRunId)) throw new Error('control_run_not_active');
};
const checkNativeIdle = command => {
  if (!command.requireIdle) return;
  // Verified against SDK 1.0.2: no streamingBehavior queues, and the synchronous
  // started hook immediately precedes _runAgentPrompt's active-run assignment.
  if (option('--sdk-version') !== '1.0.2') throw new Error('native_admission_sdk_unverified');
  if (command.streamingBehavior !== undefined || !Number.isSafeInteger(command.nativeAdmissionDeadline) || Date.now() > command.nativeAdmissionDeadline) throw new Error('native_admission_expired');
  if (session.isStreaming !== false || session.isCompacting !== false || session.pendingMessageCount !== 0) throw new Error('native_session_not_idle');
};
const emit = value => writer.send(value).catch(fatal);
const identityTheme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text, italic: text => text, underline: text => text, dim: text => text, inverse: text => text, strikethrough: text => text, getFgAnsi: () => '', getBgAnsi: () => '' };
const ui = {};
for (const name of ['select', 'input', 'editor', 'custom']) ui[name] = async () => undefined;
ui.confirm = async () => false; // Unsupported interactive dialogs fail closed immediately.
for (const name of ['setWorkingMessage', 'setWorkingVisible', 'setWorkingIndicator', 'setHiddenThinkingLabel', 'setFooter', 'setHeader', 'addAutocompleteProvider', 'setEditorComponent', 'setToolsExpanded']) ui[name] = () => {};
ui.onTerminalInput = () => () => {};
ui.theme = identityTheme; ui.getAllThemes = () => []; ui.getTheme = () => undefined;
ui.getEditorText = () => ''; ui.getEditorComponent = () => undefined; ui.getToolsExpanded = () => false;
ui.setTheme = () => ({ success: false, error: 'Theme switching not supported in Console worker' });
const uiEvent = (method, extra) => emit({ type: 'extension_ui_request', id: randomUUID(), method, ...extra });
ui.notify = (message, notifyType) => uiEvent('notify', { message, notifyType });
ui.setStatus = (statusKey, statusText) => uiEvent('setStatus', { statusKey, statusText });
ui.setWidget = (widgetKey, widgetLines, options) => { if (widgetLines === undefined || Array.isArray(widgetLines)) return uiEvent('setWidget', { widgetKey, widgetLines, widgetPlacement: options?.placement }); };
ui.setTitle = title => uiEvent('setTitle', { title });
ui.setEditorText = text => uiEvent('set_editor_text', { text }); ui.pasteToEditor = ui.setEditorText;

export function jsonEvent(event) {
  if (event.type !== 'message_update') return event;
  const { partial, ...delta } = event.assistantMessageEvent;
  if (delta.type === 'toolcall_start') {
    const tool = partial?.content?.[delta.contentIndex];
    if (tool?.type !== 'toolCall') throw new Error('invalid SDK toolcall_start');
    delta.id = tool.id; delta.toolName = tool.name;
  }
  return { type: 'message_update', usage: event.message.usage, assistantMessageEvent: delta };
}
async function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  decoder.close(); writer.close(); // release awaited stream pressure before aborting SDK
  unsubscribe?.(); unsubscribePressure?.();
  const deadline = setTimeout(() => process.exit(code || 1), 3000); deadline.unref();
  try { await session?.abort(); await runtime?.dispose(); } catch { code = code || 1; }
  // Keep the unref'd deadline: leaked extension handles must not prevent exit.
  process.exitCode = code; process.stdin.destroy(); protocolOutput.destroy();
}
function fatal(e) {
  if (stopping) return;
  // Do not log payloads, images, prompts or credentials.
  process.stderr.write(`Console SDK worker failed: ${e instanceof Error ? e.message : 'unknown error'}\n`);
  void shutdown(1);
}
process.stdout.on('error', fatal); protocolOutput.on('error', fatal);
process.on('SIGTERM', () => { void shutdown(); });
const reader = new FrameLineReader();
const decoder = new FrameDecoder({ generation, onError: fatal });
let shutdownRequested = false;
const remotePending=new Map();
if(option('--remote-desktop-package'))globalThis[Symbol.for('pi-console.remote-desktop.invoke')]=(request,signal)=>{
 if(!activeConsoleRunId||remotePending.size>=8||signal?.aborted)return Promise.resolve({ok:false,error:'remote_run_authority_required',outcome:'KNOWN'});
 const requestId=randomUUID();
 return new Promise(resolve=>{const abort=()=>{void emit({type:'console_remote_desktop_cancel',requestId});remotePending.delete(requestId);clearTimeout(timer);resolve({ok:false,error:'remote_aborted_no_retry',outcome:'UNKNOWN'});};const finish=result=>{signal?.removeEventListener('abort',abort);resolve(result);};const timer=setTimeout(()=>{remotePending.delete(requestId);signal?.removeEventListener('abort',abort);void emit({type:'console_remote_desktop_cancel',requestId});resolve({ok:false,error:'remote_timeout_no_retry',outcome:'UNKNOWN'})},95000);remotePending.set(requestId,{resolve:finish,timer});void emit({type:'console_remote_desktop_request',requestId,runId:activeConsoleRunId,request});signal?.addEventListener('abort',abort,{once:true});});
};
async function bind() {
  unsubscribe?.(); unsubscribePressure?.(); session = runtime.session;
  // Capture startup/extension events as well as model activity.
  unsubscribe = session.subscribe(event => {
    // Autonomous extension starts cannot inherit authority for an old Console run.
    if (event.type === 'agent_start') { activeConsoleRunId = pendingConsoleRunId; pendingConsoleRunId = undefined; if (!activeConsoleRunId) finalEvidence?.reset(); }
    finalEvidence?.observe(event);
    if (event.type === 'agent_settled') {
      const proof = finalEvidence?.finish(session.sessionManager); if (proof) void emit(proof);
      activeConsoleRunId = undefined; pendingConsoleRunId = undefined;
    }
    void emit(jsonEvent(event));
    if (event.type === 'agent_settled' && shutdownRequested) void writer.flush().then(() => shutdown()).catch(fatal);
  });
  unsubscribePressure = session.agent.subscribe((_event, signal) => waitForPressure(writer, signal));
  await session.bindExtensions({ mode: 'rpc', uiContext: ui,
    commandContextActions: {
      waitForIdle: () => session.waitForIdle(),
      // Console owns session identity. A slash command may not silently rebind the
      // browser/queue to a different session. Explicit Console navigation creates workers.
      newSession: async () => { throw new Error('Create sessions through Console'); },
      switchSession: async () => { throw new Error('Switch sessions through Console'); },
      fork: async () => { throw new Error('Forking through this Console worker is not supported'); },
      navigateTree: async () => { throw new Error('Tree navigation through this Console worker is not supported'); },
      reload: async () => { await session.reload(); },
    },
    shutdownHandler: () => { shutdownRequested = true; },
    onError: e => { void emit({ type: 'extension_error', extensionPath: e.extensionPath, event: e.event, error: e.error }); },
  });
}
// SDK factories otherwise trust project resources by default. Resolve trust before
// project settings/packages load, using public SDK state and bootstrap-only hooks.
async function projectTrusted(sdk, cwd, agentDir, settings, { extensionsResult }) {
  if (!sdk.hasTrustRequiringProjectResources(cwd)) return true;
  for (const extension of extensionsResult.extensions) {
    for (const handler of extension.handlers.get('project_trust') ?? []) {
      let result;
      try { result = await handler({ type: 'project_trust', cwd }, { cwd, mode: 'rpc', hasUI: true, ui }); }
      catch (e) { await emit({ type: 'extension_error', extensionPath: extension.path, event: 'project_trust', error: e.message }); continue; }
      if (!result) continue;
      if (!['yes', 'no'].includes(result.trusted)) throw new Error('Invalid project trust extension decision');
      if (result.remember === true) throw new Error('Remember project trust in Pi CLI before opening Console');
      return result.trusted === 'yes';
    }
  }
  const decision = new sdk.ProjectTrustStore(agentDir).get(cwd);
  return decision ?? settings.getGlobalSettings().defaultProjectTrust === 'always';
}
const state = () => ({ model: session.model, thinkingLevel: session.thinkingLevel, isStreaming: session.isStreaming, isCompacting: session.isCompacting,
  steeringMode: session.steeringMode, followUpMode: session.followUpMode, sessionFile: session.sessionFile, sessionId: session.sessionId,
  sessionName: session.sessionName, autoCompactionEnabled: session.autoCompactionEnabled, messageCount: session.messages.length, pendingMessageCount: session.pendingMessageCount,
  remoteDesktopTools:option('--remote-desktop-package')?session.getAllTools().filter(t=>t.name.startsWith('remote_')).map(t=>t.name):[] });
async function command(c) {
  if (stopping) return;
  if (!c || typeof c.type !== 'string' || typeof c.id !== 'string' || c.id.length > 256) throw new Error('invalid Console command');
  const respond = (success, data, error) => emit({ type: 'response', id: c.id, command: c.type, success, data, error });
  try {
    switch (c.type) {
      case 'remote_desktop_result': {const pending=remotePending.get(c.requestId);if(pending){remotePending.delete(c.requestId);clearTimeout(pending.timer);pending.resolve(c.result);}return respond(true);}
      case 'prompt': {
        checkNativeIdle(c);
        let accepted = false, admissionOpen = true; const epoch = abortEpoch;
        // Retain command accounting until its authoritative ACK, not run completion.
        // State/abort commands stay concurrent, including during slow input handlers.
        return await new Promise(resolve => {
          void session.prompt(c.message, { images: c.images, streamingBehavior: c.streamingBehavior, source: 'rpc',
            preflightResult: disposition => {
              if (c.requireIdle) {
                if (!admissionOpen || disposition !== 'started') throw new Error('native_admission_closed');
                checkNativeIdle(c);
              }
              if (disposition === 'started' && (stopping || shutdownRequested || epoch !== abortEpoch)) throw new Error('Prompt interrupted before acceptance');
              if (disposition === 'started') {
                activeConsoleRunId = pendingConsoleRunId = consoleRunIdValid(c.consoleRunId) ? c.consoleRunId : undefined;
                if (activeConsoleRunId) finalEvidence?.start(activeConsoleRunId, session.sessionManager);
              }
              accepted = true; void respond(true, { disposition }).finally(resolve);
            },
          }).then(() => { if (!accepted) { admissionOpen = false; void respond(false, undefined, 'SDK did not report prompt acceptance').finally(resolve); } })
            .catch(e => { admissionOpen = false; if (!accepted) void respond(false, undefined, e.message).finally(resolve); else fatal(e); });
        });
      }
      case 'steer': return respond(true, { disposition: await session.steer(c.message, c.images, { source: 'rpc' }) });
      case 'abort': checkRunFence(c); abortEpoch++; await session.abort(); return respond(true);
      case 'clear_queue': checkRunFence(c); return respond(true, session.clearQueue());
      case 'get_state': return respond(true, state());
      case 'get_history': {
        const manager = session.sessionManager, leafId = manager.getLeafId();
        const messages = manager.buildSessionProjection().messages;
        return respond(true, { sessionId: manager.getSessionId(), leafId, dirty: manager.getLeafId() !== leafId, messages });
      }
      case 'get_commands': {
        const commands = session.extensionRunner.getRegisteredCommands().map(c => ({ name: c.invocationName, description: c.description, source: 'extension', sourceInfo: c.sourceInfo }));
        for (const template of session.promptTemplates) commands.push({ name: template.name, description: template.description, source: 'prompt', sourceInfo: template.sourceInfo });
        for (const skill of session.resourceLoader.getSkills().skills) commands.push({ name: `skill:${skill.name}`, description: skill.description, source: 'skill', sourceInfo: skill.sourceInfo });
        return respond(true, { commands });
      }
      case 'get_available_models': return respond(true, { models: session.modelRuntime.getAvailableSnapshot() });
      case 'get_available_thinking_levels': return respond(true, { levels: session.getAvailableThinkingLevels() });
      case 'get_session_stats': return respond(true, session.getSessionStats());
      case 'set_model': {
        const model = session.modelRuntime.getAvailableSnapshot().find(m => m.provider === c.provider && m.id === c.modelId);
        if (!model) throw new Error('Model not found'); await session.setModel(model); return respond(true, model);
      }
      case 'set_thinking_level': session.setThinkingLevel(c.level); return respond(true);
      case 'set_session_name': if (typeof c.name !== 'string' || !c.name.trim()) throw new Error('Session name cannot be empty'); session.setSessionName(c.name.trim()); return respond(true);
      default: throw new Error(`Unsupported Console operation: ${c.type}`);
    }
  } catch (e) { return respond(false, undefined, e.message); }
  finally { if (shutdownRequested && !session.isStreaming) void writer.flush().then(() => shutdown()).catch(fatal); }
}
async function main() {
  const sdk = await import(pathToFileURL(option('--sdk-entry')).href);
  const required = ['createAgentSessionServices', 'createAgentSessionFromServices', 'createAgentSessionRuntime', 'SessionManager', 'getAgentDir', 'createCodemodeExtension', 'createToolSearchExtension', 'createMcpExtension', 'SettingsManager', 'ProjectTrustStore', 'hasTrustRequiringProjectResources'];
  for (const name of required) if (typeof sdk[name] !== 'function') throw new Error(`Pi SDK export unavailable: ${name}`);
  const cwd = process.cwd(), agentDir = sdk.getAgentDir();
  const sessionManager = option('--session') ? sdk.SessionManager.open(option('--session'), option('--session-dir')) : sdk.SessionManager.create(cwd, option('--session-dir'));
  const create = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    const settingsManager = sdk.SettingsManager.create(cwd, agentDir, { projectTrusted: false });
    const services = await sdk.createAgentSessionServices({ cwd, agentDir, settingsManager,
      resourceLoaderReloadOptions: { resolveProjectTrust: options => projectTrusted(sdk, cwd, agentDir, settingsManager, options) },
      resourceLoaderOptions: {
      additionalExtensionPaths: [option('--extension'),...(option('--remote-desktop-package')?[option('--remote-desktop-package')]:[])],
      extensionFactories: [
        { name: 'codemode', builtin: true, factory: sdk.createCodemodeExtension({ mode: 'on' }) },
        { name: 'tool_search', builtin: true, factory: sdk.createToolSearchExtension() },
        { name: 'mcp', builtin: true, factory: sdk.createMcpExtension() },
      ],
    } });
    const created = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent });
    return { ...created, services, diagnostics: services.diagnostics };
  };
  runtime = await sdk.createAgentSessionRuntime(create, { cwd, agentDir, sessionManager });
  runtime.setRebindSession(bind);
  await bind();
  if(option('--remote-desktop-package')&&globalThis[Symbol.for('pi-console.remote-desktop.registered')]!==true)throw Error('remote_package_tool_registration_failed');
  if (!session.extensionRunner.getRegisteredCommands().some(c => c.invocationName === 'pi-console-history-rpc')) throw new Error('Console safety extension did not load');
  await writer.send({ type: 'console_ready', protocolVersion: 1, sdkVersion: option('--sdk-version'), sessionId: session.sessionId,remoteDesktop:option('--remote-desktop-package')?true:undefined, capabilities: ['chunked-records', 'direct-history', 'preflight-ack'] });
  process.stdin.on('data', chunk => {
    try { for (const frame of reader.push(chunk)) {
      const c = decoder.accept(frame); if (!c) continue;
      const bytes = decoder.lastRecordBytes;
      if (commandCount >= 64 || commandBytes + bytes > QUEUED_BYTES) throw new Error('Console command resource limit exceeded');
      commandCount++; commandBytes += bytes;
      void command(c).catch(fatal).finally(() => { commandCount--; commandBytes -= bytes; });
    } } catch (e) { fatal(e); }
  });
  process.stdin.on('error', fatal);
  process.stdin.on('end', () => { try { reader.finish(); decoder.finish(); void shutdown(); } catch (e) { fatal(e); } });
  process.stdin.resume();
}
void main().catch(fatal);
