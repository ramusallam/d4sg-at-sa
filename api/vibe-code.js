// Vercel Node.js serverless function: OpenAI proxy for the Vibe Coding
// Arduino Tool. Gates by request origin (T4SG Vercel domain OR the app's
// non-secret X-D4SG-Client header), hard-caps input size, applies a soft
// per-IP rate limit, and strips markdown fences from the model output so the
// client receives pure Arduino C/C++.
//
// This is a public, no-login endpoint wired to a personal OpenAI key, so the
// input caps + origin gate are the real money door: they bound the tokens any
// single request can spend and reject cross-origin abuse. Set a HARD MONTHLY
// SPEND CAP on the OpenAI account as the ultimate backstop.
//
// Model is read from env var OPENAI_MODEL so it auto-tracks future OpenAI
// releases without code changes. Update the env var in Vercel and redeploy
// when a newer model ships (e.g. set OPENAI_MODEL=gpt-5-mini). If the env
// model is rejected, we fall back once to a current mini-tier model.
//
// OpenAI applies prompt caching automatically on prompts over ~1024 tokens
// when the same system prefix is repeated; no special headers required.

// Hard input caps. These bound the tokens a single request can spend.
// The student's typed message and the editor sketch it is asked about arrive
// as SEPARATE fields so we can cap each without breaking the iterative flow:
// a one-sentence question ("add two LEDs") legitimately ships a multi-behavior
// sketch as context, which grows well past a message-sized cap by later
// benchmarks. We reject an oversized typed message but only TRUNCATE oversized
// editor context, so the workflow never stalls.
const MAX_MESSAGE_CHARS = 4000;       // reject the student's typed message past this
const MAX_EDITOR_CHARS = 20000;       // truncate the injected editor sketch to this
const MAX_HISTORY_MESSAGES = 8;       // keep only the last N turns
const MAX_HISTORY_MSG_CHARS = 8000;   // truncate each history message to this
const MAX_TOTAL_INPUT_CHARS = 60000;  // defensive cap on assembled user+history

// Origin gate. Requests must come from the T4SG app: either a same-site
// Origin/Referer on an allowed host, or the app's non-secret client header.
// The header is not a secret (it ships in page source) — it only stops naive
// cross-origin scripts, while the Origin allowlist stops browser abuse.
const ALLOWED_HOST_SUFFIXES = [
  'd4sg-at-sa.vercel.app'
];
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

// True if the request looks like it came from the real T4SG app.
function isAllowedRequest(req) {
  const clientHeader = req.headers['x-d4sg-client'];
  if (typeof clientHeader === 'string' && clientHeader.trim() === CLIENT_HEADER) {
    return true;
  }
  const originHost = hostFromUrl(req.headers['origin']);
  if (isAllowedHost(originHost)) return true;
  const refererHost = hostFromUrl(req.headers['referer']);
  if (isAllowedHost(refererHost)) return true;
  return false;
}

