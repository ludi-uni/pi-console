# Phase 1 runtime

## Runtime architecture and API

One Node.js process hosts HTTP, per-session Pi subprocesses, a Pi-only JSONL adapter (`server/adapters/pi`), canonical normalizer/chat projection (`server/runtime/events.ts`) and Workspace/session ownership (`server/runtime`). React consumes only `shared/types.ts` canonical snapshots/events, never raw Pi. Vite produces static files served by Node. HTTP commands + SSE were chosen over WebSocket: prompt/stop are short requests, Pi output is one-way; browser EventSource reconnects automatically.

- `GET/POST /api/workspaces` — list/add validated absolute local paths.
- `GET /api/sessions?workspaceId=...` — discover Pi JSONL headers by cwd; `POST /api/sessions` creates Pi session with workspaceId.
- `POST /api/resume` — open existing session (workspaceId, sessionId), hydrate chat with Pi `get_messages`, return snapshot.
- `POST /api/prompt`, `POST /api/stop` — workspaceId, sessionId, prompt additionally takes message. One active prompt per session (queued prompts intentionally not supported in Phase 1).
- `GET /api/state?workspaceId=...&sessionId=...` — current snapshot including runtime state; does not silently restart a failed process. Explicit resume restarts it.
- `GET /api/events?workspaceId=...&sessionId=...&since=seq` — SSE `execution` canonical events, bounded replay ring, 409 on cursor gap. Snapshot first, then stream; clients dedupe seq. `POST /api/close` closes an idle worker for cleanup/testing.

Only loopback host is accepted, same-origin POST enforced and cross-site fetch metadata rejected. This is **not** remote-ready authentication. Pi owns session files and full chat history. Workspace metadata is a small JSON file; no SQLite or new database. The bounded (5000-event/session) canonical ring and live drafts survive browser reconnection while the server lives, **not server restart**. On server restart an in-flight run cannot be reconstructed truthfully from Pi JSONL; explicit resume hydrates completed chat only. A cursor gap returns 409 and the browser refreshes the snapshot. SSE response contains canonical events only, never Pi wire packets.

## Pi process lifecycle

`stopped → starting → running → stopping → stopped`, or unexpected exit/parser/startup failure → `failed`. `get_state` confirms Pi ID/path at create/resume. Node runs the discovered installed Pi CLI with `process.execPath`; Windows `spawn('pi')` was proven ENOENT. Pi runs in the selected workspace cwd. JSONL decoder frames on LF bytes (not Unicode separators); stdin writes serialize and honor drain, command IDs correlate responses with deadlines. stdout is protocol only; bounded stderr is for diagnostics. Worker failures reject pending calls, mark active runs interrupted, and remain visible as failed until explicit resume. Browser disconnect leaves Pi running. Explicit close requires an idle run; server SIGINT/SIGTERM closes stdin for every worker, then escalates after 3.5 s.

New Pi sessions can return an ID and intended file path **before the file exists**. Until the first prompt writes the header, the active worker is their only owner and the sessions API includes it. On create we validate Pi's path is within the configured sessions root; once the header exists, list/resume validates its canonical ID and cwd against the workspace. Pi session entry `parentId` is not an execution parent.

Unsupported extension UI dialogs are answered `cancelled:true` to avoid deadlocking Pi. No native `approval_*`/`approval_response` commands are implemented.

## Canonical event flow, run boundary and streaming

`prompt` prepares a console UUID run, and Pi `agent_start` (or a prompt acceptance response arriving first) emits `RunStarted`. Only `agent_settled` emits `AgentSettled` then terminal `RunCompleted`/`RunFailed`; `agent_end` never closes a run. Explicit stop marks terminal `cancelled`; unexpected process loss marks `interrupted`; provider error/retry exhaustion marks `failed`. Pi's `message_update` text deltas are indexed into an in-memory draft; `message_end.message` replaces it authoritatively. The browser applies canonical `MessageStarted/Delta/Completed` only. `toolCallId` correlates `ToolStarted/Progress/Completed/Failed` keyed to console run ID; `parentId` points to the known run, not a fabricated child Agent. Partial tool output is **not** concatenated. Tool event payload stores tool name, ID, argument key names and content-block counts instead of potentially sensitive raw args/output. Chat content itself remains visible as requested; avoid using this tool for secrets on an unauthenticated remote host.

Every canonical record has schemaVersion/eventId, session-local increasing seq, timestamp, workspaceId/sessionId/runId, type/entityId, optional parentId/toolCallId, source/certainty/status/payload. Agent children and orchestration are out of scope. `ErrorEvent` covers command/extension failures and unsupported dialogs. This Phase adds `AgentSettled` to the Phase 0 type union because Pi makes it the authoritative settlement boundary.

## Test strategy and evidence

- Unit: LF framing/U+2028/size guard, process state transitions, run/message/tool reducer including terminal errors/abort/crash and Windows path normalization (`tests/runtime.test.ts`).
- Fixture: `tests/fixtures/powershell.jsonl`, minimal anonymized Pi 0.87.1-shaped assistant stream, powershell start/progress/completion and `agent_end` before `agent_settled`; error cases in unit test. Not a verbatim transcript because the original could contain session metadata.
- Integration: fake Pi subprocess through real HTTP/SSE server, session create/list/resume/prompt and canonical stream (`tests/integration.test.ts`).
- Real Pi: `tests/real-pi.test.ts` starts installed Pi in a temporary workspace/session directory, observes powershell tool progress and completion, text streaming and settled, reopens session and verifies chat, cancels a 20-second sleep, kills Pi to prove abnormal-exit detection, and shuts down.
- Browser: `e2e/runtime.spec.ts` starts real server and Pi, creates session via Chrome/Playwright, sends prompt, checks streamed delta/chat and terminal event, then checks narrow viewport controls. No mock Pi in browser test.

## Known limitations and Phase 0 deviations

Phase 0 permitted lightweight persistence but did not require SQLite: Phase 1 keeps event history only in memory. The contract's reconnect snapshot/cursor works while the server runs, not across a server restart. Pi's lazy session file creation required retaining an unprompted session in the worker registry until its first prompt; the expected header validation occurs when the file exists. Flat log only, no subagent or Orchestrator source, no approval UI, no full tool output, no PWA/auth/remote hosting. One active prompt per session; multi-queued prompts, retries spanning disconnected Pi processes, recovery of unpersisted drafts, and extension dialog interaction are deliberately unsupported. Chrome channel is used because the matching bundled Playwright Chromium is not installed on this Windows host. Phase 2 should validate child data via an independent source before drawing a hierarchy.
