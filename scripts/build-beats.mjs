// Makes one small page per beat (beat/<name>.html) so every beat has its own link, for example
// https://www.austinopro.store/beat/density, and WhatsApp, Instagram, X and Google show a proper preview.
// It runs on Cloudflare every time the site is published:  node scripts/build-beats.mjs
// It reads beats.json and meta.json, and copies index.html. Nothing in this script is secret.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.SITE_URL || 'https://www.austinopro.store').replace(/\/+$/, '');
const OUT = path.join(root, 'beat');
const MARK = '.generated-by-build-beats';

const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch { return null; } };
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Same cleaning the store does, so the names and links match exactly.
const raw = readJSON('beats.json');
const list = Array.isArray(raw) ? raw : raw && raw.beats;
const seen = new Set(), titles = [];
for (let t of list || []) {
  if (typeof t !== 'string') continue;
  t = t.replace(/[<>"`\\]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!t) continue;
  const k = slug(t);
  if (!k || seen.has(k)) continue;
  seen.add(k); titles.push(t);
}
if (!titles.length) { console.log('build-beats: no beats found in beats.json, skipping.'); process.exit(0); }

const meta = readJSON('meta.json') || {};
const tpl = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const anchor = '<title>Austino Pro Beats</title>';
if (!tpl.includes(anchor)) { console.error('build-beats: index.html has no "' + anchor + '" line, so the beat pages cannot be made.'); process.exit(1); }

// Start clean so deleted beats lose their page. Only ever remove a folder this script made.
if (fs.existsSync(OUT)) {
  if (!fs.existsSync(path.join(OUT, MARK))) { console.error('build-beats: a "beat" folder already exists that this script did not make. Rename or delete it, then publish again.'); process.exit(1); }
  fs.rmSync(OUT, { recursive: true, force: true });
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, MARK), 'Made by scripts/build-beats.mjs. Safe to delete; it is rebuilt on every publish.\n');

for (const t of titles) {
  const s = slug(t), m = (meta[s] && typeof meta[s] === 'object') ? meta[s] : {};
  const bits = [];
  if (typeof m.g === 'string' && m.g) bits.push(m.g.replace(/[<>"'`\\]/g, '').slice(0, 24));
  const bpm = Math.round(+m.bpm); if (bpm >= 40 && bpm <= 300) bits.push(bpm + ' BPM');
  if (typeof m.k === 'string' && /^[A-G][♯♭♯♭]? (major|minor)$/.test(m.k)) bits.push(m.k);
  const title = `${t} | Beat by Austino Pro`;
  const desc = `${t}${bits.length ? ' · ' + bits.join(' · ') : ''}. Listen to the preview, then lease it as MP3, WAV or WAV Unlimited, or make an offer for exclusive rights. Beat by Austino Pro.`;
  const url = `${SITE}/beat/${s}`;
  const head =
    `<title>${esc(title)}</title>\n` +
    `<base href="/">\n` +
    `<meta name="description" content="${esc(desc)}">\n` +
    `<link rel="canonical" href="${esc(url)}">\n` +
    `<meta property="og:type" content="music.song">\n<meta property="og:site_name" content="Austino Pro">\n` +
    `<meta property="og:title" content="${esc(title)}">\n<meta property="og:description" content="${esc(desc)}">\n<meta property="og:url" content="${esc(url)}">\n` +
    `<meta name="twitter:card" content="summary">\n<meta name="twitter:title" content="${esc(title)}">\n<meta name="twitter:description" content="${esc(desc)}">`;
  let html = tpl.replace(anchor, head);
  // Words for search engines and for visitors without JavaScript. The page replaces them as soon as it loads.
  html = html.replace('</main>', `<noscript><h1>${esc(t)}</h1><p>${esc(desc)}</p><p><a href="/">See all beats</a></p></noscript>\n</main>`);
  fs.writeFileSync(path.join(OUT, s + '.html'), html);
}

// sitemap.xml: the home page, the other pages, and every beat.
const pages = ['', 'about.html', 'contact.html'].concat(fs.existsSync(path.join(root, 'reviews.html')) ? ['reviews.html'] : []);
const urls = pages.map((p) => `${SITE}/${p}`).concat(titles.map((t) => `${SITE}/beat/${slug(t)}`));
fs.writeFileSync(path.join(root, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n') + '\n</urlset>\n');

console.log(`build-beats: made ${titles.length} beat pages in /beat and sitemap.xml`);
