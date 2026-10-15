import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Wrench, User, Sparkles, Crosshair } from 'lucide-react';
import { getActiveAdForSlot } from './data/ads';
import { BlogPost, AdBannerItem } from './types';
import { LocalGifStudio } from './components/LocalGifStudio';
import { SquooshStudio } from './components/SquooshStudio';
import { AreaAnalyzerTool } from './components/AreaAnalyzerTool';
// Новый дизайн-система в стиле coder.qwen.ai: лента 1:1 + читалка статей
import { BlogList } from './components/BlogFeed';
import { BlogPostView } from './components/BlogReader';
import './styles/blog-qwen.css';
import { ThemeToggle } from './components/ThemeToggle';
import { getInitialTheme, applyTheme, persistTheme, type ThemeMode } from './utils/theme';
import { postPath, feedPath, getDataUrl, hashPostPath } from './utils/postUrl';
import { AdBanner } from './components/AdBanner';
import { DecapAdminStandalone } from './components/DecapAdminStandalone';
import { updateSEOMetadata } from './utils/seo';
import { Logo } from './components/Logo';

/** Хронологический порядок (новые сверху) — общий для ленты и читалки. */
function sortByDateDesc(list: BlogPost[]): BlogPost[] {
  return [...list].sort(
    (a, b) => new Date(b.isoDate || b.date).getTime() - new Date(a.isoDate || a.date).getTime(),
  );
}

/**
 * Активный slug статьи: сначала смотрим hash вида #post/<slug> (именно такие
 * ссылки генерирует SPA-лента — переход по ним НЕ перезагружает страницу и
 * сразу открывает читалку), затем путь /blog/<slug>/ (прямые ссылки, SEO).
 */
function slugFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  const hm = hash.match(/^#post\/(.+)$/);
  if (hm) {
    try {
      return decodeURIComponent(hm[1]);
    } catch {
      return hm[1];
    }
  }
  const m = window.location.pathname.match(/\/blog\/([^/]+)\/?$/);
  if (!m) return null;
  const raw = decodeURIComponent(m[1]);
  if (raw.toLowerCase() === 'blog') return null;
  return raw;
}

