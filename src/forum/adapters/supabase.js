/**
 * АДАПТЕР ФОРУМА: Supabase.
 *
 * РАБОЧИЙ РЕЖИМ. Общая база, настоящая регистрация, посты видны всем.
 *
 * ПОЧЕМУ БЕЗ БИБЛИОТЕКИ. У Supabase есть свой клиент, но он тянется сборкой
 * и зависимостями, а весь проект держится на правиле «обычные ES-модули,
 * никакого шага сборки» — его должны уметь поддерживать не программисты.
 * Нужны нам ровно два их интерфейса, оба обычный HTTP: вход (auth) и запросы
 * к таблицам (PostgREST). Это две функции ниже, и они дешевле зависимости.
 *
 * ГДЕ ЖИВЁТ БЕЗОПАСНОСТЬ. Не здесь. Ключ `anonKey` публичный и лежит
 * в config.js открыто — он лишь открывает дверь. Что за дверью разрешено,
 * решают политики доступа в самой базе (см. supabase/schema.sql): свой пост
 * править можно, чужой нет, удалять с причиной — только модератору.
 * Проверки в этом файле нужны для понятных сообщений, а не для защиты:
 * любую из них можно обойти, отправив запрос мимо сайта, и тогда откажет
 * база. Так и должно быть — проверка на стороне клиента защитой не бывает.
 *
 * ПАРОЛИ здесь не хешируются и не проверяются: этим занимается сам Supabase.
 * Своей криптографии в проекте нет намеренно — самодельное хеширование
 * пароля хуже отсутствия пароля, потому что выглядит защитой.
 */
import { CONFIG } from '../../../config.js';
import { CATEGORY_IDS, REACTION_IDS, reactionMeta } from '../rules.js';
import { nickToEmail } from '../nick-email.js';
/*
  ВЕСЬ ТРАНСПОРТ — ИЗ ОБЩЕГО КЛИЕНТА.

  Сессия, запросы к таблицам, вход в базу и обновление токена живут в
  db/client.js — это единственный клиент для всего проекта (сайта, форума
  и админ-панели). Раньше у форума был свой дубль: своя копия readSession/
  writeSession с другим ключом в localStorage, свой rest и свой auth. Один
  аккаунт тогда хранился в двух местах сразу, токены после обновления
  расходились, и профиль мог видеть протухшую сессию, пока форум — нет.

  Отсюда берём только то, что нужно, не дублируя транспорт.
*/
import {
  readSession,
  writeSession,
  currentUserId,
  auth,
  rest,
  nickDomain,
  isConfigured,
} from '../../db/client.js';

export const name = 'общая база (Supabase)';

/** @type {import('../contract.js').ForumCapabilities} */
export const capabilities = {
  canWrite: true,
  isShared: true,
  canAuth: true,
  canModerate: true,
};

/**
 * Ник в адрес почты. Почты у нас нет, но системе входа адрес обязателен —
 * см. решение в config.js. Домен вымышленный, письма туда никто не посылает.
 *
 * Само превращение вынесено в ../nick-email.js: оно оказалось не тремя
 * строками, а отдельной задачей со своими правилами. Система входа Supabase
 * принимает в адресе только ASCII, а игровые ники здесь почти все русские —
 * подробности и разбор в том файле.
 *
 * ВАЖНО: сюда ник должен приходить уже после validateNick. Тот подрезает
 * пробелы по краям и сжимает двойные внутри, а адрес считается от точного
 * ника — если подрезка не сделана, при входе получится другой адрес,
 * и человек не попадёт в свою же учётную запись.
 */
function emailFor(nick) {
  return nickToEmail(nick, nickDomain());
}

/** Готов ли форум к работе: настроена ли база. */
export function isReady() {
  return isConfigured();
}

/* ── Вход ─────────────────────────────────────────────────────────────────── */

const toDate = (v) => (v ? new Date(v) : null);

/**
 * Профиль игрока лежит в таблице `forum_users`, а не в системе входа:
 * ник, роль и ограничения нужны в запросах и в политиках доступа, а внутрь
 * auth политики не смотрят.
 */
function userOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    nick: row.nick,
    role: row.role,
    avatarUrl: row.avatar_url || '',
    about: row.about || '',
    allianceTag: row.alliance_tag || '',
    canEditSite: Boolean(row.can_edit_site) || row.role === 'admin',
    createdAt: toDate(row.created_at) ?? new Date(),
    mutedUntil: toDate(row.muted_until),
    banned: Boolean(row.banned),
    banReason: row.ban_reason || '',
  };
}

