// Loaded into every Pi worker spawned by pi-console (server/adapters/pi/process.ts passes
// --extension <this file>). Its only job is to enforce a tool-free reply while the console is
// saving an orchestrator final report into this Pi session.
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
}
