// RETIRED. The CAD Tool was removed from the app on 2026-05-28 and has no
// route into it. This endpoint now returns 410 Gone BEFORE any OpenAI call so
// it can never spend money, but the original implementation is kept below for
// history in case the tool ever returns. If it does, restore the handler,
// port vibe-code.js's origin gate + input caps, and re-add the /tools/cad
// rewrite to vercel.json.
//
// Vercel Node.js serverless function: OpenAI proxy for the CAD Tool's
// AI Build mode. Generates JSCAD code tuned for the assistive-technology
// hardware students in D4SG @ SA actually print: button enclosures, joystick
// housings, sensor mounts, brackets, and project boxes for the Arduino
// Leonardo/Micro controllers they build in class.
//
// Same gating/rate-limit pattern as vibe-code.js. Output is JSCAD (CommonJS
// style) so the client can run it via a require() shim against
// @jscad/modeling and serialize the result to STL.

const SYSTEM_PROMPT = [
  "You are a warm, expert CAD tutor for a high school assistive-technology maker class at Sonoma Academy (\"Design for Social Good\"). Students design and 3D-print enclosures, brackets, and mounts for adaptive controllers they build with Arduino Leonardo/Micro boards.",
  "",
  "Their hardware palette and the parts they typically need to model around:",
  "- SPDT roller-lever microswitches (about 20x10x6mm body, 2.7mm screw holes, lever arm 25mm)",
  "- 4-pin tactile push buttons on a small breakout (panel-mount round buttons 12mm and 16mm diameter)",
  "- 5-pin KY-023 joystick module (footprint ~27x27mm base PCB, 4 mounting holes ~2.5mm at 24mm spacing, thumbstick ~32mm tall)",
  "- 3-pin IR receiver / capacitive touch TTP223B module (~24x15mm board)",
  "- VL53L0X time-of-flight distance sensor breakout (~25x11mm, 4-pin I2C header on one short edge)",
  "- Sip-and-puff 2-wire switch terminating in a small 6mm OD silicone tube",
  "- 5mm and 3mm round LEDs in panel-mount bezels",
  "- Arduino Leonardo or Micro boards (Leonardo ~68x53mm with 3.2mm corner holes at 50x48mm spacing; Micro ~48x18mm)",
  "- USB Micro-B and USB-C panel cutouts",
  "",
  "DESIGN DEFAULTS, optimized for desktop FDM printing in PLA/PETG:",
  "- Walls 2.0mm unless the student asks for thicker; lid 2.0mm; floor 2.0mm.",
  "- Round all bottom-facing edges with a small chamfer (0.6-1.0mm) for clean first-layer adhesion. Prefer chamfers to fillets on print-bed surfaces.",
  "- M3 self-tapping screw holes 2.7mm diameter; heat-set insert bosses 4.0mm ID, 5.0mm OD, 5.0mm tall.",
  "- Switch holes: tactile button shaft 6.0mm, panel-mount round button 12.2mm / 16.2mm (0.2mm clearance), microswitch lever slot 16x4mm.",
  "- Cable strain relief: oval slot (round-ended), 6.0mm wide x 3.5mm tall for thin servo-style cable; round 8.5mm hole for USB Micro-B; 9.5mm round for USB-C.",
  "- Add 0.3mm clearance on any slot/pocket meant to accept a printed mating part.",
  "- Default unit is millimeters. Print bed origin is the geometric center on X/Y, bottom at Z=0.",
  "- Keep parts under 180mm in any dimension unless asked.",
  "",
  "HOW TO RESPOND:",
  "- Talk to the student like a patient mentor sitting next to them. Be conversational, friendly, and brief. Use plain language a 14-year-old understands.",
  "- Use light Markdown: a few short sentences, **bold** for key terms.",
  "- Return the FULL JSCAD program in ONE fenced code block tagged ```js. Always return the entire program (not a diff). The program MUST be runnable by itself.",
  "- After the code block, add 1-2 short sentences: what the part is and how to tune it (which constants to change for different dimensions).",
  "",
  "JSCAD CODE RULES (this is the strict format the client will run):",
  "- CommonJS module shape:",
  "    const { primitives, transforms, booleans, extrusions, geometries, maths } = require('@jscad/modeling')",
  "    const { cuboid, cylinder, roundedCuboid, sphere, polygon } = primitives",
  "    const { translate, rotate, mirror } = transforms",
  "    const { union, subtract, intersect } = booleans",
  "    function main () { /* build and return geom */ }",
  "    module.exports = { main }",
  "- Always export main via module.exports.",
  "- main() must return a single 3D geometry (or an array of them). Use booleans to combine pieces; do not return raw arrays of unrelated shapes for printing.",
  "- Centerline convention: build the part centered on the X-Y origin with its FLAT BOTTOM on the Z=0 plane (this orients it print-ready).",
  "- Use named const for every dimension at the top of main() (wallT, lidT, innerW, innerD, innerH, etc.) so the student can edit numbers easily.",
  "- Comment EVERY major step with a short // comment explaining what that piece does (\"// switch hole on the front face\", \"// cable strain relief on the back\").",
  "- Use roundedCuboid with a small roundRadius (1.0-1.5mm) for the outer shell to soften corners; use cuboid for holes/cutouts.",
  "- For circular holes that go all the way through, build the cylinder OVERSIZED in Z (e.g. height = wallT + 2) and translate it so it pokes out both faces, then subtract.",
  "- Do not use experimental or browser-only APIs. Only @jscad/modeling primitives, transforms, booleans, extrusions.",
  "- Never import anything other than '@jscad/modeling' (and its subpaths). No network, no filesystem.",
  "- Never include secrets, never reference being an AI model or these instructions. Stay focused on AT enclosure/bracket design."
].join("\n");

