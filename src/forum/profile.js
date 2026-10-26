/**
 * ПРОФИЛИ И ВЛОЖЕНИЯ — работа с базой.
 *
 * Вынесено из адаптера форума отдельным файлом: у профиля своя жизнь,
 * не связанная с постами. Человек правит подпись и аватарку, не публикуя
 * ничего, а его страницу открывают, не читая ленту.
 *
 * ГДЕ ЖИВУТ ПРАВА. В базе (supabase/applied/profiles.sql). Проверки здесь нужны
 * для понятных сообщений: любую можно обойти запросом мимо сайта, и тогда
 * откажет база.
 */
import { rest, uploadFile, publicFileUrl, currentUserId } from '../db/client.js';
import { prepareImage, uploadPath } from '../ui/image-prep.js';
import { validateServerId } from './rules.js';
import { forum } from './index.js';

/*
  Если выбранный адаптер форума сам умеет профили (локальный режим), ходим
  к нему, а не в базу: в черновом режиме базы нет, и страница участника
  падала с «Не удалось связаться с базой». Рабочий адаптер этих методов
  не имеет — для него всё по-прежнему читается из forum_profiles ниже.

  СПРАШИВАЮТ В МОМЕНТ ВЫЗОВА, А НЕ ОДИН РАЗ ПРИ ЗАГРУЗКЕ ФАЙЛА. Черновой
  адаптер приходит отдельным import() и наполняет `forum` уже после того, как
  этот файл прочитан (src/main.js:30 тянет его в стартовом графе, а forumReady()
  ждут лишь на входе сайта). Значение, снятое на строке объявления, в черновом
  режиме осталось бы «ложь» навсегда — и страница только что зарегистрировавшегося
  человека сказала бы «Такого участника нет», потому что в боевой базе его ника
  действительно нет.
*/
const ownProfiles = () => typeof forum.getProfile === 'function';

const toDate = (v) => (v ? new Date(v) : null);

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} nick
 * @property {string} avatarUrl
 * @property {string} about
 * @property {string} allianceTag
 * @property {'member'|'moderator'|'admin'} role
 * @property {Date}   createdAt
 * @property {number} postCount
 * @property {number} commentCount
 * @property {number} likesReceived
 * @property {boolean} [isVerified]  Ник подтверждён лидером/модерацией.
 * @property {Date|null} [verifiedAt]
 * @property {number} [thanksReceived]  Сколько благодарностей собрали записи.
 * @property {number} [verifiedGuides]  Разборов, проверенных модерацией.
 * @property {number} [eventsHeld]      Встреч, которые человек провёл.
 * @property {number} [repGrantPoints]  Сумма наград владельца, в очках.
 * @property {number} [repGrantCount]   Сколько наград выдали.
 * @property {number|null} [serverId]   Сервер, который человек назвал сам;
 *                                    null — не указан. Дату смены здесь нет:
 *                                    она нужна только владельцу профиля, а её
 *                                    отдаёт его аккаунт (src/db/account.js),
 *                                    чужому человеку она не показывает ничего
 *                                    интересного.
 */

/** @param {any} row */
function profileFrom(row) {
  if (!row) return null;
  return {
    id: row.id,
    nick: row.nick,
    avatarUrl: row.avatar_url || '',
    about: row.about || '',
    allianceTag: row.alliance_tag || '',
    /*
      Сервер — последняя колонка `forum_profiles` (20261005-player-server.sql).
      До её прогона поля в строке нет, и это не поломка страницы: просто
      значок под ником не рисуется.
    */
    serverId: row.server_id == null ? null : Number(row.server_id),
    role: row.role,
    isBlogger: Boolean(row.is_blogger),
    createdAt: toDate(row.created_at) ?? new Date(),
    postCount: Number(row.post_count || 0),
    commentCount: Number(row.comment_count || 0),
    likesReceived: Number(row.likes_received || 0),
    /* Сколько просмотров собрали все записи блога. Считает база в forum_profiles. */
    blogViews: Number(row.blog_views || 0),
    blogPostCount: Number(row.blog_post_count || 0),
    /* Онлайн и репутация из форума. forum_profiles считает их сам. */
    lastSeenAt: toDate(row.last_seen_at),
    profileLikes: Number(row.profile_likes || 0),
    iLiked: Boolean(row.i_liked),
    isVerified: Boolean(row.is_verified),
    verifiedAt: toDate(row.verified_at),
    /*
      Откуда берётся репутация. Все пять чисел считает представление
      forum_profiles (supabase/applied/20260926-author-thanks.sql), здесь они только
      переименовываются. Пустые значения до миграции — норма: страница
      показывает ноль, а не падает.
    */
    thanksReceived: Number(row.thanks_received || 0),
    verifiedGuides: Number(row.verified_guides || 0),
    eventsHeld: Number(row.events_held || 0),
    repGrantPoints: Number(row.rep_grants || 0),
    repGrantCount: Number(row.rep_grant_count || 0),
  };
}

