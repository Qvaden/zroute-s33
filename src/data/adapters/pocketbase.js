/**
 * АДАПТЕР: PocketBase.
 *
 * Пока не задействован — включается сменой dataSource на 'pocketbase'
 * в config.js, когда появится человек, отвечающий за сервер.
 *
 * Написан заранее намеренно: пока оба адаптера пишутся рядом, контракт
 * держится честным. Если отложить второй адаптер «на потом», интерфейс
 * незаметно подстроится под особенности первого источника, и обещание
 * дешёвого переезда окажется враньём.
 *
 * Работает через обычный REST без SDK — чтобы у проекта по-прежнему
 * не было ни одной зависимости.
 */
import { CONFIG } from '../../../config.js';
import { toDate, toBool, toStr, toNumber, toOutcome } from './_coerce.js';

export const name = 'pocketbase';

/**
 * Здесь абстракция честно расширяется: появляется запись, загрузка
 * картинок и авторизация. Страницы проверяют эти флаги явно — например,
 * страница ввода недели существует только при canWrite.
 * @type {import('../types.js').Capabilities}
 */
export const capabilities = {
  canWrite: true,
  canUploadImages: true,
  canAuth: true,
};

/** @type {Map<string, Promise<any[]>>} */
const cache = new Map();

/**
 * @param {string} collection
 * @param {string} [sort]
 */
function list(collection, sort = '') {
  const key = `${collection}|${sort}`;
  if (cache.has(key)) return cache.get(key);

  const base = CONFIG.pocketbase.url;
  if (!base) {
    throw new Error('pocketbase-адаптер: в config.js не заполнен pocketbase.url');
  }

  const url =
    `${base.replace(/\/$/, '')}/api/collections/${encodeURIComponent(collection)}/records` +
    `?perPage=500${sort ? `&sort=${encodeURIComponent(sort)}` : ''}`;

  const p = (async () => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`pocketbase-адаптер: коллекция «${collection}» недоступна (${res.status})`);
    }
    const json = await res.json();
    return json.items ?? [];
  })();

  cache.set(key, p);
  return p;
}

export async function getAlliances() {
  const items = await list('alliances', 'tag');
  return items.map((r) => ({
    id: toStr(r.id),
    tag: toStr(r.tag),
    name: toStr(r.name),
    color: toStr(r.color) || undefined,
    active: toBool(r.active, true),
    note: toStr(r.note) || undefined,
  }));
}

export async function getWeeks() {
  const items = await list('weeks', 'number');
  return items.map((r) => ({
    id: toStr(r.id),
    number: toNumber(r.number) ?? 0,
    startDate: toDate(r.startDate),
    endDate: toDate(r.endDate),
    note: toStr(r.note) || undefined,
  }));
}

export async function getResults() {
  const items = await list('results');
  return items
    .map((r) => ({
      weekId: toStr(r.week),
      allianceId: toStr(r.alliance),
      outcome: toOutcome(r.outcome),
      opponent: toStr(r.opponent) || undefined,
      comment: toStr(r.comment) || undefined,
    }))
    .filter((r) => r.outcome !== null);
}

export async function getEvents() {
  const items = await list('events', '-date');
  return items.map((r) => ({
    id: toStr(r.id),
    date: toDate(r.date),
    type: toStr(r.type) || 'other',
    serverNumber: toNumber(r.serverNumber) ?? undefined,
    title: toStr(r.title),
    body: toStr(r.body) || undefined,
    // В PocketBase файл хранится как имя — собираем полный адрес.
    imageUrl: r.image
      ? `${CONFIG.pocketbase.url.replace(/\/$/, '')}/api/files/events/${r.id}/${r.image}`
      : undefined,
  }));
}

export async function getTexts() {
  const items = await list('texts');
  return items.map((r) => ({
    key: toStr(r.key),
    title: toStr(r.title),
    body: r.body ?? '',
  }));
}
