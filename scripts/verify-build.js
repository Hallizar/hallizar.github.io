#!/usr/bin/env node
/**
 * End-to-end build verification for the Astro + Decap CMS + Yandex RSN blog.
 *
 * Runs `npm run build`, then asserts against the generated `dist/` folder:
 *   1. dist/sitemap-index.xml is well-formed XML and (via its child sitemaps) lists every post URL.
 *   2. dist/admin/config.yml exists and is valid YAML with a Decap backend and collections.
 *   3. Static HTML pages contain build-time Open Graph, Twitter Card and Schema.org JSON-LD tags.
 *   4. Pages with RSN ad containers ship the IntersectionObserver lazy-loader and load
 *      Yandex `context.js` exactly once.
 *
 * Usage:
 *   node scripts/verify-build.js               # build, then verify
 *   node scripts/verify-build.js --skip-build  # verify an existing dist/ (e.g. after a CI build step)
 *
 * Exits with code 1 if any assertion fails, so it can gate CI/CD pipelines.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const POSTS_DIR = path.join(ROOT, 'src/content/posts');
const ADS_DIR = path.join(ROOT, 'src/content/ads');
const SITE = 'https://hallizar.ru';
const RSN_SDK_URL = 'yandex.ru/ads/system/context.js';
const REQUIRED_AD_FIELDS = ['id', 'title', 'slot', 'imageUrl', 'targetUrl', 'active', 'priority'];

const skipBuild = process.argv.includes('--skip-build');

// ----------------------------------------------------------------------
// Minimal test harness
// ----------------------------------------------------------------------

const results = { passed: 0, failed: 0 };

class AssertionError extends Error {}

function assert(condition, message) {
  if (!condition) throw new AssertionError(message);
}

function check(name, fn) {
  try {
    fn();
    results.passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.failed++;
    console.log(`  ✗ ${name}`);
    console.log(`      ${error instanceof AssertionError ? error.message : error.stack}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function readDist(relPath) {
  const file = path.join(DIST, relPath);
  assert(fs.existsSync(file), `Missing build artifact: dist/${relPath}`);
  return fs.readFileSync(file, 'utf8');
}

function walk(dir, predicate, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, acc);
    else if (predicate(full)) acc.push(full);
  }
  return acc;
}

/** Parses the YAML frontmatter block of a markdown file. */
function readFrontmatter(file) {
  const match = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? parseYaml(match[1]) ?? {} : null;
}

function getPublishedPostSlugs() {
  return fs
    .readdirSync(POSTS_DIR)
    .filter((file) => /\.(md|mdx)$/.test(file))
    .filter((file) => readFrontmatter(path.join(POSTS_DIR, file))?.draft !== true)
    .map((file) => file.replace(/\.(md|mdx)$/, ''));
}

/**
 * Dependency-free XML well-formedness check: balanced/nested tags, single root element,
 * quoted attributes and no stray markup. Throws with a descriptive message on failure.
 */
function assertWellFormedXml(xml, label) {
  const body = xml.replace(/^﻿/, '');
  assert(/^\s*<\?xml\s[^?]*\?>/.test(body), `${label}: missing <?xml ...?> declaration`);

  const stack = [];
  let rootCount = 0;
  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|</g;
  let match;
  while ((match = tokenRe.exec(body))) {
    const [token, closing, name, , selfClosing] = match;
    if (token === '<') {
      throw new AssertionError(`${label}: malformed markup near offset ${match.index}: "${body.slice(match.index, match.index + 40)}"`);
    }
    if (!name) continue; // comment, CDATA, processing instruction, doctype
    if (closing) {
      const open = stack.pop();
      assert(open === name, `${label}: closing </${name}> does not match <${open ?? 'nothing'}>`);
    } else {
      if (stack.length === 0) rootCount++;
      if (!selfClosing) stack.push(name);
    }
  }
  assert(stack.length === 0, `${label}: unclosed element(s): ${stack.join(' > ')}`);
  assert(rootCount === 1, `${label}: expected exactly one root element, found ${rootCount}`);
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
}

function getMeta(html, attr, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const keyMatch = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
    if (keyMatch && keyMatch[1] === key) {
      const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      return content ? (content[1] ?? content[2]) : '';
    }
  }
  return null;
}

function getScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({
    attrs: m[1],
    content: m[2],
    src: m[1].match(/\bsrc\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? null,
    type: m[1].match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? null,
  }));
}

/** Inline script bodies plus the contents of any local bundled script referenced by the page. */
function getPageJavaScript(html) {
  return getScripts(html)
    .filter((s) => s.type !== 'application/ld+json')
    .map((s) => {
      const src = s.src ? (s.src.startsWith('./') ? s.src.slice(1) : s.src) : null;
      if (src && src.startsWith('/') && !src.startsWith('//')) {
        const file = path.join(DIST, src.split(/[?#]/)[0]);
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      }
      return s.content;
    })
    .join('\n');
}

function relDist(file) {
  return path.relative(DIST, file).split(path.sep).join('/');
}

// ----------------------------------------------------------------------
// 0. Mock content fixtures
// ----------------------------------------------------------------------

section('Mock content fixtures');

check('src/content/posts/test-post.md has complete frontmatter (title, date, description)', () => {
  const file = path.join(POSTS_DIR, 'test-post.md');
  assert(fs.existsSync(file), 'test-post.md is missing');
  const fm = readFrontmatter(file);
  assert(fm, 'test-post.md has no frontmatter block');
  for (const key of ['title', 'date', 'description']) {
    assert(fm[key] !== undefined && String(fm[key]).trim() !== '', `frontmatter field "${key}" is missing or empty`);
  }
  assert(!Number.isNaN(new Date(fm.date).getTime()), `frontmatter "date" is not a valid date: ${fm.date}`);
});

check('src/content/ads/test-banner.json contains all required ad fields', () => {
  const file = path.join(ADS_DIR, 'test-banner.json');
  assert(fs.existsSync(file), 'test-banner.json is missing');
  const ad = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = REQUIRED_AD_FIELDS.filter((key) => ad[key] === undefined);
  assert(missing.length === 0, `missing fields: ${missing.join(', ')}`);
  assert(['sidebar', 'in-article', 'top-header'].includes(ad.slot), `invalid slot "${ad.slot}"`);
  assert(typeof ad.active === 'boolean', '"active" must be a boolean');
  assert(typeof ad.priority === 'number', '"priority" must be a number');
  new URL(ad.targetUrl); // throws on invalid URL
});

// ----------------------------------------------------------------------
// Build
// ----------------------------------------------------------------------

if (skipBuild) {
  section('Build (skipped: --skip-build)');
} else {
  section('Build: npm run build');
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (build.status !== 0) {
    console.error(`\n✗ npm run build failed with exit code ${build.status ?? build.signal}`);
    process.exit(1);
  }
}

if (!fs.existsSync(DIST)) {
  console.error('\n✗ dist/ does not exist. Run the build first or drop --skip-build.');
  process.exit(1);
}

const postSlugs = getPublishedPostSlugs();

// ----------------------------------------------------------------------
// 1. Sitemap
// ----------------------------------------------------------------------

section('Sitemap');

check('dist/sitemap-index.xml is well-formed XML and lists every published post URL', () => {
  const indexXml = readDist('sitemap-index.xml');
  assertWellFormedXml(indexXml, 'sitemap-index.xml');
  assert(/<sitemapindex\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/.test(indexXml),
    'sitemap-index.xml root must be <sitemapindex> with the sitemaps.org namespace');

  const childSitemaps = extractLocs(indexXml);
  assert(childSitemaps.length > 0, 'sitemap-index.xml does not reference any child sitemaps');

  const urls = new Set();
  for (const loc of childSitemaps) {
    const relPath = new URL(loc).pathname.replace(/^\//, '');
    const childXml = readDist(relPath);
    assertWellFormedXml(childXml, relPath);
    assert(/<urlset\b/.test(childXml), `${relPath} root must be <urlset>`);
    for (const url of extractLocs(childXml)) urls.add(url.replace(/\/$/, ''));
  }

  // Сравниваем через decodeURIComponent, т.к. Astro экранирует не-ASCII slug'и
  // в sitemap percent-encoding'ом (кириллица -> %D0%BF...).
  const decodedUrls = new Set([...urls].map((u) => decodeURIComponent(u)));
  const missing = postSlugs.filter(
    (slug) => !decodedUrls.has(`${SITE}/blog/${slug}`) && !decodedUrls.has(`${SITE}/blog/${slug}/`)
  );
  assert(missing.length === 0, `post URLs missing from sitemap: ${missing.join(', ')}`);
  assert(urls.has(`${SITE}/blog/test-post`), 'test-post URL missing from sitemap');
  const adminUrls = [...urls].filter((u) => u.includes('/admin'));
  assert(adminUrls.length === 0, `sitemap must not list admin URLs: ${adminUrls.join(', ')}`);
});

// ----------------------------------------------------------------------
// 2. Decap CMS config
// ----------------------------------------------------------------------

section('Decap CMS');

check('dist/admin/config.yml exists and is valid YAML', () => {
  const raw = readDist('admin/config.yml');
  let config;
  try {
    config = parseYaml(raw, { prettyErrors: true, strict: true, uniqueKeys: true });
  } catch (error) {
    throw new AssertionError(`YAML syntax error: ${error.message}`);
  }
  assert(config && typeof config === 'object', 'config.yml did not parse to an object');
  assert(config.backend?.name, 'config.yml is missing backend.name');
  assert(Array.isArray(config.collections) && config.collections.length > 0, 'config.yml has no collections');

  const names = config.collections.map((c) => c.name);
  for (const required of ['posts', 'ads']) {
    assert(names.includes(required), `config.yml is missing the "${required}" collection`);
  }
  const ads = config.collections.find((c) => c.name === 'ads');
  const adFieldNames = (ads.fields ?? []).map((f) => f.name);
  const missingAdFields = REQUIRED_AD_FIELDS.filter((key) => !adFieldNames.includes(key));
  assert(missingAdFields.length === 0, `ads collection is missing CMS fields: ${missingAdFields.join(', ')}`);
});

check('dist/admin/index.html exists', () => {
  readDist('admin/index.html');
});

// ----------------------------------------------------------------------
// 3. SEO tags in static HTML
// ----------------------------------------------------------------------

section('SEO (Open Graph, Twitter Cards, Schema.org JSON-LD)');

const htmlPages = walk(DIST, (f) => f.endsWith('.html')).filter((f) => !relDist(f).startsWith('admin/'));

check('every published post has a static HTML page', () => {
  const missing = postSlugs.filter((slug) => !fs.existsSync(path.join(DIST, 'blog', slug, 'index.html')));
  assert(missing.length === 0, `missing dist/blog/<slug>/index.html for: ${missing.join(', ')}`);
});

const OG_TAGS = ['og:type', 'og:title', 'og:description', 'og:url', 'og:image'];
const TWITTER_TAGS = ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'];

for (const file of htmlPages) {
  const rel = relDist(file);
  const html = fs.readFileSync(file, 'utf8');
  const isPost = /^blog\/[^/]+\/index\.html$/.test(rel);

  check(`${rel}: Open Graph + Twitter Card meta tags`, () => {
    const missingOg = OG_TAGS.filter((key) => !getMeta(html, 'property', key));
    assert(missingOg.length === 0, `missing/empty Open Graph tags: ${missingOg.join(', ')}`);
    const missingTw = TWITTER_TAGS.filter((key) => !getMeta(html, 'name', key));
    assert(missingTw.length === 0, `missing/empty Twitter tags: ${missingTw.join(', ')}`);
    assert(getMeta(html, 'name', 'twitter:card') === 'summary_large_image',
      `twitter:card should be "summary_large_image", got "${getMeta(html, 'name', 'twitter:card')}"`);
    if (isPost) {
      assert(getMeta(html, 'property', 'og:type') === 'article', 'post pages must use og:type="article"');
      assert(getMeta(html, 'property', 'article:published_time'), 'post pages need article:published_time');
      const slug = decodeURIComponent(rel.split('/')[1]);
      const ogUrl = decodeURIComponent(getMeta(html, 'property', 'og:url') ?? '');
      assert(ogUrl.replace(/\/$/, '') === `${SITE}/blog/${slug}`,
        `og:url should be ${SITE}/blog/${slug}, got ${getMeta(html, 'property', 'og:url')}`);
      assert(/<link\b[^>]*rel=["']?canonical["']?[^>]*>/i.test(html), 'post pages need a canonical link');
    }
  });

  check(`${rel}: valid Schema.org JSON-LD`, () => {
    const blocks = getScripts(html).filter((s) => s.type === 'application/ld+json');
    assert(blocks.length > 0, 'no <script type="application/ld+json"> block found');
    const types = [];
    for (const block of blocks) {
      let data;
      try {
        data = JSON.parse(block.content);
      } catch (error) {
        throw new AssertionError(`JSON-LD is not valid JSON: ${error.message}`);
      }
      assert(String(data['@context'] ?? '').includes('schema.org'), 'JSON-LD @context must reference schema.org');
      const nodes = Array.isArray(data['@graph']) ? data['@graph'] : [data];
      for (const node of nodes) types.push(node['@type']);
    }
    assert(types.every(Boolean), 'every JSON-LD node needs an @type');
    if (isPost) {
      assert(types.includes('BlogPosting'), `post pages need a BlogPosting node, found: ${types.join(', ')}`);
    }
  });
}

// ----------------------------------------------------------------------
// 4. Yandex RSN ad containers
// ----------------------------------------------------------------------

section('Yandex RSN ad containers');

const adPages = htmlPages
  .map((file) => ({ file, rel: relDist(file), html: fs.readFileSync(file, 'utf8') }))
  .filter(({ html }) => /class=["'][^"']*\byandex-ad-container\b/.test(html));

check('ad containers are rendered on post pages', () => {
  const postAdPages = adPages.filter(({ rel }) => rel.startsWith('blog/') && rel !== 'blog/index.html');
  assert(postAdPages.length > 0, 'no post page renders a .yandex-ad-container');
  assert(adPages.some(({ rel }) => rel === 'blog/test-post/index.html'), 'blog/test-post/index.html renders no ad container');
});

for (const { rel, html } of adPages) {
  check(`${rel}: ad containers are wired to the IntersectionObserver lazy loader`, () => {
    const containers = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\byandex-ad-container\b[^>]*>/g)].map((m) => m[0]);
    for (const tag of containers) {
      assert(/\bdata-rtb-block-id=["'][^"']+["']/.test(tag), `container without data-rtb-block-id: ${tag.slice(0, 120)}`);
      assert(/\bdata-render-to=["'][^"']+["']/.test(tag), `container without data-render-to: ${tag.slice(0, 120)}`);
    }
    const ids = containers.map((tag) => tag.match(/\bid=["']([^"']+)["']/)?.[1]);
    assert(ids.every(Boolean), 'every ad container needs an id to render into');
    assert(new Set(ids).size === ids.length, `duplicate ad container ids: ${ids.join(', ')}`);

    const js = getPageJavaScript(html);
    assert(/new\s+IntersectionObserver\s*\(/.test(js), 'no IntersectionObserver setup found in page scripts');
    assert(/\.observe\s*\(/.test(js), 'IntersectionObserver never calls observe()');
    assert(js.includes('yandex-ad-container'), 'lazy loader does not target .yandex-ad-container');
    assert(js.includes('yaContextCb'), 'lazy loader does not queue renders on window.yaContextCb');
    assert(/AdvManager\s*\.\s*render/.test(js), 'lazy loader never calls Ya.Context.AdvManager.render');
  });

  check(`${rel}: Yandex RSN context.js is loaded exactly once`, () => {
    const scripts = getScripts(html);
    const srcTags = scripts.filter((s) => s.src?.includes(RSN_SDK_URL));
    const inlineLoaders = scripts.filter((s) => !s.src && s.content.includes(RSN_SDK_URL));
    const total = srcTags.length + inlineLoaders.length;
    assert(total === 1,
      `expected 1 context.js loader, found ${total} (${srcTags.length} <script src>, ${inlineLoaders.length} inline)`);

    const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
    assert(head.includes(RSN_SDK_URL), 'context.js loader must live in <head>');
    const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';
    assert(!body.includes(RSN_SDK_URL), 'context.js must not be injected again inside <body> (e.g. per ad container)');

    // Every script (inline + bundled) mentions the SDK URL at most once in total.
    const occurrences = getPageJavaScript(html).split(RSN_SDK_URL).length - 1;
    assert(occurrences <= 1, `context.js URL appears ${occurrences} times across page scripts`);
  });
}

// ----------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------

const total = results.passed + results.failed;
console.log(`\n${results.failed === 0 ? '✓' : '✗'} ${results.passed}/${total} checks passed`);
process.exit(results.failed === 0 ? 0 : 1);
