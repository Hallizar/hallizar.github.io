import { useState, useMemo } from 'react';
import { Search, X, Tag, CalendarDays } from 'lucide-react';
import { BlogPost, AdBannerItem, MetrikaEvent } from '../types';
import { AdBanner } from './AdBanner';
import { hashPostPath } from '../utils/postUrl';

interface BlogListProps {
  posts: BlogPost[];
  sidebarAd: AdBannerItem | null;
  onSelectPost: (post: BlogPost) => void;
  onAdEvent?: (event: MetrikaEvent) => void;
  /** Клик по ссылке статьи: открывает читалку без перезагрузки страницы */
  onLinkClick?: (e: React.MouseEvent<HTMLAnchorElement>, post: BlogPost) => void;
}

/** Приводим любое изображение превью к квадратному кропу 1:1. */
function squareImage(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (/[?&]w=/.test(url)) {
    // Unsplash и подобные CDN — просим квадратный кроп
    return url.replace(/([?&])w=\d+/g, '$1w=800').replace(/([?&])h=\d+/g, '') + '&h=800&fit=crop';
  }
  return url;
}

export function BlogList({ posts, sidebarAd, onSelectPost, onAdEvent, onLinkClick }: BlogListProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories = useMemo(() => {
    const list = Array.from(new Set(posts.map((p) => p.category)));
    return ['all', ...list];
  }, [posts]);

  // Строгая хронология (новые сверху) — тот же порядок использует читалка
  const sortedPosts = useMemo(() => {
    return [...posts].sort(
      (a, b) => new Date(b.isoDate || b.date).getTime() - new Date(a.isoDate || a.date).getTime(),
    );
  }, [posts]);

  const filteredPosts = useMemo(() => {
    return sortedPosts.filter((post) => {
      const matchesSearch = search
        ? post.title.toLowerCase().includes(search.toLowerCase()) ||
          post.excerpt.toLowerCase().includes(search.toLowerCase()) ||
          post.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
        : true;
      const matchesCategory = selectedCategory === 'all' ? true : post.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [sortedPosts, search, selectedCategory]);

  return (
    <div className="space-y-8">
      {/* Минималистичная шапка ленты */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--accent)">Блог</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-(--text)">
            Лента статей
          </h1>
          <p className="mt-2 text-sm text-(--muted) max-w-xl leading-relaxed">
            Мой блог — о практическом дизайне и разработке. Делюсь своими компетенциями, решениями в дизайне и разработке.
          </p>
        </div>

        <div className="relative w-full lg:w-72">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-(--muted)" />
          <input
            type="text"
            placeholder="Поиск по статьям..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="qwen-search w-full pl-10 pr-9 py-2.5 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Очистить поиск"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-(--muted) hover:text-(--text)"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </header>

      {/* Категории — мягкие чипы */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="hidden sm:inline-flex items-center gap-1.5 mr-1 text-[10px] font-mono uppercase tracking-widest text-(--muted)">
          <Tag size={11} /> Темы
        </span>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`qwen-chip ${selectedCategory === cat ? 'active' : ''}`}
          >
            {cat === 'all' ? 'Все' : cat}
          </button>
        ))}
      </div>

      {/* Сетка-лента: изображения 1:1, как в Instagram */}
      {filteredPosts.length === 0 ? (
        <div className="py-24 text-center border border-dashed border-(--line-strong) rounded-2xl bg-(--panel)/40">
          <p className="text-(--muted) text-sm">Пока не написал про это. Попробуйте другой запрос или тему.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredPosts.map((post) => (
            <a
              key={post.id}
              href={hashPostPath(post)}
              onClick={(e) => {
                // ЛКМ без модификаторов — открываем читалку без перезагрузки;
                // Ctrl/Cmd/Shift-клик остаётся «открыть в новой вкладке».
                if (onLinkClick) {
                  onLinkClick(e, post);
                } else if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                  e.preventDefault();
                  onSelectPost(post);
                }
              }}
              className="qwen-card rounded-2xl overflow-hidden cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
            >
              {/* Квадратное привью 1:1 */}
              <div className="qwen-square">
                {post.image ? (
                  /\.(mp4|webm)(\?.*)?$/i.test(post.image) ? (
                    <video
                      src={post.image}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full object-cover select-none pointer-events-none"
                    />
                  ) : (
                    <img
                      src={squareImage(post.image)}
                      alt={post.title}
                      loading="lazy"
                      className="select-none"
                      draggable={false}
                    />
                  )
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-(--accent-soft) to-transparent">
                    <span className="text-4xl font-black text-(--accent)/40 select-none">
                      {(post.author?.name || 'H').slice(0, 1)}
                    </span>
                  </div>
                )}
                <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider bg-black/55 text-white backdrop-blur-md">
                  {post.category}
                </span>
              </div>

              {/* Подпись под привью — минимум текста */}
              <div className="p-4 sm:p-5">
                <h3 className="font-sans text-base sm:text-lg font-bold leading-snug tracking-tight text-(--text) line-clamp-2 group-hover:text-(--accent) transition-colors">
                  {post.title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-(--muted) line-clamp-2">
                  {post.excerpt}
                </p>
                <div className="mt-3.5 flex items-center justify-between gap-3 text-[11px] font-mono text-(--muted)">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <CalendarDays size={12} /> {post.date}
                  </span>
                  <span className="truncate">{post.readingTime}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Рекламный слот аккуратно встроен между рядами ленты */}
      {sidebarAd && (
        <div className="max-w-md mx-auto w-full">
          <AdBanner ad={sidebarAd} slot="sidebar" onAdEvent={onAdEvent} />
        </div>
      )}
    </div>
  );
}

export default BlogList;
