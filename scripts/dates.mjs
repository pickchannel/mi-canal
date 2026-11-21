// Exact publish date of a video from its watch page. Node 20+, no dependencies.
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
  "accept-language": "es-ES,es;q=0.9",
};

export async function exactDate(id) {
  const res = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const raw = html.match(/"publishDate":"([^"]+)"/)?.[1] ?? html.match(/itemprop="datePublished" content="([^"]+)"/)?.[1];
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// Replace approximate dates (approx: true) with exact ones, in place, one request at a time.
// Stops at the first HTTP 429 (YouTube rate limit); the rest are retried on a later run. Returns how many were fixed.
export async function fixApproxDates(videos, { limit = Infinity, delay = 1500 } = {}) {
  let fixed = 0;
  for (const v of videos.filter((v) => v.approx).slice(0, limit)) {
    try {
      const date = await exactDate(v.id);
      if (date) { v.published = date; delete v.approx; fixed++; }
    } catch (err) {
      if (err.message === "HTTP 429") { console.warn("YouTube limita las peticiones (429); se sigue en la próxima ejecución"); break; }
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  return fixed;
}
