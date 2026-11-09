// speech.cpp local STT — shared API contracts between server and web UI.
// The service runs the official speech.cpp Windows x64 portable release under a
// dedicated dataDir, bound to 127.0.0.1 only. Everything here is metadata or a
// bounded request/response shape; no local paths, ports, tokens or process
// details ever leave the owner boundary.

export const SPEECH_CPP_PROVIDER_ID = 'speech-cpp' as const;

/** Fixed model whitelist. Only catalog names known to the official speech.cpp release are accepted. */
export const SPEECH_MODELS = [
  { id: 'qwen3-asr-0.6b', label: 'Qwen3-ASR 0.6B', default: true },
  { id: 'qwen3-asr-1.7b', label: 'Qwen3-ASR 1.7B', default: false },
] as const;
export type SpeechModelId = (typeof SPEECH_MODELS)[number]['id'];
export const SPEECH_DEFAULT_MODEL: SpeechModelId = 'qwen3-asr-0.6b';
export const speechModelId = (v: unknown): v is SpeechModelId => SPEECH_MODELS.some(m => m.id === v);

// ---------------------------------------------------------------------------
// Owner management API — POST /local-owner/voice/<action>
// Only reachable through the local-owner bootstrap boundary (loopback listener,
// no proxy headers, literal host/origin, valid owner session cookie).

export interface SpeechEnableRequest {
  /** 'managed' installs the official release archive into the dataDir; 'existing' adopts a local executable/model cache. */
  source: 'managed' | 'existing';
  /** 'existing' only: absolute path of a speech.exe on a local fixed drive. */
  executablePath?: string;
  /** 'existing' only: absolute path of an existing speech.cpp model directory (SPEECH_MODEL_DIR). */
  modelDirectory?: string;
  modelId: SpeechModelId;
  /** Explicit owner confirmation; without it nothing is installed, adopted or started. */
  confirmed: boolean;
  /** Explicit consent for any network fetch (release archive and/or model GGUF). */
  allowDownload: boolean;
}

export interface SpeechOwnerActionRequest {
  /** Reserved for future job scoping. Current actions need no fields. */
}

export type SpeechPhase =
  | 'off'            // default; never enabled
  | 'installing'     // release archive download/extract running
  | 'model-fetch'    // `speech pull` downloading the model GGUF
  | 'validating'     // existing executable/model verification
  | 'stopped'        // enabled, nothing running
  | 'starting'       // serve process warming up / waiting for Ready
  | 'ready'          // owned serve process healthy on loopback
  | 'transcribing'   // a transcription request is in flight
  | 'error';

export interface SpeechJobState {
  id: string;
  kind: 'install' | 'enable-existing' | 'model-fetch' | 'start';
  state: 'running' | 'done' | 'failed' | 'cancelled';
  /** 0..1 when known. */
  progress?: number;
  /** Coarse, stable error code — never a path, URL or stderr text. */
  error?: string;
  startedAt: number;
}

/** Owner-facing status. May include local paths (owner-only boundary). */
export interface SpeechOwnerStatus {
  enabled: boolean;
  phase: SpeechPhase;
  modelId?: SpeechModelId;
  executablePath?: string;
  modelDirectory?: string;
  version?: string;
  port?: number;
  job?: SpeechJobState;
  /** True when the runtime requires a Vulkan loader the host may lack. */
  vulkanRequired: boolean;
  /** Coarse error code when persisted settings could not be loaded (fail-closed; file preserved). */
  lastError?: string;
}

// ---------------------------------------------------------------------------
// Public API — /api/voice/*
// Sanitized: no paths, ports, executable details, job internals or error text.

export interface SpeechPublicStatus {
  enabled: boolean;
  available: boolean; // enabled && phase === 'ready'|'transcribing'
  phase: SpeechPhase;
  modelId?: SpeechModelId;
  providerId: typeof SPEECH_CPP_PROVIDER_ID;
}

export interface SpeechTranscribeRequest {
  /** Base64 of a 16 kHz mono 16-bit PCM WAV file, max ~60 s (~2 MB decoded). */
  audioBase64: string;
  /** BCP-47 tag, e.g. 'ja-JP', 'en-US'. Omit for auto-detect. */
  language?: string;
}

export interface SpeechTranscribeResult {
  text: string;
  providerId: typeof SPEECH_CPP_PROVIDER_ID;
  language?: string;
}

