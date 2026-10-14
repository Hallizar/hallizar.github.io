import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

// Canonical production URL
const site = 'https://hallizar.ru';

/**
 * Dynamically extract all blog post slugs from Astro Content Collections (src/content/posts)
 */
function getBlogPostUrls() {
  const postsDir = path.resolve('src/content/posts');
  if (!fs.existsSync(postsDir)) return [];

  return fs
    .readdirSync(postsDir)
    .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
    .map((file) => `${site}/blog/${file.replace(/\.(md|mdx)$/, '')}`);
}

/**
 * Dynamically extract service pages and tools from Content Collections (src/content/services) / routes
 */
function getServiceUrls() {
  const baseServices = [
    `${site}/services`,
    `${site}/services/gif-studio`,
    `${site}/services/webp-converter`,
  ];
  const servicesDir = path.resolve('src/content/services');
  if (!fs.existsSync(servicesDir)) return baseServices;

  const dynamicServices = fs
    .readdirSync(servicesDir)
    .filter((file) => file.endsWith('.md') || file.endsWith('.mdx') || file.endsWith('.json'))
    .map((file) => `${site}/services/${file.replace(/\.(md|mdx|json)$/, '')}`);

  return Array.from(new Set([...baseServices, ...dynamicServices]));
}

// Main static routes to index
const staticRoutes = [
  `${site}/`,
  `${site}/blog`,
  `${site}/about`,
];

// Combined list of all dynamically indexed pages from collections and routes
const customPages = Array.from(
  new Set([...staticRoutes, ...getServiceUrls(), ...getBlogPostUrls()])
);

export default defineConfig({
  site,
  output: 'static',
  /**
   * ВАЖНО: всегда генерируем страницы в виде каталогов (/blog/index.html) и
   * НЕ редиректим адрес без замыкающего слэша.
   *
   * Почему это чинит картинки: страница https://hallizar.ru/blog (БЕЗ «/»)
   * для браузера выглядит как ФАЙЛ «blog» в корне, и любая относительная
   * ссылка вида assets/uploads/x.png резолвится в /assets/uploads/x.png,
   * тогда как со слэшем («/blog/») та же ссылка дала бы /blog/assets/....
   * Держим href-атрибуты самодостаточными, но при этом канонический формат
   * адреса — со слэшем, поэтому относительные пути нигде не используются.
   */
  trailingSlash: 'ignore',
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
        if (item.url === `${site}/` || item.url === `${site}/blog`) {
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
