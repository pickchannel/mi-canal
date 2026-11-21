// Node 20+, no dependencies.
// Logs never print channel ids or names: GitHub Actions logs of a public repo are public.
import { loadConfig, loadKey, readVideos, writeVideos } from "./store.mjs";

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

async function fetchFeed(channelId, label, tries = 4) {
  // UULF… = uploads playlist without Shorts or lives
  const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${encodeURIComponent(channelId.slice(2))}`;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (feed-reader)" } });
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

// Drop videos of channels no longer in the list
const byId = new Map((previous.videos ?? []).filter((v) => config.channels.includes(v.channelId)).map((v) => [v.id, v]));
const names = {};
for (const id of config.channels) names[id] = previous.channels?.[id] ?? id;

let ok = 0;
for (const [i, channelId] of config.channels.entries()) {
  const label = `canal ${i + 1}`;
  try {
    const xml = await fetchFeed(channelId, label);
    const author = tag(xml.match(/<author>[\s\S]*?<\/author>/)?.[0] ?? "", "name");
    if (author) names[channelId] = author;
    const videos = parseFeed(xml, channelId);
    for (const v of videos) byId.set(v.id, { ...byId.get(v.id), ...v });
    console.log(`[${label}] ${videos.length} vídeos en el RSS`);
    ok++;
  } catch (err) {
    console.error(`[${label}] error: ${err.message}`);
  }
}

if (ok === 0) {
  console.error("No se pudo leer ningún feed; no se toca videos.enc.json");
  process.exit(1);
}

const videos = [...byId.values()].sort((a, b) => b.published.localeCompare(a.published));
const prevSerialized = JSON.stringify({ title: previous.title, channels: previous.channels, videos: previous.videos ?? [] });
const nextSerialized = JSON.stringify({ title: config.title, channels: names, videos });

if (prevSerialized === nextSerialized) {
  console.log("Sin cambios");
} else {
  await writeVideos(key, { title: config.title, updated: new Date().toISOString(), channels: names, videos });
  console.log(`videos.enc.json: ${videos.length} vídeos`);
}
