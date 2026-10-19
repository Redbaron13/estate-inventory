// Fails when the initial JavaScript (the entry chunk named in dist/index.html)
// grows past the budget. Run after `npm run build`. See docs/DECISIONS.md.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 600;
const BUDGET_GZIP_KB = 175;

const html = readFileSync('dist/index.html', 'utf8');
const entry = /<script[^>]+src="[^"]*?(assets\/[^"]+\.js)"/.exec(html)?.[1];
if (!entry) {
  console.error('No entry script found in dist/index.html. Run npm run build first.');
  process.exit(1);
}
const code = readFileSync(`dist/${entry}`);
const kb = code.length / 1000;
const gzipKb = gzipSync(code).length / 1000;
console.log(`${entry}: ${kb.toFixed(1)} kB minified (budget ${BUDGET_KB}), ${gzipKb.toFixed(1)} kB gzip (budget ${BUDGET_GZIP_KB})`);
if (kb > BUDGET_KB || gzipKb > BUDGET_GZIP_KB) {
  console.error('Initial JavaScript is over budget. Load the new code on demand (React.lazy or import()) or discuss raising the budget.');
  process.exit(1);
}
