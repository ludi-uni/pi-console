import { startConsole } from '../package/launcher.mjs';
import { ensureStartupOnPiSession } from '../package/startup-manager.mjs';

export default function piConsole(pi) {
  let running;
  let startupChecked=false;
  pi.on('session_start',async (_event,ctx)=>{
    if(ctx.mode!=='tui'||startupChecked)return;
    startupChecked=true;
    try{await ensureStartupOnPiSession()}catch(error){ctx.ui.notify(`pi-console Startup registration failed: ${error.message}`,'error')}
  });
  pi.registerCommand('pi-console', {
    description: 'Start the loopback pi-console Web UI (a separate Pi RPC session)',
    handler: async (args, ctx) => {
      const option = args.trim();
      if (option === 'stop') {
        if (running?.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGTERM');
        running = undefined;
        ctx.ui.notify('pi-console stopped', 'info');
        return;
      }
      if (option && !/^\d{1,5}$/.test(option)) {
        ctx.ui.notify('Usage: /pi-console [port|stop]', 'error');
        return;
      }
      if (running?.child.exitCode === null && running.child.signalCode === null && !running.child.killed) {
        ctx.ui.notify(`pi-console is already running at ${running.url}`, 'info');
        return;
      }
      try {
        running = await startConsole({ cwd: ctx.cwd, env: { ...process.env, ...(option ? { PORT: option } : {}) } });
        ctx.ui.notify(`Open ${running.url} — choose a workspace and session to connect to Pi. The Web UI runs a separate Pi RPC worker, not this TUI session.`, 'info');
      } catch (error) {
        ctx.ui.notify(`pi-console could not start: ${error.message}${/EADDRINUSE/.test(error.message) ? ' — use /pi-console <free-port> or stop the existing server first.' : ''}`, 'error');
      }
    },
  });
  pi.on('session_shutdown', () => {
    if (running?.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGTERM');
    running = undefined;
  });
}
