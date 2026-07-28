/**
 * Приведение типов для адаптеров.
 *
 * Всё, что источник отдаёт строками, превращается здесь в нормальные
 * значения доменной модели. Это ровно то место, где абстракция протекает,
 * если поленишься: наружу из адаптера обязаны выходить Date, number и
 * строгие литералы outcome — никогда сырые строки источника.
 */

/** Как в таблице записывают результат. Регистр и пробелы не важны. */
const OUTCOME_ALIASES = {
  'п': 'win',
  'победа': 'win',
  'w': 'win',
  'win': 'win',
  '+': 'win',

  'х': 'loss', // русская Х
  'x': 'loss', // латинская X
  'поражение': 'loss',
  'l': 'loss',
  'loss': 'loss',
  '-': 'loss',

  'н': 'draw',
  'ничья': 'draw',
  'd': 'draw',
  'draw': 'draw',
  '=': 'draw',
};

/**
 * @param {unknown} raw
 * @returns {import('../types.js').Outcome | null} null — значит записи нет вовсе (пустая ячейка)
 */
export function toOutcome(raw) {
  if (raw === null || raw === undefined) return null;
  const key = String(raw).trim().toLowerCase();
  if (key === '') return null;
  return OUTCOME_ALIASES[key] ?? null;
}

/**
 * Понимает ISO (2026-07-14), русский формат (14.07.2026) и Date.
 * @param {unknown} raw
 * @returns {Date | null}
 */
export function toDate(raw) {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (raw === null || raw === undefined) return null;

  const s = String(raw).trim();
  if (s === '') return null;

  const ru = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if (ru) {
    const [, d, m, y] = ru;
    const date = new Date(Date.UTC(+y, +m - 1, +d));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
export function toNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Таблицы отдают «да»/«нет», «TRUE»/«FALSE», «1»/«0».
 * @param {unknown} raw
 * @param {boolean} fallback
 */
export function toBool(raw, fallback = true) {
  if (typeof raw === 'boolean') return raw;
  if (raw === null || raw === undefined) return fallback;
  const s = String(raw).trim().toLowerCase();
  if (s === '') return fallback;
  return ['да', 'true', '1', 'yes', 'y', '+'].includes(s);
}

/** @param {unknown} raw */
export function toStr(raw) {
  return raw === null || raw === undefined ? '' : String(raw).trim();
}
