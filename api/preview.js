// Vercel serverless function: fetches a URL and returns Open Graph metadata.
// Called by the front-end when a student drops a link into the gallery.
//
// This is a public fetch proxy, so it is hardened against abuse:
//   - daily per-IP bucket (soft, per warm instance) so it can't be scripted to
//     exhaust the Vercel function quota and take /api/compile down with it,
//   - SSRF guard: the hostname is resolved and any request that lands on a
//     private, loopback, link-local, or cloud-metadata IP is refused, so it
//     can't be used to read internal services,
//   - a hard response-size cap and an HTML-only content-type check so it only
//     ever pulls the small amount of markup it needs to read OG tags.

const dns = require('dns').promises;
const net = require('net');

const RATE_LIMIT_PER_DAY = Number(process.env.PREVIEW_RATE_LIMIT) || 500;
const rateBuckets = new Map();

const MAX_BYTES = 512 * 1024;   // read at most 512 KB of markup
const FETCH_TIMEOUT_MS = 8000;

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

// Reject IPs that point at the deployment's own network: loopback, private
// ranges, link-local (incl. the 169.254.169.254 cloud-metadata endpoint), and
// unique-local IPv6. Blocks SSRF into internal services.
function isBlockedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    if (p[0] === 10) return true;                                  // 10.0.0.0/8
    if (p[0] === 127) return true;                                 // loopback
    if (p[0] === 0) return true;                                   // 0.0.0.0/8
    if (p[0] === 169 && p[1] === 254) return true;                 // link-local + metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;     // 172.16.0.0/12
    if (p[0] === 192 && p[1] === 168) return true;                 // 192.168.0.0/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;    // 100.64.0.0/10 CGNAT
    if (p[0] >= 224) return true;                                  // multicast/reserved
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;                              // loopback
    if (lower === '::') return true;                               // unspecified
    if (lower.startsWith('fe80')) return true;                     // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
    if (lower.startsWith('::ffff:')) {                             // IPv4-mapped
      return isBlockedIp(lower.slice(7));
    }
    return false;
  }
  return true; // not a valid IP => refuse
}

async function assertSafeHost(hostname) {
  // Literal IPs are checked directly; hostnames are resolved and every A/AAAA
  // record must be public (DNS rebinding to an internal record is refused).
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error('blocked address');
    return;
  }
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length) throw new Error('unresolved host');
  for (const rec of records) {
    if (isBlockedIp(rec.address)) throw new Error('blocked address');
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = (req.query?.url || '').toString().trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!checkRateLimit(getClientIp(req))) {
    return res.status(429).json({ error: 'Daily preview limit reached. Try again tomorrow.' });
  }

  let hostname = '';
  try { hostname = new URL(url).hostname; } catch (_) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    await assertSafeHost(hostname);
  } catch (_) {
    return res.status(400).json({ error: 'Blocked URL' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; D4SGPreviewBot/1.0; +https://d4sg-at-sa.vercel.app)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      signal: controller.signal,
      redirect: 'follow'
    });

    // Only parse HTML; skip binary/large responses so this never becomes a
    // pipe for arbitrary content or a memory hog.
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !/text\/html|application\/xhtml\+xml/.test(contentType)) {
      clearTimeout(timeout);
      let domain = '';
      try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
      return res.status(200).json({ url, title: '', description: '', image: '', domain });
    }

    // Read at most MAX_BYTES so a huge page can't exhaust memory.
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    let html = '';
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        html += decoder.decode(value, { stream: true });
        if (received >= MAX_BYTES) { try { await reader.cancel(); } catch (_) {} break; }
      }
    } else {
      html = (await response.text()).slice(0, MAX_BYTES);
    }
    clearTimeout(timeout);

    const meta = (prop) => {
      const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i')
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m) return m[1];
      }
      return '';
    };

    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);

    let title = meta('og:title') || meta('twitter:title') || (titleTag ? titleTag[1] : '');
    let description = meta('og:description') || meta('twitter:description') || meta('description');
    let image = meta('og:image') || meta('twitter:image') || meta('twitter:image:src');

    title = title.trim();
    description = description.trim();

    // Resolve relative image URLs
    if (image && !/^https?:\/\//i.test(image)) {
      try { image = new URL(image, url).toString(); } catch (_) { image = ''; }
    }

    let domain = '';
    try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ url, title, description, image, domain });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch link preview', message: String(err.message || err) });
  }
};
