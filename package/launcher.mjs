import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { consoleDataDir } from './data-directory.mjs';
import { loadConsoleEnvironment } from './environment.mjs';
import { fileURLToPath } from 'node:url';

const serverEntry = fileURLToPath(new URL('../server/index.ts', import.meta.url));
const piCliSuffix = /[\\/]@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]bundle[\\/]cli\.js$/i;

export function hostPiCli(argv = process.argv) {
  const entry = argv[1];
  return entry && isAbsolute(entry) && piCliSuffix.test(entry) && existsSync(entry) ? entry : undefined;
}

/** Start only when explicitly requested; loading the Pi extension has no side effects. */
export async function startConsole({ cwd = process.cwd(), env = process.env, timeoutMs = 10000 } = {}) {
  env = await loadConsoleEnvironment(env);
  const port = Number(env.PORT ?? 31717);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  const childEnv = {
    ...env,
    PI_CONSOLE_DATA_DIR: consoleDataDir(env),
    // The host Pi binary is authoritative; do not guess a different globally installed version.
    PI_CONSOLE_PI_COMMAND: env.PI_CONSOLE_PI_COMMAND || hostPiCli() || '',
  };
  if (!childEnv.PI_CONSOLE_PI_COMMAND) throw new Error('Pi CLI not found; set PI_CONSOLE_PI_COMMAND to the absolute cli.js path');
  if (!isAbsolute(childEnv.PI_CONSOLE_PI_COMMAND) || !existsSync(childEnv.PI_CONSOLE_PI_COMMAND))
    throw new Error('PI_CONSOLE_PI_COMMAND must point to an existing absolute Pi cli.js');
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), serverEntry], {
    cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const cleanup = () => { clearTimeout(timer); child.stdout.off('data', stdout); child.stderr.off('data', stderr); child.off('error', fail); child.off('exit', exited); };
      const fail = (error) => { cleanup(); reject(error); };
      const stdout = (data) => { output = (output + data.toString()).slice(-4096); if (output.includes(`pi-console ${url}`)) { cleanup(); resolve(); } };
      const stderr = (data) => { output = (output + data.toString()).slice(-4096); };
      const exited = (code) => fail(new Error(`pi-console failed to start (${code}): ${output.trim().slice(-500)}`));
      const timer = setTimeout(() => fail(new Error(`pi-console startup timed out: ${output.trim().slice(-500)}`)), timeoutMs);
      child.stdout.on('data', stdout); child.stderr.on('data', stderr); child.once('error', fail); child.once('exit', exited);
    });
    child.stdout.resume(); child.stderr.resume();
    return { child, url: childEnv.PI_CONSOLE_PUBLIC_ORIGIN || url };
  } catch (error) {
    if (child.exitCode === null) child.kill();
    throw error;
  }
}
