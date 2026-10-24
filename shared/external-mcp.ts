export type IsolationBinding = { installationId: string; instanceId: string; policyGeneration: string };
export const isolationChecks = ['administratorOnlySetup','lowPrivilegeWorker','restrictedLaunch','restrictedStop','managementStoreProtected','managementApiProtected','secretNonInheritance','descendantsProtected','separateRunnersProtected'] as const;
export type IsolationCheck = typeof isolationChecks[number];
export type ExternalMcpReason = 'adapter_unavailable'|'adapter_unsupported'|'setup_required'|'setup_denied'|'verification_failed'|'verification_unknown'|'verification_stale'|'binding_mismatch'|'protection_unverified'|'recheck_required'|'disabled'|'ready'|'authority_changed';
export type ExternalMcpStatus = { enabled: boolean; readiness: 'unavailable'|'setup_required'|'recheck_required'|'ready'; reason: ExternalMcpReason; revision: number; adapterAvailable: boolean; checkedAt: number|null; expiresAt: number|null };
/** Only a trusted, code-bound package may supply this evidence. It is never HTTP input. */
export type IsolationInspection = {
  supported: boolean;
  setup: { decision: 'approved'|'denied'|'missing'; receiptId: string; installationId: string; policyGeneration: string; administratorApproved: boolean };
  verification: { outcome: 'verified'|'failed'|'unknown'; binding: IsolationBinding; checkedAt: number; expiresAt: number; checks: Record<IsolationCheck, boolean> };
};
