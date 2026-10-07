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
assert.match(breathInstructions, /OUT on pin ___ and SCK on pin ___/,
  'the prompt uses pins selected from the student\'s cumulative schematic');
assert.doesNotMatch(breathInstructions, /OUT on pin 4 and SCK on pin 5|OUT to pin 4, and SCK to pin 5/,
  'the benchmark does not overwrite earlier wiring with hard-coded pressure-sensor pins');
assert.match(breathInstructions, /change \*\*OUT_PIN\*\* and \*\*SCK_PIN\*\* to match your wiring/,
  'the supplied breath test tells students how to use their chosen open pins');
assert.match(breathInstructions, /halfway between resting and puff[\s\S]*halfway between resting and sip[\s\S]*never overlap/,
  'the prompt chooses triggers inside the student numbers that cannot overlap');
assert.match(breathInstructions, /Puff is greater than Resting and Sip is less than Resting/,
  'students verify that all three calibration readings are in the expected order');
assert.match(breathInstructions, /If not, do not write code; tell me to repeat the sensor test/,
  'bad calibration data stops code generation instead of producing false triggers');
assert.match(breathInstructions, /Prefer reading the HX710B directly with digital pin timing and no pressure-sensor library[\s\S]*existing code already uses HX710AB and compiles, preserve it[\s\S]*Do not add another pressure-sensor library/,
  'the student prompt prefers the proven direct reader while preserving working library code');
assert.doesNotMatch(breathInstructions, /for \(int i = 0; i < 24|count = count << 1|0xFF000000/,
  'the benchmark does not hand students the direct sensor-reading code');
assert.match(breathInstructions, /Type the letter e once[\s\S]*the letter q once/,
  'puff and sip each send one key that no earlier benchmark uses');
assert.match(breathInstructions, /Do not type again until the reading comes back near my resting value/,
  'one breath sends one key');
assert.doesNotMatch(breathInstructions, /release band|quick puff|long puff|types [1-4]\b|average 20 readings|150000|Every 20 seconds/,
  'the simplified flow has no timing, release band, or universal threshold');
assert.match(breathInstructions, /comfortable breath, not your hardest/,
  'pressure calibration uses a comfortable breath rather than maximum effort');
assert.match(breathInstructions, /If another person will use your controller, repeat these three readings with their consent and their own clean tube/,
  'the finished controller is calibrated hygienically and consensually with its intended user');
const usedKeys = projects.flatMap(project => project.benchmarks).filter(b => b.id !== 'p3b5')
  .map(b => JSON.stringify(b.instructions || '')).join(' ');
assert.doesNotMatch(usedKeys, /(?:letter|the) [eq]\b(?! key)|\b[EQ][- ]key/, 'E and Q are not used by any other benchmark');
assert.equal(breathPressure.instructions[4],
  'Test it. Modify the code until the behavior works exactly the way you described it.',
  'Breath Pressure uses the canonical test-and-modify step');

const project3 = projects.find(project => project.id === 'p3');
const project3Product = project3?.benchmarks.find(benchmark => benchmark.id === 'p3b4');
assert.ok(project3Product, 'Project 3 product exists');
assert.doesNotMatch(JSON.stringify(project3Product), /soft puff|hard puff|quick puff|long puff|quick sip|long sip|quick breath|long breath|breath timing/i,
  'Project 3 product uses the same puff-versus-sip model as the Breath Pressure benchmark');
assert.match(JSON.stringify(project3Product), /puff[\s\S]*sip/i,
  'Project 3 product keeps distinct puff and sip actions');
assert.equal(project3Product.brief.requirements.length, 6,
  'Project 3 surfaces its six requirement groups before the build steps');
assert.ok(project3Product.brief.challenge.length < 180,
  'the Project 3 challenge stays focused instead of burying requirements in prose');
const requirementText = project3Product.brief.requirements.map(item => `${item.label} ${item.text}`).join(' ');
assert.match(requirementText, /two HX710B sensors[\s\S]*one puff action and one sip action/i,
  'the visible requirement map names both sensors and all four breath actions');
assert.match(requirementText, /Project 2 final product wired, coded, and working/i,
  'the visible requirement map preserves the cumulative build');
assert.ok(project3Product.brief.personas.every(persona => persona.context && persona.goal && persona.motion && persona.actions),
  'Project 3 personas lead with goals and reliable motion, with access context kept secondary');
const secondSensorStep = project3Product.instructions[1];
assert.match(secondSensorStep, /Unplug USB before adding the sensor/,
  'students power down before adding pressure-sensor wiring');
assert.match(secondSensorStep, /Sensor 2 OUT pin, SCK pin, resting, puff, sip/,
  'the second sensor has one explicit calibration record');
assert.match(secondSensorStep, /Leave both sensors in their final pins/,
  'second-sensor calibration does not dismantle a known-good baseline');
assert.match(secondSensorStep, /stop if you feel dizzy or uncomfortable/,
  'breath trials include a clear stop condition');
const productPromptStep = project3Product.instructions[2];
assert.match(productPromptStep, /Check whether each OUT pin is ready before reading it[\s\S]*never wait for one sensor/,
  'two-sensor code is prompted to keep every control responsive');
assert.match(project3Product.instructions[4], /three clean rounds[\s\S]*alternate 10 breath actions[\s\S]*no missed, repeated, or accidental action/,
  'the final controller has a concrete six-control reliability test');
const rubricText = project3Product.rubric.map(item => `${item.label} ${item.text}`).join(' ');
assert.match(rubricText, /both pressure sensors labeled[\s\S]*each OUT and SCK pin/i,
  'the wiring rubric grades the new two-sensor requirement');
assert.match(rubricText, /joystick move[\s\S]*joystick click[\s\S]*puff and sip on each tube/i,
  'the video rubric grades all six required controls');
assert.match(html, /aria-label="Project requirements"/,
  'the requirement map has an accessible list label');
assert.match(html, /<strong>Goal:<\/strong>[\s\S]*<strong>Reliable motion:<\/strong>[\s\S]*<strong>Access context:<\/strong>/,
  'persona cards present the person\'s goal and reliable motion before diagnosis context');

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
