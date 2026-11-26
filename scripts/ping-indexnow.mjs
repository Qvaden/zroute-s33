/**
 * Уведомляет поисковики (Яндекс / Bing) через IndexNow об обновлении страниц.
 * Ошибка сети не роняет workflow: индексация по sitemap.xml всё равно работает.
 */
const HOST = 'zroutehub.bond';
const KEY = 'zroutehubindexnow2026key9a4f7c1e';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const URL_LIST = [
  `https://${HOST}/`,
  `https://${HOST}/promocodes/`,
];

try {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: KEY_LOCATION,
      urlList: URL_LIST,
    }),
  });
  console.log(`IndexNow: HTTP ${res.status}`);
} catch (err) {
  console.warn(`IndexNow недоступен: ${err?.message ?? err}`);
}
