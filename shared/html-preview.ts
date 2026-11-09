// Explicit-consent HTML preview — shared API contract between the server and the
// trusted browser shell.
//
// Ordinary workspace JS/CSS is only handed out after a short-lived review that
// the user inspects (file names, sizes, SHA-256 hashes) and an explicit enable
// confirmation. Snapshots are in-memory only; the trusted shell renders them
// through inert DOMParser + data URLs + a sandboxed srcdoc frame, so no unauthenticated
// asset route or CORS relaxation is needed.
//
// Preview assets: a fixed allowlist of binary file types (images, audio/video,
// fonts) may join a review under separate consent flags. The server verifies a
// known magic-byte signature against each file's extension and delivers the
// bytes base64-encoded inside the grant — the signature check is a guard, not a
// decoder guarantee, so actual playback still depends on browser codec support.
//
// HTTP surface (composed after the existing Host/Access/allowedPost gates):
//   POST /api/workspace/preview/review  — {workspaceId, path}
//   POST /api/workspace/preview/enable  — {reviewId, allowScripts, allowStyles, confirmed:true, allowImages?, allowMedia?, allowFonts?}
//   POST /api/workspace/preview/revoke  — {grantId}

/** Authenticated caller. Remote is built from a verified Access principal
 * (issuer/audience/subject + exp); local callers use the fixed id 'local'.
 * Reviews and grants are bound to the identity id and always expire at or
 * before expiresAt. */
export interface PreviewIdentity { id: string; expiresAt?: number }

/** Explicit per-grant consent. Flags default to false; each enabled flag
 * admits only the matching resource kinds (.js for allowScripts, .css for
 * allowStyles, image formats for allowImages, audio/video for allowMedia,
 * font formats for allowFonts). Kinds never inherit another flag's consent. */
export interface PreviewFlags {
  allowScripts: boolean;
  allowStyles: boolean;
  allowImages?: boolean;
  allowMedia?: boolean;
  allowFonts?: boolean;
}

/** The one fixed set of binary preview assets. Signature verification guards
 * the container format only — codec support remains the browser's
 * responsibility (e.g. an MP4 with an unsupported codec is still delivered
 * but may simply not play). */
export const PREVIEW_ASSET_TYPES: Record<string, { kind: 'image' | 'audio' | 'video' | 'font'; mime: string }> = {
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.oga': { kind: 'audio', mime: 'audio/ogg' },
  '.opus': { kind: 'audio', mime: 'audio/ogg' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.woff': { kind: 'font', mime: 'font/woff' },
  '.woff2': { kind: 'font', mime: 'font/woff2' },
  '.ttf': { kind: 'font', mime: 'font/ttf' },
  '.otf': { kind: 'font', mime: 'font/otf' },
};

/** Extension → allowlist entry, or undefined for anything not previewable
 * (svg, pdf, extra html documents, executables, json, …). */
export const previewAssetType = (extension: string) => PREVIEW_ASSET_TYPES[extension.toLowerCase()];

/** Per-kind byte caps on top of the shared total budget. */
export const PREVIEW_ASSET_LIMITS = {
  imageBytes: 4 * 1024 * 1024,
  mediaBytes: 8 * 1024 * 1024,
  fontBytes: 2 * 1024 * 1024,
} as const;

/** Consent flag name per asset kind — nothing else may enable these kinds. */
export const PREVIEW_ASSET_FLAG = { image: 'allowImages', audio: 'allowMedia', video: 'allowMedia', font: 'allowFonts' } as const;

export type PreviewKind = 'html' | 'script' | 'style' | 'image' | 'audio' | 'video' | 'font';

/** User-verification metadata for one candidate file. Paths are
 * forward-slash canonical, relative to the workspace root. mime/encoding are
 * set only for binary assets (they describe how content is delivered in a
 * grant); review entries for text files omit them. */
export interface PreviewFileInfo {
  path: string;
  kind: PreviewKind;
  bytes: number;
  sha256: string;
  mime?: string;
  encoding?: 'utf8' | 'base64';
}

/** A consented file delivered inside an enable response. Text kinds are UTF-8;
 * binary kinds carry encoding 'base64' and a strict known mime. */
export interface PreviewResource extends PreviewFileInfo { content: string }

export interface PreviewReviewRequest { workspaceId: string; path: string }

export interface PreviewReview {
  reviewId: string;
  expiresAt: number;
  /** Workspace-relative path of the approved HTML entry document. */
  entryPath: string;
  /** Workspace-relative directory the entry lives in; '' for the root.
   * Script/style/asset candidates were enumerated under this directory. */
  basePath: string;
  documentHtml: string;
  files: PreviewFileInfo[];
}

export interface PreviewEnableRequest extends PreviewFlags {
  reviewId: string;
  /** Must be exactly true — the boolean consent is part of the audit surface. */
  confirmed: true;
}

export interface PreviewGrant {
  grantId: string;
  expiresAt: number;
  entryPath: string;
  basePath: string;
  documentHtml: string;
  allowScripts: boolean;
  allowStyles: boolean;
  allowImages: boolean;
  allowMedia: boolean;
  allowFonts: boolean;
  /** Re-read and hash-verified content of the approved files, filtered to the
   * kinds the flags enabled. Nothing else is ever returned. */
  resources: PreviewResource[];
}

export interface PreviewRevokeRequest { grantId: string }
export interface PreviewRevokeResult { ok: true }

// Dedicated trusted shell only. The child adds a stricter meta-CSP and an
// opaque-origin sandbox; never apply this policy to the main Console UI.
// img-src/media-src/font-src are data: only — embedded grant bytes, never the
// network (connect-src 'self' covers the JSON API only).
export const HTML_PREVIEW_SHELL_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' data:; style-src 'self' 'unsafe-inline' data:; connect-src 'self'; img-src data:; media-src data:; font-src data:; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const HTML_PREVIEW_LIMITS = {
  /** Request JSON bodies stay small and strict. */
  maxBodyBytes: 8 * 1024,
  maxResourceBytes: 256 * 1024,
  maxResources: 64,
  /** Raw bytes across every file in one grant (text + binary). */
  maxTotalResourceBytes: 16 * 1024 * 1024,
  maxScanEntries: 512,
  maxScanDepth: 8,
  reviewTtlMs: 2 * 60 * 1000,
  maxReviews: 8,
  grantTtlMs: 5 * 60 * 1000,
  maxGrants: 16,
} as const;
