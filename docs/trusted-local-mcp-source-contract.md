# Trusted-local MCP source contract

Status: source implementation, default OFF, not deployed. The source-only D: application
was authorized and completed on 2026-10-11; distribution/runtime activation is separate.
Pi, its SDK, extensions,
and same-user code are trusted. OS isolation remains **unverified**. pi-warden is
frozen and is not a prerequisite for this mode. This change does not authorize
production activation, credential setup, grants, Tunnel changes, or a restart.

## Composition and entrypoints

`server/index.ts` keeps one existing `RuntimeManager`, stores and final-owner
composition. Its explicit `TrustedLocalMcpConfig` is `{enabled:false}`. The local
owner addition reads only the fixed, explicitly provisioned disabled profile in
the trusted Console data directory. It does not search for credentials, generate
them automatically, enable MCP from that profile, or add an install hook.
All credentials must be distinct 64-character lower-case hex strings, including
the optional local-owner key, and distinct from the explicitly supplied complete
legacy credential list. Configuration and credentials expire closed.

`createTrustedLocalMcp(runtime, permissions, receipts, paths, config)` provides
`handle`, `handleOwner`, `handleOwnerScope`, `ownerRequest`, `status`, `view`,
`bind`, `disable`, `dispose`. `trustedLocalConfigured` is a pure composition
preflight; it is not OS evidence. `startTrustedLocalListener(app, port, publicPort)`
requires a configured app and a fixed valid port distinct from the public port,
binds only literal IPv4 `127.0.0.1`, and refuses errors without another address or
port fallback. The source-only candidate is 31719; deployment must separately
confirm port ownership and routing before using it.

The dedicated listener accepts exact `/mcp/dots` only. It does not mount UI,
management shutdown, workspace APIs, legacy `/mcp/readonly`, queries, or absolute
request targets. Authenticated OAuth metadata aliases return no metadata. Bind
metadata, actual socket address/port, exact Host and single role credential are
checked; browser, proxy and Access headers are denied. Loopback is not proof of
caller identity, so every private request still needs the dedicated credential.
The package is not a general localhost/IPC or process sandbox.

Public `denyPublicMcp` unconditionally returns 404 for MCP, OAuth discovery,
legacy external-control APIs, and encoded/normalized aliases for all methods,
before ordinary UI routes. A loopback cloudflared peer cannot open this entry.
The public listener retains Host, Access JWT, Origin/POST and UI/API protections.
Management identity/shutdown retains its separate existing proof mechanism.
This implementation does not prove effective Access or Tunnel configuration.

## Protocol and permissions

Only the existing modern `2026-07-28` adapter contract is accepted for read/control:
JSON-RPC 2.0 POST, JSON content type, JSON + SSE Accept, matching
`MCP-Protocol-Version`, `MCP-Method`, and `MCP-Name` headers, and explicit `_meta`
protocol/client-capabilities objects. No `initialize`/ping or version fallback.
Actual Dots compatibility is unconnected and must be established separately.

| Role | Dedicated header | Tools / disclosure |
| --- | --- | --- |
| read | `x-pi-console-readonly-key` | `get_status`, `get_progress`; existing status scope |
| control | `x-pi-console-control-key` | `submit_instruction`, `start_execution`, `cancel_instruction`, `stop_execution`, `get_request` |
| final | `x-pi-console-dots-read-key` | Existing final-owner adapter and its own exact saved-final scope |

Control requires both the existing `WorkspacePermissions` control scope and a
new explicit, expiring grant for exact instance, permission revision, workspace,
session and observed generation. Final-read approval remains separate; control
never grants final text, aggregate disclosure or session history. The final
producer continues to require its existing SDK/producer support and saved ACK;
this work does not change SDK 1.1.0 into verified final-producer support.

The local control capability is an opaque process-local WeakMap entry, issued by
trusted server composition and consumed by the existing runtime. JSON booleans,
HTTP fields and `controlIsolationVerified=false` cannot mint it. Runtime admission,
prompt dispatch, stop/pause boundaries and response release recheck authority and
exact generation. It is a permission for trusted application code, not protection
against malicious JavaScript executing in the server process.

Instruction staging rejects slash-command entry. Existing bounded durable
`PromptReceipts` bind request IDs to target/action/payload digest. Concurrent or
accepted retries do not redispatch; acknowledgement uncertainty stays uncertain,
including after restart. Stop retries preserve exact run binding. Authority
revocation after dispatch suppresses success but cannot roll back work already
accepted by Pi. The owner UI never automatically resends an unknown save.

