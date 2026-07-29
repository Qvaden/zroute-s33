/**
 * АДАПТЕР: Google Таблица.
 *
 * Читает вкладки как CSV через gviz-эндпоинт. Ни ключей, ни OAuth,
 * ни серверной части — достаточно открыть документ на просмотр по ссылке
 * (Доступ → Все, у кого есть ссылка → Читатель).
 *
 * ГЛАВНОЕ ЗДЕСЬ — вкладка results.
 * Человеку быстрее всего заполнять широкую матрицу: строки это альянсы,
 * столбцы это недели. Одна неделя = один новый столбец и 32 ячейки,
 * примерно минута работы.
 *
 *   allianceId | W21 | W22 | W23 | W24
 *   a01        | П   | П   | Х   | П
 *   a02        | Х   | П   | П   |
 *
 * Доменная же модель хочет нормализованные «длинные» строки.
 * Разворот матрицы делается здесь и наружу не протекает — остальной
 * код получает ровно тот же формат, что и от PocketBase.
 */
import { CONFIG } from '../../../config.js';
import { parseCsvObjects } from '../../lib/csv.js';
import { toDate, toBool, toStr, toNumber, toOutcome, toServerOutcome } from './_coerce.js';

export const name = 'sheets';

/**
 * Таблица доступна только на чтение: писать в неё с сайта нельзя.
 * Это не недоработка, а осознанный режим — роль админки здесь
 * играет сама таблица, а страница ввода недели просто не существует.
 * @type {import('../types.js').Capabilities}
 */
export const capabilities = {
  canWrite: false,
  canUploadImages: false,
  canAuth: false,
};

/** @type {Map<string, Promise<Record<string, string>[]>>} */
const cache = new Map();

/**
 * Сбрасывает кэш вкладок, чтобы следующий запрос забрал свежие данные.
 * Пригодится для кнопки «обновить» — Google отдаёт опубликованный CSV
 * с задержкой в несколько минут, и повторный заход в течение сессии
 * иначе показал бы то же самое.
 */
export function clearCache() {
  cache.clear();
}

/**
 * @param {string} tab
 * @returns {Promise<Record<string, string>[]>}
 */
function fetchTab(tab) {
  if (cache.has(tab)) return cache.get(tab);

  const { docId } = CONFIG.sheets;
  if (!docId) {
    throw new Error(
      'sheets-адаптер: в config.js не заполнен sheets.docId. ' +
        'Это ID из адреса документа: docs.google.com/spreadsheets/d/<ID>/edit'
    );
  }

  const url =
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(docId)}` +
    `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;

  const p = (async () => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `sheets-адаптер: вкладка «${tab}» недоступна (${res.status}). ` +
          'Проверьте имя вкладки и что документ открыт на просмотр по ссылке.'
      );
    }
    return parseCsvObjects(await res.text());
  })();

  cache.set(tab, p);
  return p;
}

export async function getAlliances() {
  const rows = await fetchTab(CONFIG.sheets.tabs.alliances);
  return rows
    /*
      В шаблоне все 32 строки заранее пронумерованы: ID выдаются один раз
      и больше не меняются никогда, человеку остаётся вписать тег и название.
      Пока строка не заполнена, альянса ещё не существует — такие строки
      пропускаем, иначе сайт показал бы двадцать безымянных участников.
    */
    .filter((r) => toStr(r.id) && (toStr(r.tag) || toStr(r.name)))
    .map((r) => ({
      id: toStr(r.id),
      tag: toStr(r.tag),
      name: toStr(r.name),
      color: toStr(r.color) || undefined,
      active: toBool(r.active, true),
      note: toStr(r.note) || undefined,
    }));
}

export async function getWeeks() {
  const rows = await fetchTab(CONFIG.sheets.tabs.weeks);
  return rows
    .filter((r) => toStr(r.id))
    .map((r) => ({
      id: toStr(r.id),
      number: toNumber(r.number) ?? 0,
      startDate: toDate(r.startDate),
      endDate: toDate(r.endDate),
      note: toStr(r.note) || undefined,
      // Итог недели на уровне сервера. В таблице пишется словами:
      // взяли · не взяли · удержали · потеряли.
      serverOutcome: toServerOutcome(r.serverOutcome) ?? undefined,
      serverNumber: toNumber(r.serverNumber) ?? undefined,
    }))
    .sort((a, b) => a.number - b.number);
}

/**
 * Разворот широкой матрицы в нормализованные строки.
 *
 * Пустая ячейка записи не порождает вовсе. Это означает «результат ещё
 * не внесли», а не какой-то третий исход: в VS альянс участвует всегда.
 */
export async function getResults() {
  const [rows, weeks] = await Promise.all([
    fetchTab(CONFIG.sheets.tabs.results),
    getWeeks(),
  ]);

  const knownWeeks = new Set(weeks.map((w) => w.id));
  const out = [];

  for (const row of rows) {
    const allianceId = toStr(row.allianceId || row.id);
    if (!allianceId) continue;

    for (const [column, cell] of Object.entries(row)) {
      if (!knownWeeks.has(column)) continue; // служебные колонки вроде tag/name пропускаем
      const outcome = toOutcome(cell);
      if (!outcome) continue;
      out.push({ weekId: column, allianceId, outcome });
    }
  }

  return out;
}

export async function getEvents() {
  const rows = await fetchTab(CONFIG.sheets.tabs.events);
  return rows
    .filter((r) => toStr(r.title))
    .map((r, i) => ({
      id: toStr(r.id) || `e${i + 1}`,
      date: toDate(r.date),
      type: toStr(r.type) || 'other',
      serverNumber: toNumber(r.serverNumber) ?? undefined,
      title: toStr(r.title),
      body: toStr(r.body) || undefined,
      imageUrl: toStr(r.imageUrl) || undefined,
      durationDays: toNumber(r.durationDays) ?? undefined,
    }))
    .filter((e) => e.date)
    .sort((a, b) => b.date - a.date);
}

export async function getTexts() {
  const rows = await fetchTab(CONFIG.sheets.tabs.texts);
  return rows
    .filter((r) => toStr(r.key))
    .map((r) => ({
      key: toStr(r.key),
      title: toStr(r.title),
      /*
        Внутри ячейки перевод строки можно записать двумя символами \n.
        Настоящие переносы (Alt+Enter) тоже работают, но многострочная ячейка
        неудобна в редактировании и рвётся при копировании через буфер.
        Поэтому поддерживаем оба варианта.
      */
      body: String(r.body ?? '').replace(/\\n/g, '\n'),
    }));
}
