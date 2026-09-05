/**
 * ЧТО ИМЕННО ИЗМЕНИЛОСЬ — И ЗАПИСЬ ТОЛЬКО ЭТОГО.
 *
 * Панель устроена так: экраны правят «сырой» объект данных целиком (см. edit.js),
 * а публикация раньше отправляла его в GitHub одним файлом. Файлу было
 * безразлично, поменялась одна клетка или тысяча.
 *
 * Базе не безразлично, и это к лучшему. Отправлять все две тысячи строк при
 * правке одного результата — значит:
 *
 *   1. Забить журнал правок мусором. Вопрос «кто внёс эту неделю» перестанет
 *      иметь ответ: каждая публикация трогает всё.
 *   2. Затирать чужую работу. Двое редакторов, заполняющие разные недели
 *      в один вечер, писали бы каждый свою копию поверх другого — ровно та
 *      беда, от которой файловый подход защищался сверкой версий.
 *
 * Поэтому здесь сравниваются два состояния и пишется только разница. Тогда
 * одновременная правка разных мест не мешает сама себе, а конфликт возможен
 * только там, где двое действительно поменяли одно и то же — и побеждает
 * последний, который видел свежие данные.
 *
 * Функции здесь чистые до самого конца: сравнение возвращает список действий,
 * и только `applyChanges` выходит в сеть. Так разницу можно проверить тестом,
 * не трогая настоящую базу.
 */
import * as store from './store.js';

/**
 * @typedef {Object} Change
 * @property {'alliance'|'week'|'result'|'event'|'text'} entity
 * @property {'save'|'delete'} action
 * @property {string} id      Читаемый идентификатор — он же попадёт в отчёт.
 * @property {any}    [value] Что записать. Для удаления не нужен.
 */

const str = (v) => (v == null ? '' : String(v));

/** Порядок ключей внутри строки на разницу не влияет — сравниваем по значениям. */
function sameResult(a, b) {
  return (
    str(a.outcome) === str(b.outcome) &&
    str(a.opponent) === str(b.opponent) &&
    str(a.comment) === str(b.comment)
  );
}

function sameAlliance(a, b) {
  return (
    str(a.tag) === str(b.tag) &&
    str(a.name) === str(b.name) &&
    str(a.color) === str(b.color) &&
    // Признак «существует сейчас» по умолчанию true: в старых данных его нет.
    (a.active !== false) === (b.active !== false) &&
    str(a.note) === str(b.note) &&
    str(a.mergedInto) === str(b.mergedInto)
  );
}

function sameWeek(a, b) {
  return (
    Number(a.number) === Number(b.number) &&
    dateKey(a.startDate) === dateKey(b.startDate) &&
    dateKey(a.endDate) === dateKey(b.endDate) &&
    str(a.note) === str(b.note)
  );
}

function sameEvent(a, b) {
  return (
    dateKey(a.date) === dateKey(b.date) &&
    str(a.type) === str(b.type) &&
    str(a.serverNumber) === str(b.serverNumber) &&
    str(a.title) === str(b.title) &&
    str(a.summary) === str(b.summary) &&
    str(a.body) === str(b.body) &&
    str(a.durationDays) === str(b.durationDays) &&
    urlsKey(a) === urlsKey(b)
  );
}

/**
 * Ссылки на фото приводим к одному виду перед сравнением.
 *
 * В данных они лежат двумя способами: старое одиночное поле imageUrl
 * и массив imageUrls. Без приведения переход с одного на другой выглядел бы
 * изменением, даже когда фотография та же.
 */
function urlsKey(e) {
  const list = Array.isArray(e.imageUrls) ? e.imageUrls : (e.imageUrl ? [e.imageUrl] : []);
  return list.filter(Boolean).join('|');
}

/**
 * Дата к виду ГГГГ-ММ-ДД.
 *
 * В сыром объекте она бывает и строкой, и Date — смотря кто её положил:
 * выгрузка из таблицы пишет строку, панель может подставить Date. Сравнивать
 * их напрямую нельзя: одна и та же дата в двух видах даст «изменилось».
 */
function dateKey(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  const s = str(value).trim();
  if (!s) return '';
  // «14.07.2026» из таблицы и «2026-07-14» из базы — одна дата.
  const dotted = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotted) return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  return s.slice(0, 10);
}

/** Ключ результата: у него составной идентификатор. */
const resultKey = (r) => `${str(r.weekId)}/${str(r.allianceId)}`;

/**
 * Сравнение двух состояний данных.
 *
 * @param {any} before Что лежит в базе.
 * @param {any} after  Что получилось после правки.
 * @returns {Change[]}
 */
export function diffDataset(before, after) {
  /** @type {Change[]} */
  const changes = [];

  compareById('alliance', before?.alliances, after?.alliances, 'id', sameAlliance, changes);
  compareById('week', before?.weeks, after?.weeks, 'id', sameWeek, changes);
  compareById('event', before?.events, after?.events, 'id', sameEvent, changes);
  compareById('text', before?.texts, after?.texts, 'key', (a, b) =>
    str(a.title) === str(b.title) && str(a.body) === str(b.body), changes);

  /*
    Результаты сравниваем отдельно: у них составной ключ, и удаление здесь
    имеет особый смысл — «результат ещё не внесли», а не «третий исход».
  */
  const oldResults = new Map((before?.results ?? []).map((r) => [resultKey(r), r]));
  const newResults = new Map((after?.results ?? []).map((r) => [resultKey(r), r]));

  for (const [key, row] of newResults) {
    const old = oldResults.get(key);
    if (!old || !sameResult(old, row)) {
      changes.push({ entity: 'result', action: 'save', id: key, value: row });
    }
  }
  for (const key of oldResults.keys()) {
    if (!newResults.has(key)) {
      changes.push({ entity: 'result', action: 'delete', id: key });
    }
  }

  return changes;
}