`get_request` depends on process-local staging. After restart, or when its binding
cannot be matched, the trusted-local service returns a successful, explicit
`{requestId,state:"unknown",runId:null,reason:"request_binding_unavailable",retryAllowed:false}`
only after current credential, local grant, base scope and observed generation
admission. Old instance/generation/grant requests remain denied. This is not a
claim that the request never ran. Existing receipts contain only the payload hash,
state and run ID; the original instruction is unavailable for scoped binding
verification, so lookup does not infer a result from the UUID or restore staging.
The owner may explicitly reread local owner status and, with the separate read
credential/current scope, `get_status`/`get_progress` for observed state. No lookup
automatically sends an instruction, opens a worker, grants a scope or calls final
disclosure. A fresh execution must not be inferred from unknown. Existing accepted
or uncertain durable receipts continue to prevent duplicate dispatch; the legacy
adapter's missing-binding refusal is unchanged.

## Owner and lifetime

Owner endpoints are public-UI POSTs under `/api/local-mcp/`:
`status`, `review`, `cancel`, `save`, `result`. They require the existing browser
CSRF gates plus either an additional local-owner credential, or an exact pinned
Access interactive subject from the JWT verifier's branded principal. Unverified
headers/objects, another valid Access subject, service tokens, issuer/audience
mismatch, expired proof or duplicate critical headers cannot authorize an owner.
No real subject or credential loader is supplied in this change.

Review is bounded to 60 seconds; grant expiry is at most 24 hours and never beyond
credential expiry. Save requires explicit confirmation and CAS revision. The
additional grant store uses bounded 64-entry outcomes, exclusive locks, fsync and
atomic replacement. Corrupt state/save failure/capacity exhaustion disables local
authority. Full receipts are deliberately not pruned to enable unsafe replay;
future capacity maintenance requires a separate, reviewed policy. Locks do not
have automatic stale recovery. A new process epoch leaves persisted grants
inactive, requiring fresh explicit approval. Disable, listener close and dispose
invalidate tickets and reviews. They do not stop an already accepted Pi run.

Status explicitly reports `mode:trusted-local`, `workerTrust:trusted`, and
`osIsolation:unverified`. `active` describes the current authenticated listener,
not an OS boundary or an approved control grant. A credential/store failure is
never promoted to isolation readiness. `dispose` clears key buffers, but does not
promise secure erasure of JavaScript strings or defense against trusted Pi.

Worker spawning strips the whole Console-owned `PI_CONSOLE_*` environment
namespace; its allowlist is empty. Existing trusted Pi/provider environment stays
available, and the resolved SDK root is supplied explicitly. This is not a full
worker environment allowlist or a guarantee that same-user Pi cannot read host
secrets. Management stores and owner configuration are kept in the server role.

## Verified scope and application

The approved dummy tests use dedicated Temp stores, dynamic loopback-only ports,
dummy credentials/RS256 keys, fake worker/producer, and the actual runtime/control/
final-owner services. An application-level test guard forbids external sockets,
non-loopback binds and arbitrary child launches; it is not OS sandbox evidence.
Browser acceptance uses a static in-memory Vite bundle and a dedicated Temp Edge
profile, with desktop/mobile review, cancellation, explicit confirmation, lost
save acknowledgement/result inspection and revocation. Loss injection commits the
exact browser POST body through the dummy authenticated owner fixture; normal
review/result/revoke requests use the actual browser and owner middleware.

Supplemental no-spawn acceptance connects the real RuntimeManager, SessionEvents,
FinalAnswerJournal, durable PromptReceipts, permissions and both HTTP adapters in
one composition. A fixed fake worker records its prompt only after the real pending
receipt exists and returns a dummy started ACK. The test loses the start HTTP reply,
inspects accepted state, injects dummy saved-final/settled events into the real
journal, explicitly grants final disclosure separately and reads that exact final
over HTTP. Runtime open is forbidden and never called. Separate restart cases
construct new runtime/permission/authority instances with the same Temp receipt
directory, require explicit fresh owner scopes, return unknown without staging
restoration, and prove accepted/uncertain receipts do not redispatch. A static AST
check confirms literal default OFF, shared runtime and conditional private startup.
These three tests supplement the original 37 unique tests; no additional browser,
esbuild or real SDK/producer test was run for this supplement.

