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

const oct20 = warmUps.find(w => w.id === 'wu-2026-10-20');
assert.ok(oct20, 'the October 20 Stephen Hawking warm-up is present');
assert.match(oct20.question, /movie scene first, then the real story/,
  'the warm-up gives the intended viewing order');
assert.match(oct20.question, /Write 2 to 3 sentences/,
  'the warm-up gives students a concrete notebook task');
assert.match(oct20.question, /innovations that let Stephen Hawking communicate/,
  'the first prompt focuses on the communication innovations');
assert.match(oct20.question, /your own assistive technology work/,
  'the second prompt connects the clips to the student project');
const oct20Videos = [...oct20.question.matchAll(/youtube\.com\/embed\/([^"?]+)/g)].map(m => m[1]);
assert.deepEqual(oct20Videos, ['EWWPUbNvP_Y', '7npnWX0dJQM'],
  'the movie clip appears before the real Stephen Hawking explainer');

assert.match(html, /class="project-title">Warm-ups<\/h2>/, 'warm-ups use the shared class-hub page title');
assert.match(html, /class="project-blurb">Answer in your written notebook\./, 'warm-ups explain the notebook workflow in the shared page style');
assert.doesNotMatch(html, /warmup-hero|warmup-title|warmup-deck/, 'warm-ups do not use a separate hero treatment');
assert.match(html, /id="warmupDateSelect"/, 'students can browse directly by date');
assert.match(html, /\.warmup-workspace\s*\{[^}]*width:\s*100%/, 'the workspace aligns with the other hub pages');
assert.match(html, /\.warmup-card\s*\{[^}]*box-shadow:\s*0 2px 6px rgba\(17, 17, 17, 0\.04\)/, 'the prompt card uses the shared hub card treatment');
assert.doesNotMatch(html, /id="warmupOlder"|id="warmupNewer"|class="warmup-footer"/, 'date navigation is not duplicated');
assert.doesNotMatch(html, /class="warmup-time"|class="warmup-count"/, 'decorative counters and timing badges stay removed');
assert.match(html, /function enhanceWarmUpMedia\(root\)/, 'multi-video warm-ups use the focused media deck');
assert.match(html, /\.warmup-media-panel\[hidden\]\s*\{\s*display:\s*none\s*!important/, 'inactive media is removed from layout');
assert.match(html, /event\.key === 'ArrowRight'/, 'media tabs support keyboard navigation');
assert.match(html, /frame\.loading = 'lazy'/, 'archive media loads only when selected');
assert.doesNotMatch(html, /class="warmup-earlier"/, 'the archive no longer expands every warm-up into one page');
assert.doesNotMatch(html, /<textarea[^>]*warmup|<input[^>]*warmup/i, 'warm-ups remain notebook-only');

console.log(`T4SG warm-up audit passed: ${warmUps.length} preserved prompts, focused date navigation, lazy media, and notebook-only work.`);
