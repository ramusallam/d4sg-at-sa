const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const compileProxy = fs.readFileSync(path.join(__dirname, '..', 'api', 'compile.js'), 'utf8');

assert.match(html, /function setupBenchmarkJourney\(b\)/, 'benchmarks use the focused journey');
assert.match(html, /const HACKATHON_MINUTES = 60;/,
  'every hackathon uses the shared 60-minute duration');
assert.doesNotMatch(html, /\n\s+minutes:\s*\d+,/,
  'individual hackathons cannot silently override the shared duration');
assert.match(html, /d4sg-hack-timer-end-\$\{HACKATHON_MINUTES\}-\$\{id\}/,
  'a duration change starts a fresh persisted timer instead of reviving an older countdown');
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
assert.match(breathExample, /Serial\.print\("Now "\)[\s\S]*Serial\.print\("   Highest "\)[\s\S]*Serial\.print\("   Lowest "\)/,
  'the see-it-work sketch shows the three numbers students write down');
assert.match(breathExample, /skipped < 10/,
  'unsteady power-up readings do not become the highest or lowest value');
assert.doesNotMatch(breathExample, /- rest\b/,
  'the see-it-work sketch shows raw readings, the same numbers the final code compares');
assert.match(breathExample, /bool readHX710\(long &value\)[\s\S]*digitalRead\(OUT_PIN\) == HIGH[\s\S]*for \(int i = 0; i < 24; i\+\+\)[\s\S]*25th pulse[\s\S]*0xFF000000UL/,
  'the see-it-work sketch uses the proven signed 24-bit direct reader');
assert.doesNotMatch(breathExample, /#include\s+["<]HX710AB\.h[">]/,
  'the canonical breath test does not depend on the library API');
assert.match(breathExample, /noInterrupts\(\)[\s\S]*digitalWrite\(SCK_PIN, LOW\)[\s\S]*interrupts\(\)/,
  'the short clock transaction cannot be stretched by an interrupt');
assert.match(breathExample, /now == 0[\s\S]*No sensor reading/,
  'zero readings are treated as a wiring fault instead of calibration data');
assert.match(breathExample, /lastReadingAt >= 1200[\s\S]*Sensor timeout/,
  'an unresponsive sensor produces a clear timeout instead of hanging');
assert.doesNotMatch(breathExample, /void loop\(\)[\s\S]*delay\(/,
  'the see-it-work sketch does not throw away quick-breath samples');
assert.match(breathExample, /Choose any two open digital pins[\s\S]*Pins 4 and 5 are examples only/,
  'the example protects cumulative builds from hard-coded pin collisions');

const starterStart = html.indexOf('const VIBE_STARTER_PROMPT');
const starterEnd = html.indexOf('].join("\\n")', starterStart);
assert.ok(starterStart >= 0 && starterEnd > starterStart,
  'the Arduino starter prompt can be isolated for regression checks');
const starterPrompt = html.slice(starterStart, starterEnd);
assert.match(starterPrompt, /Prefer reading the HX710B directly with digital pin timing and no pressure-sensor library[\s\S]*existing code already uses HX710AB and compiles, preserve it[\s\S]*construct HX710B with both pins and call begin\(\) with no pins/,
  'the standing prompt prefers direct timing and preserves a valid library fallback');
assert.match(starterPrompt, /Compare the raw reading to the verified puff and sip trigger numbers from my prompt, act once per breath/,
  'combined controllers compare raw readings to the triggers chosen from the student numbers');
assert.match(starterPrompt, /verify that the puff value is greater than resting and the sip value is less than resting[\s\S]*otherwise stop and ask for a new sensor test/,
  'the standing prompt refuses to build from reversed or invalid calibration data');
assert.doesNotMatch(starterPrompt, /release band|20 startup readings|slowly move the resting value/,
  'the starter prompt does not fight the simplified breath prompt');
assert.match(starterPrompt, /Avoid any sensor wait that blocks those controls/,
  'combined controllers keep existing controls responsive with either sensor-reading method');

const pressurePhotoPath = path.join(__dirname, '..', 'parts', 'hx710b-pressure-sensor.jpg');
const pressurePhoto = fs.readFileSync(pressurePhotoPath);
assert.match(html, /key: 'pressure'[\s\S]{0,180}url: '\/parts\/hx710b-pressure-sensor\.jpg'/,
  'every pressure-sensor photo link resolves to the hosted classroom copy');
assert.deepEqual([...pressurePhoto.subarray(0, 3)], [0xff, 0xd8, 0xff],
  'the hosted pressure-sensor asset is a valid JPEG');
assert.doesNotMatch(html, /HX710B\.h, and HX711\.h/,
  'the repair prompt does not advertise incompatible pressure-sensor libraries');
assert.match(html, /prefer reading it directly with digital pin timing and no pressure-sensor library[\s\S]*existing code already uses HX710AB\.h and compiles, preserve it[\s\S]*construct HX710B with both pins and call begin\(\) with no pins[\s\S]*Do not add another sensor library/,
  'the compiler repair prompt prefers direct timing while preserving the valid library fallback');
assert.match(compileProxy, /await fetch\(healthUrl/,
  'the public compiler health route checks the real Fly service');
assert.match(compileProxy, /backendReady/,
  'the public compiler health route reports backend readiness honestly');
assert.match(compileProxy, /health\.hidReady === true[\s\S]*health\.hx710Ready === true/,
  'the public compiler health route requires both HID and breath-sensor compiles');
assert.match(compileProxy, /setTimeout\(\(\) => controller\.abort\(\), 40000\)/,
  'compile proxy calls cannot hang a serverless worker indefinitely');
assert.match(html, /e\.isBusy = r\.status === 503[\s\S]*The class compiler is busy\. Your code is safe/,
  'a classroom compile burst gets retry guidance instead of a false outage message');

console.log('T4SG refinement audit passed: focused journey, accessible Arduino monitor, inclusive breath calibration, verified hosted sensor photo, honest compiler health, direct nonblocking breath sensing, dialog isolation, and stable portfolio writes.');
