const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dataMatch = html.match(/const WARM_UPS = (\[[\s\S]*?\n  \]);\n\n  \/\/ ============== DAY ONE/);
assert.ok(dataMatch, 'warm-up data can be audited');
const warmUps = vm.runInNewContext(`(${dataMatch[1]})`);

assert.ok(warmUps.length > 0, 'at least one warm-up exists');
assert.equal(new Set(warmUps.map(w => w.id)).size, warmUps.length, 'warm-up ids are unique');
assert.equal(new Set(warmUps.map(w => w.date)).size, warmUps.length, 'warm-up dates are unique');
warmUps.forEach(w => {
  assert.equal(w.id, `wu-${w.date}`, `${w.date} uses the stable date id`);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(w.date), `${w.id} has an ISO date`);
  assert.ok(typeof w.question === 'string' && w.question.trim(), `${w.id} has a question`);
});

assert.match(html, /class="warmup-hero"/, 'warm-ups use the premium focused hero');
assert.match(html, /id="warmupDateSelect"/, 'students can browse directly by date');
assert.match(html, /\.warmup-shell\s*\{[^}]*margin:\s*14px auto 0/, 'the workspace sits cleanly below the hero');
assert.doesNotMatch(html, /id="warmupOlder"|id="warmupNewer"|class="warmup-footer"/, 'date navigation is not duplicated');
assert.doesNotMatch(html, /class="warmup-time"|class="warmup-count"/, 'decorative counters and timing badges stay removed');
assert.match(html, /function enhanceWarmUpMedia\(root\)/, 'multi-video warm-ups use the focused media deck');
assert.match(html, /\.warmup-media-panel\[hidden\]\s*\{\s*display:\s*none\s*!important/, 'inactive media is removed from layout');
assert.match(html, /event\.key === 'ArrowRight'/, 'media tabs support keyboard navigation');
assert.match(html, /frame\.loading = 'lazy'/, 'archive media loads only when selected');
assert.doesNotMatch(html, /class="warmup-earlier"/, 'the archive no longer expands every warm-up into one page');
assert.doesNotMatch(html, /<textarea[^>]*warmup|<input[^>]*warmup/i, 'warm-ups remain notebook-only');

console.log(`T4SG warm-up audit passed: ${warmUps.length} preserved prompts, focused date navigation, lazy media, and notebook-only work.`);