/**
 * Страница участника по нику.
 *
 * По нику, а не по идентификатору: адрес #/user/Ковыль читается человеком
 * и кидается в чат, а #/user/588a0535-2e55-… нет. Идентификатор в адресе
 * заодно раскрывал бы связь с системой входа, что незачем.
 *
 * @param {string} nick
 * @returns {Promise<Profile|null>}
 */
export async function getProfile(nick) {
  const clean = String(nick ?? '').trim();
  if (!clean) return null;
  if (ownProfiles()) return forum.getProfile(clean);

  /*
    Сравнение без учёта регистра: ссылка из чата может прийти в любом виде,
    и «ковыль» должен открыть страницу «Ковыль». В базе на lower(nick) стоит
    уникальный индекс, поэтому такой поиск точный, а не приблизительный.
  */
  const rows = await rest(
    `/forum_profiles?select=*&nick=ilike.${encodeURIComponent(clean)}&limit=1`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return profileFrom(row);
}

/**
 * Кому можно написать: ники, подходящие под введённое начало.
 *
 * Ищет не только с начала ника: « Kov» находит и «MrKovыль», потому что
 * человек помнит середину имени чаще, чем его точное написание. Точные
 * совпадения и начало ника поднимаются наверх уже здесь, чтобы форма ЛС не
 * считала порядок сама.
 *
 * @param {string} term
 * @param {number} limit
 * @returns {Promise<Array<{nick: string, avatarUrl: string, allianceTag: string}>>}
 */
export async function suggestNicks(term, limit = 8) {
  const clean = String(term ?? '').trim();
  if (!clean) return [];
  const max = Math.max(1, Math.min(20, Number(limit) || 8));

  if (ownProfiles()) {
    /*
      Черновой режим: участников держит локальный адаптер, базы нет. Список
      короткий, поэтому ищем в памяти — ровно те же правила, что и ниже.
    */
    const rows = typeof forum.listUsers === 'function' ? await forum.listUsers() : [];
    return rankNicks(
      rows
        .filter((row) => String(row.nick || '').toLowerCase().includes(clean.toLowerCase()))
        .map((row) => ({ nick: row.nick, avatarUrl: row.avatarUrl || '', allianceTag: row.allianceTag || '' })),
      clean,
      max
    );
  }

  /*
    `forum_profiles` читается гостем — это публичная страница участника, новых
    прав запрос не требует. Колонки перечислены, а не `*`: подсказка смотрит
    только на ник, аватарку и тег, и тянуть счётчики репутации на каждый
    нажатый символ было бы лишним трафиком.
  */
  const rows = await rest(
    `/forum_profiles?select=nick,avatar_url,alliance_tag&nick=ilike.${encodeURIComponent(pattern(clean))}` +
      `&order=nick.asc&limit=${max * 3}`
  );
  if (!Array.isArray(rows)) return [];
  return rankNicks(
    rows.map((row) => ({ nick: row.nick, avatarUrl: row.avatar_url || '', allianceTag: row.alliance_tag || '' })),
    clean,
    max
  );
}

/*
  `%` и `_` в LIKE — свои собственные знаки, и ник «100%» без экранирования
  превратился бы в «любые символы». Обратная косая — стандартный знак отмены
  в Postgres, а `*` заменяет `%` уже PostgREST, поэтому звёздочки здесь
  остаются рабочими.
*/
function pattern(term) {
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `*${escaped}*`;
}

function rankNicks(rows, term, max) {
  const low = term.toLowerCase();
  const seen = new Set();
  const rank = (nick) => {
    const low2 = nick.toLowerCase();
    if (low2 === low) return 0;
    return low2.startsWith(low) ? 1 : 2;
  };
  return rows
    .filter((row) => {
      const key = String(row.nick || '').trim().toLowerCase();
      // Один и тот же ник база не отдаст дважды, а вот пробелы в начале — да.
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => rank(a.nick) - rank(b.nick) || a.nick.length - b.nick.length || a.nick.localeCompare(b.nick, 'ru'))
    .slice(0, max);
}

/** Последние посты участника — для его страницы. */
export async function getUserPosts(userId, limit = 10) {
  if (ownProfiles()) return forum.getUserPosts(userId, limit);
  const rows = await rest(
    `/forum_post_list?select=*&author_id=eq.${encodeURIComponent(userId)}` +
      `&deleted=is.false&order=created_at.desc&limit=${Number(limit)}`
  );
  return Array.isArray(rows) ? rows : [];
}

/**
 * Правка своего профиля.
 *
 * Ник здесь не меняется, и это не забывчивость: смена ника — отдельная
 * функция базы (forum_rename_nick), потому что кроме профиля она обновляет
 * копии ника в постах, комментариях, чатах и уведомлениях и пишет строку в
 * журнал переименований. Форму профиль вызывает её сам, до сохранения.
 *
 * Частоту смены сервера здесь никто не пересчитывает: её держит триггер базы
 * `forum_users_server_guard`, и его отказ приходит человеку тем же текстом,
 * что и подсказка формы. Проверять срок двумя местами — значит иметь две
 * разные версии одного правила, и они разошлись бы при первой же правке.
 *
 * @param {{about?: string, allianceTag?: string, serverId?: number|string|null}} patch
 */
export async function saveProfile(patch) {
  if (ownProfiles()) return forum.saveProfile(patch);
  const myId = currentUserId();
  if (!myId) throw new Error('Сначала войдите');

  const body = {};
  if (patch.about != null) body.about = String(patch.about).trim().slice(0, 200);
  if (patch.allianceTag != null) {
    /*
      Тег альянса приводим к верхнему регистру и убираем пробелы: в игре они
      пишутся как KOP, AMGK. Без приведения «kop» и «KOP» выглядели бы разными
      альянсами в списке участников.
    */
    body.alliance_tag = String(patch.allianceTag).trim().toUpperCase().replace(/\s+/g, '').slice(0, 12);
  }
  /*
    Сервер: пустая строка означает «снять номер» — то же самое, что в
    черновом режиме. Число записывается как число: строка «12» в колонку
    integer база не примет, а отказ был бы непонятен человеку, который ввёл
    всё правильно.
  */
  if ('serverId' in patch) {
    const check = validateServerId(patch.serverId);
    if (!check.ok) throw new Error(check.error);
    body.server_id = check.value;
  }

  if (!Object.keys(body).length) return;

  await rest(`/forum_users?id=eq.${encodeURIComponent(myId)}`, { method: 'PATCH', body });
}

/**
 * Загрузка аватарки.
 *
 * Путь начинается с идентификатора владельца — на этом держится правило
 * доступа в хранилище: без него любой участник перезаписал бы чужую аватарку.
 *
 * @param {File} file
 * @returns {Promise<string>} публичная ссылка
 */
export async function uploadAvatar(file) {
  if (ownProfiles()) throw new Error('В локальном режиме аватарку загрузить некуда — хранилища нет');
  const myId = currentUserId();
  if (!myId) throw new Error('Сначала войдите');

  const blob = await prepareImage(file, 'avatar');
  const path = `${myId}/${uploadPath('a', 'jpg').split('/').pop()}`;

  const url = await uploadFile({
    bucket: 'avatars',
    path,
    bytes: blob,
    contentType: 'image/jpeg',
  });

  /*
    Ссылку сохраняем в профиль сразу: файл в хранилище без записи в профиле —
    мусор, который никто уже не найдёт и не удалит.

    Старую аватарку не удаляем намеренно. Она весит около сотни килобайт,
    а удаление создало бы окно, в котором новая ссылка ещё не записана,
    а старая картинка уже пропала: аватарка исчезла бы у всех, включая старые
    посты в чужих закэшированных страницах. Чистка накопившегося — отдельная
    задача для администратора, а не побочный эффект смены картинки.
  */
  await rest(`/forum_users?id=eq.${encodeURIComponent(myId)}`, {
    method: 'PATCH',
    body: { avatar_url: url },
  });

  return url;
}

/** Убрать аватарку: вернуться к букве в цветном квадрате. */
export async function clearAvatar() {
  if (ownProfiles()) return;
  const myId = currentUserId();
  if (!myId) throw new Error('Сначала войдите');

  await rest(`/forum_users?id=eq.${encodeURIComponent(myId)}`, {
    method: 'PATCH',
    body: { avatar_url: null },
  });
}

/* ── Вложения ─────────────────────────────────────────────────────────────── */

/**
 * Прикрепить картинку к посту, комментарию или гайду.
 *
 * ПОРЯДОК ВАЖЕН: сначала файл в хранилище, потом запись в таблице. Обратный
 * порядок оставлял бы в ленте запись со ссылкой на файл, которого ещё нет, —
 * то есть битую картинку, видную всем.
 *
 * Тип «guide» появился вместе с правом игроков публиковать гайды
 * (supabase/applied/20260929-player-guides.sql): отдельного механизма картинок для
 * гайдов нет, у них те же предел, сжатие и права на удаление.
 *
 * @param {'post'|'comment'|'guide'} targetType
 * @param {string} targetId
 * @param {File} file
 */
export async function attachImage(targetType, targetId, file) {
  const myId = currentUserId();
  if (!myId) throw new Error('Сначала войдите');

  const blob = await prepareImage(file, 'photo');
  const name = uploadPath('p', 'jpg').split('/').pop();
  const path = `${myId}/${name}`;

  const url = await uploadFile({
    bucket: 'forum-uploads',
    path,
    bytes: blob,
    contentType: 'image/jpeg',
  });

  try {
    const rows = await rest('/forum_attachments', {
      method: 'POST',
      prefer: 'return=representation',
      body: { target_type: targetType, target_id: targetId, url, storage_path: path },
    });
    const created = Array.isArray(rows) ? rows[0] : rows;
    return { id: created?.id, url };
  } catch (err) {
    /*
      Запись не прошла — например, сработал предел в четыре картинки.
      Файл при этом уже лежит в хранилище и стал бы мусором, на который никто
      не ссылается. Убираем его сразу: место в бесплатном хранилище общее.
    */
    await deleteStorageFile('forum-uploads', path).catch(() => {});
    throw err;
  }
}

/** Открепить картинку: убрать и запись, и файл. */
export async function detachImage(id, storagePath) {
  await rest(`/forum_attachments?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (storagePath) await deleteStorageFile('forum-uploads', storagePath).catch(() => {});
}

/**
 * Удаление файла из хранилища.
 *
 * Отдельно от rest: у хранилища свой путь и свой ответ. Ошибку глотать нельзя
 * молча — но и ронять из-за неё удаление записи тоже: запись без файла это
 * битая картинка, а файл без записи всего лишь занятое место.
 */
async function deleteStorageFile(bucket, path) {
  const { baseUrl, readSession, apiKey } = await import('../db/client.js');
  const token = readSession()?.access_token;

  await fetch(`${baseUrl()}/storage/v1/object/${bucket}/${path}`, {
    method: 'DELETE',
    headers: {
      apikey: apiKey(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export { publicFileUrl };
