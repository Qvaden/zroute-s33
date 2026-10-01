/**
 * ПРАВА ПО СЕРВЕРУ НА СТОРОНЕ СТРАНИЦЫ.
 *
 * Здесь нет ни прав, ни их копий. Права держит база
 * (`supabase/applied/20261001-server-rights.sql`), а страница читает ответ
 * `forum_my_server_roles()` — одну карту «сервер → моя роль», которую адаптер
 * кладёт в состояние. Задача этого модуля — один раз объяснить, что значит
 * строка этой карты, и назвать отказ теми же словами, что и база.
 *
 * ПОЧЕМУ ОДНО МЕСТО, А ТРИ СТРОКИ В РАЗМЕТКЕ. Одно правило смотрит на экран в
 * трёх местах: форма новой темы, кнопки карточки и поле ответа. Записанное
 * трижды оно расходится в первый же месяц, и расходится тихо — форма прячется,
 * а «Удалить» остаётся. Поэтому и роль, и текст объяснения берутся отсюда.
 *
 * ГЛАВНОЕ РАЗЛИЧЕНИЕ — null против 'none'.
 *   null   прав не проверяем: гость, или функции ещё нет в базе. Ничего не
 *          прячем и не объясняем — иначе отсутствие миграции выглядело бы
 *          как полная блокировка форума.
 *   'none' проверили и сказали: тебя в этой ленте нет.
 * Поэтому каждая функция ниже на null отвечает «как раньше», а не «запретить».
 */
import { CONFIG } from '../../config.js';

/** Роль вошедшего в сервере: 'moderator' | 'member' | 'none' | null. */
function serverRoleOf(s, serverId) {
  if (!s || !s.me || s.serverRoles === null || s.serverRoles === undefined) return null;
  const id = serverId == null || serverId === '' ? null : Number(serverId);
  if (!Number.isInteger(id)) return null;
  const role = s.serverRoles[String(id)];
  return role === 'moderator' || role === 'member' || role === 'none' ? role : null;
}

/**
 * Сервер, в который уйдёт новая тема: выбранный в переключателе, а при общем
 * виде нескольких лент — номер сайта.
 *
 * Форма всегда пишет в конкретную ленту, даже когда на экране их смешано
 * несколько, поэтому спрашивать роль у «всех лент сразу» не о чем.
 */
export function writingServerId(s) {
  if (s && s.serverId != null) return Number(s.serverId);
  const configured = Number(CONFIG.server);
  return Number.isInteger(configured) ? configured : null;
}

/** Ряд сервера из списка `listServers()` — нужен ради признака «приём закрыт». */
function serverRowOf(s, serverId) {
  const id = serverId == null ? null : Number(serverId);
  const rows = Array.isArray(s?.servers) ? s.servers : [];
  return rows.find((row) => Number(row?.id) === id) ?? null;
}

/** Модерация сайта — та граница, что действовала до этого шага. */
function isSiteModerator(me) {
  return Boolean(me) && (me.role === 'admin' || me.role === 'moderator');
}

/**
 * Кто распоряжается материалом ленты: модератор этого сервера или модерация
 * сайта. Роль 'moderator' даёт и то и другое — в базе это одна функция
 * `forum_can_moderate_server`, где модерация сайта проходит первой веткой, и
 * та же оговорка заложена в `forum_my_server_roles()`.
 *
 * Отказ по серверу — не отказ по человеку: права модерации сайта остаются
 * целиком, и панель от этого шага не меняется.
 */
export function canModerateServer(s, serverId) {
  const role = serverRoleOf(s, serverId);
  if (role === null) return isSiteModerator(s && s.me);
  return role === 'moderator';
}

/**
 * Почему форма молчит, — одной строкой на том месте, где человек собирался
 * писать.
 *
 * Тексты дословно повторяют шаг 6 миграции и черновой адаптер: страница
 * обязана сказать то же до отправки, что скажет база после, и совпадение слов
 * сторожит тест. Порядок тот же, что в триггере: сначала про закрытый приём
 * тем — ждать добавления в ленту при закрытом приёме бесполезно, — потом про
 * отсутствие участия.
 *
 * Пустая строка значит «объяснять нечего»: права есть или мы их не спрашивали.
 *
 * `isTopic` — о новой теме речь или об ответе под ней. Закрытый приём тем
 * касается только тем: участники продолжают переписку в ленте, где новые
 * темы уже не начинают.
 */
export function serverWriteNotice(s, serverId, isTopic = true) {
  if (!s || !s.me) return '';
  if (isTopic) {
    const row = serverRowOf(s, serverId);
    if (row && row.enabled === false) {
      return 'Приём новых тем в этот сервер закрыт модерацией';
    }
  }
  return serverRoleOf(s, serverId) === 'none'
    ? 'В этот сервер пишут только его участники: попросите модератора сервера добавить вас'
    : '';
}
