/** Keep Console-owned management/configuration out of trusted Pi workers.
 * Provider/runtime variables are preserved. This is not OS-level isolation. */
export function piWorkerEnvironment(parent: NodeJS.ProcessEnv, sdkRoot?: string): NodeJS.ProcessEnv {
  const worker = Object.fromEntries(Object.entries(parent).filter(([name]) =>
    !name.toUpperCase().startsWith('PI_CONSOLE_') && name.toUpperCase() !== 'PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT'));
  if (sdkRoot) worker.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT = sdkRoot;
  return worker;
}
