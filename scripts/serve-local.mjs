// Local static server + hourly feed refresh. Usage: node scripts/serve-local.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.argv[2] || 3006);
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  if (path.startsWith("..") || path.startsWith(".") || path.startsWith("scripts") || ["channels.json", "videos.json"].includes(path)) return res.writeHead(404).end();
  try {
    const file = path || "index.html";
    const body = await readFile(join(ROOT, file));
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, "0.0.0.0", () => console.log(`http://localhost:${PORT}`));

const refresh = () =>
  execFile(process.execPath, [join(ROOT, "scripts/fetch-feed.mjs")], (err, out, errOut) => console.log(out || errOut || err?.message));
refresh();
setInterval(refresh, 60 * 60 * 1000);
