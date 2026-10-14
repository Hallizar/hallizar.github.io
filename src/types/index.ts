export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  tags: string[];
  date: string;
  isoDate?: string;
  image?: string;
  /** Подпись (описание) к главному изображению статьи — показывается в читалке под фото */
  imageCaption?: string;
  /** Ссылки на источник с подписью — показываются в читалке под фото: «Подробнее: (ссылка)» */
  links?: { label?: string; url: string }[];
  readingTime: string;
  author: {
    name: string;
    role: string;
    avatar: string;
  };
  content: string;
  views?: number;
}

export interface AdBannerItem {
  id: string;
  title: string;
  slot: 'sidebar' | 'in-article' | 'top-header';
  imageUrl: string;
  targetUrl: string;
  rtbBlockId?: string; // Идентификатор RTB-блока РСЯ (например, R-A-123456-1)
  active: boolean;
  startDate?: string;
  endDate?: string;
  priority: number;
}

export interface MetrikaEvent {
  id: string;
  type: 'AD_IMPRESSION' | 'AD_CLICK';
  adId: string;
  timestamp: string;
  slot?: string;
  counterId: number;
}

export interface ServiceItem {
  id: string;
  title: string;
  badge: string;
  description: string;
  features: string[];
  status: 'active' | 'beta' | 'planned';
}

export interface AdConfig {
  enabled: boolean;
  network?: 'yandex'; // Только РСЯ
  yandexRtbId?: string;
  metrikaCounterId?: number;
  testMode?: boolean;
}
