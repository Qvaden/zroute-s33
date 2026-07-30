/**
 * ЛОГИКА ПРАВКИ — чистые функции над сырым JSON.
 *
 * Здесь нет ни сети, ни DOM, ни localStorage: только «взять данные и отметки,
 * вернуть новые данные». Ровно поэтому публикацию можно проверить тестом
 * целиком, не поднимая браузер и не трогая настоящий репозиторий, — а это
 * единственный код в проекте, который способен испортить накопленную историю.
 */
import { plural } from '../ui/helpers.js';
import { SERVER_OUTCOME } from '../logic/server-outcome.js';
import { toDate } from '../data/adapters/_coerce.js';

/**
 * Формат файла обязан совпадать с тем, что пишет scripts/pull-sheet.mjs:
 * два пробела отступа и перевод строки в конце. Иначе первый же коммит
 * панели покажет в истории «изменён весь файл» вместо одной недели.
 *
 * @param {any} raw
 */
export function serialize(raw) {
  return JSON.stringify(raw, null, 2) + '\n';
}

/**
 * Отметки недели, какие они сейчас в данных.
 * @returns {Record<string, 'win'|'loss'>}
 */
export function marksFromRaw(raw, weekId) {
  const out = {};
  for (const r of raw?.results ?? []) {
    if (String(r.weekId) !== String(weekId)) continue;
    const outcome = normalize(r.outcome);
    if (outcome) out[String(r.allianceId)] = outcome;
  }
  return out;
}

/**
 * Исход приводим к 'win' / 'loss'.
 *
 * В файле он может лежать в двух видах: выгрузка из таблицы пишет
 * английские слова, а генератор демо-данных — русские П и Х, как в таблице.
 * Панель обязана понимать оба и писать всегда одинаково.
 */
function normalize(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (['win', 'п', 'w', '+', '1', 'победа'].includes(s)) return 'win';
  if (['loss', 'х', 'x', '-', '0', 'поражение'].includes(s)) return 'loss';
  return null;
}

/**
 * Применяет отметки недели к данным и возвращает НОВЫЙ объект.
 *
 * Три вещи, которые здесь важны и легко потерять:
 *
 * 1. Результаты остальных недель не трогаются вообще.
 * 2. Пустая отметка удаляет запись, а не пишет третий исход. Отсутствие
 *    записи означает «не внесли» — см. рассуждение в types.js.
 * 3. Порядок канонический: недели в порядке из weeks, альянсы в порядке
 *    из alliances. Так правка одной недели даёт в истории гита один
 *    компактный блок, а не перетасованный файл.
 *
 * @param {any} raw
 * @param {string} weekId
 * @param {Record<string, 'win'|'loss'|null>} marks
 */
export function applyMarks(raw, weekId, marks) {
  const weekOrder = new Map((raw?.weeks ?? []).map((w, i) => [String(w.id), i]));
  const allyOrder = new Map((raw?.alliances ?? []).map((a, i) => [String(a.id), i]));

  const all = raw?.results ?? [];
  const kept = all.filter((r) => String(r.weekId) !== String(weekId));

  // Прошлые записи этой недели нужны, чтобы не потерять opponent и comment,
  // если их однажды начнут заполнять: панель правит исход, а не всю запись.
  const previous = new Map(
    all.filter((r) => String(r.weekId) === String(weekId)).map((r) => [String(r.allianceId), r])
  );

  const fresh = Object.entries(marks ?? {})
    .filter(([, outcome]) => outcome === 'win' || outcome === 'loss')
    .map(([allianceId, outcome]) => {
      const prev = previous.get(String(allianceId));
      return prev
        ? { ...prev, outcome }
        : { weekId: String(weekId), allianceId: String(allianceId), outcome };
    });

  const rank = (r) => [
    weekOrder.get(String(r.weekId)) ?? Number.MAX_SAFE_INTEGER,
    allyOrder.get(String(r.allianceId)) ?? Number.MAX_SAFE_INTEGER,
  ];

  const merged = [...kept, ...fresh].sort((a, b) => {
    const [aw, aa] = rank(a);
    const [bw, ba] = rank(b);
    return aw - bw || aa - ba;
  });

  return { ...raw, results: merged };
}

/**
 * Что именно изменится при публикации.
 *
 * Нужно не для красоты: человек должен видеть «удалится 3» до нажатия,
 * а не после. Удаление результата — единственное необратимое действие
 * в панели, которое легко сделать случайно, промахнувшись по клетке.
 */
export function diffMarks(raw, weekId, marks) {
  const before = marksFromRaw(raw, weekId);
  const after = marks ?? {};
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);

  let added = 0;
  let changed = 0;
  let removed = 0;

  for (const id of ids) {
    const was = before[id] ?? null;
    const now = after[id] === 'win' || after[id] === 'loss' ? after[id] : null;
    if (was === now) continue;
    if (was === null) added++;
    else if (now === null) removed++;
    else changed++;
  }

  return { added, changed, removed, total: added + changed + removed };
}

