// Explicit-consent HTML preview — document assembly for the sandboxed srcdoc
// frame. Everything here is string-only: the entry HTML is parsed with DOMParser
// into an inert Document that is never inserted into the shell's DOM, and the
// serialized result runs only inside an opaque sandboxed iframe.
//
// Boundary model (defense in depth):
//   1. The parent shell serves this page under a strict CSP with frame-src
//      'none', so the srcdoc document can never navigate itself or open frames.
//   2. The child document gets an even tighter meta CSP as its first <head>
//      node — connect/frame/worker/object/base/form are always 'none';
//      images/media/fonts remain embedded data only, and each source directive
//      is 'none' unless the matching consent flag is on (img-src ↔ allowImages,
//      media-src ↔ allowMedia, font-src ↔ allowFonts); script/style sources are
//      likewise 'none' unless consented, and then only 'unsafe-inline' data:
//      (never network URLs).
//   3. Only grant-approved resources (manifest-verified by the server) may be
//      embedded, always as data: URLs. Binary resources are delivered base64
//      and embedded verbatim — never re-encoded through TextEncoder. Unknown,
//      mismatched or external references are removed and reported as warnings —
//      a blocked reference never falls back to a network fetch because the
//      child CSP forbids it anyway.
//   4. The iframe sandbox attribute is empty without script consent and
//      'allow-scripts' with it. allow-same-origin, allow-top-navigation,
//      allow-forms, allow-popups and allow-downloads are never granted.
//
// No regex rewriting is trusted for safety: CSP is the final boundary. The
// DOM-level removals below only reduce noise and keep dangerous surfaces
// (base hijack, meta refresh, subframes) out of the serialized document.
import { PREVIEW_ASSET_FLAG, PREVIEW_ASSET_TYPES, previewAssetType, type PreviewGrant } from '../shared/html-preview.ts';

export interface PreviewWarning { path?: string; reason: 'module' | 'importmap' | 'unapproved' | 'external' | 'cycle' | 'unsupported' }

export interface PreviewRenderResult {
  /** Serialized document for iframe.srcdoc. Never assign to any other sink. */
  srcdoc: string;
  /** Sandbox token list for the iframe: '' or 'allow-scripts'. */
  sandbox: 'allow-scripts' | '';
  warnings: PreviewWarning[];
  blockedCounts: { scripts: number; styles: number; links: number; embeds: number; assets: number };
}

/** Total expansion budget: entry HTML plus every data:-embedded resource.
 * The server caps raw grant bytes at 16 MiB and base64 inflates them by ~4/3,
 * so a headroom far above that is needed for legitimate previews; the budget
 * exists to bound cumulative @import inlining, repeated giant data URIs and
 * pathological quoting before huge strings are built. */
export const PREVIEW_RENDER_LIMITS = {
  maxExpandedBytes: 64 * 1024 * 1024,
  maxReferences: 128,
} as const;

class PreviewRenderLimit extends Error { constructor() { super('preview_render_limit'); } }
export const isPreviewRenderLimit = (e: unknown): boolean => e instanceof PreviewRenderLimit;

/** UTF-8-safe base64 data URL for text kinds (btoa alone cannot encode
 * non-Latin-1 text). Binary resources never go through here — their server
 * base64 is embedded verbatim to keep the exact signed bytes. */
function toDataUrl(mime: string, text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // Chunked conversion keeps multi-MiB resources off the call-argument limit
  // while staying a plain base64 of the exact UTF-8 bytes.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mime};charset=utf-8;base64,${btoa(binary)}`;
}

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** Running byte budget shared by every embedding step; throwing mid-build is
 * intentional — a partially-expanded document is never returned. */
class Budget {
  used: number;
  references = 0;
  constructor(seed: string) {
    this.used = utf8Length(seed);
    if (this.used > PREVIEW_RENDER_LIMITS.maxExpandedBytes) throw new PreviewRenderLimit();
  }
  charge(text: string): void {
    this.used += utf8Length(text);
    if (this.used > PREVIEW_RENDER_LIMITS.maxExpandedBytes) throw new PreviewRenderLimit();
  }
  reference(): void {
    if (++this.references > PREVIEW_RENDER_LIMITS.maxReferences) throw new PreviewRenderLimit();
  }
}