/**
 * @param {Change['entity']} entity
 * @param {any[]} before
 * @param {any[]} after
 * @param {string} idField
 * @param {(a: any, b: any) => boolean} same
 * @param {Change[]} out
 */
function compareById(entity, before, after, idField, same, out) {
  const oldMap = new Map((before ?? []).map((x) => [str(x[idField]), x]));
  const newList = after ?? [];

  newList.forEach((row, index) => {
    const id = str(row[idField]);
    const old = oldMap.get(id);
    /*
      Порядок альянсов — тоже данные: он задаёт, как они идут в списках.
      Поэтому у альянсов сравнивается и позиция, иначе перестановка местами
      не попала бы в разницу и потерялась при публикации.
    */
    const movedInList =
      entity === 'alliance' && old && (before ?? []).indexOf(old) !== index;

    if (!old || !same(old, row) || movedInList) {
      out.push({ entity, action: 'save', id, value: { ...row, __order: index } });
    }
  });

  const newIds = new Set(newList.map((x) => str(x[idField])));
  for (const id of oldMap.keys()) {
    if (!newIds.has(id)) out.push({ entity, action: 'delete', id });
  }
}

/**
 * Записать разницу в базу.
 *
 * ПОРЯДОК ДЕЙСТВИЙ ЗДЕСЬ ВАЖЕН И ЗАДАН СВЯЗЯМИ МЕЖДУ ТАБЛИЦАМИ.
 *
 * Результат ссылается на неделю и альянс, поэтому:
 *   — сначала добавляем недели и альянсы (иначе результату некуда ссылаться);
 *   — потом результаты;
 *   — удаляем в обратном порядке: сначала результаты, потом то, на что они
 *     ссылались.
 *
 * Обратный порядок упёрся бы в проверку связей, и часть правок прошла бы,
 * а часть нет — то есть данные остались бы в половинчатом состоянии.
 *
 * @param {Change[]} changes
 * @returns {Promise<{done: number, failed: {change: Change, error: string}[]}>}
 */
export async function applyChanges(changes) {
  const failed = [];
  let done = 0;

  const saves = changes.filter((c) => c.action === 'save');
  const deletes = changes.filter((c) => c.action === 'delete');

  const ORDER = ['alliance', 'week', 'text', 'event', 'result'];
  const sortByEntity = (list, reverse = false) =>
    [...list].sort((a, b) => {
      const d = ORDER.indexOf(a.entity) - ORDER.indexOf(b.entity);
      return reverse ? -d : d;
    });

  for (const change of [...sortByEntity(saves), ...sortByEntity(deletes, true)]) {
    try {
      await applyOne(change);
      done++;
    } catch (err) {
      /*
        Одна неудачная строка не останавливает остальные: если у редактора
        отвалилась сеть на середине недели, лучше сохранить двадцать отметок
        из тридцати и честно сказать про десять, чем потерять все тридцать.
        Что не прошло — видно в отчёте, и повтор допишет остальное.
      */
      failed.push({ change, error: String(err?.message ?? err) });
    }
  }

  return { done, failed };
}

/** @param {Change} change */
async function applyOne(change) {
  const { entity, action, id, value } = change;

  if (action === 'delete') {
    if (entity === 'alliance') return store.deleteAlliance(id);
    if (entity === 'week') return store.deleteWeek(id);
    if (entity === 'event') return store.deleteEvent(id);
    if (entity === 'text') return store.deleteText(id);
    if (entity === 'result') {
      const [weekId, allianceId] = id.split('/');
      return store.saveWeekMarks(weekId, { [allianceId]: null });
    }
    throw new Error(`Неизвестный вид записи: ${entity}`);
  }

  if (entity === 'alliance') return store.saveAlliance(value, value.__order);
  if (entity === 'week') return store.saveWeek(value);
  if (entity === 'event') return store.saveEvent(value);
  if (entity === 'text') return store.saveText(value);
  if (entity === 'result') {
    return store.saveWeekMarks(value.weekId, { [value.allianceId]: value.outcome });
  }
  throw new Error(`Неизвестный вид записи: ${entity}`);
}

/**
 * Человеческое описание разницы — то, что раньше было сообщением коммита.
 *
 * Показывается ДО публикации: человек должен видеть, что именно уйдёт в базу,
 * особенно когда видит там неожиданное. «Удалится 3 записи» вместо тихого
 * удаления — единственный способ поймать свою же ошибку до, а не после.
 *
 * @param {Change[]} changes
 */
export function describeChanges(changes) {
  if (!changes.length) return 'Изменений нет — публиковать нечего.';

  const NAMES = {
    alliance: ['альянс', 'альянса', 'альянсов'],
    week: ['неделя', 'недели', 'недель'],
    result: ['результат', 'результата', 'результатов'],
    event: ['запись', 'записи', 'записей'],
    text: ['текст', 'текста', 'текстов'],
  };

  const parts = [];
  for (const [entity, forms] of Object.entries(NAMES)) {
    const saved = changes.filter((c) => c.entity === entity && c.action === 'save').length;
    const removed = changes.filter((c) => c.entity === entity && c.action === 'delete').length;

    if (saved) parts.push(`${saved} ${pick(saved, forms)}`);
    if (removed) parts.push(`удалится ${removed} ${pick(removed, forms)}`);
  }

  return parts.join(', ');
}

function pick(n, [one, few, many]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