/**
 * Итог недели на уровне сервера, какой он сейчас в данных.
 * @returns {{outcome: string|null, serverNumber: number|null}}
 */
export function weekOutcomeOf(raw, weekId) {
  const week = (raw?.weeks ?? []).find((w) => String(w.id) === String(weekId));
  return {
    outcome: week?.serverOutcome ?? null,
    serverNumber: week?.serverNumber ?? null,
  };
}

/**
 * Применяет итог недели и возвращает НОВЫЙ объект.
 *
 * Пустой итог удаляет поля целиком, а не пишет пустую строку: «не воевали»
 * и «не внесли» — это отсутствие данных, и в файле оно должно выглядеть
 * отсутствием, иначе валидатор начнёт спорить с пустой строкой.
 *
 * @param {any} raw
 * @param {string} weekId
 * @param {string|null} outcome 'captured' | 'not_captured' | 'held' | 'lost' | null
 * @param {number|null} [serverNumber]
 */
export function applyOutcome(raw, weekId, outcome, serverNumber) {
  const weeks = (raw?.weeks ?? []).map((w) => {
    if (String(w.id) !== String(weekId)) return w;

    const next = { ...w };
    delete next.serverOutcome;
    delete next.serverNumber;

    if (outcome) {
      next.serverOutcome = outcome;
      if (Number.isFinite(Number(serverNumber)) && serverNumber !== null && serverNumber !== '') {
        next.serverNumber = Number(serverNumber);
      }
    }
    return next;
  });

  return { ...raw, weeks };
}

/** Изменился ли итог недели по сравнению с тем, что в данных. */
export function outcomeDiffers(raw, weekId, outcome, serverNumber) {
  const before = weekOutcomeOf(raw, weekId);
  const nowNumber =
    outcome && Number.isFinite(Number(serverNumber)) && serverNumber !== null && serverNumber !== ''
      ? Number(serverNumber)
      : null;

  return before.outcome !== (outcome || null) || before.serverNumber !== nowNumber;
}

/* ── События хронологии ───────────────────────────────────────────────────── */

/**
 * Типы событий. Захват сервера — не то же самое, что итог недели: итог это
 * недельный счёт, а событие — веха с датой, рассказом и длительностью, которая
 * может тянуться через несколько недель.
 */
export const EVENT_TYPE = {
  server_capture: 'Захват сервера',
  war: 'Война',
  merge: 'Слияние альянсов',
  other: 'Событие',
};

export const EVENT_TYPE_ORDER = ['server_capture', 'war', 'merge', 'other'];

/** «2026-07-19» — формат, который понимают и файл, и input type=date. */
function isoDay(value) {
  const d = toDate(value);
  return d ? d.toISOString().slice(0, 10) : '';
}

/**
 * События в виде, удобном для формы: даты строками, числа числами.
 *
 * Порядок — свежие сверху, как их читают. В файле порядок обратный,
 * см. applyEvents.
 */
