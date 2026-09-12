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
export async function isReady() {
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
    isBlogger: Boolean(row.is_blogger),
    isLeader: Boolean(row.is_leader),
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
    authorIsBlogger: Boolean(row.author_is_blogger),
    category: row.category,
    title: row.title,
    body: row.body,
    createdAt: toDate(row.created_at) ?? new Date(),
    editedAt: toDate(row.edited_at) ?? undefined,
    pinned: Boolean(row.pinned),
    deleted: Boolean(row.deleted),
    deletedReason: row.deleted_reason || '',
    views: Number(row.views || 0),
    commentCount: Number(row.comment_count || 0),
    reactions: counts,
    myReaction: row.my_reaction || null,
    score,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    poll: pollOut(row.poll),
  };
}

/**
 * Опрос, который база собрала jsonb-подписью внутри ленты (см. forum_post_list).
 *
 * «poll» приходит null, когда у поста опроса нет, — и null и должен остаться:
 * пустая разметка дороже, чем честное «нет опроса», и на каждом посту
 * проверка на null дешевле, чем повсюду протаскивать пустой объект.
 */
function pollOut(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    id: p.id,
    question: p.question,
    multiple: Boolean(p.multiple),
    closed: Boolean(p.closed),
    total: Number(p.total || 0),
    options: (Array.isArray(p.options) ? p.options : []).map((o) => ({
      id: o.id,
      text: o.text,
      votes: Number(o.votes || 0),
      mine: Boolean(o.mine),
    })),
  };
}

/** @param {{category?: string, sort?: string, limit?: number, offset?: number, q?: string}} [opts] */
export async function listPosts(opts = {}) {
  const { category = 'all', sort = 'fresh', limit = CONFIG.forum.pageSize, offset = 0, q = '' } = opts;

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
  /*
    Поиск по названию и тексту. ilike ищет без учёта регистра, звёздочки —
    подстановочные знаки PostgREST, как у LIKE в Postgres. Введённые человеком
    «*» в запросе ведут себя так же — это не баг, а то же правило, что
    в поиске любой базы.
  */
  const query = String(q ?? '').trim();
  if (query) {
    params.set('or', `(title.ilike.*${query}*,body.ilike.*${query}*)`);
  }

  const rows = await rest(`/forum_post_list?${params}`, { retryOnAbort: true });
  const hasMore = Array.isArray(rows) && rows.length > limit;
  const posts = (hasMore ? rows.slice(0, limit) : (Array.isArray(rows) ? rows : []))
    .map(postOut);

  return { posts, total: offset + posts.length + (hasMore ? 1 : 0) };
}

