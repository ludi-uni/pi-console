import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { consoleDataDir } from './data-directory.mjs';

/** Read only the operator-owned, stable Console .env, never the current workspace's.
 * Resolve the file using the incoming environment, then merge with explicit environment
 * values taking precedence (including empty strings). Do not mutate the host Pi process.
 */
export async function loadConsoleEnvironment(env = process.env) {
  const path = join(consoleDataDir(env), '.env');
  let values;
  try { values = parseEnv(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { ...env }; throw error; }
  return { ...values, ...env };
}