/**
 * КТО Я.
 *
 * Идентификатор берётся ИЗ ТОКЕНА, и строка запрашивается точным сравнением
 * по нему. Раньше здесь стоял «первый из forum_users с limit=1» с расчётом
 * на то, что права доступа и так отдадут только мою строку.
 *
 * Для участника это было верно, а для АДМИНИСТРАТОРА — нет: ему видны все
 * профили, иначе модерация не работала бы. Тогда «первый без порядка»
 * возвращал произвольную строку, на практике самую старую в таблице,
 * и администратор видел на сайте чужой ник вместо своего.
 *
 * Ошибка была именно в подходе: вопрос «кто я» решался правами доступа,
 * а не проверкой идентификатора. Права отвечают на вопрос «что мне можно
 * читать» — это другой вопрос, и совпадение ответов было случайным.
 */
export async function currentUser() {
  const session = readSession();
  if (!session?.access_token) return null;

  /*
    Идентификатор берём из токена тем же способом, что и общий клиент: `sub`.
    Свой разбор держать не нужно — он ровно такой же, и одна копия меньше
    шансов разойтись с остальным проектом.
  */
  const myId = currentUserId();
  if (!myId) {
    // Токен не разобрался — значит он не наш и доверять ему нельзя.
    writeSession(null);
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

  return userOut(me);
}

export async function signUp(nick, password) {
  const email = emailFor(nick);

  /*
    Ник кладём в метаданные: триггер в базе создаёт из них строку профиля.
    Уникальность ника обеспечивает индекс в базе, а не эта проверка —
    иначе два человека, регистрирующиеся одновременно, получили бы
    один ник и один из них потом не смог бы войти.
  */
  const session = await auth('/signup', {
    body: { email, password, data: { nick: String(nick).trim() } },
  });

  if (!session?.access_token) {
    // Такое бывает, если в проекте забыли выключить подтверждение почты.
    throw new Error(
      'Регистрация не завершена: похоже, в Supabase включено подтверждение почты. ' +
        'Почты у нас нет — подтверждение надо выключить.'
    );
  }
  writeSession(session);

  const me = await currentUser();
  if (!me) throw new Error('Профиль не создан — проверьте схему базы');
  return me;
}

export async function signIn(nick, password) {
  const session = await auth('/token?grant_type=password', {
    body: { email: emailFor(nick), password },
  });

  if (!session?.access_token) {
    // Ответ без токена — сломанный вход: молча писать пустую сессию хуже,
    // чем сказать. Пользователь увидит объяснение, а не загадочное «не вошло».
    throw new Error('Вход не завершён: база не вернула сессию. Проверьте настройки входа.');
  }
  writeSession(session);

  const me = await currentUser();
  if (!me) throw new Error('Профиль не найден');
  if (me.banned) {
    /*
      Забаненного впускаем, но не молчим: он должен прочитать причину.
      Писать ему всё равно не даст база, а не эта строка.
    */
    return me;
  }
  return me;
}

export async function signOut() {
  const session = readSession();
  writeSession(null);
  if (session?.access_token) {
    // Отзыв токена на стороне сервера. Если не вышло — локально мы уже вышли.
    await auth('/logout', { token: session.access_token }).catch(() => {});
  }
}

/* ── Записи ───────────────────────────────────────────────────────────────── */

/**
 * Лента читается из представления `forum_post_list`, а не из таблицы постов.
 *
 * Причина в счётчиках. Ленте нужны число комментариев, число каждой реакции
 * и «что поставил я» — считать это в браузере означало бы тащить все реакции
 * всех постов целиком. Представление считает на стороне базы одним запросом.
 */
function postOut(row) {
  const counts = row.reactions && typeof row.reactions === 'object' ? row.reactions : {};
  let score = 0;
  for (const [id, n] of Object.entries(counts)) {
    score += (reactionMeta(id)?.weight ?? 0) * Number(n || 0);
  }
  return {
    id: row.id,
    authorId: row.author_id,
    authorNick: row.author_nick,
    /*
      Аватарка и альянс приходят связью с профилем, а ник — копией в самой
      записи. Разница осмысленная: ник в старом посте это «кто сказал тогда»,
      а аватарка — «как человек выглядит сейчас», и сменив её он ожидает
      увидеть новую везде, включая прошлые посты.
    */
    authorAvatar: row.author_avatar || '',
    authorAlliance: row.author_alliance || '',
    /*
      Роль автора нужна для метки рядом с ником: читатель должен понимать,
      кто перед ним, когда речь о правилах или решении по жалобе — иначе слово
      модератора ничем не отличается от слова любого участника.
    */
    authorRole: row.author_role || 'member',
    category: row.category,
    title: row.title,
    body: row.body,
    createdAt: toDate(row.created_at) ?? new Date(),
    editedAt: toDate(row.edited_at) ?? undefined,
    pinned: Boolean(row.pinned),
    deleted: Boolean(row.deleted),
    deletedReason: row.deleted_reason || '',
    commentCount: Number(row.comment_count || 0),
    reactions: counts,
    myReaction: row.my_reaction || null,
    score,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
  };
}

/** @param {{category?: string, sort?: string, limit?: number, offset?: number}} [opts] */
export async function listPosts(opts = {}) {
  const { category = 'all', sort = 'fresh', limit = CONFIG.forum.pageSize, offset = 0 } = opts;

  const ORDER = {
    fresh: 'pinned.desc,created_at.desc',
    top: 'pinned.desc,score.desc,created_at.desc',
    talked: 'pinned.desc,comment_count.desc,created_at.desc',
  };

  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('order', ORDER[sort] ?? ORDER.fresh);
  // Просим на одну строку больше: точное число записей вернулось бы только
  // в заголовке Content-Range, а он прячется за обёрткой rest(). Лишняя
  // строка ничего не стоит (это тот же запрос), зато честно говорит,
  // кончилась ли лента.
  params.set('limit', String(limit + 1));
  params.set('offset', String(offset));
  if (category !== 'all' && CATEGORY_IDS.includes(category)) {
    params.set('category', `eq.${category}`);
  }

  const rows = await rest(`/forum_post_list?${params}`);
  const hasMore = Array.isArray(rows) && rows.length > limit;
  const posts = (hasMore ? rows.slice(0, limit) : (Array.isArray(rows) ? rows : []))
    .map(postOut);

  return { posts, total: offset + posts.length + (hasMore ? 1 : 0) };
}

export async function getPost(id) {
  const rows = await rest(`/forum_post_list?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? postOut(row) : null;
}

export async function createPost(draft) {
  if (!CATEGORY_IDS.includes(draft.category)) throw new Error('Неизвестный раздел');

  const rows = await rest('/forum_posts', {
    method: 'POST',
    prefer: 'return=representation',
    body: { category: draft.category, title: draft.title, body: draft.body },
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  if (!created?.id) throw new Error('Пост не создан');

  const full = await getPost(created.id);
  return full ?? postOut(created);
}

export async function editPost(id, patch) {
  const body = { edited_at: new Date().toISOString() };
  if (patch.title != null) body.title = patch.title;
  if (patch.body != null) body.body = patch.body;

  await rest(`/forum_posts?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body });
  const full = await getPost(id);
  if (!full) throw new Error('Пост не найден после правки');
  return full;
}

