import { startManagedServer, stopManagedServer, restartManagedServer, managedServerStatus } from '../package/server-manager.mjs';
import { ensureStartupOnPiSession } from '../package/startup-manager.mjs';

const usage = 'Usage: /pi-console [start [port]|stop|restart [port]|status|port]';
const parsePort = text => /^\d{1,5}$/.test(text) && Number(text) >= 1 && Number(text) <= 65535 ? Number(text) : undefined;

const describe = result => {
  if (result.status === 'running') {
    const owner = result.managed ? '' : ' · started outside this manager (stop it from that process)';
    return `running at ${result.url ?? `http://127.0.0.1:${result.port}`} · pid ${result.pid ?? '?'} · port ${result.port}${owner}`;
  }
  if (result.status === 'port-in-use') return `port ${result.port} is already used by a different program`;
  if (result.status === 'stale') return `stale state for pid ${result.pid} on port ${result.port}; another start or stop will clean it up`;
  if (result.status === 'stopping') return `pid ${result.pid} did not exit within the shutdown window`;
  return 'stopped';
};

export default function piConsole(pi) {
  let startupChecked = false;
  pi.on('session_start', async (_event, ctx) => {
    if (ctx.mode !== 'tui' || startupChecked) return;
    startupChecked = true;
    try { await ensureStartupOnPiSession(); } catch (error) { ctx.ui.notify(`pi-console Startup registration failed: ${error.message}`, 'error'); }
  });
  pi.registerCommand('pi-console', {
    description: 'Manage the background pi-console Web UI server (start [port]|stop|restart [port]|status|port)',
    handler: async (args, ctx) => {
      const words = args.trim().split(/\s+/).filter(Boolean);
      const [command, extra] = words;
      if (words.length > 2 || (extra !== undefined && parsePort(extra) === undefined)) { ctx.ui.notify(usage, 'error'); return; }
      try {
        if (command === 'stop') {
          const result = await stopManagedServer({});
          ctx.ui.notify(`pi-console: ${describe(result)}${result.error ? ` — ${result.error}` : ''}`, result.error ? 'error' : 'info');
          return;
        }
        if (command === 'restart') {
          const result = await restartManagedServer({ port: parsePort(extra) });
          ctx.ui.notify(result.status === 'running'
            ? `pi-console restarted at ${result.url} — active Web sessions were interrupted; reload the browser`
            : `pi-console: ${describe(result)}${result.error ? ` — ${result.error}` : ''}`, result.status === 'running' ? 'info' : 'error');
          return;
        }
        if (command === 'status') { ctx.ui.notify(`pi-console: ${describe(await managedServerStatus({}))}`, 'info'); return; }
        if (command === 'port') { ctx.ui.notify(`pi-console port: ${(await managedServerStatus({})).port ?? 31717}`, 'info'); return; }
        // Bare invocation, 'start', or the legacy `/pi-console <port>` form.
        const port = parsePort(extra) ?? (command === 'start' || command === undefined ? undefined : parsePort(command));
        if (command !== undefined && command !== 'start' && port === undefined) { ctx.ui.notify(usage, 'error'); return; }
        const result = await startManagedServer({ port });
        if (result.status === 'running') {
          ctx.ui.notify(result.changed
            ? `Open ${result.url} — the server keeps running after Pi exits; use /pi-console stop to shut it down.`
            : `pi-console is already ${describe(result)}`, 'info');
        } else {
          ctx.ui.notify(`pi-console: ${describe(result)}`, 'error');
        }
      } catch (error) {
        ctx.ui.notify(`pi-console could not start: ${error.message}`, 'error');
      }
    },
  });
  // Intentionally no session_shutdown kill: the server is an independent background
  // process that survives Pi exit and reload; /pi-console stop manages it.
}
