// ProviderRouter — minimal registry + routing seam.
//
// Explicit selection resolves by provider id. A routing request (Automatic)
// names a task and preferences — never a model — and is matched against
// declared capabilities only. Actual model/provider selection for text
// processing is delegated: a future PiProcessor adapter can consult the
// existing Pi provider/model layer instead of hardcoding prices or rankings
// here.

import type { IntentProcessorProvider, NormalizerProvider, STTProvider, VoiceRoutingRequest } from './types.ts';

export interface VoiceProviderRegistry {
  stt: STTProvider[];
  normalizers: NormalizerProvider[];
  intentProcessors: IntentProcessorProvider[];
}

export class ProviderRouter {
  constructor(private readonly registry: VoiceProviderRegistry) {}

  /** Explicit selection; returns undefined for unknown or unavailable providers. */
  resolveSTT(id: string): STTProvider | undefined {
    return this.registry.stt.find(provider => provider.id === id && provider.isAvailable());
  }
  resolveNormalizer(id: string): NormalizerProvider | undefined {
    return this.registry.normalizers.find(provider => provider.id === id);
  }
  resolveIntentProcessor(id: string): IntentProcessorProvider | undefined {
    return this.registry.intentProcessors.find(provider => provider.id === id);
  }

  /** Automatic routing: first available provider whose capabilities fit the task. */
  route(request: VoiceRoutingRequest): STTProvider | NormalizerProvider | IntentProcessorProvider | undefined {
    if (request.task === 'transcription') {
      return this.registry.stt.find(provider => provider.isAvailable() && this.fitsLocality(provider.capabilities.local, request.localPreference));
    }
    const preferLocal = (local: boolean) => this.fitsLocality(local, request.localPreference);
    if (request.task === 'dictation_cleanup') {
      return this.registry.normalizers.find(provider => provider.capabilities.cleanup && preferLocal(provider.capabilities.local));
    }
    return this.registry.intentProcessors.find(provider => provider.capabilities.agentIntent && preferLocal(provider.capabilities.local));
  }

  private fitsLocality(local: boolean, preference: VoiceRoutingRequest['localPreference']): boolean {
    return preference === 'require' ? local : true;
  }
}