/**
 * Удаление — это отметка, а не стирание строки: на месте поста остаётся
 * заглушка с причиной. См. рассуждение в contract.js.
 */
export async function deletePost(id, reason) {
  await rest(`/forum_posts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      deleted: true,
      deleted_reason: String(reason || 'Нарушение правил форума'),
      deleted_at: new Date().toISOString(),
    },
  });
}

/* ── Комментарии ──────────────────────────────────────────────────────────── */

function commentOut(row) {
  const counts = row.reactions && typeof row.reactions === 'object' ? row.reactions : {};
  return {
    id: row.id,
    postId: row.post_id,
    authorId: row.author_id,
    authorNick: row.author_nick,
    authorAvatar: row.author_avatar || '',
    authorRole: row.author_role || 'member',
    body: row.body,
    createdAt: toDate(row.created_at) ?? new Date(),
    deleted: Boolean(row.deleted),
    deletedReason: row.deleted_reason || '',
    reactions: counts,
    myReaction: row.my_reaction || null,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
  };
}

export async function listComments(postId) {
  const rows = await rest(
    `/forum_comment_list?select=*&post_id=eq.${encodeURIComponent(postId)}&order=created_at.asc`
  );
  return (Array.isArray(rows) ? rows : []).map(commentOut);
}

export async function addComment(postId, body) {
  const rows = await rest('/forum_comments', {
    method: 'POST',
    prefer: 'return=representation',
    body: { post_id: postId, body },
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  if (!created?.id) throw new Error('Комментарий не создан');
  // Ник подставляет база — он приходит в ответе вместе со строкой.
  return commentOut(created);
}

export async function deleteComment(id, reason) {
  await rest(`/forum_comments?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      deleted: true,
      deleted_reason: String(reason || 'Нарушение правил форума'),
      deleted_at: new Date().toISOString(),
    },
  });
}

