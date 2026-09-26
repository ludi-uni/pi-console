// Pi JSONL is framed only at LF bytes. JSON strings may contain U+2028/U+2029.
export class JsonlParser {
  private pending = Buffer.alloc(0);
  constructor(private readonly maxBytes = 8 * 1024 * 1024) {}
  push(chunk: Buffer): unknown[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const records: unknown[] = [];
    let end: number;
    while ((end = this.pending.indexOf(10)) >= 0) {
      const line = this.pending.subarray(0, end);
      this.pending = this.pending.subarray(end + 1);
      if (line.length > this.maxBytes) throw new Error('Pi RPC record too large');
      const text = line.toString('utf8').replace(/\r$/, '');
      if (text.trim()) records.push(JSON.parse(text));
    }
    if (this.pending.length > this.maxBytes) throw new Error('Pi RPC record too large');
    return records;
  }
  finish(): void { if (this.pending.length) throw new Error('Pi RPC stdout ended mid-record'); }
}
