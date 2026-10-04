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
 *
 * ПОЧЕМУ У ЧЕРНОВИКА ЕСТЬ СЕРВЕР.
 *   С мультиарендой «W1» перестал быть уникальным: на 33-м и на 44-м свои
 *   недели с одинаковыми именами, и одна и та же клетка значит разное. Без
 *   разделения панель, открытая на чужом сервере, показала бы незаконченную
 *   отметку соседней недели, а «Сбросить» стёр бы чужой ввод. Поэтому все
 *   четыре черновика лежат в папке по номеру сервера.
 *
 *   Рядом с этим — цена молчаливой ошибки. Черновик, который прочитался не из
 *   своей папки, выглядит ровно как свой: те же имена недель, те же теги.
 *   Отсюда и правило удаления: снял черновик на своём сервере — чужие папки
 *   остались нетронутыми.
 *
 * СТАРЫЕ ЧЕРНОВИКИ — СЕРВЕР САЙТА.
 *   До этого шага папок не было, и всё написанное относилось к одному набору —
 *   тому, что в `config.js`. Поэтому плоский черновик при первом чтении
 *   перекладывается под номер сервера сайта и больше не трогается: переезд
 *   происходит один раз, в момент чтения, и не требует, чтобы человек что-то
 *   публиковал или терял ввод.
 *
 * Две цели у одной папки: сервер берётся из `draftServer()` (src/admin/target.js)
 * — тот же источник, что у чтений и записей. Пока права не прочитаны, это сервер
 * сайта, то есть ровно то, чем черновик был до мультиаренды.
 */
import { draftServer } from './target.js';
import { siteServer } from '../data/server.js';

const KEY = 'zr33.admin.drafts';

/** @param {() => any} fn */
function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function readRaw(key) {
  return safe(() => JSON.parse(localStorage.getItem(key) || 'null'), null);
}

function writeRaw(key, value) {
  safe(() => localStorage.setItem(key, JSON.stringify(value)));
}

/*
  Ключ папки — число сервера текстом. Пустое число (в config.js не заполнен)
  получает имя «site»: черновик обязан остаться читаемым, а не исчезнуть из-за
  того, что папку не как назвать.
*/
function folder(server) {
  return server === null || server === undefined ? 'site' : String(server);
}

/** Папка текущего сервера панели. */
function current() {
  return folder(draftServer());
}

/** Папка, куда переезжают черновики без папки: сервер сайта. */
function home() {
  return folder(siteServer());
}

/**
 * Черновики недель, разложенные по серверам, — с переездом старого плоского
 * вида в папку сервера сайта.
 *
 * @returns {Record<string, Record<string, {marks: object, savedAt: string}>>}
 */
function loadBuckets() {
  const parsed = readRaw(KEY);
  if (!parsed || typeof parsed !== 'object') return {};

  // Строка недели всегда имеет `marks`; строка папки — нет. По этому признаку
  // и различаем старый и новый вид, а не по имени ключа: «W31» и «33» выглядят
  // в JSON одинаково.
  const weekEntries = Object.entries(parsed).filter(([, v]) => v && typeof v === 'object' && 'marks' in v);
  if (!weekEntries.length) return parsed;

  const moved = { ...parsed, [home()]: { ...parsed[home()], ...Object.fromEntries(weekEntries) } };
  for (const [id] of weekEntries) delete moved[id];
  writeRaw(KEY, moved);
  return moved;
}

function writeBuckets(buckets) {
  writeRaw(KEY, buckets);
}

/**
 * Незаконченные отметки недели этого сервера.
 *
 * @param {string} weekId
 * @returns {Record<string, 'win'|'loss'> | null}
 */
export function getDraft(weekId) {
  const entry = loadBuckets()[current()]?.[String(weekId)];
  return entry ? entry.marks ?? {} : null;
}

/**
 * @param {string} weekId
 * @param {Record<string, 'win'|'loss'>} marks
 */
export function saveDraft(weekId, marks) {
  const buckets = loadBuckets();
  const scope = current();
  buckets[scope] = { ...buckets[scope], [String(weekId)]: { marks: marks ?? {}, savedAt: new Date().toISOString() } };
  writeBuckets(buckets);
}

