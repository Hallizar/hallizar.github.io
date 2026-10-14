import { BlogPost } from '../types';

export interface ArticleMetadata {
  pubDate: Date | string;
  updatedDate?: Date | string;
  tags?: string[];
  author?: string;
  authorRole?: string;
  section?: string;
}

export interface SEOOptions {
  title?: string;
  description?: string;
  image?: string;
  canonicalURL?: string | URL;
  pathname?: string;
  siteUrl?: string;
  type?: 'website' | 'article';
  article?: ArticleMetadata;
  siteName?: string;
  locale?: string;
  twitterHandle?: string;
  noindex?: boolean;
}

export interface SEOMetadata {
  title: string;
  description: string;
  canonicalURL: string;
  image: string;
  type: 'website' | 'article';
  siteName: string;
  locale: string;
  noindex: boolean;
  openGraph: {
    title: string;
    description: string;
    type: 'website' | 'article';
    url: string;
    image: string;
    imageAlt: string;
    siteName: string;
    locale: string;
    article?: {
      publishedTime: string;
      modifiedTime?: string;
      author: string;
      section?: string;
      tags: string[];
    };
  };
  twitter: {
    card: 'summary_large_image';
    site: string;
    creator: string;
    title: string;
    description: string;
    image: string;
    imageAlt: string;
    url: string;
  };
  schemaJsonLd: Record<string, unknown>;
}

const DEFAULT_SITE_URL = 'https://hallizar.ru';
const DEFAULT_TITLE = 'Халлизар студия — Блог о дизайне и веб-разработке, плагины Figma, веб-сервесы: пакетная сборка гиф,пакетное сжатие с сохранением структуры папки - png,jpeg,webp на самых пиздатых WASM кодировщиках.  ';
const DEFAULT_DESCRIPTION = 'Блог о современной веб-разработке с удобными локальнми инструментами без серверного бэкенда.';
const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&auto=format&fit=crop&q=80';
const DEFAULT_SITE_NAME = 'Халлизар студия';
const DEFAULT_LOCALE = 'ru_RU';
const DEFAULT_TWITTER_HANDLE = '@hallizar';

/**
 * Standardizes and constructs SEO metadata, Open Graph, Twitter cards, and Schema.org JSON-LD.
 * Designed for build-time static generation (SSG) in Astro as well as client-side rendering.
 */
