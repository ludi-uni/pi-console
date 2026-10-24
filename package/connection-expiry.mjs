// Shared finite confirmation policy; null is only an explicitly approved folder grant.
export const CONFIRMATION_WAIT_MS = 5 * 60_000;
export const MAX_GRANT_MS = 24 * 60 * 60_000;
export const MAX_CONNECTION_MS = 8 * 60 * 60_000;
// Explicit long transport consent does not extend any credential or operation grant.
export const TRANSPORT_MINUTES = Object.freeze([60, 480, 44640]);
export const LONG_TRANSPORT_MINUTES = 44640;
export const LEASE_TIMER_CHUNK_MS = 24 * 60 * 60_000;
export function grantExpired(expiresAt, now) { return expiresAt !== null && expiresAt <= now; }
export function expiryText(expiresAt, now = Date.now()) {
  if (expiresAt === null) return '期限なし（解除・Console停止まで）';
  if (!Number.isSafeInteger(expiresAt)) return '期限を確認してください';
  const seconds = Math.ceil((expiresAt - now) / 1000);
  if (seconds <= 0) return '期限切れ';
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return `残り ${h ? h + '時間' : ''}${m}分${s}秒 / 終了 ${new Date(expiresAt).toISOString()}`;
}
