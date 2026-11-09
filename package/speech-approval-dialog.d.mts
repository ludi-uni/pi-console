export interface SpeechApprovalView {
  requestId: string;
  /** Console process generation (manage nonce) the request is bound to. */
  generation: string;
  expiresAt: number;
  source: 'managed' | 'existing';
  modelId: string;
  modelLabel: string;
  /** Static size note shown for consent (e.g. "約0.84 GB · モデル単体"), never a measured value. */
  downloadBytesNote: string;
  allowDownload: boolean;
  hasExistingExecutable: boolean;
  hasExistingModelDirectory: boolean;
  /** Bound into the digest and shown (escaped) — real paths, never just flags. */
  executablePath?: string;
  modelDirectory?: string;
  bindingDigest: string;
}
export type SpeechApprovalDecision = 'approved' | 'cancelled' | 'unavailable' | 'noninteractive';
export interface SpeechApprovalResult { decision: SpeechApprovalDecision; bindingDigest: string }
export type SpeechApprovalDialog = (view: Readonly<SpeechApprovalView>, options: { signal: AbortSignal }) => Promise<SpeechApprovalResult>;
export declare function speechApprovalBinding(view: Omit<SpeechApprovalView, 'bindingDigest'> | SpeechApprovalView): string;
export declare function speechApprovalDisplay(view: SpeechApprovalView): string;
export declare const speechApprovalScript: string;
export declare function createWindowsSpeechApprovalDialog(options?: { transport?: (input: { file: string; args: string[]; input: string; env: Record<string, string>; signal: AbortSignal }) => Promise<string>; platform?: string; env?: Record<string, string | undefined> }): SpeechApprovalDialog;
