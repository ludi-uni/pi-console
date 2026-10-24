// Do not forward arbitrary errors: the manager can include server log tails.
export function startupFailureMessage(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const reason = /^pi-console exited during startup \((\d+|signal)\)/.exec(message)?.[0]
    ?? /^pi-console startup timed out after \d+ms/.exec(message)?.[0]
    ?? 'startup refused';
  return `pi-console startup: ${reason}`;
}
