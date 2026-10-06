import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

// Locate the SDK belonging to the explicitly selected CLI, not an unrelated npm
// installation. Only public package exports are loaded; installed Pi is never patched.
export function resolvePiSdk(cli) {
  if (!isAbsolute(cli) || !existsSync(cli)) throw new Error('Pi CLI locator must be an absolute existing file');
  let dir = dirname(realpathSync(cli));
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      if (pkg.name === '@earendil-works/pi-coding-agent') {
        // preflightResult and awaited agent subscriptions are version-sensitive.
        // Expand this explicit compatibility list only with no-provider contract tests.
        if (!['0.99.2', '1.0.0', '1.0.2'].includes(pkg.version)) throw new Error(`Unsupported Pi SDK ${pkg.version}; Console SDK worker currently supports 0.99.2 / 1.0.0 / 1.0.2. Update the selected Pi installation (PI_CONSOLE_PI_COMMAND) to a supported version.`);
        const entry = pkg.exports?.['.']?.import;
        if (typeof entry !== 'string' || !entry.startsWith('./')) throw new Error('Pi SDK public import export unavailable');
        const path = resolve(dir, entry);
        if (!path.startsWith(dir + '/') && !path.startsWith(dir + '\\')) throw new Error('Pi SDK import escapes its package');
        if (!existsSync(path)) throw new Error('Pi SDK public entry is missing');
        return { entry: path, version: pkg.version, packageRoot: dir };
      }
    }
    const parent = dirname(dir); if (parent === dir) break; dir = parent;
  }
  throw new Error('PI_CONSOLE_PI_COMMAND must locate an installed Pi package with public SDK exports; arbitrary CLI scripts are not SDK workers');
}
