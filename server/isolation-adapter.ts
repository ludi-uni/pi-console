import type {Readable,Writable} from 'node:stream';
import type {IsolationBinding} from '../shared/external-mcp.ts';
/** A future audited dependency is injected by trusted bootstrap code, not discovered from env,
 * request headers, settings booleans, or arbitrary module paths. No package is installed here.
 * The package must verify its protected setup receipt, OS enforcement and all management
 * protections; revoke synchronously when uncertain. Console cannot manufacture this proof. */
export interface IsolationAdapter {
  inspect(binding: Readonly<IsolationBinding>, signal: AbortSignal): Promise<unknown>;
  onInvalidated(listener: () => void): () => void;
  /** Atomically revalidate policy/instance/receipt and OS limits before launch; no plain spawn fallback.
   * Resolve executable/roots/environment from protected policy, not caller-supplied paths/secrets.
   * All descendants and separate agent runners must remain in the package's enforcement domain. */
  launch(request: RestrictedAgentRequest, authorize: () => void): Promise<RestrictedAgentHandle>;
  // Call authorize immediately before OS admission, with no await between authorization and
  // the atomic restricted launch. For an out-of-process broker use a protected admission
  // handshake with equivalent ordering; cached IDs/booleans are not launch authority.
  /** Explicit owner action only, exact owned handle. Revocation itself must not kill work. */
  stop(handle: RestrictedAgentHandle): Promise<void>;
}
export type RestrictedAgentRequest = { binding: Readonly<IsolationBinding>; admissionId: string; workspaceId: string; sessionId: string; generation: string; protocolVersion: 1 };
export type RestrictedAgentHandle = { id: string; binding: IsolationBinding; stdin: Writable; stdout: Readable; stderr: Readable; closed: Promise<void> };