/** Приводим любые накопленные относительные URL вида /blog/blog или /blog/a/blog/b к чистому адресу. */
function normalizePathIfNeeded() {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  // Несколько подряд сегментов /blog/<slug> или повторяющийся /blog/blog — признак накопленных pushState
  if (/\/blog(?:\/[^/]+)*\/blog(?:\/|$)/i.test(path) || /\/blog\/[^/]+(?:\/blog\/[^/]+)+\/?$/.test(path)) {
    const slug = slugFromLocation();
    const clean = slug ? postPath({ slug }) : feedPath();
    window.history.replaceState(window.history.state, '', clean);
  }
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [route, setRoute] = useState<'blog' | 'services' | 'about' | 'admin'>(() => {
    if (typeof window !== 'undefined' && window.location.pathname.includes('/admin')) {
      return 'admin';
    }
    return 'blog';
  });

  const [selectedService, setSelectedService] = useState<'gif-studio' | 'squoosh' | 'area-analyzer'>('gif-studio');
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null);

  // Единая тема для всего сайта (светлая / тёмная), сохраняется между визитами
  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  // Приводим адресную строку в порядок при старте (защита от накопленных URL)
  useEffect(() => {
    normalizePathIfNeeded();
  }, []);

  // Переход между статьями: «вперёд» — pushState (работает кнопка «Назад»),
  // «назад к ленте» — replaceState. URL всегда корректный (/blog/<slug>#post/<slug>).
  const selectPost = useCallback((post: BlogPost | null) => {
    setSelectedPost(post);
    if (post) {
      // hash-маркер #post/<slug>: переход по такой ссылке внутри SPA не
      // перезагружает страницу — читалка открывается мгновенно.
      window.history.pushState({ slug: post.slug }, '', hashPostPath(post));
    } else {
      window.history.replaceState({}, '', feedPath());
    }
  }, []);

  // Единый обработчик перехода к статье из ленты: открываем читалку без
  // перезагрузки страницы (pushState + setSelectedPost).
  const handleFeedLinkClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, post: BlogPost) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      selectPost(post);
    },
    [selectPost],
  );

  // Назад к ленте (кнопка «К ленте») — возвращаем адрес ленты в адресную строку
  const backToFeed = useCallback(() => {
    selectPost(null);
  }, [selectPost]);

  // Active ads for slots. The single source of truth is /ads-data.json and
  // /posts-data.json, generated at build time from src/content (edited in the
  // Decap CMS admin panel). We intentionally start with EMPTY lists instead of
  // the hard-coded INITIAL_ADS / BLOG_POSTS so that deleted/stale entries can
  // never flash on screen during load.
  //
  // ВАЖНО: жёстко закодированные INITIAL_ADS / BLOG_POSTS больше НЕ используются
  // как «резервный вариант». Если бы при недоступности JSON мы показывали их, то
  // на залитом в GitHub Pages старом деплое (или при сбое загрузки данных)
  // посетители видели бы давно удалённые демо-статьи и демо-баннеры. Пустой
  // список — корректное состояние: показываем ровно то, что реально лежит в
  // src/content и опубликовано через админ-панель.
  const [ads, setAds] = useState<AdBannerItem[]>([]);
  const [adsLoaded, setAdsLoaded] = useState(false);

  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [postsLoaded, setPostsLoaded] = useState(false);

  // Прямые ссылки на статьи: /blog/<slug> открывают читалку сразу
  useEffect(() => {
    if (!postsLoaded) return;
    const slug = slugFromLocation();
    if (!slug) return;
    const match = posts.find((p) => p.slug === slug || String(p.id) === slug);
    if (match) setSelectedPost(match);
  }, [postsLoaded, posts]);

  // Load admin-managed content (Decap CMS -> src/content -> public/*-data.json) at runtime.
  useEffect(() => {
    let cancelled = false;

    fetch(getDataUrl('ads-data.json'), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled) return;
        if (payload) {
          const loaded: AdBannerItem[] = Array.isArray(payload) ? payload : payload.ads;
          // Accept even an empty array: "no active ads" is a valid state and
          // must NOT fall back to stale hard-coded banners.
          if (Array.isArray(loaded)) {
            setAds(loaded);
            setAdsLoaded(true);
            return;
          }
        }
        // Файл недоступен (старый деплой без сгенерированных данных, сбой сети):
        // НЕ откатываемся к жёстко закодированным демо-баннерам INITIAL_ADS —
        // иначе посетители увидят давно удалённые «дефолтные» объявления.
        setAds([]);
        setAdsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAds([]);
        setAdsLoaded(true);
      });

    fetch(getDataUrl('posts-data.json'), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled) return;
        if (payload) {
          const loaded: BlogPost[] = Array.isArray(payload) ? payload : payload.posts;
          if (Array.isArray(loaded)) {
            setPosts(loaded);
            setPostsLoaded(true);
            return;
          }
        }
        // Тот же принцип для статей: при недоступности posts-data.json не
        // показываем устаревший хардкод BLOG_POSTS — только реальное содержимое
        // src/content/posts (или пусто).
        setPosts([]);
        setPostsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setPosts([]);
        setPostsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);
  const topHeaderAd = getActiveAdForSlot(ads, 'top-header');
  const sidebarAd = getActiveAdForSlot(ads, 'sidebar');
  const inArticleAd = getActiveAdForSlot(ads, 'in-article');

  // Handle URL popstate / hashchange / pathname changes (включая «Назад» между статьями)
  useEffect(() => {
    const syncFromLocation = () => {
      if (window.location.pathname.includes('/admin')) {
        setRoute('admin');
        return;
      }
      // Защита от накопленных относительных адресов — чиним строку сразу
      normalizePathIfNeeded();
      const slug = slugFromLocation();
      if (slug) {
        const match = posts.find((p) => p.slug === slug || String(p.id) === slug);
        setSelectedPost(match ?? null);
      } else if (/\/blog\/?.*$/.test(window.location.pathname)) {
        setSelectedPost(null);
      }
    };
    window.addEventListener('popstate', syncFromLocation);
    // Клик по <a href="...#post/slug"> внутри SPA вызывает hashchange БЕЗ
    // перезагрузки страницы — так лента мгновенно переносит в читалку.
    window.addEventListener('hashchange', syncFromLocation);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('hashchange', syncFromLocation);
    };
  }, [posts]);

  // Dynamic SEO metadata updates (canonical, open graph, twitter, schema.org)
  useEffect(() => {
    if (route === 'admin') return;
    updateSEOMetadata({ route, post: selectedPost });
  }, [route, selectedPost]);

  // ISOLATED ADMIN ROUTE: If /admin/ is requested, render pure Decap CMS login without blog UI
  if (route === 'admin') {
    return <DecapAdminStandalone />;
  }

  return (
    <div className="app-shell min-h-screen flex flex-col font-sans">
      <div className="noise" />

      {/* Main Clean Header */}
      <header className="topbar sticky top-0 z-40 bg-(--bg)/90 backdrop-blur-md border-b border-(--line)">
        <div className="w-full max-w-5xl mx-auto flex items-center justify-between gap-6">
          <div
            onClick={() => {
              setRoute('blog');
              backToFeed();
            }}
            className="topbar-brand cursor-pointer flex items-center gap-3 group shrink-0"
          >
            <div className="brand-mark text-(--text)">
              <Logo size={24} color="currentColor" className="transition-transform duration-200 group-hover:scale-105" />
            </div>
            <div>
              <div className="brand-title">HALLIZAR</div>
              <div className="brand-subtitle">ENGINEERING & TOOLS</div>
            </div>
          </div>

          {/* Clean Public Navigation */}
          <nav className="hidden md:flex items-center gap-1.5 font-mono text-xs">
            <button
              onClick={() => {
                setRoute('blog');
                backToFeed();
              }}
              className={`px-3.5 py-1.5 border rounded-full transition-all flex items-center gap-1.5 ${
                route === 'blog'
                  ? 'border-(--accent) bg-(--accent)/15 text-(--text) font-bold'
                  : 'border-transparent text-(--muted) hover:text-(--text)'
              }`}
            >
              <BookOpen size={13} />
              БЛОГ
            </button>

            <button
              onClick={() => {
                setRoute('services');
                setSelectedService('gif-studio');
                selectPost(null);
              }}
              className={`px-3.5 py-1.5 border rounded-full transition-all flex items-center gap-1.5 ${
                route === 'services'
                  ? 'border-(--accent) bg-(--accent)/15 text-(--text) font-bold'
                  : 'border-transparent text-(--muted) hover:text-(--text)'
              }`}
            >
              <Wrench size={13} />
              СЕРВИСЫ
            </button>

            <button
              onClick={() => {
                setRoute('about');
                selectPost(null);
              }}
              className={`px-3.5 py-1.5 border rounded-full transition-all flex items-center gap-1.5 ${
                route === 'about'
                  ? 'border-(--accent) bg-(--accent)/15 text-(--text) font-bold'
                  : 'border-transparent text-(--muted) hover:text-(--text)'
              }`}
            >
              <User size={13} />
              О ПРОЕКТЕ
            </button>
          </nav>

          {/* Переключатель тёмной / светлой темы — выровнен по правому краю */}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </header>

      {/* Mobile nav bar — переключатель темы остаётся только в верхнем блоке (HALLIZAR.RU) */}
      <div className="flex md:hidden border-b border-(--line) bg-(--panel) px-4 sm:px-8 py-2 text-xs font-mono">
        <div className="w-full max-w-5xl mx-auto flex items-center gap-2">
          <button
            onClick={() => {
              setRoute('blog');
              backToFeed();
            }}
            className={`px-3 py-1 border rounded-full ${
              route === 'blog' ? 'border-(--accent) text-(--text)' : 'border-transparent text-(--muted)'
            }`}
          >
            Блог
          </button>
          <button
            onClick={() => {
              setRoute('services');
              setSelectedService('gif-studio');
              selectPost(null);
            }}
            className={`px-3 py-1 border rounded-full ${
              route === 'services' ? 'border-(--accent) text-(--text)' : 'border-transparent text-(--muted)'
            }`}
          >
            Сервисы
          </button>
          <button
            onClick={() => {
              setRoute('about');
              selectPost(null);
            }}
            className={`px-3 py-1 border rounded-full ${
              route === 'about' ? 'border-(--accent) text-(--text)' : 'border-transparent text-(--muted)'
            }`}
          >
            О проекте
          </button>
        </div>
      </div>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-8 py-6">
        {/* Top-Header Ad Slot (Rendered cleanly without debug labels) */}
        {adsLoaded && topHeaderAd && (
          <AdBanner
            ad={topHeaderAd}
            slot="top-header"
          />
        )}

        {/* 1. BLOG VIEW — лента 1:1 + читалка со следующим постом по хронологии */}
        {route === 'blog' && (
          <div className="w-full">
            {selectedPost ? (
              <BlogPostView
                post={selectedPost}
                posts={sortByDateDesc(posts)}
                inArticleAd={inArticleAd}
                onBack={backToFeed}
                onSelectPost={selectPost}
              />
            ) : (
              <BlogList
                posts={posts}
                sidebarAd={sidebarAd}
                onSelectPost={selectPost}
                onLinkClick={handleFeedLinkClick}
              />
            )}
          </div>
        )}

        {/* 2. SERVICES VIEW */}
        {route === 'services' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 border border-(--line) bg-(--panel) rounded-xl">
              <div>
                <span className="text-[10px] font-mono text-(--accent) font-bold uppercase tracking-wider block">
                  Браузерные инструменты
                </span>
                <span className="text-(--text) font-mono text-sm font-bold">
                  Выберите сервис для работы
                </span>
              </div>

              <div className="flex flex-wrap gap-2.5 font-mono text-xs">
                <button
                  onClick={() => setSelectedService('gif-studio')}
                  className={`px-5 py-2 border rounded-full transition-all flex items-center gap-2 cursor-pointer ${
                    selectedService === 'gif-studio'
                      ? 'border-(--accent) bg-(--accent) text-(--on-accent) font-bold'
                      : 'border-(--line-strong) bg-(--panel) text-(--muted) hover:text-(--text)'
                  }`}
                >
                  <Sparkles size={14} />
                  ПАКЕТНАЯ СБОРКА ГИФ
                </button>

                <button
                  onClick={() => setSelectedService('squoosh')}
                  className={`px-5 py-2 border rounded-full transition-all flex items-center gap-2 cursor-pointer ${
                    selectedService === 'squoosh'
                      ? 'border-(--accent) bg-(--accent) text-(--on-accent) font-bold'
                      : 'border-(--line-strong) bg-(--panel) text-(--muted) hover:text-(--text)'
                  }`}
                >
                  <Sparkles size={14} />
                   ПАКЕТНОЕ СЖАТИЕ ИЗОБРАЖЕНИЙ
                </button>

                <button
                  onClick={() => setSelectedService('area-analyzer')}
                  className={`px-5 py-2 border rounded-full transition-all flex items-center gap-2 cursor-pointer ${
                    selectedService === 'area-analyzer'
                      ? 'border-(--accent) bg-(--accent) text-(--on-accent) font-bold'
                      : 'border-(--line-strong) bg-(--panel) text-(--muted) hover:text-(--text)'
                  }`}
                >
                  <Crosshair size={14} />
                  АНАЛИЗАТОР ПЛОЩАДИ
                </button>
              </div>
            </div>

            <div className="border border-(--line) bg-(--panel) p-2 sm:p-4 rounded-xl">
              {selectedService === 'gif-studio' && <LocalGifStudio />}
              {selectedService === 'squoosh' && <SquooshStudio />}
              {selectedService === 'area-analyzer' && <AreaAnalyzerTool />}
            </div>
          </div>
        )}

        {/* 3. ABOUT VIEW */}
        {route === 'about' && (
          <div className="max-w-3xl mx-auto border border-(--line) bg-(--panel) p-8 font-mono text-xs text-(--text) space-y-6 rounded-2xl">
            <h1 className="text-2xl font-bold font-sans text-(--text)">
              Привет я Hallizar
            </h1>

            <p className="text-sm leading-relaxed text-(--muted)">
              Этот проект — персональный блог и коллекция легковесных веб-инструментов и плагинов. (Все медиа-утилиты обрабатывают данные локально в браузере).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-(--line)">
              <div className="p-4 border border-(--line) bg-(--elevated) rounded-xl">
                <strong className="text-(--text) block mb-1 font-sans text-sm">Стек технологий</strong>
                <p className="text-[11px] text-(--muted) m-0 leading-relaxed">
                  Astro 5 (SSG), Tailwind CSS, React Islands, WebAssembly (gifski-wasm), Decap CMS, GitHub Pages.
                </p>
              </div>

              <div className="p-4 border border-(--line) bg-(--elevated) rounded-xl">
                <strong className="text-(--text) block mb-1 font-sans text-sm">Контакты &amp; Код</strong>
                <p className="text-[11px] text-(--muted) m-0 leading-relaxed">
                  TG: @hallizar
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-(--line) bg-(--panel) py-8 px-4 sm:px-8 mt-12 text-center text-xs font-mono text-(--muted)">
        <div className="w-full max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center text-(--text) shrink-0">
              <Logo size={16} color="currentColor" />
            </div>
            <span className="text-(--text) font-bold">HALLIZAR</span>
            <span>&middot; Авторский блог, плагины, веб-сервисы </span>
          </div>

          <div className="flex items-center gap-4 text-[11px]">
            <button
              onClick={() => {
                setRoute('blog');
                selectPost(null);
              }}
              className="hover:text-(--accent) transition-colors"
            >
              Статьи
            </button>
            <button
              onClick={() => {
                setRoute('services');
                setSelectedService('gif-studio');
                selectPost(null);
              }}
              className="hover:text-(--accent) transition-colors"
            >
              Сервисы
            </button>
            <button
              onClick={() => {
                setRoute('about');
                selectPost(null);
              }}
              className="hover:text-(--accent) transition-colors"
            >
              О проекте
            </button>
            <a
              href="/admin/"
              onClick={(e) => {
                e.preventDefault();
                setRoute('admin');
              }}
              className="hover:text-(--accent) transition-colors opacity-60 hover:opacity-100"
            >
              Вход
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
