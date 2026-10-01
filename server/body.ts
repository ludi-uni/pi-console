import type { IncomingMessage } from 'node:http';

// Bodies are bytes, not characters: count Buffer length so multi-byte UTF-8 cannot bypass
// the limit, and decode once at the end so a split surrogate/multibyte boundary never
// corrupts Japanese text or emoji. Aborted requests settle via the async iterator's error.
export async function readJsonBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const part = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    bytes += part.length;
    if (bytes > maxBytes) throw new Error('request too large');
    chunks.push(part);
  }
  const data = Buffer.concat(chunks, bytes).toString('utf8');
  return data ? JSON.parse(data) : {};
}
