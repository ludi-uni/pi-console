import type { ExecutionEvent, ExecutionNode } from '../shared/types.ts';

// Copyable issue rows: every failed/interrupted terminal state plus the canonical
// issue event types (RunFailed, ToolFailed, ErrorEvent — same list as recentIssue).
export function copyableExecutionEvent(event: ExecutionEvent): boolean {
  return event.status === 'failed' || event.status === 'interrupted'
    || ['RunFailed', 'ToolFailed', 'ErrorEvent'].includes(event.type);
}

// Pretty-print a payload value. Structured values keep newlines via indented JSON;
// strings pass through verbatim so multiline diagnostics stay readable.
const payloadValue = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value);

// Full-fidelity plain-text dump of a canonical event: identifiers, type, time,
// source and status, then every payload key. No truncation — a copy the user
// pastes into a bug report must contain the whole captured diagnostics.
export function serializeExecutionEvent(event: ExecutionEvent, ja = false): string {
  const fields: [string, unknown][] = [
    [ja ? '時刻' : 'Time', event.timestamp],
    [ja ? '種類' : 'Type', event.type],
    ['Status', event.status],
    ['Source', event.sourceRef?.kind ?? event.source],
    ['Source native ID', event.sourceRef?.nativeId],
    ['Event ID', event.eventId],
    ['Entity ID', event.entityId],
    ['Parent entity ID', event.parentId],
    ['Tool call ID', event.toolCallId],
    ['Run ID', event.runId],
    ['Session ID', event.sessionId],
    ['Workspace ID', event.workspaceId],
  ];
  const lines = fields
    .filter((entry): entry is [string, NonNullable<unknown>] => entry[1] !== undefined && entry[1] !== null && entry[1] !== '')
    .map(([name, value]) => `${name}: ${String(value)}`);
  lines.push(ja ? 'ペイロード:' : 'Payload:');
  for (const key of Object.keys(event.payload ?? {}).sort())
    lines.push(`${key}: ${payloadValue(event.payload[key])}`);
  return lines.join('\n');
}

// Full node copy for failed/interrupted/blocked/decision rows. The node
// projection can drop the failure reason (RunFailed payloads are not stored on
// the node at all; ToolFailed nodes keep only contentBlocks), so related
// canonical events are appended to carry the actual error summaries/output.
export function serializeExecutionNode(node: ExecutionNode, related: readonly ExecutionEvent[] = [], ja = false): string {
  const fields: [string, unknown][] = [
    ['Label', node.label],
    ['Status', node.status],
    ['Kind', node.kind],
    ['Node ID', node.id],
    ['Parent node ID', node.parentId],
    ['Source', node.sourceKind],
    ['Native ID', node.nativeId],
    ['Correlation', node.correlation],
    ['Action', node.action],
    [ja ? '試行' : 'Attempt', node.attempt],
    ['Model', [node.provider, node.model].filter(Boolean).join(' / ') || undefined],
    [ja ? '開始' : 'Started', node.startedAt],
    [ja ? '更新' : 'Updated', node.updatedAt],
    [ja ? '終了' : 'Ended', node.endedAt],
    [ja ? 'ブロック理由' : 'Blocked reason', node.blockedReason],
    [ja ? '依存' : 'Dependencies', node.dependencies?.length ? node.dependencies.join(', ') : undefined],
  ];
  const lines = fields
    .filter((entry): entry is [string, NonNullable<unknown>] => entry[1] !== undefined && entry[1] !== null && entry[1] !== '')
    .map(([name, value]) => `${name}: ${String(value)}`);
  for (const attempt of node.attempts ?? [])
    lines.push(`${ja ? '試行' : 'Attempt'} ${attempt.attempt}: ${[attempt.model, attempt.failureClass].filter(Boolean).join(' · ')}`);
  if (node.details && Object.keys(node.details).length) {
    lines.push(ja ? '詳細:' : 'Details:');
    lines.push(JSON.stringify(node.details, null, 2));
  }
  if (related.length) {
    lines.push(ja ? '関連イベント:' : 'Related events:');
    for (const event of related) lines.push(serializeExecutionEvent(event, ja));
  }
  return lines.join('\n');
}

export type ClipboardWriteResult = 'copied' | 'failed';

// Feature-detected Clipboard API write. navigator.clipboard is undefined outside
// secure contexts and writeText can reject on permission denial — the caller
// must show a manual fallback in either case, so this only reports success/failure.
export async function writeClipboardText(text: string): Promise<ClipboardWriteResult> {
  try {
    if (!navigator.clipboard?.writeText) return 'failed';
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
