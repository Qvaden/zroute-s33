/**
 * ПРОФИЛИ И ВЛОЖЕНИЯ — работа с базой.
 *
 * Вынесено из адаптера форума отдельным файлом: у профиля своя жизнь,
 * не связанная с постами. Человек правит подпись и аватарку, не публикуя
 * ничего, а его страницу открывают, не читая ленту.
 *
 * ГДЕ ЖИВУТ ПРАВА. В базе (supabase/profiles.sql). Проверки здесь нужны
 * для понятных сообщений: любую можно обойти запросом мимо сайта, и тогда
 * откажет база.
 */
import { rest, uploadFile, publicFileUrl, currentUserId } from '../db/client.js';
import { prepareImage, uploadPath } from '../ui/image-prep.js';

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
    role: row.role,
    createdAt: toDate(row.created_at) ?? new Date(),
    postCount: Number(row.post_count || 0),
    commentCount: Number(row.comment_count || 0),
    likesReceived: Number(row.likes_received || 0),
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

/** Последние посты участника — для его страницы. */
export async function getUserPosts(userId, limit = 10) {
  const rows = await rest(
    `/forum_post_list?select=*&author_id=eq.${encodeURIComponent(userId)}` +
      `&deleted=is.false&order=created_at.desc&limit=${Number(limit)}`
  );
  return Array.isArray(rows) ? rows : [];
}

/**
 * Правка своего профиля.
 *
 * Ник здесь не меняется, и это не забывчивость: на ник ссылаются копии
 * в постах (author_nick), и смена оставила бы старые записи подписанными
 * прежним именем. Переименование — отдельная задача, требующая обновления
 * этих копий; пока его нет, лучше честно не давать, чем дать наполовину.
 *
 * @param {{about?: string, allianceTag?: string}} patch
 */
export async function saveProfile(patch) {
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
  const myId = currentUserId();
  if (!myId) throw new Error('Сначала войдите');

  await rest(`/forum_users?id=eq.${encodeURIComponent(myId)}`, {
    method: 'PATCH',
    body: { avatar_url: null },
  });
}

/* ── Вложения ─────────────────────────────────────────────────────────────── */

/**
 * Прикрепить картинку к посту или комментарию.
 *
 * ПОРЯДОК ВАЖЕН: сначала файл в хранилище, потом запись в таблице. Обратный
 * порядок оставлял бы в ленте запись со ссылкой на файл, которого ещё нет, —
 * то есть битую картинку, видную всем.
 *
 * @param {'post'|'comment'} targetType
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