/** @param {string} weekId */
export function dropDraft(weekId) {
  const buckets = loadBuckets();
  const scope = current();
  const weeks = buckets[scope];
  if (!weeks || !(String(weekId) in weeks)) return;
  delete weeks[String(weekId)];
  writeBuckets(buckets);
}

/** Когда черновик этой недели трогали последний раз. */
export function draftSavedAt(weekId) {
  const at = loadBuckets()[current()]?.[String(weekId)]?.savedAt;
  return at ? new Date(at) : null;
}

/**
 * Список недель с незаконченным вводом — для значка в шапке.
 *
 * Только своего сервера: значок ведёт по адресу `#/week/<id>`, и неделя из
 * чужой папки открыла бы экран с пустой сеткой вместо обещанного черновика.
 */
export function draftWeekIds() {
  return Object.keys(loadBuckets()[current()] ?? {});
}

/* ── Черновики списков (хронология, альянсы, тексты) ───────────────────────── */

/**
 * События хранятся отдельным черновиком и целым списком, а не по одному.
 *
 * Причина в природе правки: неделю заполняют по клеткам, а летопись правят
 * пачкой — добавил запись, поправил соседнюю, удалил лишнюю — и публикуют
 * это одним действием. Список целиком совпадает с тем, что уедет в базу.
 *
 * Тот же приём у альянсов и текстов.
 *
 * @param {string} key
 * @param {any[]} [list]  Передан — список этого сервера заменяется на него.
 */
function listBucket(key, list) {
  const parsed = readRaw(key);
  // Старый вид: `{ list: [...], savedAt }` без папок. Это сервер сайта.
  const flat = Boolean(parsed) && Array.isArray(parsed.list);
  const buckets = flat ? { [home()]: parsed } : parsed && typeof parsed === 'object' ? parsed : {};

  if (list !== undefined) {
    buckets[current()] = { list, savedAt: new Date().toISOString() };
    writeRaw(key, buckets);
  } else if (flat) {
    /*
      Переезд пишется сразу, а не живёт до первой правки: пока плоский список
      не разложен по папке, каждое чтение приписывает его тому серверу, что
      назван в config.js сегодня. Сменится число — и чужая несохранённая
      летопись выглядела бы как своя.
    */
    writeRaw(key, buckets);
  }
  return buckets;
}

function readList(key) {
  const entry = listBucket(key)[current()];
  return entry && Array.isArray(entry.list) ? entry.list : null;
}

/**
 * Сброс — только своей папки: `removeItem` стёр бы и чужой несохранённый
 * список, а человек на другом сервере потерял бы работу без единого нажатия.
 */
function dropList(key) {
  const buckets = listBucket(key);
  if (!(current() in buckets)) return;
  delete buckets[current()];
  writeRaw(key, buckets);
}

function listSavedAt(key) {
  const at = listBucket(key)[current()]?.savedAt;
  return at ? new Date(at) : null;
}

const EVENTS_KEY = 'zr33.admin.events';
const ALLIANCES_KEY = 'zr33.admin.alliances';
const TEXTS_KEY = 'zr33.admin.texts';

export function getEventsDraft() {
  return readList(EVENTS_KEY);
}

export function saveEventsDraft(list) {
  listBucket(EVENTS_KEY, list);
}

export function dropEventsDraft() {
  dropList(EVENTS_KEY);
}

export function eventsDraftSavedAt() {
  return listSavedAt(EVENTS_KEY);
}

export function getAlliancesDraft() {
  return readList(ALLIANCES_KEY);
}

export function saveAlliancesDraft(list) {
  listBucket(ALLIANCES_KEY, list);
}

export function dropAlliancesDraft() {
  dropList(ALLIANCES_KEY);
}

export function alliancesDraftSavedAt() {
  return listSavedAt(ALLIANCES_KEY);
}

export function getTextsDraft() {
  return readList(TEXTS_KEY);
}

export function saveTextsDraft(list) {
  listBucket(TEXTS_KEY, list);
}

export function dropTextsDraft() {
  dropList(TEXTS_KEY);
}
