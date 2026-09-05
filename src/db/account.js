/**
 * УЧЁТНЫЕ ЗАПИСИ — ОДНИ НА САЙТ И НА ПАНЕЛЬ.
 *
 * До этого файла в проекте было две системы прав, и они не знали друг о друге:
 * панель открывалась токеном GitHub, форум — ником и паролем. Владельцу
 * приходилось держать два пароля, а чтобы пустить нового редактора, надо было
 * заводить ему доступ к репозиторию — то есть объяснять человеку, что такое
 * GitHub и personal access token, ради правки счёта в VS.
 *
 * Теперь вход один: ник и пароль. Права различаются ролью и двумя признаками:
 *
 *   role = 'admin' | 'moderator' | 'member'   — что можно на форуме;
 *   can_edit_site                             — можно ли править данные сайта.
 *
 * Признак отдельно от роли намеренно. Это разные обязанности: человек, который
 * вносит итоги VS, не обязан разбирать жалобы, а модератор форума не обязан
 * иметь доступ к истории сервера. Слепи их в одну роль — и придётся выдавать
 * лишнее, чтобы дать нужное.
 */
import { rest, auth, readSession, writeSession, currentUserId, isConfigured, nickDomain } from './client.js';
import { nickToEmail } from '../forum/nick-email.js';

/**
 * @typedef {Object} Account
 * @property {string}  id
 * @property {string}  nick
 * @property {'member'|'moderator'|'admin'} role
 * @property {boolean} canEditSite  Право править данные сайта.
 * @property {Date}    createdAt
 * @property {Date|null} mutedUntil
 * @property {boolean} banned
 * @property {string}  banReason
 */

const toDate = (v) => (v ? new Date(v) : null);

/** @param {any} row */
export function accountFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    nick: row.nick,
    role: row.role,
    canEditSite: Boolean(row.can_edit_site),
    createdAt: toDate(row.created_at) ?? new Date(),
    mutedUntil: toDate(row.muted_until),
    banned: Boolean(row.banned),
    banReason: row.ban_reason || '',
  };
}

export { isConfigured };

/**
 * Кто вошёл. Строка запрашивается по идентификатору из токена, а не «первая
 * из таблицы»: администратору видны все профили, и первая строка оказалась бы
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
 * Право править данные сайта: итоги VS, альянсы, хронологию, тексты.
 *
 * У администратора оно есть всегда, отдельно выдавать не нужно: иначе
 * владелец мог бы случайно снять его сам себе и потерять доступ к истории.
 */
export function canEditSite(account) {
  return Boolean(account && (account.canEditSite || account.role === 'admin'));
}

/** Право разбирать жалобы и удалять чужие записи. */
export function canModerate(account) {
  return account?.role === 'admin' || account?.role === 'moderator';
}

/** Право менять роли и сбрасывать пароли. */
export function isAdmin(account) {
  return account?.role === 'admin';
}

/**
 * Право писать на форуме. Проверяется и в базе — здесь только для того,
 * чтобы не показывать форму, которая заведомо откажет.
 */
export function canWrite(account) {
  if (!account || account.banned) return false;
  return !(account.mutedUntil && account.mutedUntil > new Date());
}
