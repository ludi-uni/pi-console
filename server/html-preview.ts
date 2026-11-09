// Explicit-consent HTML preview backend.
//
// Ordinary workspace JS/CSS — plus an allowlisted set of binary preview assets
// (images, audio/video, fonts) — is delivered only inside a short-lived,
// identity-bound grant: review() snapshots the entry HTML plus the candidate
// files under its canonical parent directory (names, sizes, SHA-256 — the
// user's verification surface; binary content is never returned here),
// enable() re-reads every approved file and fails on any hash change or
// deletion before issuing a one-shot grant, and revoke() deletes the grant.
// Snapshots are memory-only and bounded; nothing is executed server-side, no
// asset route or CORS relaxation exists — the trusted browser shell renders the
// returned JSON via inert DOMParser + data URLs + sandboxed srcdoc.
//
// Consent flags stay disjoint: allowImages admits only image kinds,
// allowMedia only audio/video, allowFonts only fonts. Omitted flags are false,
// and the returned grant always reports every flag explicitly.
//
// This handler assumes the caller already passed the global Host/Access/
// allowedPost gates; the injected identity callback must be the verified
// authentication principal (missing/unverified identity is denied outright, and
// one principal can never use another's review or grant).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { readJsonBody } from './body.ts';
import { PermissionFault, strictPermissionObject } from './workspace-permissions.ts';
import { readWorkspaceText, resolveWorkspaceFile } from './runtime/workspace-text.ts';
import { previewAssetByteLimit, readPreviewAsset } from './html-preview-assets.ts';
import type { WorkspaceStore } from './runtime/workspaces.ts';
import {
  HTML_PREVIEW_LIMITS,
  previewAssetType,
  type PreviewEnableRequest,
  type PreviewFileInfo,
  type PreviewGrant,
  type PreviewIdentity,
  type PreviewKind,
  type PreviewResource,
  type PreviewReview,
  type PreviewReviewRequest,
  type PreviewRevokeRequest,
  type PreviewRevokeResult,
} from '../shared/html-preview.ts';

const L = HTML_PREVIEW_LIMITS;
function fail(code: string): never { throw new PermissionFault(code); }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
const textBytes = (content: string) => Buffer.byteLength(content, 'utf8');
/** Enable bodies accept the new consent flags as optional keys; every other
 * key is still an unknown-field rejection. */
const ENABLE_KEYS = ['reviewId', 'allowScripts', 'allowStyles', 'confirmed', 'allowImages', 'allowMedia', 'allowFonts'];

/** Entries that never take part in a preview: VCS/tooling state and our own data dir. */
const EXCLUDED_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', '.pi-console']);

function requireIdentity(identity: PreviewIdentity | undefined, now: number): PreviewIdentity {
  if (!identity || typeof identity.id !== 'string' || !identity.id.length || identity.id.length > 256) fail('preview_identity_required');
  if (identity.expiresAt !== undefined && (!Number.isFinite(identity.expiresAt) || identity.expiresAt <= now)) fail('preview_identity_expired');
  return identity;
}

/** Snapshot expiry never outlives the caller's own authentication expiry. */
function boundedExpiry(now: number, ttlMs: number, identity: PreviewIdentity): number {
  const expiry = now + ttlMs;
  return identity.expiresAt === undefined ? expiry : Math.min(expiry, identity.expiresAt);
}

interface ApprovedFile { rel: string; kind: PreviewKind; sha256: string }
interface ReviewRecord {
  expiresAt: number; identityId: string;
  workspaceId: string; entryPath: string; basePath: string; baseAbs: string; rootAbs: string;
  documentHtml: string;
  files: ApprovedFile[];
}
interface GrantRecord {
  expiresAt: number; identityId: string;
  entryPath: string; basePath: string;
}

