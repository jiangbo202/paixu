export const BRAND = Object.freeze({ name: '牌序', wordmark: 'PAIXU', packageName: 'paixu-web' });
export function pageTitle(language = 'zh', section) {
  const name = language === 'en' ? BRAND.wordmark : `${BRAND.name} ${BRAND.wordmark}`;
  return `${name} · ${section || (language === 'en' ? 'Poker Roguelike' : '扑克构筑')}`;
}
