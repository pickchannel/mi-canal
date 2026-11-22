// One-off: load ALL long videos (no Shorts) and finished lives of every channel into videos.enc.json.
// Node 20+, no dependencies. Usage: node scripts/backfill.mjs
// Logs never print channel ids or names.
import { loadConfig, loadKey, readVideos, writeVideos } from "./store.mjs";
import { listPlaylist, videosPlaylist, livesPlaylist } from "./playlist.mjs";
import { fixApproxDates } from "./dates.mjs";

const config = await loadConfig();
const key = await loadKey();

// "hace 3 años" -> approximate time
const UNITS = [[/segundo/, 1e3], [/min/, 6e4], [/hora/, 36e5], [/d[ií]a/, 864e5], [/semana/, 6048e5], [/mes/, 2629746e3], [/año/, 31556952e3]];
function approxDate(ago, now) {
  const m = ago.match(/hace (\d+)\s*(\S+)/);
  if (!m) return null;
  const unit = UNITS.find(([re]) => re.test(m[2]));
  return unit ? now - Number(m[1]) * unit[1] : null;
}

// Keep exact dates already known (RSS); the rest get an approximate date from the playlist ("hace X").
const previous = await readVideos(key);
const known = new Map((previous.videos ?? []).filter((v) => v.published && !v.approx).map((v) => [v.id, v.published]));

const now = Date.now();
const all = new Map();

function add(items, channelId, kind) {
  // Playlist is newest-first: keep that order by making approximate dates strictly decreasing.
  let last = Infinity;
  for (const v of items) {
    const exact = known.get(v.id);
    let t, approx = false;
    if (exact) t = Date.parse(exact);
    else { t = Math.min(approxDate(v.ago, now) ?? last - 1000, last - 1000); approx = true; }
    if (!Number.isFinite(t)) t = now;
    last = t;
    all.set(v.id, { id: v.id, title: v.title, published: new Date(t).toISOString(), channelId, ...(kind === "live" && { kind }), ...(approx && { approx: true }) });
  }
}

for (const [i, channelId] of config.channels.entries()) {
  const label = `canal ${i + 1}`;
  const videos = config.livesOnly.includes(channelId) ? [] : await listPlaylist(videosPlaylist(channelId));
  // Lives: only finished ones (they carry a duration badge); in progress or scheduled are skipped.
  const lives = (await listPlaylist(livesPlaylist(channelId))).filter((v) => v.duration);
  add(videos, channelId, "video");
  add(lives, channelId, "live");
  console.log(`[${label}] ${videos.length} vídeos, ${lives.length} directos`);
}

if (all.size === 0) {
  console.error("No se encontró ningún vídeo; no se toca videos.enc.json");
  process.exit(1);
}

await fixApproxDates([...all.values()]);
const videos = [...all.values()].sort((a, b) => b.published.localeCompare(a.published));
const channels = Object.fromEntries(config.channels.map((id) => [id, previous.channels?.[id] ?? id]));
const nApprox = videos.filter((v) => v.approx).length;
await writeVideos(key, { title: config.title, updated: new Date().toISOString(), channels, videos });
console.log(`videos.enc.json: ${videos.length} (${nApprox} con fecha aproximada)`);
