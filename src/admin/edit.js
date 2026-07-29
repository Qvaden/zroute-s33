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