Use the accompanying `run-safe.py` and reports for the scoped acceptance command
and environment. The default broad `npm test` was not run: it includes native,
SDK, installer, Tunnel and startup paths outside this authorization. No dependency
was installed; the existing dependency tree was copied. Build output is separate
from the original Console distribution. This patch is against the recorded
uncommitted 0.5.2 baseline, not a reset to Git HEAD. That original C: evidence is
preserved; the subsequent D: source-only application is recorded below.

Source application has now been authorized and completed. Before production
activation, obtain scoped authorization for credential/owner binding,
deployment/restart and individual grants. First confirm
the actual Dots client can call this authenticated literal-loopback modern protocol,
the running Console build identity, exact verified Access owner/all-route coverage,
and effective Tunnel routing that exposes only the UI port with no alternative
route to the MCP port. Live provider/SDK-final compatibility requires its own
approval. Nothing here automatically protects directly launched Pi applications.

## Local owner entry and separate MCP credential provisioning

The gaps were both browser owner authentication and a protected MCP client key
configuration entry. The added `pi-console owner-login` command reuses the trusted
managed-server launcher. It first requires an interactive input/output terminal
and explicit `yes`. It validates the existing manager's challenge-signed identity,
including recorded PID/start timestamp and current startup nonce. It does not
start/restart the server, inspect process lists, use the clipboard, export the
management token, or retry an uncertain response. After explicit terminal `yes`,
the CLI now opens the verified nonsecret literal IPv4-loopback authentication URL
in the Windows default browser. The code stays in the trusted terminal; the owner
must enter it. Opener failure leaves the URL for manual use. Arbitrary URLs,
privileged/invalid ports, URL credentials/query/fragment and host aliases are
rejected before browser invocation. The opener receives an explicit ordinary
environment allowlist, never Pi/MCP/provider secret variables.

`requestManagedOwnerLogin({env})` is a trusted-manager API. Its domain-separated
HMAC binds `/api/manage/local-owner/open` to the current nonce and a unique request
ID. The authenticated reply returns the new code once to that caller. It is not a
public credential endpoint. Manager requests require actual IPv4 loopback socket
addresses, an exact single Host, no Origin/fetch-site/proxy headers and a single
proof. Old nonce, wrong domain, reused request ID, missing setup and disposal deny
issuance. The bounded 64-outcome set is retained for the current process; it never
replays codes. No real management token was read or exercised during verification.

`createLocalOwnerBootstrap` lazily owns a separate ephemeral `127.0.0.1` listener.
Its nonsecret URL is `/local-owner/`. Static HTML/JS contain no code or keys. Only
this listener mounts the local owner UI, authentication, credential provisioning,
and the prefixed limited permission/grant/final-owner services. It has no MCP,
shutdown, runtime prompt, workspace file, or general management API. The public
UI static allowlist excludes `owner.html`; the new owner/session proof cannot be
used on the public listener. Existing public Access/Host/Origin gates and the
unconditional MCP/OAuth denial are retained. Remote owner setup is a separate
explicit composition; local owner login is not a replacement for public Access.

The 256-bit single-use code expires after 120 seconds and is entered in a password
input. Eight invalid attempts exhaust it. A successful exchange consumes it and
sets a random process-specific, HttpOnly, SameSite=Strict cookie scoped to
`/local-owner`, with a ten-minute absolute lifetime. At most eight sessions are
active. The cookie is verified only against this listener's native address/port
and exact Origin/Host/fetch-site, never by localhost or a static admin header.
Logout, expiry, dispose and process restart revoke it. For existing permission
handlers, the admin header remains a CSRF protocol marker in addition to this
session proof. Status/result disclosure rechecks the session after await; profile
save also rechecks immediately before atomic rename. An already committed write
cannot be rolled back by logout or a lost reply; the owner inspects its request ID.
The bootstrap listener is tracked before listen and awaited/closed on disposal,
including a concurrent startup/dispose race.

The cookie uses literal-loopback HTTP and consequently does not claim a Secure
TLS cookie. HTTP cookies are not port scoped, and a malicious same-user process
can read the manager/profile or host another loopback service. This mode assumes
trusted same-user code/Pi and does not protect credentials against it. HttpOnly,
Origin and random cookie names are web admission measures, not an OS boundary.

