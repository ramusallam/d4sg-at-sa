const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
assert.match(html, /collapsePortfolioItems\(raw\)\.forEach\(data => \{/,
  'the Product editor collapses legacy duplicate documents before hydrating a student');
assert.match(html, /Promise\.all\(ids\.map\(id => setDoc\(doc\(db, 'portfolios', id\)/,
  'removing one submitted item updates every legacy document behind the collapsed row');

// Behavioral check: same-slot draft writes execute in the order queued, even
// when the first write takes longer. This protects the newest multi-file list
// from being overwritten by an older partial list.
const queueSource = html.match(/const _pfDraftSaveChains = new Map\(\);\n([\s\S]*?)\n  function slotEntryList/);
assert.ok(queueSource, 'the ordered draft-save queue can be isolated');
const context = { Promise, Map };
vm.createContext(context);
vm.runInContext(`const _pfDraftSaveChains = new Map();\n${queueSource[1]}\nthis.enqueuePfDraftSave = enqueuePfDraftSave;`, context);

async function checkOrderedSaves() {
  const events = [];
  let active = 0;
  let maxActive = 0;
  const first = context.enqueuePfDraftSave('riley::p1b4::cad', async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push('first:start');
    await new Promise(resolve => setTimeout(resolve, 15));
    events.push('first:end');
    active -= 1;
  });
  const second = context.enqueuePfDraftSave('riley::p1b4::cad', async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push('second:start');
    events.push('second:end');
    active -= 1;
  });
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end'],
    'same-student same-slot saves stay ordered');
  assert.equal(maxActive, 1, 'same-slot saves never overlap');
}

checkOrderedSaves().then(() => {
  console.log('T4SG multi-slot audit passed: list keys, multi-select pickers, plural writes, full teacher view, and ordered draft saves.');
}).catch(err => { console.error(err); process.exitCode = 1; });
