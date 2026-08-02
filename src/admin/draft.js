/**
 * ЧЕРНОВИКИ — незаконченный ввод, переживающий закрытую вкладку.
 *
 * Зачем это вообще нужно. Неделю заполняют с телефона, сразу после VS,
 * посреди переписки с альянсом: звонок, переключение приложения, случайный
 * свайп назад — и тридцать заполненных клеток исчезли. Человек, потерявший
 * работу дважды, возвращается к таблице и больше в панель не заходит.
 *
 * Поэтому каждая отметка сразу пишется в localStorage. Черновики хранятся
 * по неделям: переключение на другую неделю не должно ничего стирать.
 */
const KEY = 'zr33.admin.drafts';

/** @param {() => any} fn */
function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** @returns {Record<string, {marks: Record<string, 'win'|'loss'>, savedAt: string}>} */
export function loadDrafts() {
  const parsed = safe(() => JSON.parse(localStorage.getItem(KEY) || '{}'), {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeDrafts(drafts) {
  safe(() => localStorage.setItem(KEY, JSON.stringify(drafts)));
}

/**
 * Незаконченные отметки недели.
 *
 * @param {string} weekId
 * @returns {Record<string, 'win'|'loss'> | null}
 */
export function getDraft(weekId) {
  const entry = loadDrafts()[String(weekId)];
  return entry ? entry.marks ?? {} : null;
}

/**
 * @param {string} weekId
 * @param {Record<string, 'win'|'loss'>} marks
 */
export function saveDraft(weekId, marks) {
  const drafts = loadDrafts();
  drafts[String(weekId)] = { marks: marks ?? {}, savedAt: new Date().toISOString() };
  writeDrafts(drafts);
}

/** @param {string} weekId */
export function dropDraft(weekId) {
  const drafts = loadDrafts();
  delete drafts[String(weekId)];
  writeDrafts(drafts);
}

/** Когда черновик этой недели трогали последний раз. */
export function draftSavedAt(weekId) {
  const at = loadDrafts()[String(weekId)]?.savedAt;
  return at ? new Date(at) : null;
}

/** Список недель с незаконченным вводом — для значка в шапке. */
export function draftWeekIds() {
  return Object.keys(loadDrafts());
}

/* ── Черновик хронологии ──────────────────────────────────────────────────── */

/**
 * События хранятся отдельным черновиком и целым списком, а не по одному.
 *
 * Причина в природе правки: неделю заполняют по клеткам, а летопись правят
 * пачкой — добавил запись, поправил соседнюю, удалил лишнюю — и публикуют
 * это одним коммитом. Список целиком совпадает с тем, что уедет в файл.
 */
const EVENTS_KEY = 'zr33.admin.events';

export function getEventsDraft() {
  const parsed = safe(() => JSON.parse(localStorage.getItem(EVENTS_KEY) || 'null'), null);
  return parsed && Array.isArray(parsed.list) ? parsed.list : null;
}

export function saveEventsDraft(list) {
  safe(() => localStorage.setItem(EVENTS_KEY, JSON.stringify({ list, savedAt: new Date().toISOString() })));
}

export function dropEventsDraft() {
  safe(() => localStorage.removeItem(EVENTS_KEY));
}

export function eventsDraftSavedAt() {
  const at = safe(() => JSON.parse(localStorage.getItem(EVENTS_KEY) || 'null'), null)?.savedAt;
  return at ? new Date(at) : null;
}

/* ── Черновик альянсов ──────────────────────────────────────────────────────── */

/**
 * Тот же приём, что и у черновика хронологии: список альянсов целиком,
 * а не по одному. Правят их так же пачкой — добавил, переименовал,
 * деактивировал распавшийся, удалил лишний, — и публикуют разом.
 */
const ALLIANCES_KEY = 'zr33.admin.alliances';

export function getAlliancesDraft() {
  const parsed = safe(() => JSON.parse(localStorage.getItem(ALLIANCES_KEY) || 'null'), null);
  return parsed && Array.isArray(parsed.list) ? parsed.list : null;
}

export function saveAlliancesDraft(list) {
  safe(() => localStorage.setItem(ALLIANCES_KEY, JSON.stringify({ list, savedAt: new Date().toISOString() })));
}

export function dropAlliancesDraft() {
  safe(() => localStorage.removeItem(ALLIANCES_KEY));
}

export function alliancesDraftSavedAt() {
  const at = safe(() => JSON.parse(localStorage.getItem(ALLIANCES_KEY) || 'null'), null)?.savedAt;
  return at ? new Date(at) : null;
}