/** Resolve a document-relative URL against the workspace manifest base.
 * Only workspace-relative candidate paths are returned; absolute URLs
 * (http:, //cdn, data:, javascript:, …) and out-of-base traversals yield
 * undefined so the caller can warn and remove. */
function resolveManifestPath(raw: string | null, basePath: string,allowedBase=basePath): string | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//')) return undefined;
  let url:URL;
  try{url=new URL(trimmed,`https://preview.invalid/${basePath.split('/').filter(Boolean).map(encodeURIComponent).join('/')}${basePath?'/':''}`);}catch{return undefined;}
  if(url.origin!=='https://preview.invalid')return undefined;
  const parts:string[]=[];
  for(const encoded of url.pathname.split('/')){
    if(!encoded)continue;
    let segment:string;try{segment=decodeURIComponent(encoded);}catch{return undefined;}
    if(/[\/\\\u0000-\u001f]/.test(segment)||segment==='.'||segment==='..')return undefined;
    parts.push(segment);
  }
  const canonical = parts.join('/');
  return allowedBase && (canonical === allowedBase || !canonical.startsWith(`${allowedBase}/`)) ? undefined : canonical;
}

/** Child CSP — always tighter than the parent's, inserted as the first <head>
 * node so no earlier element can establish a base or policy. Each binary
 * family is 'none' until its own consent flag opens it to embedded data:. */
function childCsp(flags: { allowScripts: boolean; allowStyles: boolean; allowImages: boolean; allowMedia: boolean; allowFonts: boolean }): string {
  return [
    "default-src 'none'",
    `script-src ${flags.allowScripts ? "'unsafe-inline' data:" : "'none'"}`,
    `style-src ${flags.allowStyles ? "'unsafe-inline' data:" : "'none'"}`,
    `img-src ${flags.allowImages ? 'data:' : "'none'"}`,
    `media-src ${flags.allowMedia ? 'data:' : "'none'"}`,
    `font-src ${flags.allowFonts ? 'data:' : "'none'"}`,
    "connect-src 'none'", "frame-src 'none'", "child-src 'none'", "worker-src 'none'",
    "object-src 'none'", "manifest-src 'none'",
    "base-uri 'none'", "form-action 'none'", // ancestor protection belongs to the shell HTTP header
  ].join('; ');
}

/** Elements that could reach beyond the opaque frame or re-target parsing are
 * always removed regardless of consent. */
const ALWAYS_REMOVE = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'fencedframe', 'base']);

type AssetKind = 'image' | 'audio' | 'video' | 'font';
interface ApprovedAsset { kind: AssetKind; mime: string; base64: string }

const extensionOf = (path: string): string => { const i = path.lastIndexOf('.'); return i < 0 ? '' : path.slice(i).toLowerCase(); };
/** Strict transport base64 — anything looser (whitespace, url-safe alphabets,
 * odd lengths) is a contract violation and the resource is rejected whole. */
const isStrictBase64 = (value: string): boolean => value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
const base64ByteLength = (value: string): number => (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);

/** Inline CSS @import inliner: resolves quoted/url() targets against the
 * approved-style manifest and splices their (recursively inlined) content.
 * Non-matching imports are removed with a warning; CSP blocks anything left.
 * After imports are expanded each level's remaining url() references are
 * embedded against that stylesheet's own directory, so an imported file keeps
 * resolving its relative urls from where it actually lives. */
