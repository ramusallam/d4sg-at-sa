const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const compileProxy = fs.readFileSync(path.join(__dirname, '..', 'api', 'compile.js'), 'utf8');

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
assert.match(html, /\.vibe-right\.is-monitor\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto/,
  'Serial Monitor receives the flexible panel row');
assert.match(html, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/,
  'Arduino tabs support standard keyboard navigation');
assert.match(html, /tabMon\.setAttribute\('aria-label', 'Serial Monitor, new output'\)/,
  'new Serial output is announced without relying on color');
assert.match(html, /id="vibeMonitorAnnouncement" aria-live="polite"/,
  'new Serial output has a polite live-region announcement');
assert.match(html, /sketchCandidates\.length > 1[\s\S]*choose the board you just uploaded/,
  'ambiguous Arduino reconnects require an explicit board choice');
const breathExampleStart = html.indexOf("{ id: 'breath-calibration'");
const breathExampleEnd = html.indexOf('` },', breathExampleStart);
assert.ok(breathExampleStart >= 0 && breathExampleEnd > breathExampleStart,
  'the HX710B see-it-work example can be isolated for regression checks');
const breathExample = html.slice(breathExampleStart, breathExampleEnd);
assert.match(breathExample, /for \(int i = 0; i < 20; i\+\+\)/,
  'the see-it-work sketch establishes zero from 20 readings');
assert.match(breathExample, /Serial\.println\(sensor\.read\(\) - rest\)/,
  'the see-it-work sketch exposes signed pressure change');
assert.doesNotMatch(breathExample, /void loop\(\)[\s\S]*delay\(/,
  'the see-it-work sketch does not throw away quick-breath samples');

const starterStart = html.indexOf('const VIBE_STARTER_PROMPT');
const starterEnd = html.indexOf('].join("\\n")', starterStart);
assert.ok(starterStart >= 0 && starterEnd > starterStart,
  'the Arduino starter prompt can be isolated for regression checks');
const starterPrompt = html.slice(starterStart, starterEnd);
assert.match(starterPrompt, /sensor\.request\(\)[\s\S]*sensor\.is_ready\(\)[\s\S]*sensor\.fetch\(\)/,
  'combined controllers use the HX710AB asynchronous API');
assert.match(starterPrompt, /shared release band[\s\S]*two consecutive readings/,
  'combined controllers use hysteresis before ending a breath');
assert.match(starterPrompt, /slowly move the resting value[\s\S]*Never adjust it during a breath/,
  'combined controllers follow drift only while idle');

const pressurePhotoPath = path.join(__dirname, '..', 'parts', 'hx710b-pressure-sensor.jpg');
const pressurePhoto = fs.readFileSync(pressurePhotoPath);
assert.match(html, /key: 'pressure'[\s\S]{0,180}url: '\/parts\/hx710b-pressure-sensor\.jpg'/,
  'every pressure-sensor photo link resolves to the hosted classroom copy');
assert.deepEqual([...pressurePhoto.subarray(0, 3)], [0xff, 0xd8, 0xff],
  'the hosted pressure-sensor asset is a valid JPEG');
assert.doesNotMatch(html, /HX710B\.h, and HX711\.h/,
  'the repair prompt does not advertise incompatible pressure-sensor libraries');
assert.match(compileProxy, /await fetch\(healthUrl/,
  'the public compiler health route checks the real Fly service');
assert.match(compileProxy, /backendReady/,
  'the public compiler health route reports backend readiness honestly');

console.log('T4SG refinement audit passed: focused journey, accessible Arduino monitor, inclusive breath calibration, verified hosted sensor photo, honest compiler health, drift-safe asynchronous sensing, dialog isolation, and stable portfolio writes.');
