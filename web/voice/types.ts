// Voice Input Architecture — shared contracts.
//
// Pipeline:
//   Audio Capture → STT Provider → Transcript → Normalizer (optional)
//     → Intent Processor (optional) → Delivery
//
// These types are the seam every provider plugs into. Provider-specific data
// must not leak through `Transcript`: keep it in `metadata` (debugging only —
// never rendered, persisted, or forwarded) or behind the provider itself.
// Pricing, model ranking and availability do NOT live here; text-processing
// provider/model selection is delegated to a routing layer that may consult
// the existing Pi provider infrastructure.

export interface TranscriptSegment {
  text: string;
  isFinal: boolean;
  startMs?: number;
  endMs?: number;
  confidence?: number;
}

export interface Transcript {
  text: string;
  isFinal: boolean;
  language?: string;
  confidence?: number;
  segments?: TranscriptSegment[];
  providerId: string;
  /** Provider-specific debugging data only. Never rendered or sent onward. */
  metadata?: unknown;
}

// ---------------------------------------------------------------------------
// Capabilities & privacy

export interface STTCapabilities {
  /** Emits interim (non-final) transcripts while listening. */
  streaming: boolean;
  /** Can transcribe a completed audio blob after capture ends. */
  batch: boolean;
  /** Provider opens and owns the microphone itself (e.g. Web Speech API). */
  providerManagedCapture: boolean;
  /** Provider accepts audio captured by an external capture component. */
  externalAudioInput: boolean;
  languages?: string[];
  local: boolean;
  requiresNetwork: boolean;
  requiresApiKey: boolean;
}

export interface ProcessorCapabilities {
  /** Dictation cleanup: fillers, punctuation, casing, light grammar. */
  cleanup: boolean;
  /** Rewrite using surrounding pi-console context. */
  contextualRewrite: boolean;
  /** Produce an agent-ready instruction. */
  agentIntent: boolean;
  local: boolean;
  requiresNetwork: boolean;
  costClass?: 'free' | 'low' | 'metered' | 'unknown';
}

export interface ProviderPrivacy {
  local: boolean;
  requiresNetwork: boolean;
  audioLeavesDevice: boolean;
  textLeavesDevice: boolean;
}

// ---------------------------------------------------------------------------
// Errors & lifecycle

export type VoiceErrorCode =
  | 'MIC_PERMISSION_DENIED'
  | 'MIC_UNAVAILABLE'
  | 'STT_UNAVAILABLE'
  | 'STT_UNSUPPORTED'
  | 'STT_TIMEOUT'
  | 'STT_FAILED'
  | 'PROCESSOR_UNAVAILABLE'
  | 'PROCESSOR_TIMEOUT'
  | 'PROCESSOR_FAILED'
  | 'CANCELLED';

export interface VoiceError {
  code: VoiceErrorCode;
  /** Stable provider detail (e.g. SpeechRecognitionErrorCode) — not localized. */
  detail?: string;
  cause?: unknown;
}

export const voiceError = (code: VoiceErrorCode, detail?: string, cause?: unknown): VoiceError => ({ code, detail, cause });

/** Canonical voice input lifecycle. Provider-specific states must not leak past this vocabulary. */
export type VoiceInputState =
  | 'idle'
  | 'requesting_permission'
  | 'listening'
  | 'partial'
  | 'processing_stt'
  | 'processing_text'
  | 'ready'
  | 'error'
  | 'cancelled';

// ---------------------------------------------------------------------------
// STT provider

export interface STTStartOptions {
  /** BCP-47 language tag, e.g. 'ja-JP'. */
  language?: string;
}

export interface STTSessionEvents {
  /** Recognition/capture actually started. */
  onStart?(): void;
  /**
   * Incremental transcript events. Final transcripts are emitted exactly once
   * per segment; a non-final transcript replaces the previous interim text.
   */
  onTranscript?(transcript: Transcript): void;
  /** Provider finished gracefully after stop(), or ended on its own. */
  onEnd?(): void;
  onError?(error: VoiceError): void;
}

export interface STTSession {
  /** Ask the provider to finish; final transcripts may still arrive before onEnd. */
  stop(): void;
  /** Retire callbacks without aborting — the provider already ended on its own. */
  detach(): void;
  /** Cancel immediately; no further events are delivered. */
  abort(): void;
}

/** Optional health boundary for Local/API providers (installed? running? healthy?). */
export interface ProviderHealth {
  installed?: boolean;
  running?: boolean;
  healthy: boolean;
  version?: string;
  endpoint?: string;
  detail?: string;
}

export interface STTProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: STTCapabilities;
  readonly privacy: ProviderPrivacy;
  /** Optional user-facing notes (e.g. Browser mode caveats). */
  readonly notes?: string[];
  /** Cheap synchronous availability check (supported browser, config present). */
  isAvailable(): boolean;
  healthCheck?(): Promise<ProviderHealth>;
  start(options: STTStartOptions, events: STTSessionEvents): STTSession;
}

// ---------------------------------------------------------------------------
// Text processing providers

/** pi-console context made available to Intent Processor providers. */
export interface VoiceProcessingContext {
  workspaceId?: string;
  sessionId?: string;
  latestAssistantText?: string;
  selectedText?: string;
  activeRunId?: string;
  recentError?: string;
  activeTask?: string;
}

export interface NormalizerProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ProcessorCapabilities;
  readonly privacy: ProviderPrivacy;
  /**
   * raw transcript → readable text (filler removal, punctuation, casing).
   * Must not require pi-console context and must not change user meaning.
   */
  normalize(raw: Transcript): Promise<Transcript>;
}

export interface IntentProcessorProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ProcessorCapabilities;
  readonly privacy: ProviderPrivacy;
  /** normalized text + pi-console context → agent-ready instruction. */
  process(normalized: Transcript, context: VoiceProcessingContext): Promise<Transcript>;
}

// ---------------------------------------------------------------------------
// Routing

export type VoiceTask = 'transcription' | 'dictation_cleanup' | 'agent_intent';

/**
 * Automatic routing request. Names a task and preferences — never a model.
 * Provider/model selection stays with the router (or the Pi provider layer).
 */
export interface VoiceRoutingRequest {
  task: VoiceTask;
  costPreference?: 'lowest' | 'low' | 'balanced';
  localPreference?: 'require' | 'prefer' | 'neutral';
  latencyPreference?: 'low' | 'normal';
  reasoningRequirement?: 'basic' | 'strong';
  language?: string;
}
