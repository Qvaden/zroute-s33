/**
 * АДАПТЕР: локальный JSON.
 *
 * Две роли, и обе важные:
 *   1. Разработка и демо — сайт работает без сети и без всякой настройки.
 *   2. Аварийный выход. Если Google однажды сломает публикацию таблиц,
 *      а PocketBase окажется неоплачен — выгружаем всё в JSON, меняем
 *      одну строку в конфиге, и сайт снова живой и статический навсегда.
 *      История при этом не теряется.
 */
import { CONFIG } from '../../../config.js';
import { toDate, toBool, toStr, toOutcome } from './_coerce.js';

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
  const d = await raw();
  return (d.alliances ?? []).map((a) => ({
    id: toStr(a.id),
    tag: toStr(a.tag),
    name: toStr(a.name),
    color: a.color ? toStr(a.color) : undefined,
    active: toBool(a.active, true),
    note: a.note ? toStr(a.note) : undefined,
  }));
}

export async function getWeeks() {
  const d = await raw();
  return (d.weeks ?? [])
    .map((w) => ({
      id: toStr(w.id),
      number: Number(w.number),
      startDate: toDate(w.startDate),
      endDate: toDate(w.endDate),
      note: w.note ? toStr(w.note) : undefined,
    }))
    .sort((a, b) => a.number - b.number);
}

export async function getResults() {
  const d = await raw();
  return (d.results ?? [])
    .map((r) => ({
      weekId: toStr(r.weekId),
      allianceId: toStr(r.allianceId),
      outcome: toOutcome(r.outcome),
      opponent: r.opponent ? toStr(r.opponent) : undefined,
      comment: r.comment ? toStr(r.comment) : undefined,
    }))
    .filter((r) => r.outcome !== null);
}

export async function getEvents() {
  const d = await raw();
  return (d.events ?? [])
    .map((e) => ({
      id: toStr(e.id),
      date: toDate(e.date),
      type: toStr(e.type) || 'other',
      serverNumber: e.serverNumber != null ? Number(e.serverNumber) : undefined,
      title: toStr(e.title),
      body: e.body ? toStr(e.body) : undefined,
      imageUrl: e.imageUrl ? toStr(e.imageUrl) : undefined,
      durationDays: e.durationDays != null ? Number(e.durationDays) : undefined,
    }))
    .sort((a, b) => b.date - a.date);
}

export async function getTexts() {
  const d = await raw();
  return (d.texts ?? []).map((t) => ({
    key: toStr(t.key),
    title: toStr(t.title),
    body: typeof t.body === 'string' ? t.body : '',
  }));
}
