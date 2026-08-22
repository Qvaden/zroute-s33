/**
 * ЛОГИКА ПРАВКИ — чистые функции над сырым JSON.
 *
 * Здесь нет ни сети, ни DOM, ни localStorage: только «взять данные и отметки,
 * вернуть новые данные». Ровно поэтому публикацию можно проверить тестом
 * целиком, не поднимая браузер и не трогая настоящий репозиторий, — а это
 * единственный код в проекте, который способен испортить накопленную историю.
 */
import { plural } from '../ui/helpers.js';
import { toDate } from '../data/adapters/_coerce.js';
import { EVENT_TYPE, EVENT_TYPE_ORDER } from '../logic/event-types.js';

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

/* ── События хронологии ───────────────────────────────────────────────────── */

/*
  Словарь типов событий один на сайт и на панель — он в logic/event-types.js.
  Здесь только пробрасываем его дальше, чтобы экраны не тянули два импорта
  ради одного списка.
*/
export { EVENT_TYPE, EVENT_TYPE_ORDER };

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
      summary: String(e.summary ?? ''),
      body: String(e.body ?? ''),
      imageUrl: String(e.imageUrl ?? ''),
      imageUrls: Array.isArray(e.imageUrls)
        ? e.imageUrls.map((url) => String(url ?? '')).filter(Boolean)
        : (String(e.imageUrl ?? '').trim() ? [String(e.imageUrl).trim()] : []),
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
    summary: '',
    body: '',
    imageUrl: '',
    imageUrls: [],
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

  const urls = Array.isArray(ev?.imageUrls) && ev.imageUrls.length
    ? ev.imageUrls.map((url) => String(url ?? '').trim()).filter(Boolean)
    : (String(ev?.imageUrl ?? '').trim() ? [String(ev.imageUrl).trim()] : []);
  if (urls.some((url) => !/^https?:\/\//i.test(url))) {
    problems.push('Каждая ссылка на картинку должна начинаться с http:// или https://');
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
      summary: String(e.summary ?? '').trim(),
    };
      // Необязательные поля не пишем пустыми: файл читают люди.
      if (Number.isFinite(Number(e.serverNumber)) && e.serverNumber !== null && e.serverNumber !== '') {
        out.serverNumber = Number(e.serverNumber);
      }
      if (String(e.summary ?? '').trim()) out.summary = String(e.summary).trim();
      if (String(e.body ?? '').trim()) out.body = String(e.body).trim();
      const imageUrls = Array.isArray(e.imageUrls)
        ? e.imageUrls.map((url) => String(url ?? '').trim()).filter(Boolean)
        : (String(e.imageUrl ?? '').trim() ? [String(e.imageUrl).trim()] : []);
      if (imageUrls.length === 1) out.imageUrl = imageUrls[0];
      if (imageUrls.length > 1) out.imageUrls = imageUrls;
      if (Number(e.durationDays) > 0) out.durationDays = Number(e.durationDays);
      return out;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return { ...raw, events };
}

/**
 * Что изменится в событиях при публикации.
 *
 * `_pendingImage` — картинка, выбранная в форме, но ещё не загруженная
 * в репозиторий (загрузка отложена до нажатия «Опубликовать», см. main.js).
 * Пока она висит, imageUrl в записи ещё старый или пустой, и без этой
 * проверки правка «поменял только картинку» не считалась бы изменением
 * вовсе — кнопка публикации осталась бы выключенной.
 */
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
    const oldImages = Array.isArray(was.imageUrls) ? was.imageUrls : (was.imageUrl ? [was.imageUrl] : []);
    const newImages = Array.isArray(ev.imageUrls) ? ev.imageUrls : (ev.imageUrl ? [ev.imageUrl] : []);
    const same = ['date', 'type', 'title', 'summary', 'body'].every(
      (k) => String(was[k] ?? '') === String(ev[k] ?? '')
    ) && JSON.stringify(oldImages) === JSON.stringify(newImages);
    const sameNums =
      Number(was.serverNumber ?? 0) === Number(ev.serverNumber ?? 0) &&
      Number(was.durationDays ?? 0) === Number(ev.durationDays ?? 0);
    if (!same || !sameNums || ev._pendingImages?.length || ev._pendingImage) changed++;
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
 */
export function commitMessage(week, marks) {
  const { wins, losses } = countMarks(marks);
  const head = `неделя ${week?.number ?? '?'}`;

  if (wins === 0 && losses === 0) return `${head}: результаты убраны`;

  return `${head}: ${plural(wins, 'победа', 'победы', 'побед')}, ${plural(
    losses,
    'поражение',
    'поражения',
    'поражений'
  )}`;
}

/* ── Альянсы ─────────────────────────────────────────────────────────────── */

/**
 * Альянсы в виде, удобном для формы и списка.
 *
 * Порядок — как в файле, без пересортировки. В отличие от хронологии, у
 * альянсов нет естественного ключа вроде даты: пересортировка при каждой
 * правке развела бы в истории гита «поправили один альянс» и «перетасовался
 * весь список» — ровно то, чего правило канонического порядка в applyMarks
 * избегает для результатов недели.
 */