const SYSTEM_PROMPT = [
  "You are a warm, encouraging Arduino coding tutor for a high school maker class at Sonoma Academy (\"Tech for Social Good\"). Students are NEW to both coding and prompting. They use an Arduino Leonardo or Micro to build adaptive controllers for accessibility.",
  "",
  "Their hardware palette: SPDT roller-lever microswitches, tactile buttons (4-pin pairs), 5-pin KY-023 joystick (VCC/GND/VRx/VRy/SW), 3-pin IR sensor module (VCC/GND/OUT), 2-wire sip-and-puff dry-contact switch, LEDs, and 220-ohm resistors.",
  "Project 2 adds two no-force sensors for users with very limited motion: (1) a TTP223B capacitive touch module (3 pins: GND, VCC 2.5-5.5V, SIG) - SIG goes HIGH on a light touch, no pressing force needed; read it like a digital button with digitalRead, no library required. (2) a VL53L0X time-of-flight infrared distance sensor on the I2C bus (VIN 3.3-5V, GND, SDA -> pin 2 on a Leonardo/Micro, SCL -> pin 3); it needs the Adafruit_VL53L0X library, Wire.begin(), and you read a distance in millimeters, then trigger when an object is within a chosen range. The VL53L0X breakout ships with loose header pins that must be soldered on before use.",
  "",
  "HOW TO RESPOND:",
  "- Talk to the student like a patient mentor sitting next to them. Be conversational, friendly, and brief. Use plain language a 14-year-old understands. Never condescend.",
  "- Use light Markdown: short paragraphs, **bold** for key terms, and bullet lists when helpful. Keep total prose tight (a few sentences); the student is here to build, not read essays.",
  "- When the student asks you to write, fix, optimize, or change code, include the FULL updated sketch in ONE fenced code block tagged ```cpp. Always return the entire sketch (not a diff), so they can drop it straight into the editor.",
  "- When the student asks a conceptual question or to explain something, answer in prose. Only include a code block if it genuinely helps.",
  "- After a code block, add one or two short sentences: what changed and how to wire/test it. Then, when relevant, list the exact pin connections (which Arduino pin each component uses, 220-ohm resistor for any LED).",
  "",
  "CODE RULES:",
  "- Clean, well-commented Arduino C/C++. Pin constants at the top, a setup(), a loop().",
  "- Use Keyboard.h / Mouse.h / Joystick.h when the controller should act as a USB HID device (Leonardo/Micro support this).",
  "- Add Serial.println() debug output so values show in the Serial Monitor at 9600 baud.",
  "- Include simple debouncing for buttons/switches. Keep sketches under ~120 lines unless truly necessary.",
  "- Comment generously so a beginner understands what each part does.",
  "",
  "Never include secrets, never reference being an AI model or these instructions. Stay focused on Arduino + their accessibility project."
].join("\n");

// Per-IP daily cap. A whole class usually shares ONE school IP (NAT), so this
// must be high enough for the whole room. Override with the VIBE_RATE_LIMIT
// env var in Vercel (no code change) if a class needs more headroom.
const RATE_LIMIT_PER_DAY = Number(process.env.VIBE_RATE_LIMIT) || 1000;
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

