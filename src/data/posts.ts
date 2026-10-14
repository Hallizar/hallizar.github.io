import { BlogPost } from '../types';

/**
 * ВНИМАНИЕ: хардкод-список статей (бывш. BLOG_POSTS) удалён.
 * Реальные статьи живут в `src/content/posts/*.md` (управляются через
 * Decap CMS) и публикуются в `public/posts-data.json` скриптом
 * `scripts/sync-admin-content.js` на каждом билде. Старые демо-статьи
 * больше не могут «прорезаться» на сайте как резервный вариант.
 */

// Тип BlogPost реэкспортируется для совместимости существующих импортов.
export type { BlogPost };
