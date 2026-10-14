import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

// Canonical production URL
const site = 'https://hallizar.ru';

/**
 * Canonical URL builder: every page URL ALWAYS ends with a trailing slash.
 */
function canonicalUrl(...segments) {
  return `${site}/${segments.join('/')}/`;
}

/**
 * Dynamically extract all blog post slugs from Astro Content Collections (src/content/posts)
 */
function getBlogPostUrls() {
  const postsDir = path.resolve('src/content/posts');
  if (!fs.existsSync(postsDir)) return [];

  return fs
    .readdirSync(postsDir)
    .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
    .map((file) => canonicalUrl('blog', file.replace(/\.(md|mdx)$/, '')));
}

/**
 * Dynamically extract service pages and tools from Content Collections (src/content/services) / routes
 */
function getServiceUrls() {
  const baseServices = [
    canonicalUrl('services'),
    canonicalUrl('services', 'gif-studio'),
    canonicalUrl('services', 'webp-converter'),
  ];
  const servicesDir = path.resolve('src/content/services');
  if (!fs.existsSync(servicesDir)) return baseServices;

  const dynamicServices = fs
    .readdirSync(servicesDir)
    .filter((file) => file.endsWith('.md') || file.endsWith('.mdx') || file.endsWith('.json'))
    .map((file) => canonicalUrl('services', file.replace(/\.(md|mdx|json)$/, '')));

  return Array.from(new Set([...baseServices, ...dynamicServices]));
}

// Main static routes to index
const staticRoutes = [
  `${site}/`,
  canonicalUrl('blog'),
  canonicalUrl('about'),
];

// Combined list of all dynamically indexed pages from collections and routes
const customPages = Array.from(
  new Set([...staticRoutes, ...getServiceUrls(), ...getBlogPostUrls()])
);

export default defineConfig({
  site,
  output: 'static',
  /**
   * ВАЖНО: «always» — канонический формат всех адресов со замыкающим слэшем.
   * При build.format:'directory' страницы генерируются как /blog/<slug>/index.html,
   * а хостинг (Netlify/GH Pages) автоматически редиректит запрос без «/» на
   * адрес с «/». Это чинит картинки: страница https://hallizar.ru/blog/ (СО слэшем)
   * для браузера выглядит как КАТАЛОГ, и относительная ссылка вида
   * assets/uploads/x.png резолвится в /blog/assets/uploads/x.png. Без слэша
   * («/blog») браузер считал бы это ФАЙЛОМ в корне и ломал относительные пути.
   */
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    react(),
    sitemap({
      filter: (page) => !page.includes('/admin'),
      customPages,
      serialize(item) {
        // Канонический формат всех URL в sitemap — со замыкающим слэшем
        // (кроме корня сайта, где он уже есть).
        if (!item.url.endsWith('/') && item.url !== `${site}/`) {
          item.url = `${item.url}/`;
        }
        if (item.url === `${site}/` || item.url === `${site}/blog/`) {
          item.changefreq = 'daily';
          item.priority = 1.0;
        } else if (item.url.includes('/services')) {
          item.changefreq = 'weekly';
          item.priority = 0.9;
        } else if (item.url.includes('/blog/')) {
          item.changefreq = 'weekly';
          item.priority = 0.8;
        } else {
          item.changefreq = 'monthly';
          item.priority = 0.6;
        }
        item.lastmod = new Date();
        return item;
      },
    }),
  ],
  compressHTML: true,
});
