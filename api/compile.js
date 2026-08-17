// Vercel Node.js serverless function: Arduino sketch compile proxy.
//
// Routing:
//   - If COMPILE_URL is set, forward to our own arduino-cli service (real
//     Leonardo/Micro USB-HID core + Joystick/VL53L0X libraries). This is the
//     real backend; see the d4sg-compile-service repo.
//   - Otherwise fall back to Wokwi's free hexi builder (works for plain GPIO /
//     Servo only — no HID), so nothing breaks before the service is deployed.
//
// Returns { hex, stdout, stderr, board }. `hex` is Intel-HEX text; the client
// parses it with parseIntelHex and flashes over Web Serial (AVR109).
//
// Rate limiting is PER STUDENT (the client sends `student`), not per IP — a
// whole class behind one school NAT used to share a single 80/day bucket. A
// high per-IP cap remains only as an anti-abuse backstop. Identical compiles
// (same source+board) are cached so the AI "fix → auto-recompile" loop doesn't
// burn the quota re-building the same sketch.

const crypto = require('crypto');

// Origin gate — same contract as vibe-code.js. Requests must come from the
// T4SG app: a same-site Origin/Referer on an allowed host, or the app's
// non-secret client header. Stops drive-by scripts from burning the class's
// compile quota and Vercel function budget.
const ALLOWED_HOST_SUFFIXES = ['t4sg-at-sa.vercel.app', 'd4sg-at-sa.vercel.app'];
const CLIENT_HEADER = 'd4sg-at-sa';

function hostFromUrl(value) {
  if (!value) return '';
  try { return new URL(value).hostname.toLowerCase(); } catch (_) { return ''; }
}
function isAllowedHost(host) {
  if (!host) return false;
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith('.' + suffix)
  );
}
function isAllowedRequest(req) {
  const clientHeader = req.headers['x-d4sg-client'];
  if (typeof clientHeader === 'string' && clientHeader.trim() === CLIENT_HEADER) return true;
  if (isAllowedHost(hostFromUrl(req.headers['origin']))) return true;
  if (isAllowedHost(hostFromUrl(req.headers['referer']))) return true;
  return false;
}

const PER_STUDENT_PER_DAY = 200;
const PER_IP_PER_DAY = 600;            // abuse backstop only
const CACHE_TTL_MS = 10 * 60 * 1000;   // 10 min, per warm instance

const studentBuckets = new Map();
const ipBuckets = new Map();
const compileCache = new Map();        // hash -> { at, result }

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}
function todayUtc() { return new Date().toISOString().slice(0, 10); }

function bump(map, rawKey, cap) {
  const key = rawKey + '|' + todayUtc();
  const count = map.get(key) || 0;
  if (count >= cap) return false;
  map.set(key, count + 1);
  if (map.size > 8000) {
    const today = todayUtc();
    for (const k of map.keys()) if (!k.endsWith('|' + today)) map.delete(k);
  }
  return true;
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.length) {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const ALLOWED_BOARDS = new Set(['leonardo', 'micro', 'uno', 'mega', 'pro', 'nano']);

async function compileViaService(sketch, board) {
  const url = process.env.COMPILE_URL;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.COMPILE_KEY) headers['X-Compile-Key'] = process.env.COMPILE_KEY;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ sketch, board }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok && !data.stderr) {
    throw new Error(data.error || ('compile service HTTP ' + r.status));
  }
  return { hex: data.hex || '', stdout: data.stdout || '', stderr: data.stderr || '', board };
}

async function compileViaWokwi(sketch, board) {
  const r = await fetch('https://hexi.wokwi.com/build', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sketch, board }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error('Compile service error');
    e.status = 502; e.stderr = data.stderr || ''; throw e;
  }
  return { hex: data.hex || '', stdout: data.stdout || '', stderr: data.stderr || '', board };
}

export default async function handler(req, res) {
  // Reflect the origin only when it is an allowed T4SG host (never '*').
  const originHost = hostFromUrl(req.headers['origin']);
  if (isAllowedHost(originHost)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers['origin']);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-D4SG-Client');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Lightweight health surface. A GET reports whether the real arduino-cli
  // service is wired up (COMPILE_URL set) without pinging it, so the client can
  // pre-warm /tools and surface an honest "compiler is available" signal. This
  // does NOT touch the POST compile path below.
  if (req.method === 'GET') {
    const cliReady = Boolean(process.env.COMPILE_URL);
    return res.status(200).json({
      ok: true,
      cliReady,
      backend: cliReady ? 'service' : 'wokwi'
    });
  }

  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  if (!isAllowedRequest(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const body = await readJson(req);
  const sketch = (body.sketch || '').toString();
  let board = (body.board || 'leonardo').toString().toLowerCase();
  if (!ALLOWED_BOARDS.has(board)) board = 'leonardo';
  let student = (body.student || '').toString().slice(0, 80).toLowerCase().replace(/[^a-z0-9_-]/g, '') || null;
  // '_anon' is every student who hasn't picked a name yet — that's a shared
  // key, not a person. Fall through to the per-IP backstop instead of letting
  // the whole room drain one 200/day bucket.
  if (student === '_anon') student = null;

  if (!sketch.trim()) return res.status(400).json({ error: 'Empty sketch' });
  if (sketch.length > 200000) return res.status(413).json({ error: 'Sketch too long' });

  // Cache: identical source+board returns instantly and skips the quota.
  const hash = crypto.createHash('sha256').update(board + '\n' + sketch).digest('hex');
  const cached = compileCache.get(hash);
  if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) {
    return res.status(200).json({ ...cached.result, cached: true });
  }

  // Per-student limit first; per-IP only as an abuse backstop.
  if (student && !bump(studentBuckets, 'stu:' + student, PER_STUDENT_PER_DAY)) {
    return res.status(429).json({ error: "You have hit today's compile limit. Try again tomorrow." });
  }
  if (!bump(ipBuckets, getClientIp(req), PER_IP_PER_DAY)) {
    return res.status(429).json({ error: 'This network hit its daily compile limit. Try again later.' });
  }

  try {
    const result = process.env.COMPILE_URL
      ? await compileViaService(sketch, board)
      : await compileViaWokwi(sketch, board);
    // Only cache real outcomes (a hex, or a deterministic compiler error).
    if (result.hex || result.stderr) compileCache.set(hash, { at: Date.now(), result });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.status || 502).json({
      error: 'Compile service unavailable',
      detail: String(err.message || err),
      stderr: err.stderr || '',
    });
  }
}