// ---------------------------------------------------------------------------
// Setup routing — GET /api/voice/setup (authenticated, after the normal gates)
// describes where the SAME server process listens on loopback so the Settings
// tab can detect a same-device Console. instanceId is a per-process random
// NONSECRET routing token — never a manage nonce, auth code or credential.

export interface SpeechSetupDescriptor {
  /** 64-hex per-process routing id; the loopback probe must echo it exactly. */
  instanceId: string;
  /** Exact literal loopback probe URL, e.g. http://127.0.0.1:31717/api/voice/local-probe */
  probeUrl: string;
  /** Exact literal loopback landing URL, e.g. http://127.0.0.1:31717/voice-setup/ */
  setupUrl: string;
  /** Actual bound console port the URLs above were built from. */
  consolePort: number;
}

/** Loopback probe answer — minimal nonsecret identity only. */
export interface SpeechLocalProbeResult {
  instanceId: string;
}

// ---------------------------------------------------------------------------
// Terminal-free onboarding — /api/voice/onboarding/*
//
// These routes sit AFTER the normal Host/Access gates. A browser POST can only
// REQUEST a setup; the actual approval is a purpose-scoped native confirmation
// dialog on the Console PC — never an owner/admin grant, never a code, never a
// GET. Everything below is sanitized metadata for the browser: no paths, ports,
// PIDs, generations, session material or stderr text.

/** Immutable consent payload. Stored verbatim at request time; the native
 * dialog's binding digest and the eventual service.enable input derive from it,
 * so a changed payload is always a NEW requestId — never an edited request. */
export interface SpeechOnboardingPayload {
  source: 'managed' | 'existing';
  modelId: SpeechModelId;
  allowDownload: boolean;
  executablePath?: string;
  modelDirectory?: string;
}

export type SpeechOnboardingPreflight = {
  /** OS/CPU the service can ever run on. */
  supported: boolean;
  /** Vulkan loader library found (host prerequisite only — NOT GPU proof). */
  vulkanLoader: boolean;
  /** Managed native confirmation can be attempted (win32 + managed server + interactive dialog). */
  nativeApproval: boolean;
  /** Coarse reason when nativeApproval is false; safe for the browser. */
  nativeReason?: 'unmanaged' | 'noninteractive' | 'unsupported';
};

export type SpeechOnboardingState =
  | 'pending'     // request recorded; native confirmation in flight or possible
  | 'processing'  // natively approved; service enable job running
  | 'ready'       // speech feature enabled (job done or already enabled)
  | 'rejected'    // native dialog answered cancel/deny
  | 'expired'     // native prompt TTL passed without approval
  | 'cancelled'   // requester or owner cancelled
  | 'unavailable' // host cannot do native confirmation (unmanaged/noninteractive/unsupported)
  | 'conflict'    // another onboarding/native prompt displaced this one
  | 'failed';     // service enable failed (coarse code only)

/** Sanitized payload echo — paths are NEVER returned to the browser; only
 * which optional inputs were bound into the approved request. */
export interface SpeechOnboardingPayloadView {
  source: 'managed' | 'existing';
  modelId: SpeechModelId;
  allowDownload: boolean;
  hasExistingExecutable: boolean;
  hasExistingModelDirectory: boolean;
}

/** Browser-facing request/job view. No secrets, paths, ports, PIDs or binding data. */
export interface SpeechOnboardingStatus {
  requestId?: string;
  state: SpeechOnboardingState | 'idle';
  payload?: SpeechOnboardingPayloadView;
  job?: SpeechJobState;
  /** Phase + wall-clock evidence only; never fabricated percent/ETA. */
  startedAt?: number;
  updatedAt?: number;
  /** Coarse stable code on failure/unavailability. */
  error?: string;
  preflight: SpeechOnboardingPreflight;
  /** Same-device hint: this browser reached the API over the loopback listener.
   * A routing hint ONLY — it grants nothing by itself. */
  sameDevice: boolean;
  /** Whether a native confirmation prompt can be raised for this browser's request. */
  nativeApprovalAvailable: boolean;
}

export interface SpeechOnboardingRequestBody {
  /** Client-generated UUID — idempotency key. Same id + different payload = collision. */
  requestId: string;
  payload: SpeechOnboardingPayload;
  /** Explicit user intent. Without it nothing is recorded or prompted. */
  confirmed: boolean;
  /** Remote-mode only: explicitly ask the host PC to raise its native confirmation. */
  requestHostApproval?: boolean;
}