export function getSEOMetadata(options: SEOOptions = {}): SEOMetadata {
  const baseSiteUrl = (options.siteUrl || DEFAULT_SITE_URL).replace(/\/$/, '');
  const title = options.title || DEFAULT_TITLE;
  const description = options.description || DEFAULT_DESCRIPTION;
  const siteName = options.siteName || DEFAULT_SITE_NAME;
  const locale = options.locale || DEFAULT_LOCALE;
  const twitterHandle = options.twitterHandle || DEFAULT_TWITTER_HANDLE;
  const noindex = Boolean(options.noindex);

  // 1. Resolve Canonical URL (canonical format always ends with a trailing slash)
  let canonicalURL: string;
  if (options.canonicalURL) {
    canonicalURL = typeof options.canonicalURL === 'string'
      ? (options.canonicalURL.startsWith('http') ? options.canonicalURL : new URL(options.canonicalURL, baseSiteUrl).toString())
      : options.canonicalURL.toString();
  } else if (options.pathname) {
    canonicalURL = new URL(options.pathname, baseSiteUrl).toString();
  } else {
    canonicalURL = baseSiteUrl;
  }
  if (!canonicalURL.endsWith('/')) {
    canonicalURL = `${canonicalURL}/`;
  }

  // 2. Resolve absolute social media image URL
  const rawImage = options.image || DEFAULT_IMAGE;
  const image = rawImage.startsWith('http://') || rawImage.startsWith('https://')
    ? rawImage
    : new URL(rawImage, baseSiteUrl).toString();

  // 3. Resolve Type and Article Metadata
  const isArticle = options.type === 'article' || Boolean(options.article);
  const type: 'website' | 'article' = isArticle ? 'article' : 'website';

  const articleConfig = options.article;
  const pubDateObj = articleConfig?.pubDate ? new Date(articleConfig.pubDate) : null;
  const updatedDateObj = articleConfig?.updatedDate ? new Date(articleConfig.updatedDate) : pubDateObj;
  const author = articleConfig?.author || 'Hallizar';
  const tags = articleConfig?.tags || [];
  const section = articleConfig?.section || 'Технологии, веб-разработка и веб-сервисы, пакетная сборка гиф, пакетное сжатие, лучшее качество';

  // 4. Construct Open Graph payload
  const openGraph: SEOMetadata['openGraph'] = {
    title,
    description,
    type,
    url: canonicalURL,
    image,
    imageAlt: title,
    siteName,
    locale,
  };

  if (isArticle && pubDateObj) {
    openGraph.article = {
      publishedTime: pubDateObj.toISOString(),
      modifiedTime: updatedDateObj ? updatedDateObj.toISOString() : pubDateObj.toISOString(),
      author,
      section,
      tags,
    };
  }

  // 5. Construct Twitter Card payload
  const twitter: SEOMetadata['twitter'] = {
    card: 'summary_large_image',
    site: twitterHandle,
    creator: twitterHandle,
    title,
    description,
    image,
    imageAlt: title,
    url: canonicalURL,
  };

  // 6. Construct Schema.org JSON-LD structured data
  const schemaJsonLd: Record<string, unknown> = isArticle && pubDateObj
    ? {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: title,
        description,
        image: [image],
        datePublished: pubDateObj.toISOString(),
        dateModified: (updatedDateObj || pubDateObj).toISOString(),
        mainEntityOfPage: {
          '@type': 'WebPage',
          '@id': canonicalURL,
        },
        author: {
          '@type': 'Person',
          name: author,
          url: baseSiteUrl,
        },
        publisher: {
          '@type': 'Organization',
          name: siteName,
          url: baseSiteUrl,
          logo: {
            '@type': 'ImageObject',
            url: `${baseSiteUrl}/favicon.svg`,
          },
        },
        keywords: tags.join(', '),
        articleSection: section,
        inLanguage: 'ru-RU',
      }
    : {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebSite',
            '@id': `${baseSiteUrl}/#website`,
            url: baseSiteUrl,
            name: siteName,
            description,
            inLanguage: 'ru-RU',
          },
          {
            '@type': 'WebPage',
            '@id': canonicalURL,
            url: canonicalURL,
            name: title,
            description,
            isPartOf: {
              '@id': `${baseSiteUrl}/#website`,
            },
            inLanguage: 'ru-RU',
          },
          {
            '@type': 'WebApplication',
            name: 'Local GIF Studio',
            applicationCategory: 'MultimediaApplication',
            operatingSystem: 'All',
            description: 'Пакертная сборка гиф, 1000 гиф за минуту, лучшее качество и низкий вес',
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'RUB',
            },
          },
        ],
      };

  return {
    title,
    description,
    canonicalURL,
    image,
    type,
    siteName,
    locale,
    noindex,
    openGraph,
    twitter,
    schemaJsonLd,
  };
}

// ----------------------------------------------------------------------
// Client-side DOM helper for React runtime dynamic view switching
// ----------------------------------------------------------------------

interface UpdateSEOMetadataOptions {
  route: 'blog' | 'services' | 'about' | 'admin';
  post?: BlogPost | null;
}