function inlineCssImports(css: string, path: string, styles: Map<string, string>, resolveAsset: (raw: string, baseDir: string) => string | undefined, budget: Budget, warnings: PreviewWarning[], visiting: Set<string>): string {
  const pattern = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);/gi;
  let result = '', last = 0;
  for (let match = pattern.exec(css); match; match = pattern.exec(css)) {
    result += css.slice(last, match.index);
    last = pattern.lastIndex;
    const reference=match[1]??match[2]??match[3]??match[4]??match[5];
    const media=match[6].trim();
    if(/\b(?:layer|supports)\s*(?:\(|$)/i.test(media)){warnings.push({path:reference,reason:'unsupported'});continue;}
    const resolved = resolveManifestPath(reference, path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', ''); // the manifest remains the outer scope boundary
    if (resolved === path || (resolved && visiting.has(resolved))) { warnings.push({ path: resolved, reason: 'cycle' }); continue; }
    const inner = resolved ? styles.get(resolved) : undefined;
    if (inner === undefined) { warnings.push({ path: resolved ?? reference, reason: resolved ? 'unapproved' : 'external' }); continue; }
    visiting.add(resolved!);
    const expanded = inlineCssImports(inner, resolved!, styles, resolveAsset, budget, warnings, visiting);
    visiting.delete(resolved!);
    budget.reference();
    budget.charge(expanded);
    if(media)budget.charge(media);
    result += media?`@media ${media}{${expanded}}`:expanded;
  }
  return embedCssUrls(result + css.slice(last), path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', resolveAsset);
}

/** CSS url() embedder: every remaining url() is either a document-internal
 * #fragment (kept verbatim), an already-embedded data: URL (kept only while
 * its allowlisted kind is consented), or a workspace-relative path embedded
 * from the grant's image/font resources. Everything else collapses to the
 * literal none with a warning — in url() contexts where none is not a valid
 * value the declaration simply fails, and the child CSP is still the hard
 * boundary. */
function embedCssUrls(css: string, baseDir: string, resolveAsset: (raw: string, baseDir: string) => string | undefined): string {
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)"']+))\s*\)/gi;
  let result = '', last = 0;
  for (let match = pattern.exec(css); match; match = pattern.exec(css)) {
    result += css.slice(last, match.index);
    last = pattern.lastIndex;
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!raw || raw.startsWith('#')) { result += match[0]; continue; }
    const url = resolveAsset(raw, baseDir);
    result += url === undefined ? 'none' : `url("${url}")`;
  }
  return result + css.slice(last);
}

const isStylesheetLink = (rel: string): boolean => rel.toLowerCase().split(/\s+/).includes('stylesheet');

const XLINK = 'http://www.w3.org/1999/xlink';
/** Known allowlisted mimes → kind, for authored data: URL acceptance. */
const ASSET_MIME_KIND: Record<string, AssetKind> = Object.fromEntries(
  Object.values(PREVIEW_ASSET_TYPES).map(type => [type.mime, type.kind])) as Record<string, AssetKind>;
const IMAGE_KINDS: readonly AssetKind[] = ['image'];
const MEDIA_KINDS: readonly AssetKind[] = ['audio', 'video'];
const CSS_KINDS: readonly AssetKind[] = ['image', 'font'];

/**
 * Build the srcdoc payload for one consented grant. The input Document comes
 * from DOMParser in the caller; it is mutated in place here and discarded —
 * it is never adopted into the live DOM.
 */
