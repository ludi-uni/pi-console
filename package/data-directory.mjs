import { homedir } from 'node:os';
import { join } from 'node:path';

/** Keep package-managed metadata outside the replaceable npm installation. */
export function consoleDataDir(env = process.env) {
  return env.PI_CONSOLE_DATA_DIR || join(env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'pi-console');
}