export async function getPost(id) {
  const rows = await rest(`/forum_post_list?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, {
    retryOnAbort: true,
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? postOut(row) : null;
}

/**
 * Один просмотр темы.
 *
 * Отдельная функция, а не инкремент внутри getPost: getPost зовётся и для
 * пересортировки ленты, и после реакции, и после правки — каждая такая
 * перерисовка не должна считать новый просмотр. Просмотр — это переход
 * в тему, и его регистрирует страница в одном месте (см. mount.js).
 *
 * Инкремент делает функция в базе (forum_register_view): по правилам строк
 * чужой пост вообще нельзя править, а счётчик должен расти у любого.
 */
export async function registerView(postId) {
  await rest('/rpc/forum_register_view', {
    method: 'POST',
    body: { target_post: postId },
  });
}

export async function votePoll(pollId, optionId) {
  await rest('/forum_poll_votes', {
    method: 'POST',
    body: { poll_id: pollId, option_id: optionId },
  });
}

export async function unvotePoll(pollId, optionId) {
  await rest(
    `/forum_poll_votes?poll_id=eq.${encodeURIComponent(pollId)}&option_id=eq.${encodeURIComponent(optionId)}`,
    { method: 'DELETE' }
  );
}

export async function closePoll(pollId) {
  await rest(`/forum_polls?id=eq.${encodeURIComponent(pollId)}`, {
    method: 'PATCH',
    body: { closed: true },
  });
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

  if (draft.poll && Array.isArray(draft.poll.options) && draft.poll.options.length >= 2) {
    const pollRows = await rest('/forum_polls', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        post_id: created.id,
        question: draft.poll.question,
        multiple: Boolean(draft.poll.multiple),
      },
    });
    const poll = Array.isArray(pollRows) ? pollRows[0] : pollRows;
    if (poll?.id) {
      const options = draft.poll.options
        .map((text, i) => ({ poll_id: poll.id, text, position: i }))
        .filter((o) => o.text.trim());
      if (options.length >= 2) {
        await rest('/forum_poll_options', { method: 'POST', body: options });
      }
    }
  }

  const full = await getPost(created.id);
  return full ?? postOut(created);
}

export async function editPost(id, patch) {
  const body = { edited_at: new Date().toISOString() };
  if (patch.title != null) body.title = patch.title;
  if (patch.body != null) body.body = patch.body;
  if (patch.category != null) {
    // Раздел проверяем и здесь: база откажет, но своя ошибка понятнее.
    if (!CATEGORY_IDS.includes(patch.category)) throw new Error('Неизвестный раздел');
    body.category = patch.category;
  }

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

/**
 * ЗАКРЕПЛЕНИЕ ТЕМЫ — модерация: свои темы так нельзя двигать в топ.
 *
 * Проверка лимита здесь нужна для понятного сообщения, а не для защиты:
 * её можно обойти запросом мимо сайта, и тогда откажет триггер в базе
 * (supabase/schema.sql), где живёт то же число CONFIG.forum.limits.pinsMax.
 */
export async function setPinned(id, pinned) {
  pinned = Boolean(pinned);
  if (pinned) {
    const rows = await rest('/forum_posts?select=id&pinned=eq.true&deleted=eq.false');
    const count = Array.isArray(rows) ? rows.length : 0;
    if (count >= CONFIG.forum.limits.pinsMax) {
      throw new Error('Закреплено уже три темы — сначала открепите одну');
    }
  }

  await rest(`/forum_posts?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { pinned } });
  const full = await getPost(id);
  if (!full) throw new Error('Пост не найден после закрепления');
  return full;
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
    authorIsBlogger: Boolean(row.author_is_blogger),
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
    `/forum_comment_list?select=*&post_id=eq.${encodeURIComponent(postId)}&order=created_at.asc`,
    { retryOnAbort: true }
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

/**
 * Отметка блогера.
 *
 * Не роль и не ограничение: просто галочка «человек ведёт блог», поэтому
 * живёт тем же прямым PATCH'ем через политику forum_users_moderate
 * (модерация правит профили). Обратимо тем же нажатием.
 */
export async function setBlogger(userId, isBlogger) {
  await rest(`/forum_users?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: { is_blogger: Boolean(isBlogger) },
  });
}

/**
 * Отметка лидера альянса: право создавать закрытые чаты. Не роль сайта —
 * доверие своему альянсу. Выдаёт модерация, снимается тем же нажатием.
 */
export async function setLeader(userId, isLeader) {
  await rest(`/forum_users?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: { is_leader: Boolean(isLeader) },
  });
}

/**
 * УДАЛЕНИЕ АККАУНТА.
 *
 * Так же, как сброс пароля, это живёт функцией в базе (forum_admin_delete_user):
 * удалять строки напрямую может только служебный ключ, а его на сайте нет.
 * Функция проверяет, что вызвавший — администратор, и только потом удаляет.
 * Посты и комментарии игрока при этом остаются: ник лежит копией в записи.
 */
export async function adminDeleteUser(userId) {
  await rest('/rpc/forum_admin_delete_user', {
    method: 'POST',
    body: { target_user: userId },
  });
}

/* ── Уведомления ───────────────────────────────────────────────────────────── */