export function alliancesFromRaw(raw) {
  return (raw?.alliances ?? []).map((a) => ({
    id: String(a.id ?? ''),
    tag: String(a.tag ?? ''),
    name: String(a.name ?? ''),
    color: String(a.color ?? ''),
    active: a.active !== false,
    note: String(a.note ?? ''),
    mergedInto: String(a.mergedInto ?? ''),
  }));
}

/**
 * Пустая заготовка альянса для формы.
 *
 * Цвет — тот же нейтральный оттенок, которым сайт заменяет отсутствующий
 * цвет (`a.color || '#7a8494'` в screens/week.js и в подсчёте рейтинга):
 * свежедобавленный альянс не остаётся серым сиротой, а полю есть с чего
 * начать выбор — нативный `<input type="color">` не умеет быть пустым.
 */
export function blankAlliance() {
  return {
    id: null,
    tag: '',
    name: '',
    color: '#7a8494',
    active: true,
    note: '',
    mergedInto: '',
  };
}

/**
 * Свободный идентификатор альянса — тот же принцип, что и у nextEventId:
 * следующий за максимальным ЗАНЯТЫМ номером, а не по количеству записей.
 * Счёт по количеству после удаления альянса из середины выдал бы уже
 * занятый id.
 *
 * В отличие от событий (e1, e2…), существующие 32 альянса пронумерованы
 * с ведущим нулём (a01…a32) — это уже сложившийся формат в data/live.json,
 * и новый id обязан ему следовать, иначе список вперемешку читался бы хуже.
 * padStart ничего не обрежет и после a99: там ведущий ноль просто не нужен.
 */
export function nextAllianceId(raw, list) {
  const used = new Set([
    ...(raw?.alliances ?? []).map((a) => String(a.id)),
    ...(list ?? []).map((a) => String(a.id)),
  ]);

  let max = 0;
  for (const id of used) {
    const m = /^a(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }

  let n = max + 1;
  while (used.has(`a${String(n).padStart(2, '0')}`)) n++;
  return `a${String(n).padStart(2, '0')}`;
}

/**
 * Сколько результатов VS в данных ссылаются на этот альянс.
 *
 * Единственное число, вокруг которого построена защита от удаления: пока
 * оно больше нуля, сайт физически не откроется на данных, где альянс исчез,
 * а результат всё ещё называет его id, — это ловит валидатор контракта
 * (src/data/contract.js: «результат: неизвестный альянс»). Поэтому кнопка
 * «Удалить» показывается только при нуле, а иначе панель предлагает
 * деактивировать: истории это не касается вовсе.
 */
export function allianceResultsCount(raw, allianceId) {
  return (raw?.results ?? []).filter((r) => String(r.allianceId) === String(allianceId)).length;
}

/**
 * Человеческие проверки до сохранения в список.
 *
 * @param {any} a
 * @param {any[]} others Остальные альянсы рабочего списка (без самого себя) —
 *   нужны только для проверки на занятый тег.
 * @returns {string[]} пустой список — можно сохранять
 */
export function allianceProblems(a, others) {
  const problems = [];

  if (!String(a?.tag ?? '').trim()) problems.push('Не заполнен тег.');
  if (!String(a?.name ?? '').trim()) problems.push('Не заполнено название.');

  const color = String(a?.color ?? '').trim();
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
    problems.push('Цвет должен быть в формате HEX, например #d44949.');
  }

  const tag = String(a?.tag ?? '').trim().toLowerCase();
  if (tag && (others ?? []).some((o) => String(o?.tag ?? '').trim().toLowerCase() === tag)) {
    problems.push('Такой тег уже занят другим альянсом.');
  }

  const mergedInto = String(a?.mergedInto ?? '').trim();
  if (mergedInto) {
    if (mergedInto === String(a?.id ?? '')) {
      problems.push('Альянс не может слиться сам с собой.');
    } else if (!(others ?? []).some((o) => String(o?.id ?? '') === mergedInto)) {
      problems.push('Альянс, в который слились, не найден в списке.');
    }
  }

  return problems;
}

/**
 * Записывает список альянсов в данные.
 *
 * Порядок — как в рабочем списке (новые дописываются в конец): так добавление
 * одного альянса даёт в истории гита одну добавленную строку, а не
 * перетасованный файл целиком.
 */
export function applyAlliances(raw, list) {
  const alliances = (list ?? []).map((a) => {
    const mergedInto = String(a.mergedInto ?? '').trim();

    const out = {
      id: String(a.id),
      tag: String(a.tag).trim(),
      name: String(a.name).trim(),
      // Слившийся альянс обязан быть неактивным независимо от того, что
      // выбрано в форме, — иначе получится альянс, который одновременно
      // «в игре» и «вошёл в другой». Проверка здесь — та же вторая линия
      // защиты, что и у allianceResultsCount при удалении.
      active: mergedInto ? false : a.active !== false,
    };
    // Необязательные поля не пишем пустыми: файл читают люди.
    if (String(a.color ?? '').trim()) out.color = String(a.color).trim();
    if (String(a.note ?? '').trim()) out.note = String(a.note).trim();
    if (mergedInto) out.mergedInto = mergedInto;
    return out;
  });

  return { ...raw, alliances };
}

