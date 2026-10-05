const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const projectsMatch = html.match(/const PROJECTS = (\[[\s\S]*?\n  \]);\n\n  \/\/ ============== HOMEWORK/);
const labelsMatch = html.match(/const BENCHMARK_STEP_LABELS = (\{[\s\S]*?\n  \});\n\n  function setModalBoundary/);
assert.ok(projectsMatch, 'PROJECTS curriculum data can be audited');
assert.ok(labelsMatch, 'benchmark step labels can be audited');

const projects = vm.runInNewContext(`(${projectsMatch[1]})`);
const labels = vm.runInNewContext(`(${labelsMatch[1]})`);

const breathPressure = projects.flatMap(project => project.benchmarks).find(benchmark => benchmark.id === 'p3b5');
assert.ok(breathPressure, 'Breath Pressure benchmark exists');
assert.equal(breathPressure.instructions.length, 6, 'Breath Pressure follows the six-step checkpoint pattern');
const breathInstructions = breathPressure.instructions.join(' ');
// Ramsey, 2026-10-05: calibration is three numbers read off the Serial Monitor
// (resting, puff, sip). Students enter them in the prompt and the AI picks the
// two triggers. One key per puff, one per sip, both unused elsewhere in the lab.
assert.match(breathInstructions, /\*\*Resting:\*\*[\s\S]*\*\*Puff:\*\*[\s\S]*\*\*Sip:\*\*/,
  'calibration is three values: resting, puff, sip');
assert.match(breathInstructions, /resting ___, puff ___, sip ___/,
  'the prompt has a blank for each of the three values');
assert.match(breathInstructions, /halfway between resting and puff[\s\S]*halfway between resting and sip[\s\S]*never overlap/,
  'the prompt chooses triggers inside the student numbers that cannot overlap');
assert.match(breathInstructions, /Type the letter e once[\s\S]*the letter q once/,
  'puff and sip each send one key that no earlier benchmark uses');
assert.match(breathInstructions, /Do not type again until the reading comes back near my resting value/,
  'one breath sends one key');
assert.doesNotMatch(breathInstructions, /release band|quick puff|long puff|types [1-4]\b|average 20 readings|150000|Every 20 seconds/,
  'the simplified flow has no timing, release band, or universal threshold');
assert.match(breathInstructions, /comfortable breath, not your hardest/,
  'pressure calibration uses a comfortable breath rather than maximum effort');
assert.match(breathInstructions, /If another person will use your controller, take these three numbers again with them/,
  'the finished controller is calibrated with its intended user');
const usedKeys = projects.flatMap(project => project.benchmarks).filter(b => b.id !== 'p3b5')
  .map(b => JSON.stringify(b.instructions || '')).join(' ');
assert.doesNotMatch(usedKeys, /(?:letter|the) [eq]\b(?! key)|\b[EQ][- ]key/, 'E and Q are not used by any other benchmark');
assert.equal(breathPressure.instructions[4],
  'Test it. Modify the code until the behavior works exactly the way you described it.',
  'Breath Pressure uses the canonical test-and-modify step');

const project3 = projects.find(project => project.id === 'p3');
const project3Product = project3?.benchmarks.find(benchmark => benchmark.id === 'p3b4');
assert.ok(project3Product, 'Project 3 product exists');
assert.doesNotMatch(JSON.stringify(project3Product), /soft puff|hard puff|soft and hard/i,
  'Project 3 product language matches the quick-versus-long benchmark model');

for (const project of projects) {
  for (const benchmark of project.benchmarks) {
    if (!benchmark.instructions) continue;
    const instructions = (Array.isArray(benchmark.instructions) ? benchmark.instructions : [benchmark.instructions])
      .filter(text => !String(text).includes('Complete **Evidence + Reflection**') &&
        !String(text).includes('Submit your work in the **Rubric & Drop** section below'));
    assert.ok(labels[benchmark.id], `${benchmark.id} has concise release labels`);
    assert.equal(labels[benchmark.id].length, instructions.length,
      `${benchmark.id} has one release label per visible instruction`);
    labels[benchmark.id].forEach(label => {
      assert.ok(label.length <= 36, `${benchmark.id} release label stays concise: ${label}`);
    });
  }
}

assert.match(html, /journeyPages\.slice\(0, journeyIndex \+ 1\)/,
  'released steps remain visible as the next step appears');
assert.match(html, /page === current \? 'is-current' : 'is-released'/,
  'the newly released step is visually distinct from earlier steps');
assert.match(html, /setAttribute\('aria-current', 'step'\)/,
  'the current released step is announced to assistive technology');
assert.doesNotMatch(html, /little LED on the sensor lights while your finger is on the pad[\s\S]{0,700}stays on the whole time/,
  'touch-sensor testing does not give contradictory LED directions');
assert.match(html, /Every external LED needs its own 220-330 ohm current-limiting resistor/,
  'starter prompt protects every external LED with a current-limiting resistor');
assert.doesNotMatch(html, /two LEDs[^}]{0,500}no resistors/,
  'LED benchmark prompts never prohibit current-limiting resistors');

console.log('T4SG benchmark-flow audit passed: six-step pressure flow, three-number calibration, one key per breath, aligned product language, safe LEDs, concise labels, and instruction parity.');