/* ── Реакции ──────────────────────────────────────────────────────────────── */

/**
 * Реакция у человека одна на запись. Это не проверка в коде, а устройство
 * таблицы: первичный ключ включает автора и цель, поэтому вторая реакция
 * того же человека физически становится заменой первой.
 *
 * @param {'post'|'comment'} targetType
 * @param {string} targetId
 * @param {string|null} reactionId
 */
export async function setReaction(targetType, targetId, reactionId) {
  if (reactionId != null && !REACTION_IDS.includes(reactionId)) {
    throw new Error('Неизвестная реакция');
  }

  const filter = `target_type=eq.${targetType}&target_id=eq.${encodeURIComponent(targetId)}`;

  if (!reactionId) {
    await rest(`/forum_reactions?${filter}`, { method: 'DELETE' });
    return;
  }

  await rest('/forum_reactions', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: { target_type: targetType, target_id: targetId, reaction: reactionId },
  });
}

/* ── Жалобы и модерация ───────────────────────────────────────────────────── */

export async function report({ targetType, targetId, ruleId, note = '' }) {
  await rest('/forum_reports', {
    method: 'POST',
    // Повторная жалоба того же человека на то же — не новая жалоба.
    prefer: 'resolution=merge-duplicates',
    body: { target_type: targetType, target_id: targetId, rule_id: ruleId, note },
  });
}

export async function listReports() {
  const rows = await rest('/forum_report_list?select=*&resolved=is.false&order=created_at.desc');
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    reporterId: r.reporter_id,
    reporterNick: r.reporter_nick,
    ruleId: r.rule_id,
    note: r.note || '',
    createdAt: toDate(r.created_at) ?? new Date(),
    resolved: Boolean(r.resolved),
    targetTitle: r.target_title || '',
    targetBody: r.target_body || '',
    targetAuthorNick: r.target_author_nick || '',
    targetPostId: r.target_post_id || null,
  }));
}

/** Жалоба разобрана. Строку не удаляем: список решений — тоже история. */
export async function resolveReport(reportId) {
  await rest(`/forum_reports?id=eq.${encodeURIComponent(reportId)}`, {
    method: 'PATCH',
    body: { resolved: true },
  });
}

export async function listUsers() {
  const rows = await rest('/forum_users?select=*&order=nick.asc');
  return (Array.isArray(rows) ? rows : []).map(userOut);
}

/**
 * СБРОС ПАРОЛЯ ИГРОКУ.
 *
 * Почты нет, значит «восстановить самому» невозможно — пароль меняет
 * администратор из панели. Менять чужой пароль напрямую в системе входа
 * может только служебный ключ, а его на сайте нет и быть не должно:
 * он даёт полный доступ ко всей базе, а панель открывается в браузере.
 *
 * Поэтому смену делает функция внутри базы (`forum_admin_reset_password`):
 * она проверяет, что вызвавший — администратор, и только после этого пишет
 * новый пароль. Служебный ключ при этом не покидает базу.
 */
export async function resetPassword(userId, password) {
  await rest('/rpc/forum_admin_reset_password', {
    method: 'POST',
    body: { target_user: userId, new_password: password },
  });
}

export async function setRestriction(userId, opts) {
  const body = {};
  if (opts.banned != null) body.banned = Boolean(opts.banned);
  if (opts.mutedUntil !== undefined) {
    body.muted_until = opts.mutedUntil ? new Date(opts.mutedUntil).toISOString() : null;
  }
  if (opts.reason != null) body.ban_reason = String(opts.reason);

  await rest(`/forum_users?id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', body });
}