The authenticated owner enters three distinct, explicitly prepared 64-hex keys
for the MCP client's read/control/final roles, expiry (at most 24 hours), and an
explicit confirmation. These are separate from the manager token, bootstrap code,
owner cookie and supplied legacy credentials. The UI clears secret inputs before
sending and stores only the nonsecret pending request ID. The server never returns
the keys in status, result, errors or HTML. It does not generate/export/distribute
keys, configure a client, create scopes, dispatch Pi, or start a private listener.
The same client role headers defined above must be supplied separately by the
owner's future authenticated loopback client; browser owner login does not supply
them to MCP. Actual Dots client header support is still unverified.

`LocalOwnerProfile` persists only to `<Console data>/trusted-local-credentials.json`
with `enabled:false`, strict schema, revision CAS, at most 64 durable outcomes,
exclusive lock, fsync and atomic rename. The startup composition may read valid
unexpired role keys from this exact profile but still has literal default OFF.
Malformed/enabled/symlink/hardlink/oversize state, stale revision, missing
confirmation, duplicate/reserved keys, invalid expiry and write failures deny
provisioning. Windows `mode:0600` does not establish a separate ACL boundary; no
ACLs are changed. Locks/capacity are not automatically repaired or pruned.

For an approved future deployment: run `pi-console owner-login` in a trusted local
terminal, explicitly confirm code display/browser opening and enter the code in
the local authentication page. Review/save separate MCP keys only in that protected
owner session. MCP activation/restart, client credential supply/connection and
individual control/final grants each remain separately authorized actions. This
source implementation has not performed any of those real-environment operations.

### Approved Startup and owner CLI update (2026-10-11)

The current user's exact managed `Pi Console.lnk` entry is migrated from the
reviewed 0.6.0 installation to `D:\Develop\pi-console\package\startup.mjs`, using
the ordinary existing startup manager after explicit backup/ownership checks.
The Node target and managed marker remain the standard ones. Startup resolves the
same stable configuration, explicitly overrides legacy read-only MCP to `0`, and
uses the existing installed Pi CLI. If ordinary launcher resolution cannot find
Pi, its existing public managed release selector/package manifest is checked;
no Pi is installed or executed during resolution. Invalid/missing selector, code,
manifest or explicit override refuses startup. Neither existing active Console
nor owner sessions are restarted to apply these CLI/Startup-only changes.

Fixture tests and actual shortcut metadata verification are recorded separately.
No PC restart or real one-time code/browser/client/credential operation is part
of this source verification. Full error/log tails are not forwarded by Startup.

## Local owner verification and review

Twenty-three focused dummy HTTP/source tests cover setup/proof/nonce/replay,
CSRF/native boundary, cookie expiry/logout/restart, bounded issuance, disposal
during startup, masked key CAS/outcomes and expiry while awaiting disclosure,
actual permission/MCP owner handlers while default OFF, and the trusted manager
helper against dummy state/token/identity. One additional real-browser test covers
desktop/mobile login, HttpOnly, separate key entry, lost save reply, page reload
with only a pending ID, masked result and logout. The prior browser acceptance is
also rerun. Total unique coverage is 64: prior 40 plus 23 HTTP/source and one new
browser case. Test reruns and two viewports are not additional unique cases.

The manual source review followed issuance -> cookie -> owner middleware ->
profile save/load -> MCP preflight -> worker environment. Findings fixed before
final regression were incorrect built-asset prefix, strict result ID validation,
post-await session expiry, the disposal/startup race, legacy key initialization
order, unavailable-control text and missing launcher declarations. The focused
RED proof retains the first three security/asset failures and subsequent harness
schema/assertion failures separately. No test success is production or OS evidence.

## D: source-only application (2026-10-11)

The accepted integrated implementation was applied to D:\Develop\pi-console,
preserving its existing uncommitted 0.5.2 source baseline. All 246 recorded source
preimages were backed up and matched before application; only the 37 intended
source files were written. Three dummy test evidence-directory guards now accept
an explicit trusted reports root so verification can write to the approved C:
artifact directory from a D: cwd. Both compared paths normalize Windows separators.
This is a test harness portability change; product/authentication behavior is the
accepted C: implementation. This contract's application status is also updated.

Verification executes the applied D: sources with an explicit system environment
allowlist and dedicated Temp fixtures. The build imports the actual Vite config
with envFile:false/configFile:false and writes to a separate C: output. Existing
D: dist is not replaced. No running instance is stopped/restarted or asserted to
have adopted this source. Local owner login, real keys, MCP activation, client
connection and grants still require their separate real-environment steps. The
prior C: 64-case evidence and earlier cleanup unknowns remain distinct records.
