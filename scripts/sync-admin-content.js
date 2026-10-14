/**
 * Syncs Decap CMS content into static JSON files under public/, which the
 * React SPA (src/App.tsx) loads at runtime.
 *
 *   src/content/ads/*.json    -> public/ads-data.json
 *   src/content/posts/*.md    -> public/posts-data.json
 *
 * Without this step the SPA falls back to the hard-coded INITIAL_ADS /
 * BLOG_POSTS in src/data/*, so edits made in the admin panel never reach
 * the site. Runs automatically as part of `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADS_DIR = path.join(ROOT, 'src/content/ads');
const POSTS_DIR = path.join(ROOT, 'src/content/posts');
const OUT_ADS = path.join(ROOT, 'public/ads-data.json');
const OUT_POSTS = path.join(ROOT, 'public/posts-data.json');

function writeJson(file, payload) {
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

// Decap CMS иногда отдаёт list-поле links строкой (JSON), а не массивом —
// нормализуем оба варианта, чтобы синк не падал.
function normalizeLinks(raw) {
  let links = raw;
  if (typeof links === 'string') {
    const s = links.trim();
    if (!s) return [];
    try {
      links = JSON.parse(s);
    } catch {
      // Не JSON — считаем списком URL через запятую/перевод строки
      links = s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(links)) return [];
  return links
    .map((l) => {
      if (typeof l === 'string') return { url: l };
      if (l && typeof l === 'object' && l.url) {
        return { label: l.label || '', url: String(l.url) };
      }
      return null;
    })
    .filter(Boolean);
}

// ----------------------------------------------------------------------
// Ads (Decap "ads" collection: one JSON file per banner)
// ----------------------------------------------------------------------
function loadAds() {
  if (!fs.existsSync(ADS_DIR)) return [];

  return fs
    .readdirSync(ADS_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      try {
        const raw = fs.readFileSync(path.join(ADS_DIR, file), 'utf8');
        const ad = JSON.parse(raw);
        // Keep id in sync with filename (Decap slug is {{id}})
        if (!ad.id) ad.id = path.basename(file, '.json');
        return ad;
      } catch (err) {
        console.warn(`[sync-admin-content] Skipping invalid ad file ${file}: ${err.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

// ----------------------------------------------------------------------
// Posts (Decap "posts" collection: Markdown with frontmatter)
// ----------------------------------------------------------------------
function loadPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];

  return fs
    .readdirSync(POSTS_DIR)
    .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
    .map((file) => {
      try {
        const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
        const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
        const fm = match ? parseYaml(match[1]) : {};
        const body = match ? raw.slice(match[0].length) : raw;
        const slug = path.basename(file).replace(/\.(md|mdx)$/, '');
        const isoDate = fm.date ?? fm.pubDate ?? null;
        const dateObj = isoDate ? new Date(isoDate) : null;
        const words = body.trim().split(/\s+/).filter(Boolean).length;
        return {
          id: slug,
          slug,
          title: fm.title ?? slug,
          excerpt: fm.description ?? '',
          category: fm.category ?? 'Блог',
          tags: Array.isArray(fm.tags) ? fm.tags : [],
          date: dateObj
            ? dateObj.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' })
            : '',
          isoDate: dateObj ? dateObj.toISOString() : null,
          image: fm.heroImage ?? fm.image ?? '',
          imageCaption: fm.imageCaption ?? fm.caption ?? '',
          links: normalizeLinks(fm.links),
          readingTime: `${Math.max(1, Math.round(words / 200))} мин чтения`,
          author: { name: 'Hallizar', role: 'Frontend & Systems Engineer', avatar: 'H' },
          views: 0,
          draft: fm.draft === true,
          content: body.trim(),
        };
      } catch (err) {
        console.warn(`[sync-admin-content] Skipping invalid post file ${file}: ${err.message}`);
        return null;
      }
    })
    .filter((post) => post && !post.draft)
    .sort((a, b) => new Date(b.date ?? 0) - new Date(a.date ?? 0));
}

const ads = loadAds();
const posts = loadPosts();

writeJson(OUT_ADS, { generated: new Date().toISOString(), ads });
writeJson(OUT_POSTS, { generated: new Date().toISOString(), posts });

console.log(
  `[sync-admin-content] Wrote ${ads.length} ad(s) -> public/ads-data.json and ` +
    `${posts.length} post(s) -> public/posts-data.json (from src/content, edited via Decap CMS admin)`
);