/*
  Пишет их база триггерами (supabase/rich-forum.sql), а не сайт. Здесь только
  чтение своих строк и пометка прочитанным. Политика доступа сама отдаёт
  только свои уведомления (forum_notifications_read), фильтр по получателю
  поэтому не нужен — права отвечают на «что мне можно», а не на «кто я».

  Тот же вопрос, что с профилем: не полагаться на правила, что в ответе
  только мои строки. Здесь это сделать нечем: у модерации к уведомлениям
  доступа нет вовсе, а участник видит только свои — пересечения нет.
*/
function notificationOut(row) {
  return {
    id: row.id,
    userId: row.user_id,
    actorId: row.actor_id || null,
    actorNick: row.actor_nick || '',
    kind: row.kind,
    postId: row.post_id || null,
    commentId: row.comment_id || null,
    preview: row.preview || '',
    readAt: toDate(row.read_at),
    createdAt: toDate(row.created_at) ?? new Date(),
  };
}

export async function listNotifications() {
  const rows = await rest('/forum_notifications?select=*&order=created_at.desc&limit=50');
  return (Array.isArray(rows) ? rows : []).map(notificationOut);
}

export async function markNotificationsRead(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  await rest(`/forum_notifications?id=in.(${ids.map(encodeURIComponent).join(',')})`, {
    method: 'PATCH',
    body: { read_at: new Date().toISOString() },
  });
}

export async function markAllNotificationsRead() {
  await rest('/forum_notifications?read_at=is.null', {
    method: 'PATCH',
    body: { read_at: new Date().toISOString() },
  });
}

/* ── Закрытые чаты ────────────────────────────────────────────────────────── */
/*
  Устройство — в supabase/chats.sql. Здесь только перевод строк базы в объекты
  и обратно. Кто что видит, решают политики: гость не получит ни одной строки,
  участник — только свои чаты, модерация — все.
*/

function chatOut(row) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind || 'alliance',
    allianceTag: row.alliance_tag || '',
    ownerId: row.owner_id,
    ownerNick: row.owner_nick || '',
    inviteCode: row.invite_code || '',
    maxMembers: Number(row.max_members || 200),
    closed: Boolean(row.closed),
    closedReason: row.closed_reason || '',
    avatarUrl: row.avatar_url || '',
    createdAt: toDate(row.created_at) ?? new Date(),
    memberCount: Number(row.member_count || 0),
    onlineCount: Number(row.online_count || 0),
    myRole: row.my_role || null,
    unread: Number(row.unread_count || 0),
    lastBody: row.last_body || '',
    lastNick: row.last_nick || '',
    lastAt: toDate(row.last_at),
    pinnedBody: row.pinned_body || null,
    pinnedNick: row.pinned_nick || null,
  };
}

function chatMessageOut(row) {
  return {
    id: row.id,
    chatId: row.chat_id,
    authorId: row.author_id,
    authorNick: row.author_nick || '',
    authorAvatar: row.author_avatar || '',
    authorAlliance: row.author_alliance || '',
    authorRole: row.author_role || 'member',
    authorIsLeader: Boolean(row.author_is_leader),
    body: row.body,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    poll: row.poll || null,
    replyTo: row.reply_to || null,
    reactions: row.reactions && typeof row.reactions === 'object' ? row.reactions : {},
    deleted: Boolean(row.deleted),
    deletedReason: row.deleted_reason || '',
    createdAt: toDate(row.created_at) ?? new Date(),
  };
}

function chatMemberOut(row) {
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    nick: row.nick || '',
    avatarUrl: row.avatar_url || '',
    allianceTag: row.alliance_tag || '',
    isLeader: Boolean(row.is_leader),
    role: row.role || 'member',
    joinedAt: toDate(row.joined_at) ?? new Date(),
    lastSeenAt: toDate(row.last_seen_at),
    typingAt: toDate(row.typing_at),
  };
}

/** Мои чаты (для модерации — все). Непрочитанные и свежие сверху. */
export async function listChats() {
  const rows = await rest('/forum_chat_list?select=*&order=last_at.desc.nullslast,created_at.desc', { retryOnAbort: true });
  return (Array.isArray(rows) ? rows : []).map(chatOut);
}

