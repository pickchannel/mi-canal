// Stores one encrypted blob (watch progress) per user. The blob is encrypted in the browser with the
// videos passphrase, so this worker never sees which videos are watched. Key = SHA-256 derived from the passphrase.
const ORIGINS = ["https://pickchannel.github.io", "http://localhost:3006"];
const MAX_BYTES = 512 * 1024;

export default {
  async fetch(req, env) {
    const origin = req.headers.get("origin");
    const cors = {
      "access-control-allow-origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
      "access-control-allow-methods": "GET, PUT, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      vary: "origin",
    };
    const reply = (body, status = 200, extra = {}) => new Response(body, { status, headers: { ...cors, ...extra } });

    if (req.method === "OPTIONS") return reply(null, 204);
    const id = new URL(req.url).pathname.match(/^\/p\/([0-9a-f]{64})$/)?.[1];
    if (!id) return reply("Not found", 404);

    if (req.method === "GET") {
      const value = await env.PROGRESS.get(id);
      return value ? reply(value, 200, { "content-type": "application/json", "cache-control": "no-store" }) : reply("Not found", 404);
    }
    if (req.method === "PUT") {
      const body = await req.text();
      if (body.length > MAX_BYTES) return reply("Too large", 413);
      try {
        const { iv, data } = JSON.parse(body);
        if (typeof iv !== "string" || typeof data !== "string") throw 0;
      } catch {
        return reply("Bad request", 400);
      }
      await env.PROGRESS.put(id, body);
      return reply(null, 204);
    }
    return reply("Method not allowed", 405);
  },
};
