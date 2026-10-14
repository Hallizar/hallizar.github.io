import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Clock, Eye, Link2, Check, Share2, ChevronRight } from 'lucide-react';
import { BlogPost, AdBannerItem } from '../types';
import { AdBanner } from './AdBanner';
import { postPath, absolutePostUrl } from '../utils/postUrl';

interface BlogPostViewProps {
  post: BlogPost;
  /** Весь список постов — нужен для хронологического «следующего поста» */
  posts?: BlogPost[];
  inArticleAd: AdBannerItem | null;
  onBack: () => void;
  /** Переход к другому посту (из блока «Далее по хронологии») */
  onSelectPost?: (post: BlogPost) => void;
}

/** Разметка статьи -> блоки (h2/h3/h4/p/ul/blockquote/pre). */
function parseBlocks(content: string): any[] {
  const lines = content.split('\n');
  const blocks: any[] = [];
  let currentList: any = null;
  let inCodeBlock = false;
  let codeContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        blocks.push({ type: 'pre', content: codeContent.trim() });
        codeContent = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + '\n';
      continue;
    }

    if (line.startsWith('## ')) {
      if (currentList) {
        blocks.push(currentList);
        currentList = null;
      }
      blocks.push({ type: 'h2', content: line.replace('## ', '') });
    } else if (line.startsWith('### ')) {
      if (currentList) {
        blocks.push(currentList);
        currentList = null;
      }
      blocks.push({ type: 'h3', content: line.replace('### ', '') });
    } else if (line.startsWith('#### ')) {
      if (currentList) {
        blocks.push(currentList);
        currentList = null;
      }
      blocks.push({ type: 'h4', content: line.replace('#### ', '') });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!currentList || currentList.type !== 'ul') {
        if (currentList) blocks.push(currentList);
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(line.substring(2));
    } else if (/^\d+\.\s/.test(line)) {
      if (!currentList || currentList.type !== 'ol') {
        if (currentList) blocks.push(currentList);
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(line.replace(/^\d+\.\s/, ''));
    } else if (line.startsWith('> ')) {
      if (currentList) {
        blocks.push(currentList);
        currentList = null;
      }
      blocks.push({ type: 'blockquote', content: line.replace('> ', '') });
    } else if (line.trim() === '') {
      if (currentList) {
        blocks.push(currentList);
        currentList = null;
      }
    } else {
      if (currentList) {
        blocks.push(currentList);
        currentList = null;
      }
      blocks.push({ type: 'p', content: line });
    }
  }
  if (currentList) blocks.push(currentList);
  return blocks;
}

