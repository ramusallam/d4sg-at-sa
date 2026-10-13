const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Product and checkpoint slots hold several files (two STLs, a PDF per part).
assert.match(html, /const SLOT_LIST_KEYS = \{ sketch: 'sketches', cad: 'cads', code: 'codes', wiring: 'wirings', image: 'images', video: 'videos' \};/,
  'every file slot has a plural list key');
assert.match(html, /function slotEntryList\(slots, key\)/, 'one reader turns a slot into its list of entries');
assert.match(html, /<input type="file" data-pf-file accept="\$\{def\.accept\}" multiple/, 'Product slot pickers accept several files at once');
assert.match(html, /Array\.from\(files\)\.forEach\(f => handleFileForSlot\(def, f\)\)/, 'dropping several files on a tile keeps all of them');
assert.match(html, /if \(SLOT_LIST_KEYS\[k\]\) filledSlots\[SLOT_LIST_KEYS\[k\]\] = v;/, 'a Product submit writes the list under the plural key');
assert.match(html, /filledSlots\[k\] = v\[0\] \|\| null;/, 'the first entry still mirrors to the singular key for older readers');
assert.match(html, /code: uploadedCodes\[0\] \|\| null, codes: uploadedCodes,/, 'checkpoint submits keep every code PDF');
assert.match(html, /const entries = slotEntryList\(slots, def\.key\);/, 'the teacher view renders every entry of every slot');
assert.match(html, /const arrKey = SLOT_LIST_KEYS\[slotKey\] \|\| null;/, 'teacher slot delete removes one entry from any list slot');
assert.doesNotMatch(html, /pendingFiles\[def\.key\]/, 'the Product panel no longer keeps one pending file per slot');

console.log('T4SG multi-slot audit passed: list keys, multi-select pickers, plural writes with singular mirrors, full teacher view.');