/**
 * Enumerate .js/.css plus allowlisted asset extensions under `baseAbs`
 * (already resolved inside the workspace and outside .pi-console). Symlinked
 * directories are never traversed, hidden or tooling directories are skipped,
 * and exceeding scan limits fails the review explicitly rather than silently
 * truncating the user's verification surface.
 */
async function enumeratePreviewResources(rootAbs: string, baseAbs: string): Promise<string[]> {
  const found: string[] = [];
  let scanned = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > L.maxScanDepth) fail('preview_scan_limit');
    const entries = await fs.opendir(dir).catch(() => fail('preview_unavailable'));
    for await (const entry of entries) {
      if (++scanned > L.maxScanEntries) fail('preview_scan_limit');
      const full = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name.toLowerCase())) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        const extension = extname(entry.name).toLowerCase();
        if (extension !== '.js' && extension !== '.css' && !previewAssetType(extension)) continue;
        // Realpath must stay inside both the base dir and the workspace — a
        // same-name junction race cannot smuggle an outside file into the list.
        const real = await fs.realpath(full).catch(() => fail('preview_unavailable'));
        const toBase = relative(baseAbs, real), toRoot = relative(rootAbs, real);
        if (toBase === '..' || toBase.startsWith(`..${sep}`) || isAbsolute(toBase)) fail('preview_outside_base');
        if (!toRoot || toRoot === '..' || toRoot.startsWith(`..${sep}`) || isAbsolute(toRoot)) fail('preview_outside_workspace');
        if (found.length >= L.maxResources) fail('preview_scan_limit');
        found.push(real);
      }
    }
  };
  await walk(baseAbs, 0);
  return found.sort();
}

