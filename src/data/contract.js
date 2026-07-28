/**
 * КОНТРАКТ АДАПТЕРОВ.
 *
 * Это тот механизм, который превращает обещание «источник переключается
 * одной строкой» из намерения в проверяемый факт. Без него расхождение
 * между адаптерами обнаружится ровно в день переезда — то есть в худший
 * из возможных моментов.
 *
 * Используется и в тестах, и в режиме разработки для быстрой диагностики.
 */

// Исходов ровно два: в VS альянс либо победил, либо проиграл.
const OUTCOMES = new Set(['win', 'loss']);

/** @param {unknown} v */
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isDate = (v) => v instanceof Date && !Number.isNaN(v.getTime());

/**
 * Проверяет один набор данных на соответствие доменной модели.
 * Возвращает список проблем. Пустой список — всё в порядке.
 *
 * @param {{alliances: any[], weeks: any[], results: any[], events: any[], texts: any[]}} data
 * @returns {string[]}
 */
export function validateDataset(data) {
  const problems = [];
  const add = (msg) => problems.push(msg);

  for (const key of ['alliances', 'weeks', 'results', 'events', 'texts']) {
    if (!Array.isArray(data[key])) add(`${key}: ожидался массив, пришло ${typeof data[key]}`);
  }
  if (problems.length) return problems;

  const allianceIds = new Set();
  data.alliances.forEach((a, i) => {
    if (!isStr(a.id)) add(`alliances[${i}]: пустой или нестроковый id`);
    if (!isStr(a.tag)) add(`alliances[${i}] (${a.id}): пустой tag`);
    if (!isStr(a.name)) add(`alliances[${i}] (${a.id}): пустой name`);
    if (typeof a.active !== 'boolean') add(`alliances[${i}] (${a.id}): active должен быть boolean`);
    if (allianceIds.has(a.id)) add(`alliances: дубль id «${a.id}»`);
    allianceIds.add(a.id);
  });

  const weekIds = new Set();
  data.weeks.forEach((w, i) => {
    if (!isStr(w.id)) add(`weeks[${i}]: пустой id`);
    if (!Number.isInteger(w.number)) add(`weeks[${i}] (${w.id}): number должен быть целым числом, а не строкой`);
    if (!isDate(w.startDate)) add(`weeks[${i}] (${w.id}): startDate должен быть Date`);
    if (!isDate(w.endDate)) add(`weeks[${i}] (${w.id}): endDate должен быть Date`);
    if (weekIds.has(w.id)) add(`weeks: дубль id «${w.id}»`);
    weekIds.add(w.id);
  });

  const seen = new Set();
  data.results.forEach((r, i) => {
    if (!weekIds.has(r.weekId)) add(`results[${i}]: неизвестная неделя «${r.weekId}»`);
    if (!allianceIds.has(r.allianceId)) add(`results[${i}]: неизвестный альянс «${r.allianceId}»`);
    if (!OUTCOMES.has(r.outcome)) add(`results[${i}]: недопустимый outcome «${r.outcome}»`);
    const key = `${r.weekId}|${r.allianceId}`;
    if (seen.has(key)) add(`results: дубль записи ${key}`);
    seen.add(key);
  });

  data.events.forEach((e, i) => {
    if (!isStr(e.id)) add(`events[${i}]: пустой id`);
    if (!isDate(e.date)) add(`events[${i}] (${e.id}): date должен быть Date`);
    if (!isStr(e.title)) add(`events[${i}] (${e.id}): пустой title`);
  });

  data.texts.forEach((t, i) => {
    if (!isStr(t.key)) add(`texts[${i}]: пустой key`);
    if (typeof t.body !== 'string') add(`texts[${i}] (${t.key}): body должен быть строкой`);
  });

  return problems;
}

/**
 * Забирает из адаптера всё сразу и проверяет контракт.
 * @param {import('./types.js').DataAdapter} adapter
 */
export async function loadAndValidate(adapter) {
  const [alliances, weeks, results, events, texts] = await Promise.all([
    adapter.getAlliances(),
    adapter.getWeeks(),
    adapter.getResults(),
    adapter.getEvents(),
    adapter.getTexts(),
  ]);
  const data = { alliances, weeks, results, events, texts };
  return { data, problems: validateDataset(data) };
}
