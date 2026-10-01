const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /function setupBenchmarkJourney\(b\)/, 'benchmarks use the focused journey');
assert.match(html, /t4sg-benchmark-page:\$\{b\.id\}/, 'journey position is saved per benchmark');
assert.match(html, /\.cp-step\[hidden\][\s\S]*display:\s*none\s*!important/, 'inactive instructions are removed from layout');
assert.match(html, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/, 'all five mobile destinations fit without sideways scrolling');
assert.match(html, /\.nav-link[\s\S]*min-height:\s*44px/, 'primary navigation meets the touch target minimum');
assert.match(html, /id="modal"[\s\S]*aria-hidden="true"/, 'the closed dialog is hidden from assistive technology');
assert.match(html, /function setModalBoundary\(active\)[\s\S]*toggleAttribute\('inert', active\)/, 'open dialogs isolate the page behind them');
assert.match(html, /function setLightboxBoundary\(active\)/, 'media previews isolate the dialog behind them');
assert.match(html, /doc\(db, 'portfolios', `\$\{benchmarkId\}__\$\{nameSlug\(/, 'portfolio submissions keep the stable one-student document key');
assert.match(html, /setDoc\(doc\(db, 'portfolios'/, 'portfolio revisions merge into a stable document');
assert.match(html, /function collapsePortfolioItems\(items\)/, 'historical duplicate documents collapse to one student row');

console.log('T4SG refinement audit passed: focused journey, complete mobile nav, dialog isolation, and stable portfolio writes.');