/** Инлайн-разметка: **жирный**, `код`. */
function renderInline(text: string): (string | ReactElement)[] {
  const parts: (string | ReactElement)[] = [];
  const regex = /(\*\*(.*?)\*\*|`(.*?)`)/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(
        <code key={key++} className="px-1.5 py-0.5 text-[0.85em]">
          {match[3]}
        </code>,
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export function BlogPostView({
  post,
  posts = [],
  inArticleAd,
  onBack,
  onSelectPost,
}: BlogPostViewProps) {
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Хронология: новые сверху. «Следующий» пост — идущий ниже текущего в этой же ленте.
  const chronological = useMemo(
    () =>
      [...posts].sort(
        (a, b) =>
          new Date(b.isoDate || b.date).getTime() - new Date(a.isoDate || a.date).getTime(),
      ),
    [posts],
  );

  const currentIdx = chronological.findIndex((p) => p.id === post.id);
  const nextPost = currentIdx >= 0 ? chronological[currentIdx + 1] : undefined;
  const prevPost = currentIdx > 0 ? chronological[currentIdx - 1] : undefined;

  // Адрес статьи синхронизирует App через replaceState (без накопления истории).
  // Здесь только подстраховка: если URL «уехал» (относительные pushState или повторы), чиним его.
  useEffect(() => {
    const path = window.location.pathname;
    const expected = postPath(post);
    if (!new RegExp(`(^|/)blog/${post.slug}/?$`).test(path) || path.includes('/blog/blog')) {
      window.history.replaceState({ slug: post.slug }, '', expected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  // Скролл в начало при смене поста (в т.ч. при автопереходе к следующему)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    scrollRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  const blocks = parseBlocks(post.content);
  const mid = Math.ceil(blocks.length / 2);
  const firstHalf = blocks.slice(0, mid);
  const secondHalf = blocks.slice(mid);

  const handleShare = async () => {
    // Копируем полный адрес ИМЕННО этой статьи
    const url = absolutePostUrl(post);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const renderBlock = (b: any, idx: number) => {
    switch (b.type) {
      case 'h2':
        return (
          <h2 key={idx} className="scroll-mt-24">
            {renderInline(b.content)}
          </h2>
        );
      case 'h3':
        return <h3 key={idx}>{renderInline(b.content)}</h3>;
      case 'h4':
        return <h4 key={idx}>{renderInline(b.content)}</h4>;
      case 'p':
        return <p key={idx}>{renderInline(b.content)}</p>;
      case 'blockquote':
        return <blockquote key={idx}>{renderInline(b.content)}</blockquote>;
      case 'ul':
        return (
          <ul key={idx}>
            {b.items.map((it: string, j: number) => (
              <li key={j}>{renderInline(it)}</li>
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={idx} className="[&>li]:list-decimal">
            {b.items.map((it: string, j: number) => (
              <li key={j}>{renderInline(it)}</li>
            ))}
          </ol>
        );
      case 'pre':
        return (
          <pre key={idx}>
            <code>{b.content}</code>
          </pre>
        );
      default:
        return null;
    }
  };

  return (
    <article ref={scrollRef} tabIndex={-1} key={post.id} className="reader-enter outline-none">
      {/* Верхняя панель: назад + share */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <button
          onClick={onBack}
          className="qwen-chip !text-xs hover:!border-(--accent) hover:!text-(--accent)"
        >
          <ArrowLeft size={13} /> К ленте
        </button>

        <div className="flex items-center gap-2 text-[11px] font-mono text-(--muted)">
          <span className="hidden sm:inline-flex items-center gap-1.5">
            <CalendarDays size={12} /> {post.date}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={12} /> {post.readingTime}
          </span>
          {typeof post.views === 'number' && (
            <span className="inline-flex items-center gap-1.5">
              <Eye size={12} /> {post.views}
            </span>
          )}
        </div>
      </div>

      {/* Заголовок статьи */}
      <header className="mb-8">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-(--accent)">
          {post.category}
        </p>
        <h1 className="mt-3 text-3xl sm:text-4xl md:text-[2.6rem] font-bold leading-[1.15] tracking-tight text-(--text)">
          {post.title}
        </h1>
        <p className="mt-4 text-base sm:text-lg text-(--muted) leading-relaxed max-w-2xl">
          {post.excerpt}
        </p>

        {/* Автор + кнопка «Поделиться» */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-(--line)">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-(--accent) text-(--on-accent) flex items-center justify-center text-sm font-bold shrink-0">
              {(post.author?.name || 'H').slice(0, 1)}
            </div>
            <div>
              <p className="text-sm font-semibold text-(--text) leading-tight">
                {post.author?.name || 'Hallizar'}
              </p>
              <p className="text-[11px] font-mono text-(--muted) mt-0.5">{post.author?.role || ''}</p>
            </div>
          </div>

          <button
            onClick={handleShare}
            aria-label="Скопировать ссылку на статью"
            className={`qwen-chip !py-2 !px-4 !text-xs transition-all ${
              copied
                ? '!bg-(--success) !border-(--success) !text-white'
                : 'hover:!border-(--accent) hover:!text-(--accent)'
            }`}
          >
            {copied ? (
              <>
                <Check size={14} /> Ссылка скопирована
              </>
            ) : (
              <>
                <Share2 size={14} /> Поделиться
              </>
            )}
          </button>
        </div>
      </header>

      {/* Главное изображение — без рамок, во всю ширину колонки */}
      {post.image && (
        <figure className="my-8">
          <img src={post.image} alt={post.title} className="rounded-none" draggable={false} />
        </figure>
      )}

      {/* Тело статьи */}
      <div className="prose-reader">
        {firstHalf.map(renderBlock)}

        {inArticleAd && (
          <div className="not-prose my-8">
            <AdBanner ad={inArticleAd} slot="in-article" />
          </div>
        )}

        {secondHalf.map(renderBlock)}
      </div>

      {/* Теги */}
      {post.tags && post.tags.length > 0 && (
        <footer className="mt-10 pt-6 border-t border-(--line)">
          <div className="flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span key={tag} className="qwen-chip !cursor-default">
                #{tag}
              </span>
            ))}
          </div>
        </footer>
      )}

      {/* Следующий пост по хронологии */}
      <section className="mt-10">
        {nextPost ? (
          <button
            onClick={() => onSelectPost?.(nextPost)}
            className="qwen-card qwen-card-horizontal w-full text-left rounded-2xl overflow-hidden group flex flex-col sm:flex-row"
          >
            <div className="qwen-square w-full sm:!w-44 sm:!min-w-[11rem] sm:!h-44 sm:shrink-0 !aspect-square">
              {nextPost.image ? (
                <img src={nextPost.image} alt={nextPost.title} loading="lazy" draggable={false} />
              ) : (
                <div className="w-full h-full grid place-items-center bg-(--elevated) text-3xl font-black text-(--accent)/40">
                  H
                </div>
              )}
            </div>
            <div className="p-5 flex-1 min-w-0 flex flex-col justify-center">
              <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-(--accent)">
                Далее по хронологии <ChevronRight size={12} className="transition-transform group-hover:translate-x-1" />
              </p>
              <h3 className="mt-2 text-lg font-bold leading-snug text-(--text) group-hover:text-(--accent) transition-colors line-clamp-2">
                {nextPost.title}
              </h3>
              <p className="mt-1.5 text-[13px] text-(--muted) line-clamp-2">{nextPost.excerpt}</p>
              <p className="mt-2 text-[11px] font-mono text-(--muted)">{nextPost.date}</p>
            </div>
          </button>
        ) : (
          <div className="rounded-2xl border border-dashed border-(--line-strong) p-6 text-center text-sm text-(--muted)">
            Это самый новый материал ленты.{' '}
            <button onClick={onBack} className="text-(--accent) hover:underline underline-offset-4">
              Вернуться к ленте
            </button>
          </div>
        )}
      </section>

      {/* Подсказка про навигацию стрелками + предыдущий пост */}
      {prevPost && (
        <div className="mt-6 flex items-center justify-between text-[11px] font-mono text-(--muted)">
          <button
            onClick={() => onSelectPost?.(prevPost)}
            className="hover:text-(--accent) transition-colors inline-flex items-center gap-1.5"
          >
            <ArrowLeft size={12} /> Предыдущий: {prevPost.title.slice(0, 40)}…
          </button>
          <Link2 size={12} className="opacity-40" />
        </div>
      )}
    </article>
  );
}

export default BlogPostView;
