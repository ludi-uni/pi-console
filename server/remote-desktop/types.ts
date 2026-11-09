export const REMOTE_CONNECTION = 'caivi-vm' as const;
export type RemoteRole = 'gui' | 'transfer';
export type RemoteOperation = 'inspect' | 'screenshot' | 'file_send' | 'caivi_click' | 'caivi_input' | 'caivi_drag';
/** Operator-granted capability names. 'read' covers inspect/screenshot (gui role); 'operate' covers the fixed caivi_* guest operations (gui role); 'send' covers file_send (transfer role). */
export type RemoteGrant = 'read' | 'operate' | 'send';

export interface EndpointMetadata { address: string; port: number; pinSha256: string; expiresUtc: string; generation: string; }
export interface ConnectionMetadata { connection: typeof REMOTE_CONNECTION; hostName: 'AI-DESKTOP-01'; gui: EndpointMetadata; transfer: EndpointMetadata; }
export interface TokenCodec { scope: 'CurrentUser'; mode: string; protect(data: Buffer, entropy: Buffer): Promise<Buffer>; unprotect(data: Buffer, entropy: Buffer): Promise<Buffer>; }
export interface RemoteRequest { connection: typeof REMOTE_CONNECTION; operation: RemoteOperation; artifact_name?: string; }
export interface TrustedArtifact { name: string; path: string; sha256: string; size: number; }
/** Identity fields the operator binds this connection to. Never exposed to the model. */
export interface ApprovedTarget { pid: number; hwnd: number; hash: string; session: number | string; }
/** The TLS adapter validates the Phase7 envelope before handing it to the broker. */
export interface TransportProof { ok: boolean; result?: unknown; error?: string; outcome: 'KNOWN' | 'UNKNOWN'; authenticated?: boolean; }
export interface RemoteTransport { (request: { endpoint: EndpointMetadata; operation: RemoteOperation; token: Buffer; artifact?: TrustedArtifact }): Promise<TransportProof>; }
export interface AuditEvent { connection: string; operation: RemoteOperation; role: RemoteRole; outcome: 'ok' | 'denied' | 'unknown' | 'failed'; timestamp: string; }
/** Public consent view of one pending write request. Never carries tokens, endpoint internals, PID/HWND, or guest paths. */
export interface PendingApproval { approvalId: string; operation: RemoteOperation; artifact?: { name: string; sha256: string; size: number }; requestedAt: string; expiresAt: string; revision: number; }
/** Public view of a registered artifact: name, digest and size only; host paths stay server-side. */
export interface ArtifactView { name: string; sha256: string; size: number; }
