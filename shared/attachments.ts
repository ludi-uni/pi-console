import type { ChatAttachment } from './types.ts';

// User prompts may contain attachment markers emitted by the console composer:
//   <pi_attachment kind="text" name="n" type="t" bytes="B">\n<attached_file name="n">\n{body}\n</attached_file>
//   <pi_attachment kind="image" name="n" type="t" bytes="B"/>\n[Attached image: n]
// This parser splits display text from attachment payloads without ever dropping
// text the user actually typed. A marker is only consumed when the WHOLE payload
// verifies: `bytes` is the UTF-8 byte length of the file body, so bodies may
// contain arbitrary tags — including `</attached_file>` or nested
// `<pi_attachment>` — and still be hidden exactly once. Anything that does not
// verify (hand-typed markers, legacy wrappers without markers, truncated text)
// is left untouched in the message. The trade-off: attachment text written by
// console versions before markers existed stays visible verbatim.
const ATTACH_PREVIEW = 1200;
const encoder = new TextEncoder();
const utf8 = new TextDecoder('utf-8', { fatal: true });

// Client-side file reads must fail loudly on binary/invalid UTF-8 instead of
// silently inserting U+FFFD replacement characters.
export function decodeUtf8(buffer: ArrayBuffer | Uint8Array): string {
  try { return utf8.decode(buffer); } catch { throw new Error('attachment is not valid UTF-8 text'); }
}

const unescape = (value: string) => value.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
const escapeAttr = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const header = (value: string): { name: string; kind: 'text' | 'image'; mimeType: string; bytes?: number } | undefined => {
  const kind = /kind="(text|image)"/.exec(value)?.[1];
  const name = /name="([^"]*)"/.exec(value)?.[1];
  if (!kind || !name) return undefined;
  const type = /type="([^"]*)"/.exec(value)?.[1] ?? '';
  const bytes = /bytes="(\d+)"/.exec(value)?.[1];
  return { name: unescape(name), kind: kind as 'text' | 'image', mimeType: unescape(type), ...(bytes !== undefined ? { bytes: Number(bytes) } : {}) };
};
// Character offset of the end of `bytes` UTF-8 bytes starting at `start`,
// or -1 when the byte length cannot match (binary search over char offsets).
const byteEnd = (text: string, start: number, bytes: number): number => {
  let lo = start, hi = text.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (encoder.encode(text.slice(start, mid)).length < bytes) lo = mid + 1; else hi = mid; }
  return encoder.encode(text.slice(start, lo)).length === bytes ? lo : -1;
};

export function splitPromptAttachments(text: string): { text: string; attachments: ChatAttachment[] } {
  const attachments: ChatAttachment[] = [];
  const spans: [number, number][] = [];
  let scan = 0;
  while (true) {
    const start = text.indexOf('<pi_attachment ', scan);
    if (start < 0) break;
    const open = /^<pi_attachment kind="(text|image)"((?:"[^"]*"|[^">])*)>/.exec(text.slice(start));
    const meta = open ? header(`kind="${open[1]}"${open[2]}`) : undefined;
    if (!open || !meta) { scan = start + 1; continue; }
    let end = start + open[0].length;
    if (meta.kind === 'text') {
      if (meta.bytes === undefined || text[start + open[0].length] !== '\n') { scan = start + 1; continue; }
      const tag = `<attached_file name="${escapeAttr(meta.name)}">\n`;
      const bodyStart = end + 1 + tag.length;
      if (!text.startsWith(tag, end + 1)) { scan = start + 1; continue; }
      const bodyEnd = byteEnd(text, bodyStart, meta.bytes);
      if (bodyEnd < 0 || !text.startsWith('\n</attached_file>', bodyEnd)) { scan = start + 1; continue; }
      const body = text.slice(bodyStart, bodyEnd);
      end = bodyEnd + '\n</attached_file>'.length;
      attachments.push({ ...meta, preview: body.slice(0, ATTACH_PREVIEW), truncated: body.length > ATTACH_PREVIEW });
    } else {
      // Image markers are self-closing and only consumed together with the exact
      // note line the composer emitted — a bare typed marker stays visible.
      if (!open[0].endsWith('/>')) { scan = start + 1; continue; }
      const note = `\n[Attached image: ${meta.name}]`;
      if (!text.startsWith(note, end)) { scan = start + 1; continue; }
      end += note.length;
      attachments.push(meta);
    }
    spans.push([start, end]);
    scan = end;
  }
  if (!attachments.length) return { text, attachments };
  let result = '', last = 0;
  for (const [a, b] of spans) { result += text.slice(last, a); last = b; }
  result += text.slice(last);
  return { text: result.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, ''), attachments };
}
