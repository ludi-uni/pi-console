// Launched by the current user's Windows Startup shortcut, never by the Pi RPC worker.
// Goes through the shared detached-server manager, so a login start joins the same state,
// lock and log as /pi-console and the CLI — and a managed server already running from an
// earlier session is reused instead of duplicated.
import { startManagedServer } from './server-manager.mjs';
import {startupEnvironment} from './startup-environment.mjs';
try {
  await startManagedServer({env:await startupEnvironment()});
} catch (error) {
  // Manager startup errors may contain a log tail. Never forward it or settings.
  const reason=/^pi-console exited during startup \((\d+|signal)\)/.exec(error?.message??'')?.[0]
    ?? /^pi-console startup timed out after \d+ms/.exec(error?.message??'')?.[0]
    ?? (error?.message==='Managed Pi installation unavailable; Startup refused without reinstall or fallback execution'?'managed Pi installation unavailable':'startup refused');
  const code=/^[A-Z][A-Z0-9_]{1,40}$/.test(error?.code??'')?` (${error.code})`:'';
  console.error(`pi-console startup: ${reason}${code}`);
  process.exitCode = 1;
}
