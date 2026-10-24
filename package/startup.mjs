// Launched by the current user's Windows Startup shortcut, never by the Pi RPC worker.
// Goes through the shared detached-server manager, so a login start joins the same state,
// lock and log as /pi-console and the CLI — and a managed server already running from an
// earlier session is reused instead of duplicated.
import { startManagedServer } from './server-manager.mjs';
import { startupEnvironment } from './startup-environment.mjs';
import { startupFailureMessage } from './startup-error.mjs';
try {
  await startManagedServer({env:await startupEnvironment()});
} catch (error) {
  console.error(startupFailureMessage(error));
  process.exitCode = 1;
}
