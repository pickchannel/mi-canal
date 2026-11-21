// One-off: load ALL long-form videos (no Shorts) of every channel into videos.json.
// Node 20+, no dependencies. Usage: node scripts/backfill.mjs
import { loadConfig, loadKey, readVideos, writeVideos } from "./store.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const HEADERS = { "user-agent": UA, "accept-language": "es-ES,es;q=0.9" };

const config = await loadConfig();
const key = await loadKey();

function extractJson(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let i = html.indexOf("{", start), depth = 0, inStr = false, esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(html.slice(i, j + 1));
  }
  return null;
}

const seenTokens = new Set();

// Walk any JSON tree and collect playlist items + continuation tokens.
function walk(node, items, tokens) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, items, tokens));
  if (!node || typeof node !== "object") return;
  if (node.playlistVideoRenderer) {
    const r = node.playlistVideoRenderer;
    items.push({ id: r.videoId, title: r.title?.runs?.map((x) => x.text).join("") ?? r.title?.simpleText ?? "" });
    return;
  }
  if (node.lockupViewModel?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" || node.lockupViewModel?.contentId?.length === 11) {
    const r = node.lockupViewModel;
    const ago = JSON.stringify(r.metadata ?? {}).match(/"content":"(hace [^"]+)"/)?.[1] ?? "";
    items.push({ id: r.contentId, title: r.metadata?.lockupMetadataViewModel?.title?.content ?? "", ago });
    return;
  }
  const tok = node.continuationCommand?.token;
  if (tok && !seenTokens.has(tok)) { seenTokens.add(tok); tokens.push(tok); }
  for (const k in node) walk(node[k], items, tokens);
}

async function listPlaylist(playlistId) {
  const html = await (await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, { headers: HEADERS })).text();
  const data = extractJson(html, "var ytInitialData");
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
  if (!data || !apiKey) throw new Error("No se pudo leer la página de la playlist");

  const items = [], tokens = [];
  walk(data, items, tokens);
  while (tokens.length) {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion, hl: "es", gl: "ES" } }, continuation: tokens.shift() }),
    });
    walk(await res.json(), items, tokens);
  }
  return items;
}

// "hace 3 años" -> approximate ISO date
const UNITS = [[/segundo/, 1e3], [/min/, 6e4], [/hora/, 36e5], [/d[ií]a/, 864e5], [/semana/, 6048e5], [/mes/, 2629746e3], [/año/, 31556952e3]];
function approxDate(ago, now) {
  const m = ago.match(/hace (\d+)\s*(\S+)/);
  if (!m) return null;
  const unit = UNITS.find(([re]) => re.test(m[2]));
  return unit ? now - Number(m[1]) * unit[1] : null;
}

// Keep exact dates already known (RSS); the rest get an approximate date from the playlist ("hace X").
let previous = [], prevChannels = {};
{ const p = await readVideos(key); previous = p.videos ?? []; prevChannels = p.channels ?? {}; }
const known = new Map(previous.filter((v) => v.published && !v.approx).map((v) => [v.id, v.published]));

const now = Date.now();
const all = [];
for (const channelId of config.channels) {
  const items = await listPlaylist("UULF" + channelId.slice(2));
  console.log(`[${channelId}] ${items.length} vídeos largos`);
  // Playlist is newest-first: keep that order by making approximate dates strictly decreasing.
  let last = Infinity;
  for (const v of items) {
    const exact = known.get(v.id);
    let t, approx = false;
    if (exact) t = Date.parse(exact);
    else { t = Math.min(approxDate(v.ago, now) ?? last - 1000, last - 1000); approx = true; }
    if (!Number.isFinite(t)) t = now;
    last = t;
    all.push({ id: v.id, title: v.title, published: new Date(t).toISOString(), channelId, ...(approx && { approx: true }) });
  }
}

if (all.length === 0) {
  console.error("No se encontró ningún vídeo; no se toca videos.json");
  process.exit(1);
}

const videos = all.sort((a, b) => b.published.localeCompare(a.published));
const nApprox = videos.filter((v) => v.approx).length;
await writeVideos(key, { title: config.title, updated: new Date().toISOString(), channels: prevChannels, videos });
console.log(`videos.enc.json: ${videos.length} vídeos (${nApprox} con fecha aproximada)`);
