const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const redBoardStart = html.indexOf('redboard: {');
const redBoardEnd = html.indexOf('\n    micro: {', redBoardStart);
assert.ok(redBoardStart >= 0 && redBoardEnd > redBoardStart,
  'the RedBoard definition can be isolated for regression checks');
const redBoard = html.slice(redBoardStart, redBoardEnd);

assert.match(redBoard, /name: 'D1'/, 'the RedBoard exposes digital pin 1');
assert.match(redBoard, /name: 'D0'/, 'the RedBoard exposes digital pin 0');
assert.match(redBoard, /name: 'GND2', label: 'GND'/,
  'the second ground keeps a unique wire id but shows the physical GND label');
assert.match(html, /const visiblePinName = pin\.label \|\| pin\.name/,
  'pin labels can differ from their internal wire ids');

assert.match(html, /function placeComponent\(type\)[\s\S]*const occupied = _schemState\.components\.map[\s\S]*if \(isOpen\(x, y\)\) return placeComponentAt/,
  'palette-added parts search for an open grid area instead of piling up by type');
assert.match(html, /const contentLayers = \[[\s\S]*schemLayerComponents[\s\S]*schemLayerWires[\s\S]*getBBox\(\)/,
  'schematic exports measure the actual circuit content');
assert.match(html, /clone\.setAttribute\('viewBox', `\$\{exportBox\.x\}/,
  'schematic exports crop their viewBox to the measured circuit');
assert.match(html, /\.schem-rotate-handle, \.schem-move-handle, \.schem-resize-handle/,
  'saved diagrams omit editor handles');

assert.match(html, /key: 'resistor10k',[\s\S]{0,180}Ceramic_Composition_Resistor_10k\.png/,
  'the 10K resistor points to a photo of a 10K resistor');
assert.match(html, /resistor10k: 'resistor10k'/,
  'the 10K palette item uses its dedicated photo');
assert.doesNotMatch(html, /resistor10k: 'resistor'/,
  'the 10K palette item cannot regress to the 220-ohm photo');

const dinoStart = html.indexOf("id: 'hack-chrome-dino-robot'");
const dinoEnd = html.indexOf('\n    }\n  ];', dinoStart);
assert.ok(dinoStart >= 0 && dinoEnd > dinoStart,
  'the Chrome Dino hackathon can be isolated for wiring checks');
const dino = html.slice(dinoStart, dinoEnd);
assert.match(dino, /LDR: one leg to 5V, other leg to A0\./,
  'the LDR voltage-divider wiring is present');
assert.match(dino, /10K resistor: from A0 to GND\./,
  'the 10K pull-down wiring is present');
assert.match(dino, /Servo: brown to GND, red to 5V, orange to pin 9\./,
  'the SG90 power, ground, and signal wiring is present');

console.log('T4SG schematic audit passed: accurate RedBoard labels, non-overlapping staging, cropped clean exports, correct 10K photo, and verified Dino Robot wiring.');
