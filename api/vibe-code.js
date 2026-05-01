// Vercel Node.js serverless function: Anthropic proxy for the Vibe Coding
// Arduino Tool. Gates access by class code, applies a soft per-IP rate limit,
// uses prompt caching on the system prompt, and strips markdown fences from
// the model output so the client receives pure Arduino C/C++.

const SYSTEM_PROMPT = "You are a coding assistant for a high school maker class at Sonoma Academy. The student is using an Arduino Leonardo or Arduino Micro to build an adaptive controller for accessibility. Their hardware palette includes: SPDT roller-lever microswitches, tactile buttons (4-pin pairs), 5-pin KY-023 joystick (VCC/GND/VRx/VRy/SW), 3-pin IR sensor module (VCC/GND/OUT), 2-wire sip-and-puff dry-contact switch, LEDs, and 220-ohm resistors.\n\nGenerate clean, well-commented Arduino C/C++ code in response to their request. Use the Keyboard.h, Mouse.h, or Joystick.h libraries when appropriate (Leonardo/Micro can act as a USB HID device). Always include pin number constants at the top, a setup() function, and a loop(). Add Serial.println() debug output so they can see values in the Serial Monitor at 9600 baud. Keep code under 100 lines unless absolutely necessary. Return ONLY the code, no markdown fences, no explanation.";

const RATE_LIMIT_PER_DAY = 30;
// Module-scoped Map. Vercel may reuse the instance across warm invocations but
// not across cold starts; this is a soft limit, fine for a class.
const rateBuckets = new Map();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    return xff.split(',')[0].trim();
  }
  if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function checkRateLimit(ip) {
  const key = ip + '|' + todayUtc();
  const count = rateBuckets.get(key) || 0;
  if (count >= RATE_LIMIT_PER_DAY) return false;
  rateBuckets.set(key, count + 1);
  // Light cleanup so the Map does not grow forever on long-warm instances.
  if (rateBuckets.size > 5000) {
    const today = todayUtc();
    for (const k of rateBuckets.keys()) {
      if (!k.endsWith('|' + today)) rateBuckets.delete(k);
    }
  }
  return true;
}

function stripFences(text) {
  if (!text) return '';
  let out = String(text).trim();
  // Strip a leading fenced block label line and trailing fence
  const fenceStart = /^```(?:arduino|cpp|c\+\+|c)?\s*\n/i;
  const fenceEnd = /\n```\s*$/;
  if (fenceStart.test(out)) {
    out = out.replace(fenceStart, '');
    out = out.replace(fenceEnd, '');
  }
  // Also handle bare ``` at start
  if (out.startsWith('```')) {
    out = out.replace(/^```\s*\n?/, '');
    out = out.replace(/\n?```\s*$/, '');
  }
  return out.trim();
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
  const prompt = (body.prompt || '').toString().trim();
  const classCode = (body.classCode || '').toString();
  const history = Array.isArray(body.history) ? body.history : [];

  const expectedCode = process.env.CLASS_CODE || 'chabot-2026';
  if (!classCode || classCode !== expectedCode) {
    return res.status(401).json({ error: 'Wrong class code' });
  }

  if (!prompt) {
    return res.status(400).json({ error: 'Empty prompt' });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Daily request limit reached. Try again tomorrow.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Sanitize history: only role + string content, only user/assistant, last 10.
  const cleanHistory = history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content }));

  const requestBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      ...cleanHistory,
      { role: 'user', content: prompt }
    ]
  };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const detail = (data && data.error && data.error.message) ? data.error.message : ('HTTP ' + r.status);
      return res.status(502).json({ error: 'Anthropic API error', detail });
    }

    let text = '';
    if (Array.isArray(data.content)) {
      // Concatenate any text blocks
      text = data.content.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n').trim();
    }
    const code = stripFences(text);

    return res.status(200).json({ code, usage: data.usage || null });
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error', detail: String(err.message || err) });
  }
}