/**
 * Что изменится в альянсах при публикации.
 *
 * Деактивация считается правкой, а не отдельной категорией: `active` —
 * такое же поле альянса, как тег или цвет, и диф должен видеть его смену.
 */
export function alliancesDiff(raw, list) {
  const before = new Map(alliancesFromRaw(raw).map((a) => [a.id, a]));
  const after = new Map((list ?? []).map((a) => [String(a.id), a]));

  let added = 0;
  let changed = 0;
  let removed = 0;

  for (const [id, a] of after) {
    const was = before.get(id);
    if (!was) {
      added++;
      continue;
    }
    const same =
      ['tag', 'name', 'color', 'note', 'mergedInto'].every((k) => String(was[k] ?? '') === String(a[k] ?? '')) &&
      Boolean(was.active) === Boolean(a.active);
    if (!same) changed++;
  }

  for (const id of before.keys()) if (!after.has(id)) removed++;

  return { added, changed, removed, total: added + changed + removed };
}

/** Сообщение коммита для правки альянсов. */
export function alliancesCommitMessage(diff) {
  const parts = [];
  if (diff.added) parts.push(plural(diff.added, 'новый альянс', 'новых альянса', 'новых альянсов'));
  if (diff.changed) parts.push(plural(diff.changed, 'правка', 'правки', 'правок'));
  if (diff.removed) parts.push(`удалено ${diff.removed}`);

  return `альянсы: ${parts.length ? parts.join(', ') : 'без изменений'}`;
}

/* ── Тексты ──────────────────────────────────────────────────────────────── */

/**
 * Известные ключи, которые сейчас читает сайт (src/pages/guide.js). Список
 * не жёсткий: у текста нет проверки формата ключа, страница просто не найдёт
 * незнакомый и промолчит. Но подсказать редактору правильное имя — дешевле,
 * чем потом объяснять, почему раздел на сайте не появился.
 */
export const KNOWN_TEXT_KEYS = ['guide-intro', 'guide-principles', 'guide-week', 'guide-donts', 'guide-benefits'];

/** Тексты в виде, удобном для формы и списка. Порядок — как в файле. */
export function textsFromRaw(raw) {
  return (raw?.texts ?? []).map((t) => ({
    key: String(t.key ?? ''),
    title: String(t.title ?? ''),
    body: String(t.body ?? ''),
  }));
}

/**
 * Пустая заготовка текста для формы.
 *
 * `originalKey` — единственное поле, которого нет в самих данных: пока
 * оно `null`, ключ ещё можно набрать руками, а форма показывает поле ввода.
 * Как только текст сохранён хотя бы раз, `originalKey` фиксирует ключ,
 * и дальше он только показан — так же, как id у альянса. Ключ — это то,
 * что ищет на странице src/pages/guide.js; переименовать его вручную —
 * молча потерять раздел на сайте, а не переименовать его.
 */
export function blankText() {
  return { originalKey: null, key: '', title: '', body: '' };
}

/**
 * Человеческие проверки до сохранения в список.
 *
 * @param {any} t Уже с разрешённым ключом (originalKey ?? key).
 * @param {any[]} others Остальные тексты рабочего списка (без самого себя).
 */
export function textProblems(t, others) {
  const problems = [];

  if (!String(t?.key ?? '').trim()) problems.push('Не заполнен ключ.');

  const key = String(t?.key ?? '').trim();
  if (key && (others ?? []).some((o) => String(o?.key ?? '') === key)) {
    problems.push('Такой ключ уже занят другим текстом.');
  }

  return problems;
}

/** Записывает список текстов в данные. Порядок — как в рабочем списке. */
export function applyTexts(raw, list) {
  const texts = (list ?? []).map((t) => ({
    key: String(t.key).trim(),
    title: String(t.title ?? '').trim(),
    body: String(t.body ?? ''),
  }));

  return { ...raw, texts };
}

/** Что изменится в текстах при публикации. */
export function textsDiff(raw, list) {
  const before = new Map(textsFromRaw(raw).map((t) => [t.key, t]));
  const after = new Map((list ?? []).map((t) => [String(t.key), t]));

  let added = 0;
  let changed = 0;
  let removed = 0;

  for (const [key, t] of after) {
    const was = before.get(key);
    if (!was) {
      added++;
      continue;
    }
    const same = ['title', 'body'].every((k) => String(was[k] ?? '') === String(t[k] ?? ''));
    if (!same) changed++;
  }

  for (const key of before.keys()) if (!after.has(key)) removed++;

  return { added, changed, removed, total: added + changed + removed };
}

/** Сообщение коммита для правки текстов. */
export function textsCommitMessage(diff) {
  const parts = [];
  if (diff.added) parts.push(plural(diff.added, 'новый блок', 'новых блока', 'новых блоков'));
  if (diff.changed) parts.push(plural(diff.changed, 'правка', 'правки', 'правок'));
  if (diff.removed) parts.push(`удалено ${diff.removed}`);

  return `тексты: ${parts.length ? parts.join(', ') : 'без изменений'}`;
}
