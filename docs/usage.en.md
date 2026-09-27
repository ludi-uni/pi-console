# Using Pi Console

[Home](../README.en.md) · [日本語](usage.ja.md)

## Workspaces and sessions

1. Run `/pi-console` in Pi and open the displayed URL. The default port is `31717`; use `/pi-console 31719` to choose another port. `/pi-console stop` stops the server owned by Pi.
2. In **Workspaces**, select an existing workspace or add one with **Browse folders** (or an absolute path). A workspace is a server-local working directory, not a separate “project” entity or a folder on your phone.
3. Select or create a session, then send Pi prompts in **Chat**. Choose its model and thinking level in the session. **Context** shows Pi's reported usage after a reply. An unprompted new session exists only on the current server until its first prompt creates a Pi session file.

**Manage workspace** can rename, pin or remove a registration; removal does not delete the folder or Pi sessions. The folder browser can create a subfolder in the open directory. **Open on host PC** opens the registered local folder on the host's interactive Windows desktop, even when clicked from a phone; it does not open the phone's file manager.

## Chat, attachments and previews

- Attach up to four small UTF-8 text files or PNG/JPEG/GIF/WebP images from the browser. Pi-provided thinking and tool calls appear separately; tap a command to expand its bounded invocation. **Instructions** jumps to past user prompts; **Copy all** is below an assistant answer.
- Assistant answers render Markdown tables, lists and fenced code. Raw HTML and remote images are not rendered.
- Paths in assistant prose, Markdown links or inline code to `.txt`, `.md`, `.markdown` and common source/configuration files (including `.ts`, `.py`, `.go`, `.json`, `.yaml`) open read-only previews inside the selected workspace. Plain prose paths containing spaces are recognized when they include a directory prefix.
- Previews reject paths outside the workspace (including symlink escapes), binary or unsupported files, and UTF-8 files above 256 KiB. They cannot edit or download files. **Copy** copies the original contents, not rendered Markdown. Code has line numbers; `src/main.ts:42`, `src/main.ts:42:8` and `src/main.ts#L42` jump to a line. Follow links within previews and use **Back** to return.

## Execution and Orchestrator

- **Execution** shows Pi tools, observed foreground pi-subagents and session-bound Orchestrator activity. Relationships that cannot be verified remain **Unattached**. There is no approval UI. While a tool runs, its observed program or command appears when Pi supplies it.
- **Activity** shows subagents, pending input, completion results and recent issues, dismissible for up to 24 hours while server state lasts. Issues clear after a successful run or ten minutes. **Inspect background result** requests only the bounded final output available from the session's pi-subagents extension; expired artifacts cannot be reconstructed.
- With a compatible ludi-agent-kit installed, start a separate Orchestrator run from **Execution**, bound to the selected Pi session and workspace. Kit model routing differs from the Pi session model and may incur provider charges. For a new session, Pi first generates a short acknowledgement to save its file; when the kit finishes, Pi receives a bounded report and saves a normal assistant answer. These Pi calls also have model costs. Progress appears live in Chat but is not persisted as chat history; detail is reconstructed from kit state in Execution.
- Pi prompts pause while the kit owns the same session. Answer questions shown in **Execution** by choosing an option or entering free text. The kit resumes after all pending questions are answered and may make additional model calls. If the continuation fails while that same answered run remains resumable, **Retry continuation** starts it again without resending the answer; retrying may also call models. **Continue Pi chat while kit is paused** lets you use Pi without discarding that run; Pi prompts pause again while a retry is running. Answers are retained in the kit's repository-scoped decision memory. If the kit finishes but saving its final report to Pi fails, **Retry saving report to Pi** retries only the report, not the kit work, but may call a Pi model. A new kit run cannot start in that session until the report failure is resolved. When prior delivery cannot be ruled out, it refuses a blind resend and asks you to inspect the Pi session. After inspecting the Pi session and the report in Execution, choose **Mark report handled after inspection** if you want to proceed without resending. Confirming marks delivery as *unverified*, disables retry, and allows another kit run. Failed report state and the uncertain-dispatch marker are stored under the data directory's `report-recovery/` and restored after a server restart; recovery never automatically resends the report. Recycling that session or removing its workspace is blocked while a report remains unresolved. Browser attachments and **Stop** do not apply to kit runs; the console cannot cancel kit runs. For ordinary Pi prompts, **Stop** clears queued prompts and sends `abort` to Pi.

## Mobile, notifications and settings

On a phone, navigate Workspaces → sessions → Chat / Execution. In-app links and browser Back/Forward return to the lists without stopping Pi. Browser reconnects do not kill a worker. Installing the PWA does not make Pi available offline.

**Settings** offers session view, appearance and Codex-compatible pet controls. Its language setting covers settings/navigation, **not the entire application**. Pets are discovered from separately installed `pet.json` and spritesheet packages and can be dragged. **Sessions → Automatic cleanup** moves Pi session files older than a chosen number of days to the server's Windows Recycle Bin (off by default). Pi sessions may be shared with other apps. Sessions can also be recycled individually.

**Sessions** completion notifications work only while the tab remains open but hidden. Permission is requested when enabled; there is no “almost finished” prediction or closed-browser notification. **Orchestrator settings** offers initial model binding and priorities; existing routes remain under Advanced. See [Operations and development](operations.en.md) for configuration and storage details.