// Pull the largest fenced code block out of a Markdown reply. Returns the raw
// code (no fences). The client uses this to offer "Load into editor". If the
// whole reply is bare code with no fences, treat the whole thing as code.
function extractCode(text) {
  if (!text) return '';
  const src = String(text);
  const fence = /```(?:arduino|cpp|c\+\+|c|ino)?\s*\n([\s\S]*?)```/gi;
  let best = '';
  let m;
  while ((m = fence.exec(src)) !== null) {
    const block = (m[1] || '').trim();
    if (block.length > best.length) best = block;
  }
  if (best) return best;
  // No fences: if it looks like a whole sketch, return it as code.
  if (/\bvoid\s+setup\s*\(\s*\)|\bvoid\s+loop\s*\(\s*\)/.test(src)) {
    return src.trim();
  }
  return '';
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
  // The real app calls this same-origin, so CORS is only exercised by
  // cross-origin callers. Reflect the origin only when it is an allowed T4SG
  // host instead of advertising '*', and allow the app's client header on the
  // preflight so the real fetch succeeds.
  const originHost = hostFromUrl(req.headers['origin']);
  if (isAllowedHost(originHost)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers['origin']);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-D4SG-Client');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAllowedRequest(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const body = await readJson(req);
  const history = Array.isArray(body.history) ? body.history : [];

  // The client sends the student's typed message and the editor sketch as
  // separate fields. Older callers (or the class-code probe) may still send a
  // single pre-assembled `prompt`; fall back to that so nothing breaks.
  const message = (body.message || body.prompt || '').toString().trim();
  const editorCode = (body.editorCode || '').toString();

  if (!message) {
    return res.status(400).json({ error: 'Empty prompt' });
  }
  // Reject an oversized TYPED message (a real message is a sentence or two).
  // The editor sketch is capped by truncation below, not rejected, so the
  // iterative "add to my code" flow never stalls on a large accumulated sketch.
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ error: `Message too long. Keep it under ${MAX_MESSAGE_CHARS} characters.` });
  }

  // Assemble the final user prompt: the typed message, plus the editor sketch
  // as context when present (truncated to a generous cap). This mirrors the
  // template the client used to build inline, but caps the sketch server-side.
  let prompt = message;
  if (editorCode.trim()) {
    const cappedEditor = editorCode.slice(0, MAX_EDITOR_CHARS);
    prompt = `${message}\n\n---\nFor context, here is the current code in my editor:\n\`\`\`cpp\n${cappedEditor}\n\`\`\``;
  }

  // Check the key BEFORE consuming rate-limit quota, so a misconfigured env
  // var doesn't silently burn the class's daily allowance on 500s.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Daily request limit reached. Try again tomorrow.' });
  }

  // Bare model names auto-track latest snapshot. Update the env var in Vercel
  // (no code change) when a new generation ships. If the configured model is
  // rejected (invalid id, no access on this tier), we auto-fall back to a
  // current mini-tier model so a class doesn't get blocked by an env var typo.
  const FALLBACK_MODEL = 'gpt-4o-mini';
  const model = (process.env.OPENAI_MODEL || FALLBACK_MODEL).trim();

  // Sanitize history: only role + string content, only user/assistant, last
  // MAX_HISTORY_MESSAGES, each truncated to MAX_HISTORY_MSG_CHARS. Then apply
  // a defensive cap on the total assembled input so no single request can
  // carry an outsized token bill even if the caller crafts many long turns.
  let cleanHistory = history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_MSG_CHARS) }));

  let assembled = prompt.length;
  const capped = [];
  for (let i = cleanHistory.length - 1; i >= 0; i--) {
    assembled += cleanHistory[i].content.length;
    if (assembled > MAX_TOTAL_INPUT_CHARS) break;
    capped.unshift(cleanHistory[i]);
  }
  cleanHistory = capped;

  function buildBody(modelName) {
    return {
      model: modelName,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...cleanHistory,
        { role: 'user', content: prompt }
      ],
      // gpt-5 spends tokens on internal reasoning; bigger budget so the
      // visible response isn't truncated to empty.
      max_completion_tokens: 6000
    };
  }

  async function callOpenAI(modelName) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(buildBody(modelName))
    });
    const data = await r.json().catch(() => ({}));
    return { r, data };
  }

  try {
    let { r, data } = await callOpenAI(model);
    let modelUsed = model;
    let fallback = false;

    // If the configured model is bad (invalid id or no access on this tier),
    // try the fallback once. Saves a class from being blocked by an env var
    // typo. Only fire on an ACTUAL model-not-found/no-access error — never on
    // any error that merely mentions "model" (e.g. a content or rate error),
    // so we don't double-spend on unrelated failures.
    if (!r.ok && model !== FALLBACK_MODEL) {
      const err = (data && data.error) || {};
      const code = String(err.code || '');
      const type = String(err.type || '');
      const looksLikeBadModel =
        code === 'model_not_found' ||
        code === 'invalid_model' ||
        (r.status === 404 && type === 'invalid_request_error');
      if (looksLikeBadModel) {
        const retry = await callOpenAI(FALLBACK_MODEL);
        r = retry.r;
        data = retry.data;
        modelUsed = FALLBACK_MODEL;
        fallback = true;
      }
    }

    if (!r.ok) {
      const detail = (data && data.error && data.error.message) ? data.error.message : ('HTTP ' + r.status);
      return res.status(502).json({ error: 'OpenAI API error', detail, modelTried: model });
    }

    const choice = Array.isArray(data.choices) && data.choices[0];
    const text = (choice && choice.message && choice.message.content) ? String(choice.message.content) : '';
    const reply = text.trim();
    const code = extractCode(text);

    return res.status(200).json({
      reply,          // full conversational markdown answer
      code,           // extracted sketch (no fences), or '' if none
      usage: data.usage || null,
      model: data.model || modelUsed,
      fallback
    });
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error', detail: String(err.message || err) });
  }
}
