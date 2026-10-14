import { AdBannerItem } from '../types';

/**
 * ВНИМАНИЕ: демонстрационные баннеры (бывш. INITIAL_ADS) удалены.
 * Единственный источник данных о рекламе — коллекция Decap CMS
 * `src/content/ads/*.json`, которая на билде синхронизируется в
 * `public/ads-data.json` (см. scripts/sync-admin-content.js). Хардкод
 * возвращал на сайт давно удалённые «дефолтные» объявления при любом
 * сбое загрузки JSON.
 */

export function getActiveAdForSlot(ads: AdBannerItem[], slot: 'sidebar' | 'in-article' | 'top-header'): AdBannerItem | null {
  const now = new Date();

  const filtered = ads
    .filter((ad) => {
      if (!ad.active) return false;
      if (ad.slot !== slot) return false;

      if (ad.startDate) {
        const start = new Date(ad.startDate);
        if (now < start) return false;
      }

      if (ad.endDate) {
        const end = new Date(ad.endDate);
        end.setHours(23, 59, 59, 999);
        if (now > end) return false;
      }

      return true;
    })
    .sort((a, b) => b.priority - a.priority);

  return filtered.length > 0 ? filtered[0] : null;
}
