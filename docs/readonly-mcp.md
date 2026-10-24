# Read-only MCP (opt-in)

`POST /mcp/readonly` is a small stateless, JSON-response Streamable HTTP endpoint
inside the existing pi-console server. It shares that server's RuntimeManager;
it never creates another manager, starts/resumes a Pi worker, polls the kit,
dispatches a prompt, restores a queue/report or changes persistence.

It is OFF unless `PI_CONSOLE_READONLY_MCP=1` is supplied at server startup.
Unset, empty and `0` mean OFF; other values fail startup. Enabling it requires an
operator-approved configuration/startup operation. Merely installing this code
does not enable or change an already running server. No additional port is used.

Enabling also requires a fixed `<PI_CONSOLE_DATA_DIR>/readonly-mcp-scope.json`:
`{"version":1,"workspaces":[{"id":"registered-workspace-id","path":"canonical-absolute-path","sessionIds":["existing-session-id"]}]}`.
This operator-owned allowlist is validated and copied at startup. Missing,
empty, oversized or invalid scope fails startup. Only these registered workspace
and session IDs are returned. The registered path and its current canonical
path must both match the rule; registry or filesystem drift fails closed.
The MCP has no API for creating or expanding this scope or selecting the newest
session automatically. Runtime counts have `coverage: observed_scope_only`;
they omit every other workspace/session and cannot prove the whole server idle.

## Local connection boundary

The endpoint accepts only a native HTTP client connected from IPv4 loopback,
with literal `Host: 127.0.0.1:<the server port>`. Requests with Origin,
Cloudflare, or cross-site Fetch Metadata headers are rejected. Proxy headers
are also rejected in default native mode. The optional dedicated shared-secret
mode permits proxy header presence only after successful authentication;
all other boundaries stay intact. See [authentication and manual setup](readonly-mcp-auth.md).
There is no CORS.
This gate is independent of the existing browser Host/JWT/Origin gate; normal
browser APIs still require exactly the same authentication as before.

When enabled, the same native loopback gate also handles only GET on
`/.well-known/oauth-protected-resource/mcp/readonly` and
`/.well-known/oauth-protected-resource`. It returns a static, no-store 404:
this MCP does not advertise OAuth metadata. Query parameters are rejected and
other methods receive 405. Neighboring paths are not intercepted; when OFF,
metadata paths keep their original routing. No browser Host/JWT/Origin gate is
changed and no runtime operation is called by these absence responses.

In default native mode, any local process capable of making loopback requests can read these
limited projections. Opaque IDs prove target identity, not caller authorization.
This endpoint is NOT authenticated for public exposure. Do not proxy it directly
to the Internet or relax the browser gates to make it accessible.

For a future Dots connection, an authorized tunnel/bridge should fetch only this
loopback path and enforce its own remote authentication, caller permissions and
target scope. Native mode cannot accept relayed forwarding headers; a bridge
that includes them requires the separately configured dedicated shared-secret
mode. Browser/Origin/Cloudflare headers remain forbidden in both modes.
The existing echo tunnel E2E has already succeeded; this pi-console endpoint's
tunnel end-to-end reads remain unverified. The pinned official
client's HTTP compatibility is tested with a temporary loopback control plane,
a dummy key and an isolated scoped RuntimeManager; that is not a Dots E2E test.

## MCP contract

Supported protocol versions are `2025-03-26`, `2025-06-18` and `2026-07-28`. Legacy initialization with
another version returns `2025-06-18` for negotiation. An unsupported explicit
`MCP-Protocol-Version` header is rejected. POST requires JSON Content-Type and
Accept with both `application/json` and `text/event-stream`. Responses are JSON;
GET/DELETE return 405 (no SSE stream or MCP transport session). Initialized and
cancelled notifications receive empty 202; cancellation has no runtime effect.
There are no resources, prompts, subscriptions, approval or execution tools.

