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
        // preflightResult and awaited agent subscriptions are version-sensitive. The
        // contract is verified against the latest release (1.4.0) and bounded to the
        // strict stable-semver range >=0.99.2 <=1.4.0; intermediate releases inside the
        // range are expected but not individually executed, prereleases and newer
        // majors/minors are refused. Widen the bound only with a no-provider contract test.
        const v = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(pkg.version ?? ''))?.slice(1).map(Number);
        const supported = !!v && v.every(Number.isSafeInteger) &&
          (v[0] === 0 && (v[1] > 99 || v[1] === 99 && v[2] >= 2) || v[0] === 1 && (v[1] < 4 || v[1] === 4 && v[2] === 0));
        if (!supported) throw new Error(`Unsupported Pi SDK ${pkg.version}; Console SDK worker currently supports stable 0.99.2–1.4.0. Update the selected Pi installation (PI_CONSOLE_PI_COMMAND) to a supported version.`);
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
