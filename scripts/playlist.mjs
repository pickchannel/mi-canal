// Read a YouTube playlist page (and optionally all its continuation pages). Node 20+, no dependencies.
// Each item: { id, title, ago: "hace 3 años", duration: "1:02:03" | "" }.
// Finished videos/lives show a duration badge; lives in progress and scheduled ones do not.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const HEADERS = { "user-agent": UA, "accept-language": "es-ES,es;q=0.9" };
const DURATION = /^\d{1,2}(:\d{2}){1,2}$/;

// Uploads playlists of a channel "UC…": long videos (no Shorts, no lives) and lives.
export const videosPlaylist = (channelId) => "UULF" + channelId.slice(2);
export const livesPlaylist = (channelId) => "UULV" + channelId.slice(2);

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

function walk(node, items, tokens, seen) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, items, tokens, seen));
  if (!node || typeof node !== "object") return;
  if (node.lockupViewModel?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" || node.lockupViewModel?.contentId?.length === 11) {
    const r = node.lockupViewModel;
    const ago = JSON.stringify(r.metadata ?? {}).match(/"content":"(hace [^"]+)"/)?.[1] ?? "";
    const badges = [...JSON.stringify(r.contentImage ?? {}).matchAll(/"thumbnailBadgeViewModel":\{"text":"([^"]*)"/g)].map((m) => m[1]);
    const duration = badges.find((t) => DURATION.test(t)) ?? "";
    items.push({ id: r.contentId, title: r.metadata?.lockupMetadataViewModel?.title?.content ?? "", ago, duration });
    return;
  }
  const tok = node.continuationCommand?.token;
  if (tok && !seen.has(tok)) { seen.add(tok); tokens.push(tok); }
  for (const k in node) walk(node[k], items, tokens, seen);
}

// all = false: only the first page (about 100 newest items). A playlist that does not exist gives [].
export async function listPlaylist(playlistId, { all = true } = {}) {
  const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, { headers: HEADERS });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const data = extractJson(html, "var ytInitialData");
  if (!data) throw new Error("No se pudo leer la página de la playlist");
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];

  const items = [], tokens = [], seen = new Set();
  walk(data, items, tokens, seen);
  while (all && apiKey && tokens.length) {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion, hl: "es", gl: "ES" } }, continuation: tokens.shift() }),
    });
    walk(await r.json(), items, tokens, seen);
  }
  return items;
}
