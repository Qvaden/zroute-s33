/**
 * УЧЁТНЫЕ ЗАПИСИ — ОДНИ НА САЙТ И НА ПАНЕЛЬ.
 *
 * До переезда в проекте было две системы прав, не знавшие друг о друге:
 * панель открывалась токеном GitHub, форум — ником и паролем. Владельцу
 * приходилось держать два пароля, а чтобы пустить помощника, надо было
 * заводить ему доступ к репозиторию — то есть объяснять человеку, что такое
 * personal access token, ради правки счёта в VS.
 *
 * Теперь вход один: ник и пароль.
 *
 * РОЛЕЙ ТРИ, И ЭТО СОКРАЩЕНИЕ ОТ ПЯТИ.
 *
 * Сначала права делились на четыре ступени плюс отдельный признак «редактор»:
 * владелец, администратор, модератор, редактор, участник. Разделение
 * выглядело аккуратно — «вносящий итоги VS не обязан разбирать споры», —
 * но оно из другого масштаба. Такое деление экономит доверие на форуме
 * с десятком помощников; здесь помощников один-два, и оно лишь добавляло
 * сущностей, которые надо помнить, объяснять и выдавать по отдельности.
 *
 * Осталось то, что различается по существу:
 *
 *   владелец  — тот, чей это сайт. В базе роль 'admin', и такая запись
 *               может быть ровно одна: правило держит уникальный индекс,
 *               а не договорённость.
 *
 *   модератор — тот, кому доверили. Может всё то же, КРОМЕ власти над
 *               правами: назначать роли и сбрасывать пароли не может.
 *               Это единственная оставшаяся граница, и она на месте —
 *               иначе модератор назначил бы владельцем себя.
 *
 *   участник  — все остальные.
 *
 * Данные сайта правят и владелец, и модератор. Отдельного «редактора» больше
 * нет: доверяя человеку удаление чужих постов, странно не доверять ему
 * внесение результатов VS.
 */
import { rest, auth, readSession, writeSession, currentUserId, isConfigured, nickDomain } from './client.js';
import { nickToEmail } from '../forum/nick-email.js';

/**
 * @typedef {Object} Account
 * @property {string}  id
 * @property {string}  nick
 * @property {'member'|'moderator'|'admin'} role
 * @property {Date}    createdAt
 * @property {Date|null} mutedUntil
 * @property {boolean} banned
 * @property {string}  banReason
 * @property {string}  avatarUrl
 * @property {string}  about
 * @property {string}  allianceTag
 */

const toDate = (v) => (v ? new Date(v) : null);

/** @param {any} row */
export function accountFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    nick: row.nick,
    role: row.role,
    createdAt: toDate(row.created_at) ?? new Date(),
    mutedUntil: toDate(row.muted_until),
    banned: Boolean(row.banned),
    banReason: row.ban_reason || '',
    avatarUrl: row.avatar_url || '',
    about: row.about || '',
    allianceTag: row.alliance_tag || '',
  };
}

export { isConfigured };

/**
 * Кто вошёл. Строка запрашивается по идентификатору из токена, а не «первая
 * из таблицы»: владельцу видны все профили, и первая строка оказалась бы
 * произвольной — на практике самой старой в таблице.
 *
 * @returns {Promise<Account|null>}
 */
export async function currentAccount() {
  if (!isConfigured()) return null;

  const myId = currentUserId();
  if (!myId) {
    // Токен не разобрался — значит он не наш, и доверять ему нельзя.
    if (readSession()) writeSession(null);
    return null;
  }

  const rows = await rest(`/forum_users?select=*&id=eq.${encodeURIComponent(myId)}&limit=1`);
  const me = Array.isArray(rows) ? rows[0] : null;

  /*
    Пустой ответ значит, что сессия ещё жива, а профиля уже нет — например,
    учётную запись удалили. Тогда сессия недействительна.
  */
  if (!me) {
    writeSession(null);
    return null;
  }
  return accountFrom(me);
}

/**
 * Вход по нику и паролю.
 *
 * Ник превращается в служебный адрес почты: системе входа адрес обязателен,
 * а почты у нас нет. Подробности превращения — в forum/nick-email.js.
 */
export async function signIn(nick, password) {
  const session = await auth('/token?grant_type=password', {
    body: { email: nickToEmail(nick, nickDomain()), password },
  });
  writeSession(session);

  const me = await currentAccount();
  if (!me) throw new Error('Профиль не найден');
  return me;
}

export async function signUp(nick, password) {
  const session = await auth('/signup', {
    body: {
      email: nickToEmail(nick, nickDomain()),
      password,
      data: { nick: String(nick).trim().replace(/\s+/g, ' ') },
    },
  });

  if (!session?.access_token) {
    // Такое бывает, если в проекте забыли выключить подтверждение почты.
    throw new Error(
      'Регистрация не завершена: похоже, в Supabase включено подтверждение почты. ' +
        'Почты у нас нет — подтверждение надо выключить.'
    );
  }
  writeSession(session);

  const me = await currentAccount();
  if (!me) throw new Error('Профиль не создан — проверьте схему базы');
  return me;
}

export async function signOut() {
  const session = readSession();
  writeSession(null);
  if (session?.access_token) {
    // Отзыв токена на стороне сервера. Не вышло — локально мы уже вышли.
    await auth('/logout', { token: session.access_token }).catch(() => {});
  }
}

/* ── Что кому можно ───────────────────────────────────────────────────────── */

/**
 * Владелец. В базе это роль 'admin', и такая запись ровно одна.
 * @param {Account|null} account
 */
export function isOwner(account) {
  return account?.role === 'admin';
}

/**
 * Право править данные сайта: итоги VS, альянсы, хронологию, тексты.
 *
 * Есть у владельца и у модератора. Отдельного признака «редактор» больше нет:
 * доверяя человеку удаление чужих постов, странно не доверять ему внесение
 * результатов VS.
 */
export function canEditSite(account) {
  return isOwner(account) || account?.role === 'moderator';
}

/** Право разбирать жалобы и удалять чужие записи. */
export function canModerate(account) {
  return isOwner(account) || account?.role === 'moderator';
}

/**
 * Право менять роли и сбрасывать пароли — только у владельца.
 *
 * Это единственная граница между ним и модератором, и она принципиальна:
 * иначе модератор назначил бы владельцем себя, и разница между ролями
 * исчезла бы при первом же желании.
 */
export function canManagePeople(account) {
  return isOwner(account);
}

/**
 * Право писать на форуме. Проверяется и в базе — здесь только для того,
 * чтобы не показывать форму, которая заведомо откажет.
 */
export function canWrite(account) {
  if (!account || account.banned) return false;
  return !(account.mutedUntil && account.mutedUntil > new Date());
}
