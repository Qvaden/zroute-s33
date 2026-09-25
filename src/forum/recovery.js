/**
 * КЛЮЧ САМОВОССТАНОВЛЕНИЯ.
 *
 * Длинная случайная строка, которую придумывает браузер игрока. Она и есть
 * доказательство «аккаунт мой»: в базу уходит её SHA-256, а сам ключ не летит
 * никуда, кроме запросов от этого браузера. Поэтому пароль, который игрок
 * ставит по заявке, не видит никто — ни панель, ни журнал, ни владелец.
 *
 * ПОЧЕМУ ХЕШИМ, А НЕ ОТПРАВЛЯЕМ КЛЮЧ КАК ЕСТЬ. Заявка живёт в базе несколько
 * дней и читается владельцем. Лежал бы там сам ключ — список заявок стал бы
 * списком пропусков в чужие аккаунты. Отпечаток же от 16 случайных байт
 * обратно не снимается: перебор по нему невозможен в принципе.
 *
 * ПОЧЕМУ КЛЮЧ НЕ В ПАРОЛЕ И НЕ В НИКЕ. Он должен переживать перезагрузку
 * страницы на том же устройстве и не должен зависеть от того, что человек
 * забыл. Отсюда localStorage: его хватает ровно на один перерыв — дождаться,
 * пока заявка примет пароль сама.
 */

/** Куда кладём ключ, чтобы пережить перезагрузку. */
export const RECOVERY_STORE_KEY = 'zr33.recovery';

/** 32 символа: 16 байт, записанные шестнадцатерично. */
const KEY_BYTES = 16;

/**
 * localStorage умеет бросать: приватный режим, запрещённые хранилища,
 * переполненный диск. Потеря ключа обидна, но падение страницы входа из-за неё
 * означало бы, что человек не может даже завести новую заявку.
 */
function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Новый случайный ключ.
 *
 * crypto.getRandomValues, а не Math.random: последний предсказуем по соседним
 * вызовам, а здесь секрет, с которым чужие руки войдут в аккаунт.
 */
export function createRecoveryKey() {
  const bytes = new Uint8Array(KEY_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Отпечаток ключа — ровно то, что уезжает в базу. */
export async function hashRecoveryKey(key) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return toHex(new Uint8Array(digest));
}

/**
 * Ключ в две строки по 16 символов.
 *
 * Слитные 32 символа с телефона не сверить глазами, а перенос по 16 остаётся
 * переносом по ровно половине: копирование от этого не портится.
 */
export function formatRecoveryKey(key) {
  const s = String(key || '');
  return s.length <= 16 ? s : `${s.slice(0, 16)}\n${s.slice(16)}`;
}

/**
 * Привести введённый ключ к сравнению.
 *
 * Нужна именно нормализация, а не «совпало посимвольно»: человек мог перенести
 * ключ из заметок, где он обзавёлся пробелами и переносами строк. Регистр
 * шестнадцатеричной записи не значим.
 */
export function normalizeRecoveryKey(value) {
  return String(value || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

/** Похоже ли введённое на ключ: ровно 32 значащих шестнадцатеричных символа. */
export function looksLikeRecoveryKey(value) {
  const clean = String(value || '').replace(/\s+/g, '');
  return clean.length === KEY_BYTES * 2 && /^[0-9a-fA-F]+$/.test(clean);
}

/**
 * Сколько осталось до самоприёма заявки — «4 ч 12 мин», «9 мин», '' если срок
 * уже прошёл.
 *
 * Час считаем по readyAt из базы, а не по «плюс 12 часов от того, что я вижу»:
 * заявка могла быть заведена вчера с другого устройства, и обещать ей новый
 * срок было бы враньём.
 *
 * Пустая строка — не ошибка, а нормальный ответ для заявки, которая уже
 * открыта: показывать «осталось 0 мин» под полем для пароля значит напоминать
 * человеку о времени, которое он не ждал.
 */
export function formatHoldLeft(readyAt, now = new Date()) {
  if (!(readyAt instanceof Date) || Number.isNaN(readyAt.getTime())) return '';
  const ms = readyAt.getTime() - now.getTime();
  if (ms <= 0) return '';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

/**
 * Сохранить пару «ник + ключ».
 *
 * Ник держим рядом не для красоты: без него при возврате на страницу пришлось
 * бы просить ввести ник заново, а опечатка в одной букве означала бы «ключ не
 * найден» и долгое разборчество.
 *
 * @returns {boolean} удалось ли сохранить — false значит, что на этом устройстве
 *                    ключ пережить нельзя, и игроку надо записать его самому.
 */
export function saveRecovery(nick, key) {
  return safe(() => {
    localStorage.setItem(
      RECOVERY_STORE_KEY,
      JSON.stringify({ nick: String(nick), key: String(key) })
    );
    return true;
  }, false);
}

/** @returns {{nick: string, key: string}|null} */
export function loadRecovery() {
  const raw = safe(() => localStorage.getItem(RECOVERY_STORE_KEY), null);
  if (!raw) return null;
  const parsed = safe(() => JSON.parse(raw), null);
  if (!parsed || !parsed.nick || !parsed.key) return null;
  return { nick: String(parsed.nick), key: String(parsed.key) };
}

/**
 * Забыть ключ.
 *
 * Вызывается, когда заявка закрылась (пароль поставлен, отказано, срок вышел)
 * и когда игрок начинает заново. Держать мёртвый ключ в localStorage незачем,
 * а вред от него есть: это единственное, что отличает этого человека от любого
 * другого, кто откроет сайт на этом же устройстве.
 */
export function clearRecovery() {
  safe(() => localStorage.removeItem(RECOVERY_STORE_KEY));
}
