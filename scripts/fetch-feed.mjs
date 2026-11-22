// Node 20+, no dependencies.
// Logs never print channel ids or names: GitHub Actions logs of a public repo are public.
import { loadConfig, loadKey, readVideos, writeVideos } from "./store.mjs";
import { listPlaylist, videosPlaylist, livesPlaylist } from "./playlist.mjs";
import { fixApproxDates } from "./dates.mjs";

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

// playlistId: UULF… (long videos, no Shorts or lives) or UULV… (lives). A playlist that does not exist gives null.
async function fetchFeed(playlistId, label, tries = 4) {
  const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (feed-reader)" } });
      if (res.status === 404 && playlistId.startsWith("UULV")) return null; // channel without lives
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      console.warn(`[${label}] intento ${i}/${tries}: ${err.message}`);
      if (i === tries) throw err;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

function parseFeed(xml, channelId) {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return entries
    .map((e) => ({
      id: tag(e, "yt:videoId"),
      title: tag(e, "title"),
      published: new Date(tag(e, "published")).toISOString(),
      channelId,
    }))
    .filter((v) => /^[\w-]{11}$/.test(v.id));
}

const config = await loadConfig();
const key = await loadKey();
const previous = await readVideos(key);

// Drop videos of channels no longer in the list, and normal videos of lives-only channels
const keep = (v) => config.channels.includes(v.channelId) && (v.kind === "live" || !config.livesOnly.includes(v.channelId));
const byId = new Map((previous.videos ?? []).filter(keep).map((v) => [v.id, v]));
const names = {};
for (const id of config.channels) names[id] = previous.channels?.[id] ?? id;

let ok = 0;
for (const [i, channelId] of config.channels.entries()) {
  const label = `canal ${i + 1}`;
  try {
    const author = (xml) => tag(xml?.match(/<author>[\s\S]*?<\/author>/)?.[0] ?? "", "name");
    let videos = [];
    if (!config.livesOnly.includes(channelId)) {
      const xml = await fetchFeed(videosPlaylist(channelId), label);
      if (author(xml)) names[channelId] = author(xml);
      videos = parseFeed(xml, channelId);
      for (const v of videos) byId.set(v.id, { ...byId.get(v.id), ...v, approx: undefined });
    }

    // Lives: only finished ones. A new live is added once the playlist page shows its duration
    // (in progress or scheduled lives have none); until then it is retried on the next run.
    const livesXml = await fetchFeed(livesPlaylist(channelId), label);
    if (author(livesXml)) names[channelId] = author(livesXml);
    const lives = livesXml ? parseFeed(livesXml, channelId) : [];
    const fresh = lives.filter((v) => byId.get(v.id)?.kind !== "live");
    let finished = new Set();
    if (fresh.length) {
      try {
        finished = new Set((await listPlaylist(livesPlaylist(channelId), { all: false })).filter((v) => v.duration).map((v) => v.id));
      } catch (err) {
        console.warn(`[${label}] no se pudo comprobar qué directos han terminado: ${err.message}`);
      }
    }
    let added = 0;
    for (const v of lives) {
      if (byId.get(v.id)?.kind === "live") byId.set(v.id, { ...byId.get(v.id), ...v, kind: "live", approx: undefined });
      else if (finished.has(v.id)) { byId.set(v.id, { ...v, kind: "live" }); added++; }
    }
    console.log(`[${label}] ${videos.length} vídeos y ${lives.length} directos en el RSS (${added} directos nuevos)`);
    ok++;
  } catch (err) {
    console.error(`[${label}] error: ${err.message}`);
  }
}

if (ok === 0) {
  console.error("No se pudo leer ningún feed; no se toca videos.enc.json");
  process.exit(1);
}

// Approximate dates (from backfill): fix a batch per run with the exact date of the watch page.
const nFixed = await fixApproxDates([...byId.values()], { limit: 200 });
if (nFixed) console.log(`${nFixed} fechas aproximadas corregidas`);

const videos = [...byId.values()].sort((a, b) => b.published.localeCompare(a.published));
const prevSerialized = JSON.stringify({ title: previous.title, channels: previous.channels, schedule: previous.schedule ?? {}, videos: previous.videos ?? [] });
const nextSerialized = JSON.stringify({ title: config.title, channels: names, schedule: config.schedule, videos });

if (prevSerialized === nextSerialized) {
  console.log("Sin cambios");
} else {
  await writeVideos(key, { title: config.title, updated: new Date().toISOString(), channels: names, schedule: config.schedule, videos });
  console.log(`videos.enc.json: ${videos.length} vídeos`);
}
