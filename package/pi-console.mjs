#!/usr/bin/env node
// Packaged CLI: `node package/pi-console.mjs [start|stop|restart|status|port <n>]` or
// `scripts\pi-console.ps1 <command>` from any working directory. All commands manage the
// same detached, user-owned pi-console server via ./server-manager.mjs; they never start an
// interactive session and never touch a server started by an older Pi Console version.
import { startManagedServer, stopManagedServer, restartManagedServer, managedServerStatus } from './server-manager.mjs';

const usage = `Usage: pi-console [command]

Commands:
  start            start the detached server (no-op if already running)
  start <port>     start on a specific port (1-65535)
  stop             stop the managed server started by start/restart/Startup
  restart          stop then start the managed server (interrupts active Web sessions)
  restart <port>   restart on a specific port
  status           show running/stopped state, PID, port and URL
  port             print the configured port
  help             show this message

State, the management token and server.log live in the Console data directory
(~/.pi/agent/pi-console by default), not in the package. PORT and remote settings are
read from <data>/.env unless overridden by the environment or a numeric argument.`;

const describe = result => {
  if (!result) return '';
  if (result.status === 'running') {
    const owner = result.managed ? 'managed' : 'unmanaged (started outside this manager)';
    return `running at ${result.url ?? `http://127.0.0.1:${result.port}`} · pid ${result.pid ?? '?'} · port ${result.port} · ${owner}`;
  }
  if (result.status === 'port-in-use') return `port ${result.port} is already used by a different program; choose another port`;
  if (result.status === 'stale') return `stale state for pid ${result.pid} on port ${result.port}; the process is ${result.pidAlive ? 'alive but not a managed pi-console' : 'gone'} — run start/stop to clean up`;
  if (result.status === 'stopping') return `pid ${result.pid} did not exit in time`;
  return `stopped${result.port ? ` · port ${result.port}` : ''}`;
};

async function main() {
  const [command, extra, ...rest] = process.argv.slice(2);
  if (rest.length) { console.error(`unexpected argument: ${rest[0]}\n`); console.error(usage); process.exitCode = 2; return; }
  if (extra !== undefined && !/^\d{1,5}$/.test(extra)) { console.error('port must be an integer from 1 to 65535'); process.exitCode = 2; return; }
  if (extra !== undefined && command !== 'start' && command !== 'restart') { console.error(`a port argument is only valid for start/restart`); process.exitCode = 2; return; }
  const port = extra === undefined ? undefined : Number(extra);
  if (port !== undefined && (port < 1 || port > 65535)) { console.error('port must be an integer from 1 to 65535'); process.exitCode = 2; return; }
  switch (command ?? 'start') {
    case 'start': {
      const result = await startManagedServer({ port });
      console.log(`pi-console: ${describe(result)}${result.note ? ` (${result.note})` : ''}`);
      if (result.status === 'port-in-use') process.exitCode = 1;
      return;
    }
    case 'stop': {
      const result = await stopManagedServer({});
      console.log(`pi-console: ${describe(result)}${result.note ? ` (${result.note})` : ''}`);
      if (result.error) { console.error(`pi-console: ${result.error}`); process.exitCode = 1; }
      return;
    }
    case 'restart': {
      const result = await restartManagedServer({ port });
      console.log(`pi-console: ${describe(result)}${result.note ? ` (${result.note})` : ''}`);
      if (result.error || result.status === 'port-in-use' || result.status !== 'running') { if (result.error) console.error(`pi-console: ${result.error}`); process.exitCode = 1; }
      return;
    }
    case 'status': {
      const result = await managedServerStatus({});
      console.log(`pi-console: ${describe(result)}${result.note ? ` (${result.note})` : ''}`);
      return;
    }
    case 'port': {
      // Reflects the running server's port, else the stable .env/environment PORT.
      const status = await managedServerStatus({});
      console.log(status.port ?? 31717);
      return;
    }
    case 'help': case '--help': case '-h': console.log(usage); return;
    default:
      if (/^\d{1,5}$/.test(command) && Number(command) >= 1 && Number(command) <= 65535) {
        const result = await startManagedServer({ port: Number(command) });
        console.log(`pi-console: ${describe(result)}${result.note ? ` (${result.note})` : ''}`);
        if (result.status === 'port-in-use') process.exitCode = 1;
        return;
      }
      console.error(`unknown command: ${command}\n\n${usage}`);
      process.exitCode = 2;
  }
}

main().catch(error => { console.error(`pi-console: ${error.message}`); process.exitCode = 1; });