function setOrCreateMeta(attrName: 'name' | 'property', attrValue: string, content: string) {
  let element = document.querySelector<HTMLMetaElement>(`meta[${attrName}="${attrValue}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attrName, attrValue);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function setOrCreateCanonical(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

function setOrCreateJsonLd(id: string, data: object) {
  let script = document.getElementById(id) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(data);
}

export function updateSEOMetadata({ route, post }: UpdateSEOMetadataOptions) {
  if (typeof window === 'undefined') return;

  const origin = window.location.origin;

  if (post) {
    const seo = getSEOMetadata({
      title: `${post.title} — Hallizar`,
      description: post.excerpt,
      canonicalURL: `${origin}/blog/${post.slug}`,
      image: post.image,
      siteUrl: origin,
      type: 'article',
      article: {
        pubDate: post.isoDate || new Date(),
        updatedDate: post.isoDate || new Date(),
        author: post.author.name,
        authorRole: post.author.role,
        tags: post.tags,
        section: post.category,
      },
    });

    document.title = seo.title;
    setOrCreateMeta('name', 'description', seo.description);
    setOrCreateCanonical(seo.canonicalURL);

    // OpenGraph
    setOrCreateMeta('property', 'og:type', seo.openGraph.type);
    setOrCreateMeta('property', 'og:title', seo.openGraph.title);
    setOrCreateMeta('property', 'og:description', seo.openGraph.description);
    setOrCreateMeta('property', 'og:url', seo.openGraph.url);
    setOrCreateMeta('property', 'og:image', seo.openGraph.image);
    setOrCreateMeta('property', 'og:site_name', seo.openGraph.siteName);
    setOrCreateMeta('property', 'og:locale', seo.openGraph.locale);

    if (seo.openGraph.article) {
      setOrCreateMeta('property', 'article:published_time', seo.openGraph.article.publishedTime);
      setOrCreateMeta('property', 'article:author', seo.openGraph.article.author);
      setOrCreateMeta('property', 'article:section', seo.openGraph.article.section || '');
    }

    // Twitter
    setOrCreateMeta('name', 'twitter:card', seo.twitter.card);
    setOrCreateMeta('name', 'twitter:title', seo.twitter.title);
    setOrCreateMeta('name', 'twitter:description', seo.twitter.description);
    setOrCreateMeta('name', 'twitter:image', seo.twitter.image);

    setOrCreateJsonLd('structured-data-json-ld', seo.schemaJsonLd);
  } else {
    let title = DEFAULT_TITLE;
    let description = DEFAULT_DESCRIPTION;
    let pathname = '/';

    if (route === 'services') {
      title = 'Халлизар студия — Блог о дизайне и веб-разработке, плагины Figma, веб-сервесы: пакетная сборка гиф,пакетное сжатие с сохранением структуры папки - png,jpeg,webp на самых пиздатых WASM кодировщиках';
      description = 'Инструменты для пакетного создания GIF из серии кадров и оптимизации, сжатия, работающие на 100% локально в браузере без серверов.';
      pathname = '/services/';
    } else if (route === 'about') {
      title = 'О проекте и технологиях — Hallizar';
      description = 'Блог о дизайне и веб-разработке. Плагины Figma и веб-сервисы: пакетная сборка GIF, сжатие PNG, JPEG, WebP с сохранением структуры папок на WASM-кодировщиках.';
      pathname = '/about/';
    }

    const seo = getSEOMetadata({
      title,
      description,
      pathname,
      siteUrl: origin,
      type: 'website',
    });

    document.title = seo.title;
    setOrCreateMeta('name', 'description', seo.description);
    setOrCreateCanonical(seo.canonicalURL);

    // OpenGraph
    setOrCreateMeta('property', 'og:type', seo.openGraph.type);
    setOrCreateMeta('property', 'og:title', seo.openGraph.title);
    setOrCreateMeta('property', 'og:description', seo.openGraph.description);
    setOrCreateMeta('property', 'og:url', seo.openGraph.url);
    setOrCreateMeta('property', 'og:image', seo.openGraph.image);
    setOrCreateMeta('property', 'og:site_name', seo.openGraph.siteName);
    setOrCreateMeta('property', 'og:locale', seo.openGraph.locale);

    // Twitter
    setOrCreateMeta('name', 'twitter:card', seo.twitter.card);
    setOrCreateMeta('name', 'twitter:title', seo.twitter.title);
    setOrCreateMeta('name', 'twitter:description', seo.twitter.description);
    setOrCreateMeta('name', 'twitter:image', seo.twitter.image);

    setOrCreateJsonLd('structured-data-json-ld', seo.schemaJsonLd);
  }
}
