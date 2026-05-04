// Vercel Node.js serverless function: Arduino sketch compile proxy.
// Forwards source to Wokwi's free hexi service (hexi.wokwi.com/build) and
// returns { hex, stdout, stderr } so the Vibe Coding tool can Verify or
// Upload directly to a connected Leonardo / Micro over Web Serial. Wokwi's
// API has open CORS, but going through our own function lets us swap
// providers later without touching the client.

const RATE_LIMIT_PER_DAY = 80;
const rateBuckets = new Map();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function todayUtc() { return new Date().toISOString().slice(0, 10); }

function checkRateLimit(ip) {
  const key = ip + '|' + todayUtc();
  const count = rateBuckets.get(key) || 0;
  if (count >= RATE_LIMIT_PER_DAY) return false;
  rateBuckets.set(key, count + 1);
  if (rateBuckets.size > 5000) {
    const today = todayUtc();
    for (const k of rateBuckets.keys()) if (!k.endsWith('|' + today)) rateBuckets.delete(k);
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
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

const ALLOWED_BOARDS = new Set(['leonardo', 'micro', 'uno', 'mega', 'pro', 'nano']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = await readJson(req);
  const sketch = (body.sketch || '').toString();
  let board = (body.board || 'leonardo').toString().toLowerCase();
  if (!ALLOWED_BOARDS.has(board)) board = 'leonardo';

  if (!sketch.trim()) return res.status(400).json({ error: 'Empty sketch' });
  if (sketch.length > 200000) return res.status(413).json({ error: 'Sketch too long' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Daily compile limit reached. Try again tomorrow.' });
  }

  try {
    const r = await fetch('https://hexi.wokwi.com/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sketch, board })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({
        error: 'Compile service error',
        detail: 'HTTP ' + r.status,
        stderr: data.stderr || ''
      });
    }
    return res.status(200).json({
      hex: data.hex || '',
      stdout: data.stdout || '',
      stderr: data.stderr || '',
      board
    });
  } catch (err) {
    return res.status(502).json({ error: 'Compile service unavailable', detail: String(err.message || err) });
  }
}
