// Serial Monitor regression checks for the Arduino Code Loading Tool.
// 1. A sketch that prints forever (the breath test, any sensor calibration)
//    must never grow the page without limit. That is what froze and crashed
//    the tab on 2026-10-05.
// 2. After an upload the monitor opens by itself, with no second click.
// The real functions are lifted out of index.html and run against a small
// stand-in for the DOM, so this exercises the shipped code, not a copy.
// Run: node tests/serial-monitor.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function slice(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker, a);
  assert.ok(a >= 0 && b > a, `can isolate code between "${startMarker}" and "${endMarker}"`);
  return html.slice(a, b);
}

// ---------- a stand-in DOM with just what the monitor code touches ----------
class TextNode {
  constructor(data) { this.nodeType = 3; this.data = data; this.parent = null; }
  get length() { return this.data.length; }
  get textContent() { return this.data; }
  appendData(t) { this.data += t; }
  deleteData(offset, count) { this.data = this.data.slice(0, offset) + this.data.slice(offset + count); }
}
class El {
  constructor() { this.nodeType = 1; this.className = ''; this.children = []; this.parent = null; this.scrollTop = 0; }
  get classList() { return { contains: (c) => this.className.split(/\s+/).includes(c) }; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get scrollHeight() { return 100000; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set innerHTML(_) { this.children = []; }
  appendChild(n) { n.parent = this; this.children.push(n); return n; }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  querySelector(sel) { return this.children.find((c) => c.nodeType === 1 && c.classList.contains(sel.slice(1))) || null; }
  getElementsByClassName(c) { // live, like the real thing
    const list = () => this.children.filter((x) => x.nodeType === 1 && x.classList.contains(c));
    return new Proxy({}, { get: (_, k) => (k === 'length' ? list().length : list()[k]) });
  }
}

function makeMonitor() {
  const monitor = new El();
  const timers = [];
  const env = {
    document: { getElementById: () => monitor, createElement: () => new El(), createTextNode: (d) => new TextNode(d) },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
  };
  const code = slice('  // Serial output is collected and painted', '  // Which panel is in front:');
  const api = new Function('document', 'setTimeout', 'clearTimeout',
    'let _vibeMonitorAutoScroll = true; function vibeMonitorMarkNew() {}\n' + code +
    '\nreturn { vibeAppendMonitor, vibeFlushMonitor, MAX_BLOCKS: VIBE_MONITOR_MAX_BLOCKS, BLOCK: VIBE_MONITOR_BLOCK_CHARS, MAX_PENDING: VIBE_MONITOR_MAX_PENDING };'
  )(env.document, env.setTimeout, env.clearTimeout);
  return { monitor, timers, api };
}
const blocksOf = (m) => m.children.filter((c) => c.nodeType === 1 && c.classList.contains('vibe-monitor-block'));

// ---------- 1. hours of readings stay bounded and intact ----------
{
  const { monitor, api } = makeMonitor();
  // 300,000 readings is about two hours of the breath test at 40 a second.
  // Serial arrives in arbitrary pieces, so split the stream mid-line too.
  let stream = '';
  const N = 300000;
  for (let i = 0; i < N; i++) {
    stream += i + '\n';
    if (stream.length > 37) {
      api.vibeAppendMonitor(stream.slice(0, 23));
      api.vibeAppendMonitor(stream.slice(23));
      stream = '';
      if (i % 7 === 0) api.vibeFlushMonitor();
    }
  }
  api.vibeAppendMonitor(stream);
  api.vibeFlushMonitor();

  const blocks = blocksOf(monitor);
  assert.ok(blocks.length <= api.MAX_BLOCKS, `monitor keeps at most ${api.MAX_BLOCKS} blocks, has ${blocks.length}`);
  assert.equal(monitor.children.length, blocks.length, 'no stray nodes pile up next to the blocks');
  const chars = monitor.textContent.length;
  assert.ok(chars <= api.MAX_BLOCKS * (api.BLOCK + 64), `monitor text stays bounded (${chars} characters)`);
  const lines = monitor.textContent.split('\n').filter(Boolean);
  assert.equal(lines[lines.length - 1], String(N - 1), 'the newest reading is on screen');
  for (let i = 1; i < lines.length; i++) {
    assert.equal(Number(lines[i]), Number(lines[i - 1]) + 1, 'no reading is split, dropped, or repeated where blocks meet');
  }
  for (const b of blocks.slice(0, -1)) {
    assert.ok(b.textContent.endsWith('\n'), 'sealed blocks end on a whole line');
  }
  assert.equal(monitor.scrollTop, monitor.scrollHeight, 'the monitor follows the newest output');
}

// ---------- 2. one paint is scheduled per batch, not one per reading ----------
{
  const { timers, api } = makeMonitor();
  for (let i = 0; i < 500; i++) api.vibeAppendMonitor(i + '\n');
  assert.equal(timers.length, 1, '500 readings schedule a single paint');
}

// ---------- 3. a flood between paints cannot balloon memory ----------
{
  const { monitor, api } = makeMonitor();
  for (let i = 0; i < 200000; i++) api.vibeAppendMonitor('1023\n'); // 1 MB with no paint in between
  api.vibeFlushMonitor();
  assert.ok(monitor.textContent.length <= api.MAX_PENDING, 'a flood keeps only the newest output');
  assert.ok(/^(1023\n)+$/.test(monitor.textContent), 'the kept output starts on a whole line');
}

// ---------- 4. a sketch that never sends a line break is still bounded ----------
{
  const { monitor, api } = makeMonitor();
  for (let i = 0; i < 4000; i++) { api.vibeAppendMonitor('x'.repeat(500)); api.vibeFlushMonitor(); } // 2 MB, no newline
  assert.ok(blocksOf(monitor).length <= api.MAX_BLOCKS, 'no-newline output is still cut into bounded blocks');
  assert.ok(monitor.textContent.length <= api.MAX_BLOCKS * api.MAX_PENDING, 'no-newline output stays bounded');
}

// ---------- 5. log lines keep their place in the stream ----------
{
  const { monitor, api } = makeMonitor();
  api.vibeAppendMonitor('before\n');
  api.vibeFlushMonitor();
  const logLine = new El(); logLine.appendChild(new TextNode('[ Upload complete ]'));
  monitor.appendChild(logLine);
  api.vibeAppendMonitor('after\n');
  api.vibeFlushMonitor();
  assert.equal(monitor.textContent, 'before\n[ Upload complete ]after\n', 'output after a log line starts a new block below it');
  assert.match(html, /function vibeMonitorLine\(text, kind\) \{[\s\S]{0,140}vibeFlushMonitor\(\);/,
    'a log line flushes buffered Serial output first so order is kept');
  assert.match(html, /_vibeMonitorPending = '';\s*m\.innerHTML = '<span class="vibe-monitor-empty">Cleared\.<\/span>';/,
    'Clear also drops output that was waiting to paint');
}
assert.doesNotMatch(html, /m\.appendChild\(document\.createTextNode\(text\)\);/, 'the one-node-per-reading append is gone');

// ---------- 6. the monitor opens by itself after an upload ----------
{
  const code = slice('  function vibeWithUsbIdentity(sketch) {', '  async function vibeCompileSketch(sketch) {');
  const vibeWithUsbIdentity = new Function(code + '\nreturn vibeWithUsbIdentity;')();

  const serialOnly = 'void setup() {\n  Serial.begin(9600);\n}\nvoid loop() {\n  Serial.println(analogRead(A0));\n}\n';
  const out = vibeWithUsbIdentity(serialOnly);
  assert.ok(out.endsWith('\n#include <Keyboard.h>\n'), 'a Serial-only sketch is compiled with the keyboard library');
  assert.ok(out.startsWith(serialOnly.trimEnd()), 'the student code is untouched and its line numbers do not move');

  for (const lib of ['Keyboard', 'Mouse', 'Joystick', 'HID']) {
    const sketch = `#include <${lib}.h>\nvoid setup() {}\nvoid loop() {}\n`;
    assert.equal(vibeWithUsbIdentity(sketch), sketch, `a sketch that already includes ${lib}.h is sent as written`);
  }
  assert.equal(vibeWithUsbIdentity('  #include "Keyboard.h"\nvoid setup(){}\nvoid loop(){}\n').includes('<Keyboard.h>'), false,
    'quoted and indented includes count too');

  const breathStart = html.indexOf("{ id: 'breath-calibration'");
  const breath = html.slice(html.indexOf('`', breathStart) + 1, html.indexOf('` },', breathStart));
  assert.ok(vibeWithUsbIdentity(breath).endsWith('\n#include <Keyboard.h>\n'), 'the breath test gets a USB identity');

  assert.match(html, /vibeCompileSketch\(vibeWithUsbIdentity\(sketch\)\)/, 'uploads compile with the USB identity');
  assert.match(html, /setTimeout\(\(\) => vibeReconnectSketchPort\(12\), 500\)/, 'the monitor starts reconnecting right after the flash');
  assert.match(html, /setTimeout\(\(\) => vibeReconnectSketchPort\(45, true, run\), VIBE_RECONNECT_POLL_MS\)/,
    'the monitor keeps looking quietly after the button is offered');
  assert.match(html, /querySelectorAll\('\.vibe-monitor-watch-btn'\)\.forEach\(b => b\.remove\(\)\)/,
    'the Watch Serial output button goes away once the monitor opens by itself');
  assert.match(html, /if \(run !== _vibeReconnectRun\) return;/, 'a new upload cancels the previous reconnect');
  assert.match(html, /btn\.classList\.add\('is-active'\);\s*\/\/[^\n]*\n\s*_vibeReconnectRun\+\+;/, 'each upload starts a fresh reconnect run');
}

// ---------- 7. RedBoard / Uno upload keeps one serial read pending ----------
// The original timeout raced reader.read() against a timer. When the timer won,
// the abandoned read stayed alive and consumed the next Optiboot reply. This
// mock drops the first sync response, then answers the retry. It also rejects
// concurrent reads so the exact race cannot return unnoticed.
;(async () => {
  const code = slice('  async function stk500WriteFlash(port, hexBytes, log) {', '  // ---- Web Serial AVR109');
  const stk500WriteFlash = new Function(code + '\nreturn stk500WriteFlash;')();
  let pendingRead = null;
  let closed = false;
  let syncCount = 0;
  let programPages = 0;
  const enqueue = (bytes) => {
    assert.ok(pendingRead, 'the single reader pump is waiting before a reply arrives');
    const resolve = pendingRead;
    pendingRead = null;
    resolve({ value: new Uint8Array(bytes), done: false });
  };
  const reader = {
    read() {
      assert.equal(pendingRead, null, 'only one serial read is pending');
      if (closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise(resolve => { pendingRead = resolve; });
    },
    cancel() {
      closed = true;
      if (pendingRead) {
        const resolve = pendingRead;
        pendingRead = null;
        resolve({ value: undefined, done: true });
      }
      return Promise.resolve();
    },
    releaseLock() {}
  };
  const writer = {
    async write(raw) {
      const bytes = Array.from(raw);
      if (bytes[0] === 0x30) {
        syncCount += 1;
        if (syncCount > 1) setTimeout(() => enqueue([0x14, 0x10]), 0);
      } else if (bytes[0] === 0x75) {
        setTimeout(() => enqueue([0x14, 0x1e, 0x95, 0x0f, 0x10]), 0);
      } else {
        if (bytes[0] === 0x64) programPages += 1;
        setTimeout(() => enqueue([0x14, 0x10]), 0);
      }
    },
    releaseLock() {}
  };
  const port = {
    readable: { getReader: () => reader },
    writable: { getWriter: () => writer }
  };
  const logs = [];
  await stk500WriteFlash(port, new Uint8Array([1, 2, 3, 4]), (line) => logs.push(line));
  assert.equal(syncCount, 2, 'the flasher retries after one missed bootloader reply');
  assert.equal(programPages, 1, 'the sketch is written after the retry syncs');
  assert.ok(logs.some(line => /flashed 4 bytes/.test(line)), 'the Uno flash reaches completion');
})().then(() => {
  console.log('T4SG Serial Monitor checks passed: bounded output, intact lines, single paint per batch, flood safe, monitor opens after upload, Uno retry is race-free.');
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
