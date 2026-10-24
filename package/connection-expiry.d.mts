export const CONFIRMATION_WAIT_MS: number;
export const MAX_GRANT_MS: number;
export const MAX_CONNECTION_MS: number;
export const TRANSPORT_MINUTES: readonly number[];
export const LONG_TRANSPORT_MINUTES: number;
export const LEASE_TIMER_CHUNK_MS: number;
export function grantExpired(expiresAt: number | null, now: number): boolean;
export function expiryText(expiresAt: number | null, now?: number): string;
