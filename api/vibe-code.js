// Vercel Node.js serverless function: OpenAI proxy for the Vibe Coding
// Arduino Tool. Gates access by class code, applies a soft per-IP rate limit,
// and strips markdown fences from the model output so the client receives
// pure Arduino C/C++.
//
// Model is read from env var OPENAI_MODEL so it auto-tracks future OpenAI
// releases without code changes. Default: gpt-4o (auto-resolves to the
// latest GPT-4o snapshot). Update the env var in Vercel and redeploy when a
// newer model ships (e.g. set OPENAI_MODEL=gpt-5 once it's available).
//
// OpenAI applies prompt caching automatically on prompts over ~1024 tokens
// when the same system prefix is repeated; no special headers required.

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
  const fenceStart = /^```(?:arduino|cpp|c\+\+|c)?\s*\n/i;
  const fenceEnd = /\n```\s*$/;
  if (fenceStart.test(out)) {
    out = out.replace(fenceStart, '');
    out = out.replace(fenceEnd, '');
  }
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
  const history = Array.isArray(body.history) ? body.history : [];

  if (!prompt) {
    return res.status(400).json({ error: 'Empty prompt' });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Daily request limit reached. Try again tomorrow.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Bare model names auto-track latest snapshot. Update the env var in Vercel
  // (no code change) when a new generation ships.
  const model = process.env.OPENAI_MODEL || 'gpt-4o';

  // Sanitize history: only role + string content, only user/assistant, last 10.
  const cleanHistory = history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content }));

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...cleanHistory,
      { role: 'user', content: prompt }
    ],
    max_completion_tokens: 2048
  };

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const detail = (data && data.error && data.error.message) ? data.error.message : ('HTTP ' + r.status);
      return res.status(502).json({ error: 'OpenAI API error', detail });
    }

    const choice = Array.isArray(data.choices) && data.choices[0];
    const text = (choice && choice.message && choice.message.content) ? String(choice.message.content) : '';
    const code = stripFences(text);

    return res.status(200).json({ code, usage: data.usage || null, model: data.model || model });
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error', detail: String(err.message || err) });
  }
}
