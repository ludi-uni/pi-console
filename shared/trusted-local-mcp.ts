export type LocalControlTarget = {
    instance: string;
    revision: number;
    workspaceId: string;
    sessionId: string;
    generation: string;
};
export type LocalControlGrant = {
    target: LocalControlTarget;
    expiresAt: number;
    credentialEpoch: string;
};
export type LocalMcpStatus = {
    mode: 'trusted-local';
    workerTrust: 'trusted';
    osIsolation: 'unverified';
    enabled: boolean;
    reason: 'disabled' | 'unconfigured' | 'unbound' | 'active' | 'disposed' | 'credential_expired';
    port: number | null;
    revision: number;
    credentialExpiresAt: number | null;
};
export type LocalOwnerView = {
    status: LocalMcpStatus;
    instance: string;
    revision: number;
    choices: LocalControlTarget[];
    grant: {
        target: LocalControlTarget;
        expiresAt: number;
        active: boolean;
    } | null;
};
export type LocalOwnerReview = {
    reviewId: string;
    requestId: string;
    instance: string;
    revision: number;
    target: LocalControlTarget | null;
    expiresAt: number | null;
};