export function buildPreviewDocument(document: Document, grant: PreviewGrant): PreviewRenderResult {
  const warnings: PreviewWarning[] = [];
  const blocked = { scripts: 0, styles: 0, links: 0, embeds: 0, assets: 0 };
  const scripts = new Map<string, string>();
  const styles = new Map<string, string>();
  const assets = new Map<string, ApprovedAsset>();
  const flagFor = (kind: AssetKind): boolean => grant[PREVIEW_ASSET_FLAG[kind]] === true;
  for (const resource of grant.resources) {
    if (resource.kind === 'script') scripts.set(resource.path, resource.content);
    else if (resource.kind === 'style') styles.set(resource.path, resource.content);
    else {
      // Strict contract check: extension, kind, mime, encoding, base64 shape
      // and declared byte count must all agree, and the matching consent flag
      // must be on. A mismatched or disguised resource is rejected whole —
      // it can never smuggle script/style bytes or unconsented kinds in.
      const type = previewAssetType(extensionOf(resource.path));
      const kind = resource.kind as AssetKind;
      const valid = !!type && type.kind === resource.kind && resource.mime === type.mime &&
        resource.encoding === 'base64' && flagFor(kind) &&
        isStrictBase64(resource.content) && base64ByteLength(resource.content) === resource.bytes;
      if (!valid) { warnings.push({ path: resource.path, reason: 'unsupported' }); continue; }
      assets.set(resource.path, { kind, mime: type.mime, base64: resource.content });
    }
  }

  const budget = new Budget(grant.documentHtml);
  for (const content of scripts.values()) budget.charge(content);
  for (const content of styles.values()) budget.charge(content);

  const remove = (element: Element, bucket: keyof typeof blocked) => { blocked[bucket]++; element.remove(); };

  // base hijack and any element that can embed/navigate content.
  for (const element of Array.from(document.querySelectorAll([...ALWAYS_REMOVE].join(',')))) remove(element, 'embeds');
  for (const meta of Array.from(document.querySelectorAll('meta'))) {
    const httpEquiv = meta.getAttribute('http-equiv')?.trim().toLowerCase();
    if (httpEquiv === 'refresh' || httpEquiv === 'content-security-policy' || httpEquiv === 'set-cookie') meta.remove();
  }

  // Fragment jumps are local to this document. Strip other authored anchor
  // navigation (including SVG xlink); the parent's frame-src 'none' remains
  // the enforcement boundary for links created later by consented scripts.
  for(const anchor of Array.from(document.querySelectorAll('a,area'))){
    for(const [namespace,name] of [[null,'href'],[XLINK,'href']] as const){
      const href=namespace?anchor.getAttributeNS(namespace,name):anchor.getAttribute(name);
      if(href!==null&&!href.trim().startsWith('#')){
        if(namespace)anchor.removeAttributeNS(namespace,name);else anchor.removeAttribute(name);
        blocked.links++;warnings.push({path:href,reason:'unsupported'});
      }else if(href!==null){
        // srcdoc inherits the shell's base URL. A bare #fragment can therefore
        // resolve to the Console URL in Chrome and be blocked as navigation.
        // Pin jumps to this srcdoc document, never the trusted shell.
        const target=`about:srcdoc${href.trim()}`;
        if(namespace)anchor.setAttributeNS(namespace,'xlink:href',target);else anchor.setAttribute(name,target);
      }
    }
    anchor.removeAttribute('target');anchor.removeAttribute('download');anchor.removeAttribute('ping');
  }

  /** Resolve one authored URL (HTML attribute or CSS url()) to an embedded
   * data: URL. `accept` lists the asset kinds this reference may use — an
   * <img> can never embed a video file even though both are granted. Returns
   * undefined after pushing a warning; the caller removes or blanks the
   * reference and the child CSP remains the hard boundary. */
  const resolveAssetUrl = (raw: string, basePath: string, accept: readonly AssetKind[]): string | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (/^data:/i.test(trimmed)) {
      // Authored data: URLs survive only with a known allowlisted mime whose
      // kind this reference accepts and whose flag is on — data:image/svg or
      // disguised kinds are always rejected.
      const mime = /^data:([^;,\s]+)/i.exec(trimmed)?.[1]?.toLowerCase() ?? '';
      const mimeKind = ASSET_MIME_KIND[mime];
      if (mimeKind && accept.includes(mimeKind) && flagFor(mimeKind)) return trimmed;
      warnings.push({ path: trimmed.slice(0, 64), reason: 'unsupported' });
      return undefined;
    }
    if (trimmed.startsWith('#')) { warnings.push({ path: trimmed, reason: 'unsupported' }); return undefined; }
    const path = resolveManifestPath(trimmed, basePath, '');
    if (!path) { warnings.push({ path: trimmed.slice(0, 80), reason: 'external' }); return undefined; }
    const asset = assets.get(path);
    if (!asset) { warnings.push({ path, reason: 'unapproved' }); return undefined; }
    if (!accept.includes(asset.kind) || !flagFor(asset.kind)) { warnings.push({ path, reason: 'unsupported' }); return undefined; }
    budget.reference();
    // Binary resources keep the server's exact base64 — never re-encoded.
    const url = `data:${asset.mime};base64,${asset.base64}`;
    budget.charge(url);
    return url;
  };
  const resolveCssAsset = (raw: string, baseDir: string): string | undefined => resolveAssetUrl(raw, baseDir, CSS_KINDS);

  /** srcset candidates: a URL runs to whitespace, descriptors run to the next
   * comma (so data: URLs, whose base64 contains a comma, stay intact). Dropped
   * candidates keep the responsive fallback for the survivors. */
  const rewriteSrcset = (value: string): string => {
    const out: string[] = [];
    let i = 0;
    while (i < value.length) {
      while (i < value.length && /[\s,]/.test(value[i])) i++;
      if (i >= value.length) break;
      const urlStart = i;
      while (i < value.length && !/\s/.test(value[i])) i++;
      const rawUrl = value.slice(urlStart, i);
      const trailingComma = rawUrl.endsWith(',');
      const candidateUrl = rawUrl.replace(/,+$/, '');
      let descriptor = '';
      if (!trailingComma) {
        const descStart = i;
        while (i < value.length && value[i] !== ',') i++;
        descriptor = value.slice(descStart, i).trim();
      }
      const resolved = candidateUrl ? resolveAssetUrl(candidateUrl, grant.basePath, IMAGE_KINDS) : undefined;
      if (resolved) out.push(descriptor ? `${resolved} ${descriptor}` : resolved);
    }
    return out.join(', ');
  };

  const embedAttribute = (element: Element, name: 'src' | 'srcset' | 'poster' | 'background', accept: readonly AssetKind[]) => {
    const value = element.getAttribute(name);
    if (value === null) return;
    if (name === 'srcset') {
      const rewritten = rewriteSrcset(value);
      if (rewritten) { element.setAttribute(name, rewritten); return; }
      element.removeAttribute(name); blocked.assets++; return;
    }
    const url = resolveAssetUrl(value, grant.basePath, accept);
    if (url === undefined) { element.removeAttribute(name); blocked.assets++; return; }
    element.setAttribute(name, url);
  };

  // Links: approved stylesheets may become data: URLs when style consent is
  // on; every other link (icons, preloads, modulepreload, manifest, …) goes.
  for (const link of Array.from(document.querySelectorAll('link'))) {
    if (!isStylesheetLink(link.getAttribute('rel') ?? '') || !grant.allowStyles) { remove(link, 'links'); continue; }
    const href = link.getAttribute('href');
    const path = resolveManifestPath(href, grant.basePath);
    const content = path ? styles.get(path) : undefined;
    if (content === undefined) { warnings.push({ path: path ?? href ?? '', reason: path ? 'unapproved' : 'external' }); remove(link, 'links'); continue; }
    const resolved = path!;
    const imported = inlineCssImports(content, resolved, styles, resolveCssAsset, budget, warnings, new Set([resolved]));
    budget.reference();
    const url = toDataUrl('text/css', imported);
    budget.charge(url);
    link.removeAttribute('integrity');link.removeAttribute('crossorigin');
    link.setAttribute('href', url);
  }

  // Styles: inline <style> and style="" attributes only survive with consent.
  if (!grant.allowStyles) {
    for (const style of Array.from(document.querySelectorAll('style'))) remove(style, 'styles');
    for (const element of Array.from(document.querySelectorAll('[style]'))) element.removeAttribute('style');
  } else {
    for (const style of Array.from(document.querySelectorAll('style'))) {
      const expanded = inlineCssImports(style.textContent ?? '', grant.basePath ? `${grant.basePath}/` : '', styles, resolveCssAsset, budget, warnings, new Set());
      // Expanded CSS comes from another file and can contain literal HTML
      // end tags. Raw-text <style> serialization does not escape </style>:
      // encode the stylesheet rather than injecting those bytes into HTML.
      budget.reference();
      const url=toDataUrl('text/css',expanded);budget.charge(url);
      style.textContent = `@import url("${url}");`;
    }
    // style="" attributes resolve url() against the document's directory.
    for (const element of Array.from(document.querySelectorAll('[style]'))) {
      element.setAttribute('style', embedCssUrls(element.getAttribute('style') ?? '', grant.basePath, resolveCssAsset));
    }
  }

  // Scripts: module/importmap are explicitly unsupported (never loosened);
  // classic external scripts embed only manifest-approved data: URLs.
  for (const script of Array.from(document.querySelectorAll('script'))) {
    const type = (script.getAttribute('type') ?? '').trim().toLowerCase();
    if (type === 'importmap' || type === 'module') {
      warnings.push({ reason: type === 'importmap' ? 'importmap' : 'module' });
      remove(script, 'scripts'); continue;
    }
    const src = script.getAttribute('src');
    if (!grant.allowScripts) { remove(script, 'scripts'); continue; }
    if (src === null) continue; // inline classic stays as authored
    const path = resolveManifestPath(src, grant.basePath);
    const content = path ? scripts.get(path) : undefined;
    if (content === undefined) { warnings.push({ path: path ?? src, reason: path ? 'unapproved' : 'external' }); remove(script, 'scripts'); continue; }
    budget.reference();
    const url = toDataUrl('application/javascript', content);
    budget.charge(url);
    script.removeAttribute('integrity');script.removeAttribute('crossorigin');
    script.setAttribute('src', url);
  }
  // With script consent off, strip handler attributes and javascript: URLs so
  // the safe view is visibly inert (the child CSP is still the real boundary).
  if (!grant.allowScripts) {
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
        else if (/^\s*javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name);
      }
    }
  }

  // Binary references: every attribute below is resolved through the grant's
  // asset manifest — an allowlisted raster image for <img>/srcset/picture
  // sources/SVG <image>/video poster, an audio or video resource for media
  // elements, anything else (external, unapproved, disguised) removed.
  for (const element of Array.from(document.querySelectorAll('img, input'))) {
    if (element.localName === 'input' && (element.getAttribute('type') ?? '').trim().toLowerCase() !== 'image') continue;
    embedAttribute(element, 'src', IMAGE_KINDS);
    embedAttribute(element, 'srcset', IMAGE_KINDS);
  }
  for (const source of Array.from(document.querySelectorAll('picture > source'))) {
    embedAttribute(source, 'srcset', IMAGE_KINDS);
  }
  for (const image of Array.from(document.querySelectorAll('image'))) {
    for (const [namespace, name] of [[null, 'href'], [XLINK, 'href']] as const) {
      const value = namespace ? image.getAttributeNS(namespace, name) : image.getAttribute(name);
      if (value === null) continue;
      const url = resolveAssetUrl(value, grant.basePath, IMAGE_KINDS);
      if (url === undefined) {
        if (namespace) image.removeAttributeNS(namespace, name); else image.removeAttribute(name);
        blocked.assets++;
      } else if (namespace) image.setAttributeNS(namespace, 'xlink:href', url);
      else image.setAttribute(name, url);
    }
  }
  for (const element of Array.from(document.querySelectorAll('audio, video'))) {
    // Autoplay is never honoured: the iframe policy says 'none' and the
    // attribute is stripped so the media only plays from a manual control.
    element.removeAttribute('autoplay');
    element.setAttribute('preload', 'none');
    embedAttribute(element, 'src', MEDIA_KINDS);
    if (element.localName === 'video') embedAttribute(element, 'poster', IMAGE_KINDS);
    for (const source of Array.from(element.querySelectorAll('source'))) embedAttribute(source, 'src', MEDIA_KINDS);
  }
  // Sweep: any reference that survived untouched (track, unknown elements,
  // use/svg indirection) still must not resolve to a network URL.
  for (const element of Array.from(document.querySelectorAll('[src],[srcset],[poster],[background]'))) {
    for (const name of ['src', 'srcset', 'poster', 'background'] as const) {
      const value = element.getAttribute(name);
      if (value !== null && !value.trim().startsWith('data:')) {
        element.removeAttribute(name);
        blocked.assets++;
        warnings.push({ path: value.trim().slice(0, 80), reason: resolveManifestPath(value, grant.basePath, '') ? 'unapproved' : 'external' });
      }
    }
  }
  for (const use of Array.from(document.querySelectorAll('use'))) {
    for (const [namespace, name] of [[null, 'href'], [XLINK, 'href']] as const) {
      const value = namespace ? use.getAttributeNS(namespace, name) : use.getAttribute(name);
      if (value !== null && !value.trim().startsWith('#')) {
        if (namespace) use.removeAttributeNS(namespace, name); else use.removeAttribute(name);
        blocked.assets++;
        warnings.push({ path: value.trim().slice(0, 80), reason: 'external' });
      }
    }
  }

  // Child CSP first: nothing in the parsed document may precede it.
  const head = document.head ?? document.documentElement.insertBefore(document.createElement('head'), document.documentElement.firstChild);
  const csp = document.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', childCsp({
    allowScripts: grant.allowScripts, allowStyles: grant.allowStyles,
    allowImages: grant.allowImages === true, allowMedia: grant.allowMedia === true, allowFonts: grant.allowFonts === true,
  }));
  head.insertBefore(csp, head.firstChild);

  const srcdoc = `<!doctype html>\n${document.documentElement.outerHTML}`;
  if (utf8Length(srcdoc) + budget.used > PREVIEW_RENDER_LIMITS.maxExpandedBytes) throw new PreviewRenderLimit();
  return { srcdoc, sandbox: grant.allowScripts ? 'allow-scripts' : '', warnings, blockedCounts: blocked };
}
