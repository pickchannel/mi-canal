// One-off: replace every approximate date in videos.enc.json with the exact one. Usage: node scripts/fix-dates.mjs
import { loadKey, readVideos, writeVideos } from "./store.mjs";
import { fixApproxDates } from "./dates.mjs";

const key = await loadKey();
const data = await readVideos(key);
const videos = data.videos ?? [];
const fixed = await fixApproxDates(videos);
videos.sort((a, b) => b.published.localeCompare(a.published));
await writeVideos(key, { ...data, updated: new Date().toISOString(), videos });
console.log(`${fixed} fechas corregidas, ${videos.filter((v) => v.approx).length} siguen aproximadas`);
