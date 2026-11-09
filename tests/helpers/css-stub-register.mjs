// Registers the css-stub loader hook for Node's test runner workers.
// Use via `node --import tsx --import ./tests/helpers/css-stub-register.mjs`.
import { register } from 'node:module';
register(new URL('./css-stub.mjs', import.meta.url));
