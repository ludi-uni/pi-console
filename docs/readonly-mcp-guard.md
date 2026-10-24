# Fixed read-only local guard

The official Windows tunnel-client v0.0.15 forwarded a dummy authentication
header on a same-origin metadata 307 redirect to another path. The guarded
launcher replaces the direct configuration for future live secret trials.

## Added trust boundary

Future route: Dots → official client → 127.0.0.1:31718 guard → 127.0.0.1:31717 pi-console.

The new guard is IPv4 loopback only and requires exactly one matching dedicated
X-Pi-Console-Readonly-Key. It shares pi-console's private key, creates no account,
public port, tunnel, workspace/session or execution capability. Same-user,
SYSTEM and administrator limitations remain. The server, guard and tunnel
retain key copies until they exit; deleting the file alone does not revoke them.

Only three exact origin-form routes are accepted, without query strings or
encoded/alternate paths, absolute URLs or other methods:

| Route | Method | Fixed upstream |
| --- | --- | --- |
| /mcp/readonly | POST | same route at literal 127.0.0.1:31717 |
| /.well-known/oauth-protected-resource/mcp/readonly | GET | same route at literal 127.0.0.1:31717 |
| /.well-known/oauth-protected-resource | GET | same route at literal 127.0.0.1:31717 |

The existing loopback-peer, literal Host, Origin, Cloudflare and Fetch Metadata
checks are retained. Proxy-header presence requires authentication; its values
never establish identity and are discarded. Routing/method/channel override
headers are rejected. No request chooses a URL. Only protocol headers,
JSON Content-Type/Accept and the independently configured key are regenerated
for the fixed upstream; caller Host/Authorization/cookies/forwarding headers
are not relayed.

RPC forwarding permits discovery, catalog, the existing three readonly tools,
legacy initialization/ping and harmless notifications. The upstream still
validates immutable scope, opaque IDs, generation and run ownership. There are
no browser APIs, result files, prompt, execution, approval or stop tools.

Node http.request never follows redirects. Every upstream 300–399 becomes a
fixed 502. Location/Refresh/WWW-Authenticate/cookies are never relayed.
Metadata accepts only a fixed upstream 404 and returns static absence; other
statuses fail closed. Responses are bounded and key reflection is rejected.
Each response closes its HTTP connection; no transport session is retained.
Limits: 16 KiB body, 8 requests, 5-second body/upstream timeout, 2 MiB response.
Rejected bytes are discarded without parsing, retaining or logging content.

Official caller header override remains physically possible. Empty, wrong and
duplicate auth overrides fail closed at the guard (401). This does not make
client headers immutable, nor provide general DoS resistance.

## Fixed launcher and lifecycle

The prepared start-readonly-auth.ps1 imports ReadOnlyGuardedLaunch.psm1 and uses
a new INACTIVE readonly-guarded.yaml. The currently running profile/launcher
remain untouched. Do not use the previous direct ReadOnlyAuthLaunch.psm1.

Before any key read, SHA256 pins verify the official binary, complete profile,
reviewed guard/auth/helper source and approved scope. Exact child argv fixes
main only, the full guard URL, same tunnel ID and disabled harpoon/public UI/raw
logging. Child environment is cleared and only role-required names are allowed.
The same checks run immediately before each child start. Drift aborts; pin
updates require a separate review. This prevents ordinary configuration drift,
not arbitrary same-user code modification. Node/tsx remain local dependencies.

An existing health file blocks launch before key reads. After upstream
attestation with redirects disabled, the launcher starts its own guard,
requires that child's readiness marker and matching scoped identity through
the guard, then prompts for the runtime API key and starts its tunnel.
Parent credential entries are cleared after child creation; output is not
displayed or saved. Q/Ctrl+C/failure stop only children created by this launcher.
Guard exit stops its tunnel. No other instance, port owner or Pi worker is killed.

## Future operator trial (not performed by installing code)

1. Review the diff and separately approve live key/config setup and an idle
   restart window. Confirm ownership and no active work/report/uncertain queue
   across the whole instance; scoped counters cannot establish global idle.
2. Run the masked [manual setup](readonly-mcp-auth.md). It creates the protected
   file and appends only PI_CONSOLE_READONLY_MCP_AUTH=shared_secret. No restart
   or scope expansion occurs.
3. Restart only the owned target on 31717. Confirm management ownership, literal
   binding and approved scope. Privately authenticate reads and update
   target-attestation.json with new opaque IDs; never select another/newest session.
4. Stop the old tunnel using Q in its own terminal. Its cleanup must remove its
   health file. Investigate stale state first; do not delete it blindly or run
   another poller.
5. Verify future port 31718 is unused. Preview, then use the guarded launcher:

~~~powershell
& 'C:\Users\leade\Documents\Codex\2026-10-05\task\secure-mcp-readonly\start-readonly-auth.ps1' -Preview
& 'C:\Users\leade\Documents\Codex\2026-10-05\task\secure-mcp-readonly\start-readonly-auth.ps1'
~~~

Preview reads neither key and starts no process/listener. Actual launch reads
the private dedicated file and requests the Restricted runtime key through
masked input (Tunnels Read + Use). Never put either key into chat/argv/YAML/logs.
The new listener and actual launch still need separate live approval.

6. Check ready 200 / OAuth not_advertised, then Dots discovery, exactly three
   tools and approved target. Read status/sessions/progress and confirm no worker
   start/scope expansion. Metadata redirects intentionally yield ready 503;
   do not relax the guard to make them ready.
7. Q stops owned tunnel/guard. The private file persists until manual rotation/
   deletion. Revoke/rotate cached keys in all three processes. Removing only
   server auth mode restores legacy unauthenticated local reads; disable MCP
   to revoke those too.

## Verification

- server/readonly-mcp-guard.ts: fixed routing, dedicated auth, shared native
  checks, no redirect following, fixed/sanitized failures.
- scripts/readonly-mcp-guard.ts: frozen production listener/upstream, no URL/
  port/channel argv or config override, required env-only key.
- tests/readonly-mcp-guard.test.ts: all 300–399 across three routes, auth/path/
  method/routing rejection, body bounds/reflection, no redirected request.
- tests/readonly-tunnel.test.ts: actual hash-pinned client, temporary mock
  control plane and dummy guard. Discovery/catalog/three reads succeed;
  runtime/metadata redirects on same/other origin are blocked; other channels
  never reach guard; caller auth overrides fail closed. Previous leak test now
  passes with zero capture requests.
- tests/readonly-launch.test.ts and dummy PS fixture: profile/source/scope/
  URL/channel/argv/env changes rejected before key reads; final check and parent
  cleanup. No production child starts.

Live Dots E2E, account permissions and user-entered real key remain unverified.
No real key, live config, listener 31718 or process restart has been applied.

