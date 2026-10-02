// Loaded into every Pi worker spawned by pi-console (server/adapters/pi/process.ts passes
// --extension <this file>). It has two jobs:
//   1. Enforce a tool-free reply while the console saves an orchestrator final report.
//   2. Serve `pi-console-history-rpc`: return the full projected session messages to the
//      console as correlated, bounded setWidget chunks so the Pi RPC 8 MiB record limit
//      cannot drop large histories (a single >8 MiB message included).
//
// The console wraps the report prompt between two session-name sentinels via set_session_name:
//   <pi-console:kit-report:N>   — arm: every tool call must be blocked
//   <pi-console:done:NAME>      — disarm and restore NAME
// Blocking happens inside Pi, so it holds even if the model ignores the prompt's "do not use
// tools" instruction. A blocked call returns an error tool result to the model instead of
// executing; the model can still answer with text afterwards.
//
// Safety: 'agent_settled' and 'session_start' always disarm, so a stale marker left by a crash
// cannot wedge the session into a permanently tool-less state.

const ARM_PREFIX = '<pi-console:kit-report:';
const MAX_TOOL_BLOCKS = 16; // Bound retries so a stubborn model cannot loop forever.
const HISTORY_PREFIX = 'PI_CONSOLE_HISTORY_JSON:';
// One JSON record per widget line must stay under both the console's 65536-char line check
// and Pi's 8 MiB stdout record limit; 48 KiB of base64 per chunk leaves ample headroom.
const HISTORY_CHUNK_CHARS = 49152;

export default function piConsoleSession(pi) {
  let armed = false;
  let blocked = 0;

  const disarm = () => { armed = false; blocked = 0; };

  const applyName = name => {
    if (typeof name === 'string' && name.startsWith(ARM_PREFIX)) { armed = true; blocked = 0; }
    else disarm();
  };

  pi.on('session_start', () => applyName(pi.getSessionName?.()));

  pi.on('session_info_changed', event => applyName(event?.name));

  pi.on('tool_call', () => {
    if (!armed) return;
    if (++blocked > MAX_TOOL_BLOCKS) return { block: true, terminate: true, reason: 'pi-console report turn already blocked too many tool calls; stop and answer with text only' };
    return { block: true, reason: 'This turn is a saved orchestrator report. Do not run tools; reply with the report summary as plain text.' };
  });

  pi.on('agent_settled', () => disarm());

  // Internal command invoked by the console as `/pi-console-history-rpc <requestId>`.
  // Snapshots the authoritative projected messages (active branch + compaction + context
  // edits, same list `get_messages` returns for a settled session) and replies through
  // single-line setWidget records correlated by requestId. No model calls, no transcript
  // writes, no tools — it only reads sessionManager and emits fire-and-forget widgets.
  pi.registerCommand('pi-console-history-rpc', {
    description: 'internal: stream the projected session messages to pi-console',
    handler: async (args, ctx) => {
      const requestId = String(args ?? '').trim();
      if (!/^[A-Za-z0-9_.:-]{1,256}$/.test(requestId)) { ctx.ui.notify('pi-console-history-rpc: invalid request id', 'error'); return; }
      const leafBefore = ctx.sessionManager.getLeafId();
      const sessionId = ctx.sessionManager.getSessionId();
      const projection = ctx.sessionManager.buildSessionProjection();
      // If the branch moved while we read it, mark the snapshot dirty so the console
      // retries instead of trusting a torn read.
      const dirty = ctx.sessionManager.getLeafId() !== leafBefore;
      const payload = Buffer.from(JSON.stringify({
        kind: 'pi-console.history', version: 1, requestId, sessionId,
        leafId: leafBefore, dirty, messages: projection.messages,
      }), 'utf8').toString('base64');
      const total = Math.max(1, Math.ceil(payload.length / HISTORY_CHUNK_CHARS));
      for (let seq = 0; seq < total; seq++) {
        const data = payload.slice(seq * HISTORY_CHUNK_CHARS, (seq + 1) * HISTORY_CHUNK_CHARS);
        ctx.ui.setWidget('pi-console-history', [HISTORY_PREFIX + JSON.stringify({
          kind: 'pi-console.history-chunk', version: 1, requestId, seq, total, data,
        })]);
      }
      ctx.ui.setWidget('pi-console-history', undefined); // Clear the widget after transport.
    },
  });
}
