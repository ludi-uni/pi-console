import type { PromptAttachment } from '../../shared/types.ts';

const MAX_COUNT = 4;
const MAX_TOTAL = 8 * 1024 * 1024;
const MAX_TEXT = 64 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const textType = (mime: string) => mime.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript'].includes(mime);
const safeName = (name: unknown): name is string => typeof name === 'string' && name.length > 0 && name.length <= 120 && !/[\\/\x00-\x1f\x7f]/.test(name);
const escaped = (name: string) => name.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const markerSafeName = (name: string) => name.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const markerSafeType = (mimeType: string) => mimeType.replace(/[^\w.\-+\/]/g, '');
// Marker tags let the console separate user text from attachment payloads on
// echo/resume. Only `pi_attachment` is parsed back; raw `<attached_file>` bodies
// stay opaque so the model still receives the full prompt verbatim.
const textMarker = (name: string, mimeType: string, bytes: number) => `<pi_attachment kind="text" name="${markerSafeName(name)}" type="${markerSafeType(mimeType)}" bytes="${bytes}">`;
const imageMarker = (name: string, mimeType: string, bytes: number) => `<pi_attachment kind="image" name="${markerSafeName(name)}" type="${markerSafeType(mimeType)}" bytes="${bytes}"/>`;

export function prepareAttachments(message: unknown, attachments: unknown): { message: string; images: { type: 'image'; data: string; mimeType: string }[] } {
  if (typeof message !== 'string' || message.length > 200_000) throw new Error('prompt text is invalid or too long');
  if (!Array.isArray(attachments) || attachments.length > MAX_COUNT) throw new Error('up to 4 attachments are allowed');
  const images: { type: 'image'; data: string; mimeType: string }[] = [];
  let total = 0;
  let text = message;
  for (const item of attachments as PromptAttachment[]) {
    if (!item || !safeName(item.name) || typeof item.mimeType !== 'string') throw new Error('invalid attachment name or type');
    if (item.kind === 'text' && textType(item.mimeType) && typeof item.text === 'string') {
      const size = Buffer.byteLength(item.text);
      if (!size || size > MAX_TEXT || item.text.includes('\0')) throw new Error('text attachment must be nonempty UTF-8 and at most 64 KiB');
      total += size;
      text += `\n\n${textMarker(item.name, item.mimeType, size)}\n<attached_file name="${escaped(item.name)}">\n${item.text}\n</attached_file>`;
    } else if (item.kind === 'image' && imageTypes.has(item.mimeType) && typeof item.data === 'string') {
      if (item.data.length > Math.ceil(MAX_IMAGE / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) throw new Error('invalid image attachment');
      const bytes = Buffer.from(item.data, 'base64');
      if (!bytes.length || bytes.length > MAX_IMAGE || bytes.toString('base64') !== item.data) throw new Error('invalid image attachment');
      const valid = item.mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : item.mimeType === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
        : item.mimeType === 'image/gif' ? /^GIF8[79]a/.test(bytes.toString('ascii', 0, 6))
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!valid) throw new Error('image content does not match its type');
      total += bytes.length;
      images.push({ type: 'image', data: item.data, mimeType: item.mimeType });
      text += `\n${imageMarker(item.name, item.mimeType, bytes.length)}\n[Attached image: ${item.name}]`;
    } else throw new Error('unsupported attachment type; choose text or PNG/JPEG/GIF/WebP images');
    if (total > MAX_TOTAL) throw new Error('attachments exceed 8 MiB total');
  }
  if (!text.trim() && !images.length) throw new Error('message or attachment required');
  return { message: text, images };
}
