import type { ControlExpectation } from './control-target.ts';
// Process-local capabilities issued by the trusted composition, never JSON/headers.
// Pi and extensions are trusted; this is application authorization, not isolation.
const assertions = new WeakMap<object, () => void>();
export function localControlExpectation<T extends ControlExpectation>(value: T, assert: () => void): T {
    const ticket = Object.freeze({ ...value });
    assertions.set(ticket, assert);
    return ticket;
}
export function localControlAssertion(value: ControlExpectation): (() => void) | undefined { return assertions.get(value); }
