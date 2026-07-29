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
 * @param {string} weekId
 * @returns {Record<string, 'win'|'loss'> | null}
 */
export function getDraft(weekId) {
  const entry = loadDrafts()[String(weekId)];
  return entry?.marks ?? null;
}

/** @param {string} weekId @param {Record<string, 'win'|'loss'>} marks */
export function saveDraft(weekId, marks) {
  const drafts = loadDrafts();
  drafts[String(weekId)] = { marks, savedAt: new Date().toISOString() };
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