export async function getChat(id) {
  const rows = await rest(`/forum_chat_list?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return Array.isArray(rows) && rows[0] ? chatOut(rows[0]) : null;
}

export async function createChat({ title, kind = 'alliance', allianceTag = '' }) {
  const rows = await rest('/forum_chats', {
    method: 'POST',
    prefer: 'return=representation',
    body: { title: String(title), kind, alliance_tag: String(allianceTag || '') },
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  return (await getChat(created.id)) ?? chatOut(created);
}

export async function joinChat(code) {
  const id = await rest('/rpc/forum_chat_join', { method: 'POST', body: { code: String(code).trim() } });
  return String(id).replace(/"/g, '');
}

export async function leaveChat(chatId) {
  const me = currentUserId();
  await rest(`/forum_chat_members?chat_id=eq.${encodeURIComponent(chatId)}&user_id=eq.${encodeURIComponent(me)}`, { method: 'DELETE' });
}

export async function listChatMembers(chatId) {
  const rows = await rest(`/forum_chat_member_list?select=*&chat_id=eq.${encodeURIComponent(chatId)}&order=role.asc,nick.asc`);
  return (Array.isArray(rows) ? rows : []).map(chatMemberOut);
}

export async function setChatMemberRole(chatId, userId, role) {
  await rest(`/forum_chat_members?chat_id=eq.${encodeURIComponent(chatId)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH', body: { role },
  });
}

export async function kickChatMember(chatId, userId) {
  await rest(`/forum_chat_members?chat_id=eq.${encodeURIComponent(chatId)}&user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

/**
 * Сообщения — последние `limit`, в хронологическом порядке. `before` —
 * для подгрузки истории вверх: дата самого старого уже показанного.
 */
export async function listChatMessages(chatId, { limit = 60, before = null } = {}) {
  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('chat_id', `eq.${chatId}`);
  params.set('order', 'created_at.desc');
  params.set('limit', String(limit));
  if (before) params.set('created_at', `lt.${new Date(before).toISOString()}`);
  const rows = await rest(`/forum_chat_message_list?${params}`, { retryOnAbort: true });
  return (Array.isArray(rows) ? rows : []).map(chatMessageOut).reverse();
}

export async function sendChatMessage(chatId, body, opts = {}) {
  const me = await currentUser();
  const payload = { chat_id: chatId, body: String(body || '') };
  if (Array.isArray(opts.attachments) && opts.attachments.length) payload.attachments = opts.attachments;
  if (opts.poll) payload.poll = opts.poll;
  if (opts.replyTo) payload.reply_to = opts.replyTo;

  const rows = await rest('/forum_chat_messages', {
    method: 'POST',
    prefer: 'return=representation',
    body: payload,
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  const out = chatMessageOut(created);
  /*
    ВАЖНО: ответ от /forum_chat_messages — это сырая строка таблицы, где
    нет join с forum_profiles (аватарка, тег, роль). Подставляем из текущего
    пользователя сразу, чтобы аватарка автора не пропадала в момент отправки.
  */
  if (!out.authorAvatar && me?.avatarUrl) out.authorAvatar = me.avatarUrl;
  if (!out.authorAlliance && me?.allianceTag) out.authorAlliance = me.allianceTag;
  if (!out.authorRole && me?.role) out.authorRole = me.role;
  if (!out.authorIsLeader && me?.isLeader) out.authorIsLeader = Boolean(me.isLeader);
  return out;
}

export async function deleteChatMessage(id, reason = '') {
  await rest(`/forum_chat_messages?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: { deleted: true, deleted_reason: String(reason || '') },
  });
}

