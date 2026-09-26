/**
 * ТИХИЕ ЧАСЫ — правило молчания и его зеркало для сервисного работника.
 *
 * Будит игрока ровно одна вещь: оповещение браузера. Web Push показывает его
 * `sw.js`, когда вкладка закрыта, а открытый чат будит сам, без работника
 * (см. `src/forum/chats.js`). Лента колокольчика не будит ничего — она ждёт,
 * пока человек зайдёт сам. Значит и тихие часы решают одно: показывать
 * оповещение или нет. Ни откладывать, ни досылать утром они не могут, и не
 * пытаются: строка уведомления стоит в ленте с той самой минуты, как появилась.
 *
 * Почему правило живёт на устройстве, а не в базе и не в `send-push`: у нас нет
 * серверной части, которая решала бы, где сейчас ночь игрока. Локальное время
 * браузера и есть его ночь — переехал в другой часовой пояс, и тишина поехала
 * следом, без единой настройки. Донорский форум хранит IANA-зону именно потому,
 * что считает окно на сервере в UTC.
 *
 * Почему зеркало нужно: сервисный работник не видит `localStorage` — у него нет
 * окна, только `IndexedDB`. Отсюда и странная на вид пара: настройка живёт
 * в базе (чтобы не исчезла при очищенных данных сайта и доехала до второго
 * устройства), а сюда она перекладывается для того, кто будит.
 *
 * Ошибка — всегда «не подавляем». Тишину, причину которой нельзя объяснить,
 * человек замечает позже, чем шум: пропавшее сообщение пугает сильнее, чем
 * пришедшее не вовремя.
 */
import { CONFIG } from '../../config.js';

const L = CONFIG.forum.limits;

/** Имена хранилища-зеркала. Их же называет `sw.js`; расхождение ловит тест. */
export const QUIET_DB = 'zr33-quiet-hours';
export const QUIET_STORE = 'hours';
export const QUIET_KEY = 'me';

/** @param {Date} now */
export function minutesOfDay(now) {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * «HH:MM» из поля формы — в минуты от полуночи. Всё остальное (пустое, «25:00»,
 * «22-00») — null: молчать на плохих данных нельзя.
 *
 * @param {string} value
 */
export function parseQuietTime(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** @param {number} minutes */
export function formatQuietTime(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > L.quietMinutesMax) return '';
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Молчать ли сейчас. Чистая функция: окно и минута передаются в неё, а сама она
 * ничего не читает, — поэтому её прогоняют и тест страницы, и тест сервисного
 * работника.
 *
 * start > end — окно через полночь, это норма (22:00 → 08:00).
 * start === end — не «весь день», а выключенные подписки: здесь такое окно
 * молчит ровно ноль минут, и отказ на нём держит ещё и база.
 *
 * @param {{start: number, end: number}|null|undefined} win
 * @param {number} minutes
 */
export function quietMutes(win, minutes) {
  const start = win?.start;
  const end = win?.end;
  const ok = (v) => Number.isInteger(v) && v >= 0 && v <= L.quietMinutesMax;
  if (!ok(start) || !ok(end) || start === end) return false;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > L.quietMinutesMax) return false;
  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

/**
 * Проверка окна перед записью в любой из двух режимов.
 *
 * Порядок отказов одинаков в `supabase.js` и `local.js`, а тексты — те же,
 * что сказала бы база: «половина окна» и «совпавшие границы» запрещены её
 * проверкой `forum_push_prefs_quiet_window`. Различить их до отправки можно
 * только по-русски, поэтому отказывает эта функция, а не база.
 *
 * undefined — поле не трогаем (null тоже не трогаем: стирает окно).
 *
 * @param {number|null|undefined} start
 * @param {number|null|undefined} end
 * @returns {{start: number|null, end: number|null}}
 */
export function normalizeQuietWindow(start, end) {
  if (start === undefined && end === undefined) return null;
  // Здесь undefined = «про эту границу не сказали»; вместе со второй парой
  // это половина окна, а не «не трогаем».
  const s = start === undefined ? null : start;
  const e = end === undefined ? null : end;
  if (s === null && e === null) return { start: null, end: null };
  if (s === null || e === null) {
    throw new Error('У тихих часов должно быть две границы: начало и конец');
  }
  const ok = (v) => Number.isInteger(v) && v >= 0 && v <= L.quietMinutesMax;
  if (!ok(s) || !ok(e)) {
    throw new Error(`Границы тихих часов — целые минуты от 0 до ${L.quietMinutesMax}`);
  }
  if (s === e) {
    throw new Error('Начало совпадает с концом: окно молчало бы весь день, для этого есть тумблеры подписки');
  }
  return { start: s, end: e };
}

function openQuietDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Нет хранилища')); return; }
    const req = indexedDB.open(QUIET_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(QUIET_STORE)) {
        req.result.createObjectStore(QUIET_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Хранилище закрыто'));
  });
}

/**
 * Переложить окно в зеркало. null — стереть его (тихие часы выключены).
 *
 * Не умеет бросать: настоящего источника правды это не отменяет, а ронять
 * сохранение настроек из-за зеркала значило бы терять тумблеры подписки.
 *
 * @param {{start: number, end: number}|null} win
 * @returns {Promise<boolean>} легло или нет
 */
export async function saveQuietWindow(win) {
  try {
    const db = await openQuietDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(QUIET_STORE, 'readwrite');
      const store = tx.objectStore(QUIET_STORE);
      if (win) store.put({ start: win.start, end: win.end }, QUIET_KEY);
      else store.delete(QUIET_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Запись не легла'));
      tx.onabort = () => reject(tx.error || new Error('Запись прервана'));
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Окно из зеркала; null, если его там нет или хранилище недоступно.
 */
export async function readQuietWindow() {
  try {
    const db = await openQuietDb();
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction(QUIET_STORE, 'readonly');
      const req = tx.objectStore(QUIET_STORE).get(QUIET_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error || new Error('Чтение не вышло'));
    });
    db.close();
    return row && Number.isInteger(row.start) && Number.isInteger(row.end)
      ? { start: row.start, end: row.end }
      : null;
  } catch {
    return null;
  }
}

/**
 * Молчать ли прямо сейчас — то, что зовёт открытый чат перед `new Notification`.
 *
 * @param {Date} [now]
 */
export async function quietMutesNow(now = new Date()) {
  return quietMutes(await readQuietWindow(), minutesOfDay(now));
}
