// Preview asset reads — the binary counterpart of readWorkspaceText for the
// explicit-consent HTML preview. Only extension-allowlisted container types
// (images, audio/video, fonts) qualify; the magic-byte signature must match
// the extension, reads run under one open FileHandle with inode/identity
// re-verification, and the size cap is enforced both before and during the
// read so a racing writer can never turn the check into an unbounded buffer.
//
// The signature check is a guard, not a decoder guarantee: a file whose
// header matches is delivered even if its codec is unsupported by the
// browser — playback support is documented as browser-dependent.
import { promises as fs, type Stats } from 'node:fs';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import { previewAssetType, PREVIEW_ASSET_LIMITS } from '../shared/html-preview.ts';

export type PreviewAssetKind = 'image' | 'audio' | 'video' | 'font';
export interface PreviewAssetData {
  bytes: number;
  sha256: string;
  mime: string;
  kind: PreviewAssetKind;
  /** Raw file content — caller decides whether to keep or deliver it. */
  content: Buffer;
}

/** Absolute-cap lookup so review can reject an oversized file before reading. */
export function previewAssetByteLimit(kind: PreviewAssetKind): number {
  return kind === 'image' ? PREVIEW_ASSET_LIMITS.imageBytes
    : kind === 'font' ? PREVIEW_ASSET_LIMITS.fontBytes
    : PREVIEW_ASSET_LIMITS.mediaBytes;
}

const ascii = (head: Buffer, start: number, end: number) => head.toString('ascii', start, end);

/** Minimal container magic per allowlisted extension. Unknown extensions never
 * reach this function (previewAssetType gates them), but a non-match is a
 * hard preview_asset_invalid — no heuristic sniffing or second-guessing. */
export function previewAssetSignature(extension: string, head: Buffer): boolean {
  switch (extension.toLowerCase()) {
    case '.png': return head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case '.jpg': case '.jpeg': return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case '.gif': return head.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(head, 0, 6));
    case '.webp': return head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP';
    case '.wav': return head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE';
    case '.mp3': return head.length >= 3 && (ascii(head, 0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0));
    case '.ogg': case '.oga': case '.opus': return head.length >= 4 && ascii(head, 0, 4) === 'OggS';
    case '.mp4': case '.m4a': return head.length >= 8 && ascii(head, 4, 8) === 'ftyp';
    case '.webm': return head.length >= 4 && head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case '.woff': return head.length >= 4 && ascii(head, 0, 4) === 'wOFF';
    case '.woff2': return head.length >= 4 && ascii(head, 0, 4) === 'wOF2';
    case '.ttf': return head.length >= 4 && (head.subarray(0, 4).equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || ascii(head, 0, 4) === 'true');
    case '.otf': return head.length >= 4 && ascii(head, 0, 4) === 'OTTO';
    default: return false;
  }
}

const sameIdentity = (a: Stats, b: Stats) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/**
 * Open `target` (already canonicalized inside the workspace + base) and read it
 * as a verified preview asset. `verify` re-checks that the path still resolves
 * to the same file inside its boundaries; it runs after open and after the
 * read so a mid-read replace/rename is caught before the bytes are trusted.
 * Throwing `fail` maps to a stable preview_* code via the wrapped callback.
 */
export async function readPreviewAsset(
  target: string,
  verify: () => Promise<void>,
  fail: (code: string) => never,
): Promise<PreviewAssetData> {
  const extension = extname(target).toLowerCase();
  const type = previewAssetType(extension);
  if (!type) fail('preview_asset_invalid');
  const limit = previewAssetByteLimit(type.kind);
  const handle = await fs.open(target, 'r').catch(() => fail('preview_unavailable'));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !opened.size || opened.size > limit) fail('preview_resource_limit');
    // Same file the canonical path pointed at — checked before any byte is read.
    await verify();
    const buffer = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit || length !== opened.size) fail('preview_changed');
    const content = buffer.subarray(0, length);
    // A concurrent writer that shrank/grew the opened inode (fstat) or swapped
    // the path for a different inode (fresh stat) between the first stat and
    // the final byte must not ship under the reviewed hash.
    const fstat = await handle.stat();
    if (!sameIdentity(opened, fstat)) fail('preview_changed');
    const current = await fs.stat(target).catch(() => fail('preview_changed'));
    if (!sameIdentity(opened, current)) fail('preview_changed');
    await verify();
    if (!previewAssetSignature(extension, content.subarray(0, 16))) fail('preview_asset_invalid');
    return { bytes: length, sha256: createHash('sha256').update(content).digest('hex'), mime: type.mime, kind: type.kind, content };
  } finally {
    await handle.close();
  }
}
