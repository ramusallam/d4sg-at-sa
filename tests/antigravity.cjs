const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const vercel = fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8');

assert.match(html, /\/tools\/antigravity/, 'Antigravity route is present');
assert.match(vercel, /"source": "\/tools\/antigravity"/, 'direct route is rewritten by Vercel');
assert.match(html, /Review-driven development/, 'first-run safety mode is taught');
assert.match(html, /\/setup-esp32/, 'ESP32 has its own setup path');
assert.match(html, /Classic ESP32 and C3 boards cannot act as a USB keyboard/, 'ESP32 HID limitation is explicit');
assert.match(html, /Upload from Antigravity, not the browser tool/, 'ESP32 upload boundary is explicit');
assert.match(html, /sketch\/sketch\.ino/, 'the guide names the real working file');
assert.match(html, /board, parts and pins, exact behavior, and what must stay unchanged/, 'prompt recipe preserves working behavior');
assert.doesNotMatch(html, /Any board, any library/, 'the guide does not overpromise toolchain support');
assert.doesNotMatch(html, /take about fifteen seconds/, 'the guide does not promise an unreliable compile time');

console.log('T4SG Antigravity checks passed: honest board boundaries, safe onboarding, ESP32 path, and clear build loop.');
