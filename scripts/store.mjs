// Shared config + encrypted storage. Node 20+, no dependencies.
// Channels: env CHANNELS (JSON array of "UC…" ids, or a channels.json object) or local channels.json (gitignored).
// Passphrase: env VIDEOS_KEY or local .videos-key (gitignored).
// Output: videos.enc.json = AES-256-GCM, key from PBKDF2-SHA256(passphrase, salt). Same format index.html decrypts.
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const ENC_FILE = new URL("videos.enc.json", ROOT);
const ITER = 310000;
const { subtle } = globalThis.crypto;

const b64 = (buf) => Buffer.from(buf).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

async function readText(name) {
  try { return (await readFile(new URL(name, ROOT), "utf8")).trim(); } catch { return ""; }
}

export async function loadConfig() {
  const raw = process.env.CHANNELS?.trim() || (await readText("channels.json"));
  if (!raw) throw new Error("Faltan los canales (secreto CHANNELS o channels.json local)");
  const parsed = JSON.parse(raw);
  const config = Array.isArray(parsed) ? { channels: parsed } : parsed;
  if (!config.channels?.length) throw new Error("La lista de canales está vacía");
  return { title: config.title || "Mis canales", channels: config.channels };
}

export async function loadKey() {
  const key = process.env.VIDEOS_KEY?.trim() || (await readText(".videos-key"));
  if (!key) throw new Error("Falta la contraseña (secreto VIDEOS_KEY o .videos-key local)");
  return key;
}

async function deriveKey(passphrase, salt, iter) {
  const base = await subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function readVideos(passphrase) {
  let enc;
  try { enc = JSON.parse(await readFile(ENC_FILE, "utf8")); } catch { return { videos: [] }; }
  const key = await deriveKey(passphrase, unb64(enc.salt), enc.iter);
  try {
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: unb64(enc.iv) }, key, unb64(enc.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error("No se pudo descifrar videos.enc.json (¿contraseña distinta?)");
  }
}

export async function writeVideos(passphrase, data) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITER);
  const cipher = await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  const out = { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(cipher) };
  await writeFile(ENC_FILE, JSON.stringify(out) + "\n");
}
