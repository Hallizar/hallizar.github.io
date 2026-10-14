import { BlogPost } from '../types';

const KNOWN_ROOT_ROUTES = new Set(['blog', 'services', 'about', 'admin', 'dist', 'index.html', '404.html']);

/**
 * Базовый префикс сайта для GitHub Pages или кастомного домена.
 * Например:
 *   - "https://hallizar.ru/blog" -> ""
 *   - "https://hallizar.github.io/blog" -> ""
 *   - "https://hallizar.github.io/hallizar.dev.github.io/blog" -> "/hallizar.dev.github.io"
 *   - "https://user.github.io/my-repo/blog" -> "/my-repo"
 * Всегда возвращает путь БЕЗ замыкающего слэша, гарантируя что итоговый адрес
 * всегда начинается с '/' и никогда не является относительным './blog'.
 */
export function getBasePrefix(): string {
  if (typeof window === 'undefined') {
    const envBase = import.meta.env.BASE_URL || '/';
    if (envBase === './' || envBase === '.' || envBase === '/') return '';
    return envBase.replace(/\/+$/, '');
  }

  const pathname = window.location.pathname;
  const segments = pathname.split('/').filter(Boolean);

  // 1. Если в пути есть сегмент 'blog', всё что идёт до него — базовый префикс
  const blogIdx = segments.indexOf('blog');
  if (blogIdx > 0) {
    return '/' + segments.slice(0, blogIdx).join('/');
  }
  if (blogIdx === 0) {
    return '';
  }

  // 2. Для других известных корневых разделов (/services, /admin, /about)
  for (const known of KNOWN_ROOT_ROUTES) {
    const idx = segments.indexOf(known);
    if (idx > 0) {
      return '/' + segments.slice(0, idx).join('/');
    }
    if (idx === 0) {
      return '';
    }
  }

  // 3. Если путь не пустой и первый сегмент не является системным маршрутом
  // (например, имя репозитория GitHub Pages вида /hallizar.dev.github.io)
  if (segments.length > 0 && !KNOWN_ROOT_ROUTES.has(segments[0])) {
    return '/' + segments[0];
  }

  return '';
}

/**
 * Канонический путь к ленте блога: всегда начинается с '/', например "/blog"
 * или "/hallizar.dev.github.io/blog".
 * Исключает накопление повторов вида "/blog/blog/blog".
 */
export function feedPath(): string {
  const prefix = getBasePrefix();
  return `${prefix}/blog`;
}

/**
 * Канонический путь к статье: всегда начинается с '/', например "/blog/<slug>"
 * или "/hallizar.dev.github.io/blog/<slug>".
 */
export function postPath(post: Pick<BlogPost, 'slug'>): string {
  const prefix = getBasePrefix();
  const cleanSlug = encodeURIComponent(decodeURIComponent(post.slug)).replace(/%2F/gi, '/');
  return `${prefix}/blog/${cleanSlug}`;
}

/**
 * Полный абсолютный URL статьи с протоколом и доменом (для буфера обмена / шеринга).
 */
export function absolutePostUrl(post: Pick<BlogPost, 'slug'>): string {
  const path = postPath(post);
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).toString();
}

/**
 * Надежный абсолютный путь к статическим JSON-данным (ads-data.json, posts-data.json) на GitHub Pages.
 */
export function getDataUrl(filename: string): string {
  const prefix = getBasePrefix();
  const cleanFile = filename.replace(/^\/+/, '');
  return `${prefix}/${cleanFile}`;
}
