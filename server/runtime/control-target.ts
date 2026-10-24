// Narrow forward-port of the prepared control admission contract (no Events).
export type ControlRejectionCode = 'target_unavailable' | 'generation_changed' | 'session_busy' | 'approval_required' | 'queue_pending' | 'background_active' | 'kit_owns_session' | 'run_not_active' | 'kit_stop_unsupported';
export class ControlRejection extends Error { constructor(readonly code: ControlRejectionCode) { super(code); } }
export type ControlExpectation = { generation: string; requestId: string };