export class HtmlPreviewService {
  private store: WorkspaceStore;
  private now: () => number;
  private reviews = new Map<string, ReviewRecord>();
  private grants = new Map<string, GrantRecord>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: { store: WorkspaceStore; now?: () => number }) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
  }

  /** Serialized state transitions keep enable one-shot even for concurrent
   * calls; large grant payloads are never retained on the queue itself. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private prune(now: number): void {
    for (const [id, record] of this.reviews) if (record.expiresAt <= now) this.reviews.delete(id);
    for (const [id, record] of this.grants) if (record.expiresAt <= now) this.grants.delete(id);
  }

  private newId(): string {
    for (;;) {
      const id = randomBytes(16).toString('hex');
      if (!this.reviews.has(id) && !this.grants.has(id)) return id;
    }
  }

  private async readApproved(workspaceId: string, rel: string, baseAbs: string): Promise<{ content: string; sha256: string; bytes: number }> {
    const checkBase = async () => {
      const current = await resolveWorkspaceFile(this.store, workspaceId, rel).catch(() => fail('preview_unavailable'));
      const within = relative(baseAbs, current.target);
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) fail('preview_outside_base');
      return current.target;
    };
    const before = await checkBase();
    const file = await readWorkspaceText(this.store, workspaceId, rel).catch(() => fail('preview_unavailable'));
    if (await checkBase() !== before || file.path.split(sep).join('/') !== rel) fail('preview_changed');
    const content = file.content;
    return { content, sha256: sha256(content), bytes: textBytes(content) };
  }

  /**
   * Binary counterpart of readApproved: the canonical workspace path must stay
   * inside `baseAbs`/`rootAbs` before and after the bounded, signature-verified
   * read, and the raw SHA-256 (not UTF-8) is what gets re-verified at enable.
   * Raw bytes leave this function only to become a grant resource — review
   * records never retain them.
   */
  private async readApprovedAsset(workspaceId: string, rel: string, baseAbs: string, rootAbs: string): Promise<{ content: Buffer; sha256: string; bytes: number; kind: PreviewKind; mime: string }> {
    const extension = extname(rel).toLowerCase();
    const type = previewAssetType(extension);
    if (!type) fail('preview_asset_invalid');
    // Reject obviously-oversized files before any allocation or read.
    const limit = previewAssetByteLimit(type.kind);
    const checkBase = async (): Promise<string> => {
      const current = await resolveWorkspaceFile(this.store, workspaceId, rel).catch(() => fail('preview_unavailable'));
      const toBase = relative(baseAbs, current.target), toRoot = relative(rootAbs, current.target);
      if (toBase === '..' || toBase.startsWith(`..${sep}`) || isAbsolute(toBase)) fail('preview_outside_base');
      if (!toRoot || toRoot === '..' || toRoot.startsWith(`..${sep}`) || isAbsolute(toRoot)) fail('preview_outside_workspace');
      return current.target;
    };
    const target = await checkBase();
    const early = await fs.stat(target).catch(() => fail('preview_unavailable'));
    if (!early.isFile() || !early.size || early.size > limit) fail('preview_resource_limit');
    let verified = false;
    const data = await readPreviewAsset(target, async () => {
      if (await checkBase() !== target) fail('preview_changed');
      verified = true;
    }, fail);
    if (!verified) fail('preview_changed');
    return { content: data.content, sha256: data.sha256, bytes: data.bytes, kind: data.kind, mime: data.mime };
  }

  async review(body: unknown, caller: PreviewIdentity | undefined): Promise<PreviewReview> {
    return this.run(async () => {
      const now = this.now();
      this.prune(now);
      const identity = requireIdentity(caller, now);
      strictPermissionObject(body, ['workspaceId', 'path']);
      const request = body as PreviewReviewRequest;
      if (typeof request.workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(request.workspaceId) ||
          typeof request.path !== 'string' || !request.path.trim()) fail('invalid_arguments');
      if (!/\.html?$/i.test(request.path.trim())) fail('preview_not_html');
      if (this.reviews.size >= L.maxReviews) fail('preview_review_limit');

      // Canonical containment: resolve once through the shared guard so the
      // workspace root and the .pi-console boundary match every other preview.
      const resolved = await resolveWorkspaceFile(this.store, request.workspaceId, request.path.trim())
        .catch(() => fail('preview_unavailable'));
      const entryAbs = resolved.target;
      const baseAbs = dirname(entryAbs);
      // The canonical base dir must itself stay inside the workspace and must
      // never be the console's own data directory or one of its ancestors.
      if (baseAbs.toLowerCase().split(sep).includes('.pi-console')) fail('preview_outside_base');
      const stats = await fs.stat(entryAbs).catch(() => fail('preview_unavailable'));
      if (!stats.isFile()) fail('preview_unavailable');
      const rootAbs = resolved.root;
      const workspaceRel = (abs: string) => relative(rootAbs, abs).split(sep).join('/');
      const entryPath = workspaceRel(entryAbs);
      const basePath = workspaceRel(baseAbs);

      // Snapshot the entry first through the shared UTF-8/256 KiB guard.
      const document = await this.readApproved(request.workspaceId, entryPath, baseAbs);

      const candidates = await enumeratePreviewResources(rootAbs, baseAbs);
      const files: PreviewFileInfo[] = [{ path: entryPath, kind: 'html', bytes: document.bytes, sha256: document.sha256 }];
      const approved: ApprovedFile[] = [{ rel: entryPath, kind: 'html', sha256: document.sha256 }];
      let total = document.bytes;
      for (const abs of candidates) {
        const rel = workspaceRel(abs);
        const extension = extname(abs).toLowerCase();
        if (extension === '.js' || extension === '.css') {
          const file = await this.readApproved(request.workspaceId, rel, baseAbs);
          total += file.bytes;
          if (total > L.maxTotalResourceBytes) fail('preview_resource_limit');
          const kind: PreviewKind = extension === '.js' ? 'script' : 'style';
          files.push({ path: rel, kind, bytes: file.bytes, sha256: file.sha256 });
          approved.push({ rel, kind, sha256: file.sha256 });
        } else {
          // Review metadata only: size/signature are verified but raw bytes are
          // never retained — enable re-reads them under hash comparison anyway.
          const file = await this.readApprovedAsset(request.workspaceId, rel, baseAbs, rootAbs);
          total += file.bytes;
          if (total > L.maxTotalResourceBytes) fail('preview_resource_limit');
          files.push({ path: rel, kind: file.kind, bytes: file.bytes, sha256: file.sha256, mime: file.mime, encoding: 'base64' });
          approved.push({ rel, kind: file.kind, sha256: file.sha256 });
        }
      }
      // `found` is already bounded by the scan (maxResources + the entry), so
      // files.length can never exceed L.maxResources + 1 here.

      const issuedAt = this.now();
      requireIdentity(caller, issuedAt);
      const reviewId = this.newId();
      const record: ReviewRecord = {
        expiresAt: boundedExpiry(issuedAt, L.reviewTtlMs, identity),
        identityId: identity.id, workspaceId: request.workspaceId,
        entryPath, basePath, baseAbs, rootAbs, documentHtml: document.content,
        files: approved,
      };
      this.reviews.set(reviewId, record);
      return { reviewId, expiresAt: record.expiresAt, entryPath, basePath, documentHtml: record.documentHtml, files };
    });
  }

  async enable(body: unknown, caller: PreviewIdentity | undefined): Promise<PreviewGrant> {
    return this.run(async () => {
      const now = this.now();
      this.prune(now);
      const identity = requireIdentity(caller, now);
      strictPermissionObject(body, ENABLE_KEYS.filter(key => Object.hasOwn(body as object, key) || ['reviewId', 'allowScripts', 'allowStyles', 'confirmed'].includes(key)));
      const request = body as unknown as PreviewEnableRequest;
      const flag = (value: boolean | undefined): boolean => {
        if (value === undefined) return false;
        if (typeof value !== 'boolean') fail('invalid_arguments');
        return value;
      };
      const allowScripts = flag(request.allowScripts), allowStyles = flag(request.allowStyles);
      const allowImages = flag(request.allowImages), allowMedia = flag(request.allowMedia), allowFonts = flag(request.allowFonts);
      if (typeof request.reviewId !== 'string' || request.reviewId.length > 80 || request.confirmed !== true) fail('invalid_arguments');
      const review = this.reviews.get(request.reviewId);
      if (!review || review.expiresAt <= now) fail('preview_review_unavailable');
      if (review.identityId !== identity.id) fail('preview_identity_mismatch');
      if (this.grants.size >= L.maxGrants) fail('preview_grant_limit');
      // Consume the review before touching the disk: a slow re-read can never
      // become a second grant from the same review.
      this.reviews.delete(request.reviewId);

      // Re-approval is pinned to what the user verified: every approved file —
      // the HTML, each .js/.css, and each asset — is re-read and hash-compared;
      // a change or a deletion requires a fresh review. Only kinds a flag
      // enabled are delivered, and asset kinds never inherit each other's flag.
      let documentHtml = '';
      const resources: PreviewResource[] = [];
      let total = 0;
      for (const approved of review.files) {
        if (approved.kind === 'html' || approved.kind === 'script' || approved.kind === 'style') {
          const file = await this.readApproved(review.workspaceId, approved.rel, review.baseAbs);
          if (file.sha256 !== approved.sha256) fail('preview_changed');
          total += file.bytes;
          if (total > L.maxTotalResourceBytes) fail('preview_resource_limit');
          if (approved.kind === 'html') { documentHtml = file.content; continue; }
          if ((approved.kind === 'script' ? allowScripts : allowStyles)) {
            resources.push({ path: approved.rel, kind: approved.kind, bytes: file.bytes, sha256: file.sha256, content: file.content });
          }
        } else {
          const file = await this.readApprovedAsset(review.workspaceId, approved.rel, review.baseAbs, review.rootAbs);
          if (file.sha256 !== approved.sha256) fail('preview_changed');
          total += file.bytes;
          if (total > L.maxTotalResourceBytes) fail('preview_resource_limit');
          const allowed = approved.kind === 'image' ? allowImages
            : approved.kind === 'font' ? allowFonts : allowMedia;
          if (allowed) {
            resources.push({ path: approved.rel, kind: approved.kind, bytes: file.bytes, sha256: file.sha256, mime: file.mime, encoding: 'base64', content: file.content.toString('base64') });
          }
        }
      }
      const issuedAt = this.now();
      requireIdentity(caller, issuedAt);
      if (review.expiresAt <= issuedAt) fail('preview_review_unavailable');
      const grantId = this.newId();
      const grant: GrantRecord = { expiresAt: boundedExpiry(issuedAt, L.grantTtlMs, identity), identityId: identity.id, entryPath: review.entryPath, basePath: review.basePath };
      this.grants.set(grantId, grant);
      return {
        grantId, expiresAt: grant.expiresAt, entryPath: review.entryPath, basePath: review.basePath,
        documentHtml, allowScripts, allowStyles, allowImages, allowMedia, allowFonts, resources,
      };
    });
  }

  async revoke(body: unknown, caller: PreviewIdentity | undefined): Promise<PreviewRevokeResult> {
    return this.run(async () => {
      const now = this.now();
      this.prune(now);
      const identity = requireIdentity(caller, now);
      strictPermissionObject(body, ['grantId']);
      const request = body as PreviewRevokeRequest;
      if (typeof request.grantId !== 'string' || request.grantId.length > 80) fail('invalid_arguments');
      const grant = this.grants.get(request.grantId);
      if (!grant || grant.expiresAt <= now) fail('preview_grant_unavailable');
      if (grant.identityId !== identity.id) fail('preview_identity_mismatch');
      this.grants.delete(request.grantId);
      return { ok: true };
    });
  }
}