The sessionless `2026-07-28` path implements `server/discover`, `tools/list` and
`tools/call` following the official Go SDK v1.7.0 contracts for SEP-2575/SEP-2243.
Each request requires matching `Mcp-Protocol-Version` and
`params._meta["io.modelcontextprotocol/protocolVersion"]`, an object-valued
`io.modelcontextprotocol/clientCapabilities`, and matching `Mcp-Method` (plus
`Mcp-Name` for tool calls). Optional client identity is validated and never echoed.
Successful results carry `resultType: "complete"` and server identity in `_meta`.
Discovery and tool listings use `ttlMs: 0`, `cacheScope: "private"`. Unsupported
modern versions return HTTP 400 / JSON-RPC -32022 with supported/requested
versions; header mismatches return 400 / -32020, invalid parameters 400 / -32602,
and missing methods 404 / -32601. Legacy response semantics are preserved.
Initialize and ping are legacy-only. No subscriptions, client callbacks, prompts,
elicitation, automatic version retry or mutation capabilities are advertised.
References: [SDK validation](https://github.com/modelcontextprotocol/go-sdk/blob/v1.7.0/mcp/shared.go),
[HTTP headers](https://github.com/modelcontextprotocol/go-sdk/blob/v1.7.0/mcp/streamable_headers.go),
[server results](https://github.com/modelcontextprotocol/go-sdk/blob/v1.7.0/mcp/server.go).

Hard native rejections retain the same access conditions. Their HTTP 403 response
includes only fixed `denialReasons` classifications and an
`X-Pi-Console-Mcp-Denial` header: `peer_not_loopback`, `host_mismatch`,
`origin_present`, `proxy_header_present`, `cloudflare_header_present`,
`fetch_site_denied`; authentication failures use fixed HTTP 401 and
`mcp_auth_failed`. Server stderr emits one `readonly_mcp_native_denial` event
per distinct reason combination per server lifetime (at most 127), containing
only these codes. Neither headers' values/names nor URLs, body, credentials,
conversation or tool arguments are logged. Diagnosis reads no rejected body.
Classifications do not authenticate requests. Only the dedicated auth gate
permits proxy-header presence, without trusting any forwarded values.
The actual remote denial can only be classified after an approved restart and
a new discovery request; fixture classifications cannot identify past requests.

The legacy implementation follows the MCP [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
and [tool contract](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

| Tool | Inputs | Output |
| --- | --- | --- |
| `get_status` | `{}` | Process-lifetime `serverId`, version/start time, runtime counts and opaque workspace IDs (at most 100). |
| `list_sessions` | `serverId`, `workspaceId`; optional `limit`, `offset` | Opaque session IDs, worker observation, generation and observed run targets. |
| `get_progress` | Exact `serverId`, `workspaceId`, `sessionId`, `generation`, `runId`; optional `limit`, `offset` | Selected run's structured node tree, status counts, sequence and timestamps. |

Call `get_status`, then `list_sessions`, then copy an exact listed target into
`get_progress`. IDs are opaque HMAC handles, stable only during this MCP server
instance. A new server instance or session projection requires rediscovery.
`generation` and `runId` must be present, even when null. Null runId is valid only
when the session has no observed run targets. Runs are never inferred from the
current browser selection, the newest run, or another session in the same repo.
No raw workspace/session/run/tool IDs, names, paths, conversation, commands,
tool arguments/output, model/provider, reports, error text or environment are
returned. The limited output deliberately does not identify projects by name;
a human must establish the desired opaque target before relying on it.

`unobserved` means the session header exists but there is no live in-memory
projection (for example unopened/closed or after restart). It is not completion.
`starting`/`closing` suppress incomplete projections. `disconnected` returns
cached observations, with `currentStatus: unknown`; cached completed nodes do
not prove current completion. Even `live` means the worker is running and these
are its latest projection values, not a fresh kit query. Consult node timestamps
and truncation flags. Only explicit parent ancestry is attributed to a run;
unattached or unrelated nodes are excluded.

Bounds: 16 KiB request body, eight concurrent MCP requests, page size 1–100,
offset 0–1000, 1024 session-storage entries per scan, 4096 bytes per header,
1024 returned session candidates, 5000 observed nodes, and 20 listed run targets.
Oversized/skipped scans and capped node pages report truncation; unreadable or
malformed storage reports `scanUnavailable`. No arbitrary file/path input exists.
Reconnection repeats pure reads; no runtime command or automatic recovery runs.

## Verification and operational follow-up

`tests/readonly-mcp.test.ts` covers protocol discovery, default OFF, loopback/Host/
Origin/proxy guards, bounds, opaque target/ownership/generation checks, content
leak prevention, unknown/disconnected state, side effects, and the real server
entry using isolated temporary data. It sends no requests to the live service.
`tests/readonly-mcp-scope.test.ts` verifies strict scope loading and copying.
`tests/readonly-tunnel.test.ts` opts in using `PI_CONSOLE_TEST_TUNNEL_CLIENT` and
checks the SHA256 of official Windows v0.0.15 before launching it against only
temporary fixture ports. It checks discovery, three tools, opaque-ID reads,
notification acknowledgement, excluded sessions, forbidden tools and zero
runtime mutations. With no reviewed binary configured, that case is skipped.
Its four isolated scenarios also verify the actual official-client discovery
and readiness: both metadata candidates 404 -> OAuth `not_advertised` and
`/readyz` 200; original 403 -> 503 and root fallback untried; 404/403 and 404/500
-> 503. RPC forwarding alone does not establish readiness. The real server
entry test retains its configured public Host and Access protection.
An additional official-client scenario sends modern sessionless discovery,
catalog and scoped reads through a loopback mock control plane, using a dummy
key and the SDK-generated standard headers. It also forwards fake Origin/proxy/
Cloudflare headers and verifies classified denial, successful error delivery,
zero runtime mutations and exclusion of all out-of-scope sessions.

Before a live trial: review the diff, approve startup/configuration timing and the
remote bridge's authentication/scope, enable the flag, and connect the approved
bridge only to `http://127.0.0.1:<port>/mcp/readonly`. Validate these three tools
and confirm that reads start no workers. Before restarting, independently
establish that no Pi or kit task, report delivery, or uncertain/sending queue is
active across the server. The limited scope's counters cannot establish this.
Live startup, tunnel/profile changes,
credentials, Dots authorization and pi-console E2E remain separate operations.
After applying a discovery-route fix, restart the owned pi-console during an
approved idle window, re-attest its new opaque IDs, and have the user restart
their tunnel launcher with masked runtime-key input. Official v0.0.15 finalizes
non-timeout discovery failures once; a running client with a recorded 403 does
not discover the server-side fix automatically. Expect OAuth `not_advertised`
and ready 200 after that fresh client startup. Keep the same tunnel/profile.
