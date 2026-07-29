/**
 * АДАПТЕР: локальный JSON.
 *
 * Две роли, и обе важные:
 *   1. Разработка и демо — сайт работает без сети и без всякой настройки.
 *   2. Аварийный выход. Если Google однажды сломает публикацию таблиц,
 *      а PocketBase окажется неоплачен — выгружаем всё в JSON, меняем
 *      одну строку в конфиге, и сайт снова живой и статический навсегда.
 *      История при этом не теряется.
 *
 * Сам разбор вынесен в `_map.js`: у этого файла появился второй читатель —
 * админ-панель берёт его через API GitHub. Оба обязаны понимать данные
 * одинаково, поэтому разбор один на всех.
 */
import { CONFIG } from '../../../config.js';
import { mapAlliances, mapWeeks, mapResults, mapEvents, mapTexts } from './_map.js';

export const name = 'json';

/** @type {import('../types.js').Capabilities} */
export const capabilities = {
  canWrite: false,
  canUploadImages: false,
  canAuth: false,
};

/** @type {Promise<any> | null} */
let cache = null;

/** Сбрасывает кэш, чтобы следующий запрос перечитал файл. */
export function clearCache() {
  cache = null;
}

async function raw() {
  if (cache) return cache;

  cache = (async () => {
    // В браузере путь резолвится относительно index.html, в Node — относительно cwd.
    const path = CONFIG.json.path;
    if (typeof fetch === 'function' && typeof window !== 'undefined') {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`json-адаптер: не удалось прочитать ${path} (${res.status})`);
      return res.json();
    }
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(path.replace(/^\.\//, ''), 'utf8'));
  })();

  return cache;
}

export async function getAlliances() {
  return mapAlliances((await raw()).alliances);
}

export async function getWeeks() {
  return mapWeeks((await raw()).weeks);
}

export async function getResults() {
  return mapResults((await raw()).results);
}

export async function getEvents() {
  return mapEvents((await raw()).events);
}

export async function getTexts() {
  return mapTexts((await raw()).texts);
}