export function eventsFromRaw(raw) {
  return (raw?.events ?? [])
    .map((e) => ({
      id: String(e.id ?? ''),
      date: isoDay(e.date),
      type: EVENT_TYPE[String(e.type)] ? String(e.type) : 'other',
      serverNumber: e.serverNumber != null && e.serverNumber !== '' ? Number(e.serverNumber) : null,
      title: String(e.title ?? ''),
      body: String(e.body ?? ''),
      imageUrl: String(e.imageUrl ?? ''),
      durationDays: e.durationDays != null && e.durationDays !== '' ? Number(e.durationDays) : null,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Пустая заготовка события для формы. */
export function blankEvent() {
  return {
    id: null,
    date: '',
    type: 'server_capture',
    serverNumber: null,
    title: '',
    body: '',
    imageUrl: '',
    durationDays: null,
  };
}

/**
 * Свободный идентификатор события.
 *
 * Считаем от максимального занятого номера, а не от количества записей:
 * после удаления середины счёт по количеству выдал бы уже занятый id,
 * и валидатор справедливо пожаловался бы на дубль.
 */
export function nextEventId(raw, list) {
  const used = new Set([
    ...(raw?.events ?? []).map((e) => String(e.id)),
    ...(list ?? []).map((e) => String(e.id)),
  ]);

  let max = 0;
  for (const id of used) {
    const m = /^e(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }

  let n = max + 1;
  while (used.has(`e${n}`)) n++;
  return `e${n}`;
}

/**
 * Человеческие проверки до публикации.
 *
 * Валидатор сайта поймает пустой заголовок и битую дату и сам, но скажет это
 * языком доменной модели — «events[3] (e07): пустой title». Здесь то же самое
 * говорится про поле, которое человек прямо сейчас видит перед собой.
 *
 * @returns {string[]} пустой список — можно сохранять
 */
export function eventProblems(ev) {
  const problems = [];

  if (!isoDay(ev?.date)) problems.push('Не заполнена дата.');
  if (!String(ev?.title ?? '').trim()) problems.push('Не заполнен заголовок.');
  if (!EVENT_TYPE[String(ev?.type)]) problems.push('Не выбран тип события.');

  const num = ev?.serverNumber;
  if (num !== null && num !== '' && num !== undefined && !Number.isFinite(Number(num))) {
    problems.push('Номер сервера должен быть числом.');
  }

  const days = ev?.durationDays;
  if (days !== null && days !== '' && days !== undefined && !(Number(days) > 0)) {
    problems.push('Длительность должна быть числом больше нуля.');
  }

  const url = String(ev?.imageUrl ?? '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    problems.push('Ссылка на картинку должна начинаться с http:// или https://');
  }

  return problems;
}

/**
 * Записывает список событий в данные.
 *
 * В файле события лежат от старых к новым: летопись так и читается, а новая
 * запись дописывается в конец и даёт в истории гита одну добавленную строку
 * вместо перетасованного массива.
 */
export function applyEvents(raw, list) {
  const events = (list ?? [])
    .map((e) => {
      const out = {
        id: String(e.id),
        date: isoDay(e.date),
        type: String(e.type),
        title: String(e.title).trim(),
      };
      // Необязательные поля не пишем пустыми: файл читают люди.
      if (Number.isFinite(Number(e.serverNumber)) && e.serverNumber !== null && e.serverNumber !== '') {
        out.serverNumber = Number(e.serverNumber);
      }
      if (String(e.body ?? '').trim()) out.body = String(e.body).trim();
      if (String(e.imageUrl ?? '').trim()) out.imageUrl = String(e.imageUrl).trim();
      if (Number(e.durationDays) > 0) out.durationDays = Number(e.durationDays);
      return out;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return { ...raw, events };
}

/** Что изменится в событиях при публикации. */
export function eventsDiff(raw, list) {
  const before = new Map(eventsFromRaw(raw).map((e) => [e.id, e]));
  const after = new Map((list ?? []).map((e) => [String(e.id), e]));

  let added = 0;
  let changed = 0;
  let removed = 0;

  for (const [id, ev] of after) {
    const was = before.get(id);
    if (!was) {
      added++;
      continue;
    }
    const same = ['date', 'type', 'title', 'body', 'imageUrl'].every(
      (k) => String(was[k] ?? '') === String(ev[k] ?? '')
    );
    const sameNums =
      Number(was.serverNumber ?? 0) === Number(ev.serverNumber ?? 0) &&
      Number(was.durationDays ?? 0) === Number(ev.durationDays ?? 0);
    if (!same || !sameNums) changed++;
  }

  for (const id of before.keys()) if (!after.has(id)) removed++;

  return { added, changed, removed, total: added + changed + removed };
}

/** Сообщение коммита для правки хронологии. */
export function eventsCommitMessage(diff) {
  const parts = [];
  if (diff.added) parts.push(plural(diff.added, 'запись', 'записи', 'записей'));
  if (diff.changed) parts.push(`${plural(diff.changed, 'правка', 'правки', 'правок')}`);
  if (diff.removed) parts.push(`удалено ${diff.removed}`);

  return `хронология: ${parts.length ? parts.join(', ') : 'без изменений'}`;
}

/** Сколько побед и поражений в отметках. */
export function countMarks(marks) {
  const values = Object.values(marks ?? {});
  return {
    wins: values.filter((o) => o === 'win').length,
    losses: values.filter((o) => o === 'loss').length,
  };
}

/**
 * Сообщение коммита.
 *
 * Пишем по-человечески и без служебных префиксов: историю этого репозитория
 * читают не программисты, а автор правки и так виден в подписи коммита.
 *
 * @param {{number: number}} week
 * @param {Record<string, 'win'|'loss'|null>} marks
 * @param {{outcome?: string|null, serverNumber?: number|null}} [server] Итог недели.
 */
export function commitMessage(week, marks, server) {
  const { wins, losses } = countMarks(marks);
  const head = `неделя ${week?.number ?? '?'}`;

  const scores =
    wins === 0 && losses === 0
      ? 'результаты убраны'
      : `${plural(wins, 'победа', 'победы', 'побед')}, ${plural(
          losses,
          'поражение',
          'поражения',
          'поражений'
        )}`;

  /*
    Итог сервера дописываем в то же сообщение, а не отдельным коммитом:
    заполняют их вместе, одним нажатием, и в истории они тоже должны
    стоять рядом.
  */
  const tail = server?.outcome ? `, ${SERVER_OUTCOME[server.outcome]?.commit ?? server.outcome}` : '';
  const target = server?.outcome && server?.serverNumber ? ` ${server.serverNumber}` : '';

  return `${head}: ${scores}${tail}${target}`;
}
