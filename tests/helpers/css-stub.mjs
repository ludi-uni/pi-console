// Test loader hook: web components import their co-located .css for Vite.
// Node's test runner has no CSS module format; resolve those imports to an
// empty module so server-side markup tests exercise the same components.
export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {}', shortCircuit: true };
  return next(url, context);
}
