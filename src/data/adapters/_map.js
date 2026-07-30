/**
 * РАЗБОР СЫРОГО JSON В ДОМЕННУЮ МОДЕЛЬ.
 *
 * Вынесено из json-адаптера, потому что у того же самого файла появился
 * второй читатель: админ-панель берёт `data/live.json` не с сайта, а через
 * API GitHub — ей нужны те же объекты, но путь к ним другой.
 *
 * Если бы каждый разбирал сам, панель показывала бы данные чуть иначе,
 * чем сайт: где-то строка вместо Date, где-то незамеченный пустой исход.
 * Расхождение нашлось бы в момент публикации, то есть в худший момент.
 * Поэтому правило простое: разбор ровно один, потребителей сколько угодно.
 */
import { toDate, toBool, toStr, toNumber, toOutcome } from './_coerce.js';
import { byWeekStart } from '../week-order.js';

/** @param {any[]} [rows] */
export function mapAlliances(rows) {
  return (rows ?? []).map((a) => ({
    id: toStr(a.id),
    tag: toStr(a.tag),
    name: toStr(a.name),
    color: a.color ? toStr(a.color) : undefined,
    active: toBool(a.active, true),
    note: a.note ? toStr(a.note) : undefined,
  }));
}

/** @param {any[]} [rows] */
export function mapWeeks(rows) {
  return (rows ?? [])
    .map((w) => ({
      id: toStr(w.id),
      number: Number(w.number),
      startDate: toDate(w.startDate),
      endDate: toDate(w.endDate),
      note: w.note ? toStr(w.note) : undefined,
    }))
    .sort(byWeekStart);
}

/**
 * Пустой и непонятный исход записи не порождает: это «результат ещё
 * не внесли», а не третий исход. См. рассуждение в types.js.
 *
 * @param {any[]} [rows]
 */
export function mapResults(rows) {
  return (rows ?? [])
    .map((r) => ({
      weekId: toStr(r.weekId),
      allianceId: toStr(r.allianceId),
      outcome: toOutcome(r.outcome),
      opponent: r.opponent ? toStr(r.opponent) : undefined,
      comment: r.comment ? toStr(r.comment) : undefined,
    }))
    .filter((r) => r.outcome !== null);
}

/** @param {any[]} [rows] */
export function mapEvents(rows) {
  return (rows ?? [])
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

/** @param {any[]} [rows] */
export function mapTexts(rows) {
  return (rows ?? []).map((t) => ({
    key: toStr(t.key),
    title: toStr(t.title),
    body: typeof t.body === 'string' ? t.body : '',
  }));
}

/**
 * Весь набор разом — то, что нужно и адаптеру, и панели.
 * @param {any} raw
 */
export function mapDataset(raw) {
  return {
    alliances: mapAlliances(raw?.alliances),
    weeks: mapWeeks(raw?.weeks),
    results: mapResults(raw?.results),
    events: mapEvents(raw?.events),
    texts: mapTexts(raw?.texts),
  };
}