const ROUTES: Record<string, 'review' | 'enable' | 'revoke'> = {
  '/api/workspace/preview/review': 'review',
  '/api/workspace/preview/enable': 'enable',
  '/api/workspace/preview/revoke': 'revoke',
};

const send = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
};

const errorStatus = (e: unknown): number => {
  const code = e instanceof PermissionFault ? e.code : '';
  if (code === 'preview_identity_required' || code === 'preview_identity_expired' || code === 'preview_identity_mismatch') return 403;
  if (code === 'preview_review_unavailable' || code === 'preview_grant_unavailable' || code === 'preview_changed' ||
      code === 'preview_review_limit' || code === 'preview_grant_limit' || code === 'preview_scan_limit' || code === 'preview_resource_limit') return 409;
  return 400;
};

export function createHtmlPreviewHttp(options: {
  service: HtmlPreviewService;
  /** Verified authentication principal for this request (issuer/aud/sub or 'local'). */
  identity: (req: IncomingMessage) => PreviewIdentity | undefined;
}) {
  return {
    handle: async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = ROUTES[url.pathname];
      if (!route) return false;
      try {
        // POST-only, no query string. Unknown methods are denied rather than
        // falling through to another handler for this exact route name.
        if (req.method !== 'POST' || url.search) fail('preview_route_unavailable');
        const body = await readJsonBody(req, L.maxBodyBytes);
        if (!object(body)) fail('invalid_arguments');
        const result = route === 'review' ? await options.service.review(body, options.identity(req))
          : route === 'enable' ? await options.service.enable(body, options.identity(req))
          : await options.service.revoke(body, options.identity(req));
        send(res, 200, result);
      } catch (e) {
        req.resume();
        send(res, e instanceof PermissionFault ? errorStatus(e) : 400,
          { error: e instanceof PermissionFault ? e.code : 'preview_request_unavailable' });
      }
      return true;
    },
  };
}
export type HtmlPreviewHttp = ReturnType<typeof createHtmlPreviewHttp>;
