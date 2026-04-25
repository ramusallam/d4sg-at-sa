// Vercel serverless function: fetches a URL and returns Open Graph metadata.
// Called by the front-end when a student drops a link into the gallery.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = (req.query?.url || '').toString().trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; D4SGPreviewBot/1.0; +https://d4sg-at-sa.vercel.app)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);

    const html = await response.text();

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
}
