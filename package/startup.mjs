// Launched by the current user's Windows Startup shortcut, never by the Pi RPC worker.
// Goes through the shared detached-server manager, so a login start joins the same state,
// lock and log as /pi-console and the CLI — and a managed server already running from an
// earlier session is reused instead of duplicated.
import { startManagedServer } from './server-manager.mjs';
try {
  await startManagedServer();
} catch (error) {
  // Startup runs without a console; record the failure in the shared log tail location.
  console.error(`pi-console startup: ${error.message}`);
  process.exitCode = 1;
}
