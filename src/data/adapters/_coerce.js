/**
 * Приведение типов для адаптеров.
 *
 * Всё, что источник отдаёт строками, превращается здесь в нормальные
 * значения доменной модели. Это ровно то место, где абстракция протекает,
 * если поленишься: наружу из адаптера обязаны выходить Date, number и
 * строгие литералы outcome — никогда сырые строки источника.
 */

/**
 * Как в таблице записывают результат. Регистр и пробелы не важны.
 * Исходов ровно два: победа или поражение.
 */
const OUTCOME_ALIASES = {
  'п': 'win',
  'победа': 'win',
  'w': 'win',
  'win': 'win',
  '+': 'win',
  '1': 'win',

  'х': 'loss', // русская Х
  'x': 'loss', // латинская X
  'поражение': 'loss',
  'l': 'loss',
  'loss': 'loss',
  '-': 'loss',
  '0': 'loss',
};

/**
 * @param {unknown} raw
 * @returns {import('../types.js').Outcome | null}
 *   null — записи нет: ячейка пустая или в ней что-то непонятное.
 *   Это означает «данные не внесены», а не какой-то третий исход.
 */
export function toOutcome(raw) {
  if (raw === null || raw === undefined) return null;
  const key = String(raw).trim().toLowerCase();
  if (key === '') return null;
  return OUTCOME_ALIASES[key] ?? null;
}

/**
 * Как записывают итог недели на уровне сервера.
 *
 * Четыре состояния, две оси: захват или защита, получилось или нет.
 * Синонимов много намеренно — человек в таблице пишет как говорит,
 * а не как удобно программе. Порядок проверки важен: «не захватили»
 * должно разбираться раньше «захватили», иначе отрицание потеряется.
 */
const SERVER_OUTCOME_ALIASES = {
  captured: ['captured', 'взяли', 'захватили', 'захват', 'забрали', 'взят', 'захвачен'],
  not_captured: [
    'not_captured', 'не взяли', 'не захватили', 'не взят', 'не захвачен',
    'не смогли захватить', 'провал захвата',
  ],
  held: ['held', 'удержали', 'защитили', 'защита', 'отбили', 'удержан', 'защищён', 'защищен'],
  lost: [
    'lost', 'потеряли', 'не удержали', 'не защитили', 'потерян', 'сдали',
  ],
};

/**
 * @param {unknown} raw
 * @returns {import('../../logic/server-outcome.js').ServerOutcome | null}
 *   null — итог не внесён. Это состояние данных, а не пятый исход:
 *   не каждую неделю сервер вообще воюет.
 */
export function toServerOutcome(raw) {
  if (raw === null || raw === undefined) return null;

  const key = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  if (key === '') return null;

  // Отрицания проверяем первыми: иначе «не захватили» совпадёт с «захватили».
  for (const outcome of ['not_captured', 'lost', 'captured', 'held']) {
    if (SERVER_OUTCOME_ALIASES[outcome].includes(key)) return outcome;
  }
  return null;
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
