import type { Writable } from 'node:stream';
export const FRAME_BYTES: number, CHUNK_BYTES: number, RECORD_BYTES: number, QUEUED_BYTES: number;
type RecordValue = Record<string, any>;
export function serializeRecord(value: RecordValue, maxBytes?: number): Buffer;
export function recordFrames(bytes: Buffer, generation: string, seq: number, hint?: RecordValue): Generator<RecordValue>;
export class FrameDecoder {
  constructor(options?: { generation?: string; maxBytes?: number; timeoutMs?: number; onStart?: (meta: { id?: string; type?: string }) => void; onError?: (error: Error) => void });
  accept(frame: unknown): RecordValue | undefined;
  finish(): void;
  close(): void;
}
export class TransportWriter {
  constructor(stream: Writable, generation: string, options?: { maxBytes?: number; queuedBytes?: number; timeoutMs?: number });
  send(record: RecordValue): Promise<void>;
  flush(): Promise<void>;
  close(): void;
}
export function waitForPressure(writer: TransportWriter, signal: AbortSignal): Promise<void>;
export class FrameLineReader { push(chunk: Buffer): RecordValue[]; finish(): void; }
