/** Pi is trusted. Preserve its existing provider/runtime environment while keeping
 * Console management/MCP configuration in the server role. The allowlist for
 * Console-owned variables in a worker is empty; this is not OS isolation. */
export function piWorkerEnvironment(parent: NodeJS.ProcessEnv, sdkRoot?: string): NodeJS.ProcessEnv {
    const worker = Object.fromEntries(Object.entries(parent).filter(([name]) => !name.toUpperCase().startsWith('PI_CONSOLE_') && name.toUpperCase() !== 'PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT'));
    if (sdkRoot)
        worker.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT = sdkRoot;
    return worker;
}