export async function reactChatMessage(messageId, emoji) {
  const me = currentUserId();
  if (!me) return;
  const rows = await rest(`/forum_chat_messages?id=eq.${encodeURIComponent(messageId)}&select=reactions`);
  const row = Array.isArray(rows) ? rows[0] : rows;
  const src = (row && typeof row.reactions === 'object' && row.reactions) ? row.reactions : {};
  // Глубокая копия: реакции — массивы id, мутация原物 сломает кэш.
  const reactions = {};
  for (const [k, v] of Object.entries(src)) {
    if (Array.isArray(v)) reactions[k] = [...v];
  }

  // Найти, какой эмодзи этот пользователь уже выбрал.
  let currentEmoji = null;
  for (const [key, voters] of Object.entries(reactions)) {
    if (voters.includes(me)) { currentEmoji = key; break; }
  }

  // Убрать из старого.
  if (currentEmoji && reactions[currentEmoji]) {
    reactions[currentEmoji] = reactions[currentEmoji].filter((id) => id !== me);
    if (!reactions[currentEmoji].length) delete reactions[currentEmoji];
  }

  // Поставить в новый, если это не повторный клик (снятие).
  if (currentEmoji !== emoji) {
    reactions[emoji] = [...(reactions[emoji] || []), me];
  }

  await rest(`/forum_chat_messages?id=eq.${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    body: { reactions },
  }).catch(() => {});
}

export async function voteChatPoll(messageId, optionIndex) {
  const rows = await rest(`/forum_chat_messages?id=eq.${encodeURIComponent(messageId)}&select=poll`);
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.poll || !Array.isArray(row.poll.options)) return;
  const me = currentUserId();
  if (!me) return;
  const poll = { ...row.poll };
  const opt = poll.options[optionIndex];
  if (!opt) return;

  opt.voters = Array.isArray(opt.voters) ? opt.voters : [];
  const idx = opt.voters.indexOf(me);
  if (idx >= 0) {
    opt.voters.splice(idx, 1);
  } else {
    if (!poll.multiple) {
      for (const o of poll.options) {
        if (Array.isArray(o.voters)) o.voters = o.voters.filter((v) => v !== me);
        o.votes = (o.voters || []).length;
      }
    }
    opt.voters.push(me);
  }
  opt.votes = opt.voters.length;
  poll.total = new Set(poll.options.flatMap((o) => o.voters || [])).size;

  await rest(`/forum_chat_messages?id=eq.${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    body: { poll },
  }).catch(() => {});
}

export async function deleteChat(chatId) {
  await rest(`/forum_chats?id=eq.${encodeURIComponent(chatId)}`, { method: 'DELETE' });
}

export async function markChatRead(chatId) {
  const me = currentUserId();
  if (!me) return;
  await rest(`/forum_chat_members?chat_id=eq.${encodeURIComponent(chatId)}&user_id=eq.${encodeURIComponent(me)}`, {
    method: 'PATCH', body: { last_read_at: new Date().toISOString() },
  }).catch(() => {});
}

export async function updateChat(chatId, patch) {
  const body = {};
  if (patch.title != null) body.title = String(patch.title);
  if (patch.allianceTag != null) body.alliance_tag = String(patch.allianceTag);
  if (patch.closed != null) body.closed = Boolean(patch.closed);
  if (patch.closedReason != null) body.closed_reason = String(patch.closedReason);
  await rest(`/forum_chats?id=eq.${encodeURIComponent(chatId)}`, { method: 'PATCH', body });
}

export async function rotateChatCode(chatId) {
  const code = await rest('/rpc/forum_chat_rotate_code', { method: 'POST', body: { target: chatId } });
  return String(code).replace(/"/g, '');
}

/** Модерация: удалить чат целиком со всеми сообщениями. */
export async function adminDeleteChat(chatId) {
  await rest(`/forum_chats?id=eq.${encodeURIComponent(chatId)}`, { method: 'DELETE' });
}

export async function pinChatMessage(chatId, messageId) {
  await rest('/rpc/forum_chat_pin', { method: 'POST', body: { target_chat: chatId, target_msg: messageId } });
}

export async function unpinChatMessage(chatId) {
  await rest('/rpc/forum_chat_unpin', { method: 'POST', body: { target_chat: chatId } });
}

export async function setTyping(chatId) {
  await rest('/rpc/forum_chat_set_typing', { method: 'POST', body: { target_chat: chatId } }).catch(() => {});
}

export async function createDM(otherUserId) {
  const id = await rest('/rpc/forum_chat_create_dm', { method: 'POST', body: { other_user: otherUserId } });
  return String(id).replace(/"/g, '');
}

export async function chatLeaderboard() {
  const rows = await rest('/forum_chat_leaderboard?select=*');
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    userId: r.user_id,
    nick: r.nick || '',
    avatarUrl: r.avatar_url || '',
    allianceTag: r.alliance_tag || '',
    messageCount: Number(r.message_count || 0),
  }));
}
