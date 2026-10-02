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

console.log('T4SG benchmark-flow audit passed: six-step pressure flow, gradual release, safe LEDs, concise labels, and instruction parity.');
