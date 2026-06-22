/**
 * Pre-build script: injects the interceptor into AriaNg's HTML.
 * Run before `wxt build` to ensure the interceptor is present in the built output.
 *
 * WXT copies public/ → .output/ verbatim. By injecting into the source HTML
 * before the build, the interceptor is included automatically.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const INTERCEPTOR = readFileSync(
  resolve(PROJECT_ROOT, 'lib', 'injected-interceptor.ts'),
  'utf-8',
);

const ORIGINAL_HTML = resolve(PROJECT_ROOT, 'public', 'ariang', 'index.original.html');
const TARGET_HTML = resolve(PROJECT_ROOT, 'public', 'ariang', 'index.html');

// Always start from the original (unmodified) AriaNg HTML to avoid double-injection
let html = readFileSync(ORIGINAL_HTML, 'utf-8');

if (html.includes('AriaNgInterceptor')) {
  console.log('[ariang-inject] Already injected (this should not happen with original)');
  process.exit(0);
}

html = html.replace(
  '<head>',
  `<head>\n    <script>${INTERCEPTOR}</script>\n`,
);

writeFileSync(TARGET_HTML, html);
console.log('[ariang-inject] Interceptor injected into public/ariang/index.html');