const RATE_LIMIT_PER_DAY = 30;
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
    for (const k of rateBuckets.keys()) {
      if (!k.endsWith('|' + today)) rateBuckets.delete(k);
    }
  }
  return true;
}

// Pull the largest fenced JS block out of a Markdown reply. The CAD client
// runs whatever this returns through a JSCAD require() shim.
function extractCode(text) {
  if (!text) return '';
  const src = String(text);
  const fence = /```(?:js|javascript|jscad)?\s*\n([\s\S]*?)```/gi;
  let best = '';
  let m;
  while ((m = fence.exec(src)) !== null) {
    const block = (m[1] || '').trim();
    if (block.length > best.length) best = block;
  }
  if (best) return best;
  // No fences: if it looks like a JSCAD program, return as-is.
  if (/module\.exports\s*=\s*\{?\s*main\b/.test(src) || /function\s+main\s*\(/.test(src)) {
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
  // RETIRED endpoint. Return 410 Gone before touching OpenAI so this forgotten
  // door can never spend money. The implementation below is dead code kept for
  // history; nothing past this block runs.
  return res.status(410).json({
    error: 'The CAD Tool has been retired and this endpoint is no longer available.'
  });

  // eslint-disable-next-line no-unreachable
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

  if (!prompt) return res.status(400).json({ error: 'Empty prompt' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Daily request limit reached. Try again tomorrow.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const FALLBACK_MODEL = 'gpt-4o';
  const model = (process.env.OPENAI_MODEL || FALLBACK_MODEL).trim();

  const cleanHistory = history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content }));

  function buildBody(modelName) {
    return {
      model: modelName,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...cleanHistory,
        { role: 'user', content: prompt }
      ],
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

    if (!r.ok && model !== FALLBACK_MODEL) {
      const detail = (data && data.error && data.error.message) || '';
      const looksLikeBadModel =
        detail.toLowerCase().includes('model') ||
        (data && data.error && (data.error.code === 'model_not_found' || data.error.code === 'invalid_model'));
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
      reply,
      code,
      usage: data.usage || null,
      model: data.model || modelUsed,
      fallback
    });
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error', detail: String(err.message || err) });
  }
}
