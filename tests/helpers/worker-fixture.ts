import { fileURLToPath } from 'node:url';
export const fixturePrelude = () => `require(${JSON.stringify(fileURLToPath(new URL('./worker-fixture.cjs', import.meta.url)))});\n`;
