// Text processing providers — the second half of the voice pipeline.
//
// Phase: STT = Web Speech only, Normalizer = passthrough, Intent = disabled.
// These implementations exist to pin the boundary, not to add features.
// Real processors (Pi provider routing, local OpenAI-compatible endpoint,
// Aqua dictation, …) plug in behind these interfaces without touching UI.

import type { IntentProcessorProvider, NormalizerProvider, ProcessorCapabilities, ProviderPrivacy, Transcript, VoiceProcessingContext } from './types.ts';
import { voiceError } from './types.ts';

const passthroughPrivacy: ProviderPrivacy = { local: true, requiresNetwork: false, audioLeavesDevice: false, textLeavesDevice: false };

/** Identity normalizer: raw transcript in, identical transcript out. */
export class PassthroughNormalizer implements NormalizerProvider {
  readonly id = 'raw';
  readonly label = 'Raw';
  readonly capabilities: ProcessorCapabilities = { cleanup: false, contextualRewrite: false, agentIntent: false, local: true, requiresNetwork: false, costClass: 'free' };
  readonly privacy = passthroughPrivacy;
  async normalize(raw: Transcript): Promise<Transcript> {
    return { ...raw, providerId: this.id };
  }
}

/** Intent processing is off in this phase: every call fails with PROCESSOR_UNAVAILABLE. */
export class DisabledIntentProcessor implements IntentProcessorProvider {
  readonly id = 'disabled';
  readonly label = 'Disabled';
  readonly capabilities: ProcessorCapabilities = { cleanup: false, contextualRewrite: false, agentIntent: false, local: true, requiresNetwork: false, costClass: 'free' };
  readonly privacy = passthroughPrivacy;
  async process(_normalized: Transcript, _context: VoiceProcessingContext): Promise<Transcript> {
    throw voiceError('PROCESSOR_UNAVAILABLE', this.id);
  }
}
