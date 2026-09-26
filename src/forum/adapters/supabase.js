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
import { CATEGORY_IDS, REACTION_IDS, TOPIC_TAG_IDS, reactionMeta } from '../rules.js';
import { nickToEmail } from '../nick-email.js';
import { normalizeQuietWindow } from '../quiet.js';
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
    leaderOf: row.leader_of || '',
    canEditSite: Boolean(row.can_edit_site) || row.role === 'admin',
    createdAt: toDate(row.created_at) ?? new Date(),
    mutedUntil: toDate(row.muted_until),
    banned: Boolean(row.banned),
    banReason: row.ban_reason || '',
    isVerified: Boolean(row.is_verified),
    verifiedBy: row.verified_by || null,
    verifiedAt: toDate(row.verified_at),
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
  // Забаненного впускаем и молчим при входе: причину он прочитает на форуме,
  // а писать ему всё равно не даст база, не эта строка.
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
    authorIsVerified: Boolean(row.author_is_verified),
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    title: row.title,
    body: row.body,
    createdAt: toDate(row.created_at) ?? new Date(),
    editedAt: toDate(row.edited_at) ?? undefined,
    /*
      Срок действия темы. null означает «срок не назначен» и это законное
      состояние для любой метки, кроме «Набор» и «Срочно»: их проверяет база
      (триггер forum_posts_expiry), а не страница.
    */
    expiresAt: toDate(row.expires_at) ?? null,
    /*
      Момент встречи и лимит мест. Оба пустые у обычной темы, и это законное
      состояние: колонки добавлены ради календаря, а живут у темы (см. шаг 1
      supabase/20260925-event-rsvp.sql). Требование даты при метке «Событие»
      смотрит триггер, а не эта строка.
    */
    eventAt: toDate(row.event_at) ?? null,
    eventCapacity: Number(row.event_capacity ?? 0) || null,
    /*
      Бартер-доска: две стороны обмена и отметка закрытия. Колонки живут у темы
      и объявлением её делает метка, а не отдельная таблица (шаг 1
      supabase/20260926-barter-board.sql). До прогона миграции колонок в строке
      нет вовсе — отсюда null, а не ошибка.
    */
    barterGives: row.barter_gives || null,
    barterWants: row.barter_wants || null,
    barterClosedAt: toDate(row.barter_closed_at) ?? null,
    pinned: Boolean(row.pinned),
    deleted: Boolean(row.deleted),
    deletedReason: row.deleted_reason || '',
    views: Number(row.views || 0),
    commentCount: Number(row.comment_count || 0),
    reactions: counts,
    myReaction: row.my_reaction || null,
    /*
      Свой ответ на приглашение. Лента обязана знать, что человек уже отвечал,
      иначе кнопка «буду» на открытой теме выглядела бы нетронутой. Поля нет в
      строке, пока миграцию не прогнали, — отсюда пустое значение, а не ошибка.
    */
    myRsvp: row.my_rsvp || null,
    /*
      Срок напоминания из той же строки ответов. Без него селект в карточке
      темы каждый раз открывался бы с «не напоминать», хотя будильник стоит.
    */
    myRemindMinutes: row.my_remind_minutes == null ? null : Number(row.my_remind_minutes),
    /*
      Благодарности. Число — общее, отметка — своя (та же граница приватности,
      что у my_reaction: ленте нужно знать себя, а не то, кто кого благодарил).
      Колонок нет, пока не прогнана 20260926-author-thanks.sql, поэтому пусто,
      а не ошибка.
    */
    thanksCount: Number(row.thanks_count || 0),
    iThanked: Boolean(row.i_thanked),
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

/** @param {{category?: string, tag?: string, sort?: string, limit?: number, offset?: number, q?: string, saved?: boolean}} [opts] */
export async function listPosts(opts = {}) {
  const { category = 'all', tag = 'all', sort = 'fresh', limit = CONFIG.forum.pageSize, offset = 0, q = '', saved = false } = opts;

  const ORDER = {
    fresh: 'pinned.desc,created_at.desc',
    top: 'pinned.desc,score.desc,created_at.desc',
    talked: 'pinned.desc,comment_count.desc,created_at.desc',
  };

  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('deleted', 'eq.false');
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
  if (tag !== 'all' && TOPIC_TAG_IDS.includes(tag)) params.set('tags', `cs.{${tag}}`);
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
  /*
    Фильтр «мои закладки» разворачивается в список id ДО запроса ленты, а не
    после: после пришлось бы резать уже отсортированную страницу, и «Показать
    ещё» считалось бы по чужому числу. Порядок человек выбирает сам (свежее,
    лучшее, обсуждаемое) — закладка не право на первое место, а метка чтения.

    Гостю список пуст по той же причине, по какой ему не видно кнопок: читать
    нечего, и спрашивать базу незачем.
  */
  if (saved) {
    if (!currentUserId()) return { posts: [], total: 0 };
    const rows = await rest(
      `/forum_bookmarks?select=post_id&order=created_at.desc&limit=${CONFIG.forum.limits.savedWindow}`
    );
    const ids = (Array.isArray(rows) ? rows : []).map((row) => row.post_id);
    if (!ids.length) return { posts: [], total: 0 };
    params.set('id', `in.(${ids.map((id) => encodeURIComponent(id)).join(',')})`);
  }

  const rows = await rest(`/forum_post_list?${params}`, { retryOnAbort: true });
  const hasMore = Array.isArray(rows) && rows.length > limit;
  const posts = (hasMore ? rows.slice(0, limit) : (Array.isArray(rows) ? rows : []))
    .map(postOut);
  if (currentUserId() && posts.length) {
    /*
      Подписки, закладки и счётчик новых ответов — три независимых запроса, и
      ждут их вместе: каждый ничего не знает про соседа.

      Счётчик берётся из представления forum_topic_unread, а не из колонки
      ленты: forum_post_list — большое представление, и каждая тема в нём
      на счету, а поле нужно ровно одному блоку карточки. Отказ этого запроса
      гасит только знак «новых», но не ленту: человек увидит темы без счётчика
      там, где мог бы увидеть темы целиком.
    */
    const [subscriptions, unreadRows, bookmarkRows] = await Promise.all([
      rest('/forum_topic_subscriptions?select=post_id'),
      rest('/forum_topic_unread?select=post_id,unread').catch(() => []),
      /*
        Закладки — третий такой же запрос, и он первым прощается с ошибкой:
        таблицы ещё может не быть (миграцию ставят руками), а лента без
        флажка «в закладках» — обычная лента, а не сломанная.
      */
      rest('/forum_bookmarks?select=post_id').catch(() => []),
    ]);
    const subscribed = new Set((Array.isArray(subscriptions) ? subscriptions : []).map((row) => row.post_id));
    const bookmarked = new Set((Array.isArray(bookmarkRows) ? bookmarkRows : []).map((row) => row.post_id));
    const unread = new Map();
    for (const row of Array.isArray(unreadRows) ? unreadRows : []) {
      unread.set(row.post_id, Number(row.unread || 0));
    }
    posts.forEach((post) => {
      post.subscribed = subscribed.has(post.id);
      post.saved = bookmarked.has(post.id);
      post.unread = unread.get(post.id) || 0;
    });
  }

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

/**
 * Отметка «я здесь был».
 *
 * Ставится там же, где просмотр (см. mount.js): человек вошёл в тему — он её и
 * прочитал. Просмотр считается у любого, отметка — только у вошедшего, потому
 * что она привязана к человеку.
 *
 * Пишет её функция базы (forum_read_topic), а не запись в таблицу: по правилам
 * строк свою строку отметки можно только добавить, а передвигать отметку
 * при каждом входе приходится — rpc делает это одним запросом.
 */
export async function markRead(postId) {
  await rest('/rpc/forum_read_topic', {
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
  const tags = [...new Set((draft.tags || []).filter((tag) => TOPIC_TAG_IDS.includes(tag)))].slice(0, 3);

  const payload = {
    category: draft.category,
    title: draft.title,
    body: draft.body,
    tags,
    /*
      Срок уезжает в базу как есть, без местной проверки: границ (от суток до
      90 дней) и требования срока для «Набора», «Срочно» и «Обмена» держит
      триггер forum_posts_expiry, и его текст человек видит целиком. Дублировать
      отказ здесь значило бы однажды разойтись с базой формулировкой.
    */
    expires_at: draft.expiresAt ?? null,
  };

  /*
    Бартер: две стороны обмена. Как и момент встречи, это колонки темы, и их
    обязывает метка, а не страница: обе строки требует триггер
    forum_posts_barter, длину — проверка таблицы.

    Поля прикладываются только когда их попросили: до прогона
    20260926-barter-board.sql PostgREST отверг бы весь запрос из-за неизвестного
    столбца, и встала бы не доска, а весь форум.
  */
  if (draft.barterGives != null || draft.barterWants != null) {
    payload.barter_gives = draft.barterGives ?? null;
    payload.barter_wants = draft.barterWants ?? null;
  }

  /*
    Момент встречи и места — те же колонки темы, что и срок действия: событие
    у нас и есть тема с меткой «Событие». Границы (не меньше десяти минут
    вперёд, не дальше 90 дней, места от 2 до 200) держит триггер
    forum_posts_event_at, и его текст человек видит целиком.

    Поля прикладываются только когда их попросили. Колонки добавлены последней
    миграцией, а PostgREST отвергает запрос с неизвестным столбцом целиком:
    отправляй event_at у каждой обычной темы — и до прогона
    20260925-event-rsvp.sql встанет весь форум, а не только календарь.
  */
  if (draft.eventAt != null || draft.eventCapacity != null) {
    payload.event_at = draft.eventAt ?? null;
    if (draft.eventCapacity != null) payload.event_capacity = Number(draft.eventCapacity);
  }

  const rows = await rest('/forum_posts', {
    method: 'POST',
    prefer: 'return=representation',
    body: payload,
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

/**
 * Срок действия темы: продлить, назначить заново или снять.
 *
 * Право на это решает RLS: строку правит автор, а модерация — любую. Границы
 * срока проверяет база (триггер forum_posts_expiry), и её текст отказа
 * страница показывает как есть — человек видит названный срок, а не «операция
 * не выполнена».
 *
 * Отдельная функция, а не patch внутри editPost: продление — это одно поле, и
 * открывать ради него правку текста значило бы давать человеку редактор
 * там, где ему нужны три кнопки.
 */
export async function setExpiry(id, expiresAt) {
  await rest(`/forum_posts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { expires_at: expiresAt ?? null },
  });
  const full = await getPost(id);
  if (!full) throw new Error('Пост не найден после продления');
  return full;
}

/**
 * Снять объявление с доски или вернуть его.
 *
 * Отметка закрытия — та же колонка темы, что и срок действия, поэтому и право
 * на неё решает RLS: строку правит автор, модерация — любую. Двери здесь нет
 * нарочно: «это моя тема» — единственное правило, а его политика умеет отвечать
 * сама. Тема при этом не удаляется: под объявлением могли договориться другие,
 * и их ответы исчезли бы вместе с ним.
 */
export async function closeBarter(id, closed) {
  await rest(`/forum_posts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { barter_closed_at: closed ? new Date().toISOString() : null },
  });
  const full = await getPost(id);
  if (!full) throw new Error('Пост не найден после снятия объявления');
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
    authorIsVerified: Boolean(row.author_is_verified),
    body: row.body,
    createdAt: toDate(row.created_at) ?? new Date(),
    deleted: Boolean(row.deleted),
    deletedReason: row.deleted_reason || '',
    reactions: counts,
    myReaction: row.my_reaction || null,
    thanksCount: Number(row.thanks_count || 0),
    iThanked: Boolean(row.i_thanked),
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

/* ── Благодарности и репутация ────────────────────────────────────────────── */

/**
 * Поблагодарить автора темы или ответа.
 *
 * Одна строка на функцию базы (forum_give_thank), и сама функция решает всё:
 * своего автора, удалённую запись, повтор и частоту. Таблица при этом закрыта
 * от записи политикой — иначе отказ базового ограничения («нарушена политика
 * доступа») заменил бы человеку причину, по которой не вышло.
 *
 * @param {'post'|'comment'} targetType
 * @param {string} targetId
 */
export async function giveThanks(targetType, targetId) {
  await rest('/rpc/forum_give_thank', {
    method: 'POST',
    body: { p_target_type: targetType, p_target_id: targetId },
  });
}

/**
 * Награда владельца: начисление очков репутации с обязательным пояснением.
 * Строка неизменяема — ни правки, ни удаления, поэтому «исправить» означает
 * вторую запись с обратным знаком, и обе остаются в истории.
 */
export async function grantReputation(userId, delta, reason) {
  await rest('/rpc/forum_grant_reputation', {
    method: 'POST',
    body: { p_user: userId, p_delta: Number(delta), p_reason: String(reason ?? '') },
  });
}

/** История начислений: своя — игроку, вся — модерации (аргумент пуст). */
export async function listReputationGrants(userId = null) {
  const rows = await rest('/rpc/forum_reputation_grant_list', {
    method: 'POST',
    body: { p_user: userId || null },
  });
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    nick: r.nick || '',
    delta: Number(r.delta || 0),
    reason: r.reason || '',
    grantedByNick: r.granted_by_nick || 'владелец ушёл',
    createdAt: toDate(r.created_at) ?? new Date(),
  }));
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
    targetAutoHidden: Boolean(r.target_auto_hidden),
  }));
}

/** Жалоба разобрана. Строку не удаляем: список решений — тоже история. */
export async function resolveReport(reportId) {
  await rest(`/forum_reports?id=eq.${encodeURIComponent(reportId)}`, {
    method: 'PATCH',
    body: { resolved: true },
  });
}

export async function subscribeTopic(postId) {
  await rest('/forum_topic_subscriptions', {
    method: 'POST', prefer: 'resolution=merge-duplicates', body: { post_id: postId },
  });
}

export async function unsubscribeTopic(postId) {
  await rest(`/forum_topic_subscriptions?post_id=eq.${encodeURIComponent(postId)}`, { method: 'DELETE' });
}

/**
 * Закладка — одна своя строка, и дверь ей не нужна: ни чужих строк здесь
 * никто не читает, ни на что одно нажатие не влияет. Идентификатор человека
 * ставит триггер базы из токена, поэтому тело запроса — ровно тема.
 *
 * Повторное нажатие не плодит строк: слияние по первичному ключу (post_id,
 * user_id) делает это одним запросом, а не проверкой «есть ли уже».
 */
export async function bookmarkTopic(postId) {
  await rest('/forum_bookmarks', {
    method: 'POST', prefer: 'resolution=merge-duplicates', body: { post_id: postId },
  });
}

export async function unbookmarkTopic(postId) {
  await rest(`/forum_bookmarks?post_id=eq.${encodeURIComponent(postId)}`, { method: 'DELETE' });
}

export async function subscribeAlliance(allianceId) {
  await rest('/forum_alliance_subscriptions', {
    method: 'POST', prefer: 'resolution=merge-duplicates', body: { alliance_id: allianceId },
  });
}

export async function unsubscribeAlliance(allianceId) {
  await rest(`/forum_alliance_subscriptions?alliance_id=eq.${encodeURIComponent(allianceId)}`, { method: 'DELETE' });
}

export async function listAllianceSubscriptions() {
  const rows = await rest('/forum_alliance_subscriptions?select=alliance_id');
  return (Array.isArray(rows) ? rows : []).map((row) => row.alliance_id);
}

export async function recordAllianceRankSnapshot(rows) {
  await rest('/rpc/forum_record_alliance_rank_snapshot', {
    method: 'POST', body: { p_rows: rows.map((row) => ({ alliance_id: row.allianceId, place: row.place, points: row.points })) },
  });
}

export async function restoreAutoHiddenContent(targetType, targetId) {
  const table = targetType === 'post' ? 'forum_posts' : 'forum_comments';
  await rest(`/${table}?id=eq.${encodeURIComponent(targetId)}`, {
    method: 'PATCH', body: { deleted: false, deleted_reason: '', deleted_at: null, auto_hidden: false },
  });
}

export async function listModerationQueue() {
  const rows = await rest('/forum_moderation_queue?select=*&order=report_count.desc,last_report_at.desc');
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    targetType: row.target_type,
    targetId: row.target_id,
    reportCount: Number(row.report_count) || 0,
    priority: row.priority || 'normal',
    firstReportAt: toDate(row.first_report_at),
    lastReportAt: toDate(row.last_report_at),
  }));
}

export async function listModerationActions() {
  const rows = await rest('/forum_moderation_actions?select=*&order=created_at.desc&limit=30');
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: String(row.id), actorNick: row.actor_nick || '', targetType: row.target_type,
    targetId: row.target_id, targetNick: row.target_nick || '', action: row.action,
    details: row.details || {}, createdAt: toDate(row.created_at) ?? new Date(),
  }));
}

export async function listUsers() {
  const rows = await rest('/forum_users?select=*&order=nick.asc');
  return (Array.isArray(rows) ? rows : []).map(userOut);
}

/* ── Сигналы о спаме ───────────────────────────────────────────────────────── */

/**
 * Список «на кого посмотреть». Считает его база, здесь только разбор строк.
 *
 * Функция, а не представление: темы и ответы читают все, и представление с
 * `security_invoker` отдало бы список подозреваемых кому угодно, включая гостя.
 * Отказ тоже важен: пустой список и «тебе не видно» — разные вещи, и панель
 * обязана различать их, поэтому ошибку вызывающий не глушит.
 * См. supabase/20260926-spam-signals.sql.
 */
function spamSignalOut(row) {
  return {
    userId: String(row.user_id),
    nick: row.nick || '',
    role: row.role || 'member',
    posts20m: Number(row.posts_20m) || 0,
    comments2m: Number(row.comments_2m) || 0,
    posts24h: Number(row.posts_24h) || 0,
    comments24h: Number(row.comments_24h) || 0,
    openReports: Number(row.open_reports) || 0,
    autoHidden: Number(row.auto_hidden) || 0,
    sectionMutes: Number(row.section_mutes) || 0,
    banned: Boolean(row.banned),
    mutedUntil: toDate(row.muted_until),
    lastActivity: toDate(row.last_activity),
    signals: Array.isArray(row.signals) ? row.signals : [],
  };
}

export async function listSpamSignals() {
  const rows = await rest('/rpc/forum_spam_signals', { method: 'POST', body: {} });
  return (Array.isArray(rows) ? rows : []).map(spamSignalOut);
}

/* ── Первые шаги новичка ──────────────────────────────────────────────────
 *
 * Одна функция базы (supabase/20260926-starter-checklist.sql) отвечает пятью
 * строками: ключ шага и сделано ли. Здесь из неё берётся ровно это — слова к
 * ключу подбирает страница, потому что база считает строки, а не окончания.
 *
 * Функция ничего не пишет и ни во что не превращается: вызывающий видит в ней
 * только свои строки теми же политиками, что и в таблицах. Без неё страница
 * форума делала бы пять запросов там, где один.
 *
 * Ошибку вызывающий глушит сам, и это не лень: блок новичка — подсказка. Ему
 * лучше исчезнуть, чем занять место на странице сообщением про миграцию.
 */
function starterStepOut(row) {
  return { id: String(row.step_key), done: Boolean(row.done) };
}

export async function listStarterSteps() {
  const rows = await rest('/rpc/forum_starter_checklist', { method: 'POST', body: {} });
  return (Array.isArray(rows) ? rows : []).map(starterStepOut);
}

/**
 * ВОССТАНОВЛЕНИЕ ДОСТУПА.
 *
 * Пароль придумывает сам игрок, а владелец может лишь возразить: заявка
 * принимает пароль через 12 часов сама, если её никто не отклонил. Порядок и
 * причины — в supabase/20260925-self-recovery.sql; здесь только пять вызовов,
 * которые этот порядок обслуживают.
 *
 * ВСЕ ОНИ ЖИВУТ ФУНКЦИЯМИ В БАЗЕ, и не из вежливости: сменить чужой пароль
 * напрямую может только служебный ключ, а его на сайте нет и быть не должно.
 * наружу уходит право «создать заявку» и право «отклонить», но не право «всё».
 *
 * КЛЮЧ НЕ ПОКИДАЕТ БРАУЗЕР ИГРОКА. В базу уходит SHA-256 от него, а обратно —
 * сам ключ: база сворачивает его ещё раз и сравнивает с тем, что лежит.
 * Поэтому владельцу из всего этого потока не виден ни один секрет — только ник
 * и время заявки.
 */

/** Шаг 1: игрок заводит заявку. keyHash — SHA-256 от его случайного ключа. */
export async function beginRecovery(nick, keyHash) {
  await rest('/rpc/forum_begin_recovery', {
    method: 'POST',
    body: { p_nick: String(nick).trim(), p_code_hash: keyHash },
  });
}

/**
 * Шаг 1.5: на каком она этапе.
 *
 * Возвращает `{ status, canSet, readyAt }`:
 *   status  — 'none' | 'pending' | 'approved' | 'rejected' | 'used' | 'expired';
 *   canSet  — можно ли уже ставить пароль;
 *   readyAt — когда заявка откроется сама, если владелец не вмешался.
 *
 * canSet считает база, поэтому страницу не обманет неправильное время на
 * устройстве игрока: она покажет поле ровно тогда, когда его пустит функция.
 *
 * Ответ 'none' база даёт и когда ника нет, и когда ключ не подходит, и когда
 * заявка уже закрыта: различать эти случаи наружу незачем, а смешивать удобно —
 * спрашивать статус можно, только предъявив ключ. Занят ли ник, при этом и так
 * открыто отвечает forum_check_nick, так что скрывать здесь нечего.
 */
export async function recoveryStatus(nick, key) {
  const rows = await rest('/rpc/forum_recovery_status', {
    method: 'POST',
    body: { p_nick: String(nick).trim(), p_code: key },
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || typeof row.status !== 'string') return { status: 'none', canSet: false, readyAt: null };
  return {
    status: row.status,
    canSet: row.canSet === true,
    readyAt: toDate(row.readyAt) ?? null,
  };
}

/** Шаг 3: игрок ставит новый пароль. Отсюда наружу не возвращается ничего. */
export async function finishRecovery(nick, key, password) {
  await rest('/rpc/forum_finish_recovery', {
    method: 'POST',
    body: { p_nick: String(nick).trim(), p_code: key, p_password: password },
  });
}

/*
 * Очередь для панели владельца. Читается представление, а не таблица: в нём
 * нет отпечатков ключей, так что даже открывший список не увидит ничего, чем
 * можно воспользоваться.
 */
export async function listRecoveryRequests() {
  const rows = await rest('/forum_recovery_requests?select=*&order=created_at.asc');
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    nick: row.nick || '',
    status: row.status,
    createdAt: toDate(row.created_at) ?? new Date(),
    readyAt: toDate(row.ready_at),
    decidedAt: toDate(row.decided_at),
    expiresAt: toDate(row.expires_at),
    decidedByNick: row.decided_by_nick || '',
  }));
}

/** Впустить досрочно или отклонить заявку. Право проверяет база. */
export async function reviewRecovery(id, approve) {
  await rest('/rpc/forum_review_recovery', {
    method: 'POST',
    body: { p_id: id, p_approve: Boolean(approve) },
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

/* ── Оспаривание запрета писать и тишины ───────────────────────────────────── */

function appealOut(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    userNick: row.user_nick || '',
    kind: row.kind,
    sanction: row.sanction || '',
    message: row.message || '',
    status: row.status,
    answer: row.answer || '',
    createdAt: toDate(row.created_at) ?? new Date(),
    decidedAt: toDate(row.decided_at),
    decidedByNick: row.decided_by_nick || '',
  };
}

/**
 * Заявки на пересмотр меры.
 *
 * Читаем представление, а не таблицу: модератору нужен ник заявителя, а
 * вытягивать его пришлось бы вторым запросом, который к тому же разбился бы
 * о политику forum_users (чужие профили участнику не отдают).
 *
 * Ошибку не глушим: таблица появилась позже всего остального, и вызывающий
 * сам решает, что ей делать. Ленте без очереди жить как жила, а панели
 * владельца по ней видно, какой SQL-файл ещё не выполнен.
 */
export async function listAppeals() {
  const rows = await rest('/forum_appeal_list?select=*&order=created_at.desc');
  return (Array.isArray(rows) ? rows : []).map(appealOut);
}

/**
 * Заявка игрока.
 *
 * Права на запись у таблицы нет ни у кого: инициатор — функция в базе,
 * иначе забаненный человек не прошёл бы через forum_can_write() и не мог бы
 * возразить именно против того запрета, который его и закрыл.
 */
export async function openAppeal(kind, message) {
  await rest('/rpc/forum_open_appeal', {
    method: 'POST',
    body: { p_kind: kind, p_message: String(message ?? '') },
  });
}

/** Решение модерации: «upheld» снимает ровно оспоренную меру. */
export async function reviewAppeal(id, status, answer) {
  await rest('/rpc/forum_review_appeal', {
    method: 'POST',
    body: { p_target: id, p_status: status, p_answer: String(answer ?? '') },
  });
}

/* ── Тишина в одном разделе ────────────────────────────────────────────────── */

function sectionMuteOut(row) {
  return {
    userId: String(row.user_id),
    category: row.category,
    mutedUntil: toDate(row.muted_until) ?? new Date(),
    reason: row.reason || '',
  };
}

/**
 * Тишины по разделам.
 *
 * Таблица читается напрямую, без представления, как forum_topic_reads: в ней
 * нет чужих имён — только пары «человек и раздел», и ник наложившего панели
 * не нужен (есть журнал модерации). Политика отдаёт игроку его строки, а
 * модерации — все.
 *
 * Ошибку не глушим: по ней панель видит, какой SQL-файл ещё не выполнен,
 * а лента решает сама, жить ей без этой подсказки или нет.
 */
export async function listSectionMutes(userId) {
  const rows = await rest(
    `/forum_section_mutes?select=*&user_id=eq.${encodeURIComponent(userId)}&order=muted_until.asc`
  );
  return (Array.isArray(rows) ? rows : []).map(sectionMuteOut);
}

/** Тишина в одном разделе; срок и право налагает база. */
export async function setSectionMute(userId, category, days, reason) {
  await rest('/rpc/forum_set_section_mute', {
    method: 'POST',
    body: {
      p_user_id: userId,
      p_category: category,
      p_days: Number(days),
      p_reason: String(reason ?? ''),
    },
  });
}

/** Снятие: та же функция, только без срока. */
export async function clearSectionMute(userId, category) {
  await rest('/rpc/forum_set_section_mute', {
    method: 'POST',
    body: { p_user_id: userId, p_category: category, p_days: null, p_reason: '' },
  });
}

/* ── Календарь встреч ─────────────────────────────────────────────────────── */

/**
 * Строка календаря.
 *
 * Числа участников приходят уже посчитанные: представление вызывает
 * forum_event_going и forum_event_maybe, которые работают правами владельца
 * схемы и отдают наружу только количество. Считать это в браузере нечем:
 * список ответов модерации и самому игроку политика отдаёт целиком, а гостю
 * не отдаёт вовсе, и без функций гость увидел бы пустой календарь.
 */
function eventOut(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    authorId: row.author_id,
    authorNick: row.author_nick,
    createdAt: toDate(row.created_at) ?? new Date(),
    /*
      Представление не отдаёт темы без момента: метка «Событие» старше этого
      правила, и такие темы на форуме уже есть. null здесь — только след
      прямой правки в SQL-редакторе, и страница обязана такую строку пропустить,
      а не показывать ей 1970 год.
    */
    eventAt: toDate(row.event_at),
    eventCapacity: row.event_capacity == null ? null : Number(row.event_capacity),
    goingCount: Number(row.going_count || 0),
    maybeCount: Number(row.maybe_count || 0),
    spotsLeft: row.spots_left == null ? null : Number(row.spots_left),
    myStatus: row.my_status || null,
    myRemindMinutes: row.my_remind_minutes == null ? null : Number(row.my_remind_minutes),
  };
}

/**
 * Лента календаря: хронологический порядок, предстоящие и прошедшие вместе.
 *
 * Деление на «ближе» и «позади» делает страница, а не база: один и тот же
 * запрос кормит и список, и «Моё расписание», и фильтровать его двумя
 * условиями значило бы вычитывать второе представление.
 *
 * Ошибку не глушим: представление появилось последней миграцией, и по её
 * тексту страница называет игроку файл, которого не хватает.
 */
export async function listEvents() {
  const rows = await rest('/forum_event_list?select=*&order=event_at.asc', { retryOnAbort: true });
  return (Array.isArray(rows) ? rows : []).map(eventOut);
}

/**
 * Ответ на приглашение.
 *
 * Прямой записи в таблицу нет: только функция в базе умеет сказать «мест
 * больше нет», проверяя и занимая место в одной операции. И права писать она
 * не требует — та же логика, что у апелляций.
 */
export async function answerEvent(postId, status, remindMinutes = null) {
  await rest('/rpc/forum_answer_event', {
    method: 'POST',
    body: {
      p_post: postId,
      p_status: status,
      p_remind_minutes: remindMinutes == null ? null : Number(remindMinutes),
    },
  });
}

/**
 * Назначить или перенести момент встречи.
 *
 * Отдельная функция, как setExpiry: перенос — это одна колонка, и открывать
 * ради неё редактор текста значило бы давать человеку поле с чужим постом
 * там, где ему нужны две кнопки.
 */
export async function setEventAt(id, eventAt, eventCapacity = null) {
  await rest(`/forum_posts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      event_at: eventAt,
      event_capacity: eventCapacity == null ? null : Number(eventCapacity),
    },
  });
  const full = await getPost(id);
  if (!full) throw new Error('Тема не найдена после переноса встречи');
  return full;
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
 * Лидерство привязано к альянсу: у лидера заполнен leader_of (тег альянса),
 * и на один альянс — один лидер. Назначает и снимает функция в базе
 * (forum_set_leader): она по-хозяйски снимает предыдущего лидера того же тега
 * и держит is_leader синхронным. Пустой тег = снятие.
 */
export async function setLeader(userId, allianceTag) {
  await rest('/rpc/forum_set_leader', {
    method: 'POST',
    body: { target_user: userId, leader_of: String(allianceTag || '') },
  });
}

/**
 * УДАЛЕНИЕ АККАУНТА.
 *
 * Как и восстановление доступа, это живёт функцией в базе (forum_admin_delete_user):
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

/* ── Ники и верификация ────────────────────────────────────────────────────── */

/*
  Защита ников и статус «проверенного игрока» живут функциями в базе
  (см. supabase/nicks-verified.sql): и право, и правила проверяются там,
  а этот код лишь пересказывает результат в понятном виде. Так владелец
  не даёт панели больше прав, чем есть у функции.
*/

/**
 * Живая проверка ника для формы: свободен / занят / зарезервирован.
 * База сравнивает по нормализованному ключу («Кремль» и «Крeмль» — одно).
 */
export async function checkNick(nick) {
  const res = await rest('/rpc/forum_check_nick', {
    method: 'POST',
    body: { nick: String(nick || '') },
  });
  return { status: res?.status || 'free' };
}

/** Подтвердить ник игрока; снять — повторным вызовом с false. */
export async function setVerified(userId, verified) {
  await rest('/rpc/forum_set_verified', {
    method: 'POST',
    body: { target_user: userId, verified: Boolean(verified) },
  });
}

/** Игрок меняет свой ник. База сама проверит формат, занятость и стоп-лист. */
export async function renameNick(newNick, reason = '') {
  await rest('/rpc/forum_rename_nick', {
    method: 'POST',
    body: { new_nick: String(newNick), reason: String(reason) },
  });
}

/** Владелец переименовывает игрока (например, тролля). Причина обязательна. */
export async function renameNickAs(userId, newNick, reason) {
  await rest('/rpc/forum_rename_nick_as', {
    method: 'POST',
    body: { target_user: userId, new_nick: String(newNick), reason: String(reason) },
  });
}

export async function listReservedNicks() {
  const rows = await rest('/rpc/forum_reserved_list', { method: 'POST', body: {} });
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    nick: r.nick,
    createdAt: toDate(r.created_at),
  }));
}

export async function addReservedNick(nick) {
  await rest('/rpc/forum_reserved_add', {
    method: 'POST',
    body: { nick: String(nick) },
  });
}

export async function removeReservedNick(nick) {
  await rest('/rpc/forum_reserved_remove', {
    method: 'POST',
    body: { nick: String(nick) },
  });
}

/**
 * История переименований игрока: старая/новая, кто (null — сам игрок),
 * причина и дата. Смотрит сам игрок и владелец.
 */
export async function nickHistory(userId) {
  const rows = await rest('/rpc/forum_nick_history_list', {
    method: 'POST',
    body: { target_user: userId },
  });
  return (Array.isArray(rows) ? rows : []).map((h) => ({
    createdAt: toDate(h.created_at),
    oldNick: h.old_nick,
    newNick: h.new_nick,
    changedBy: h.changed_by || null,
    reason: h.reason || '',
  }));
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
    myLastReadAt: toDate(row.my_last_read_at),
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
    authorIsVerified: Boolean(row.author_is_verified),
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
  // Сырая строка не знает о верификации — без подстановки своё только что
  // отправленное сообщение получало бы серую метку «не проверен».
  out.authorIsVerified = Boolean(me?.isVerified);
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
  // Глубокая копия: реакции — массивы id, мутация оригинала сломала бы кэш.
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
  });
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
  });
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

export async function createDM(otherUserNick) {
  const id = await rest('/rpc/forum_chat_create_dm', { method: 'POST', body: { other_nick: otherUserNick } });
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

/* ── Комментарии к летописи ────────────────────────────────────────────── */

function eventCommentOut(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    authorId: row.author_id,
    authorNick: row.author_nick || '',
    body: row.body,
    deleted: Boolean(row.deleted),
    deletedReason: row.deleted_reason || '',
    createdAt: toDate(row.created_at) ?? new Date(),
  };
}

export async function listEventComments(eventId) {
  const rows = await rest(
    `/forum_event_comments?select=*&event_id=eq.${encodeURIComponent(eventId)}&order=created_at.asc`
  );
  return (Array.isArray(rows) ? rows : []).map(eventCommentOut);
}

export async function addEventComment(eventId, body) {
  const rows = await rest('/forum_event_comments', {
    method: 'POST',
    prefer: 'return=representation',
    body: { event_id: eventId, body: String(body) },
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  return eventCommentOut(created);
}

export async function deleteEventComment(id, reason = '') {
  await rest(`/forum_event_comments?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { deleted: true, deleted_reason: String(reason || '') },
  });
}

/* ── Web Push подписки ─────────────────────────────────────────────────── */

export async function savePushSubscription(endpoint, keys) {
  // Если подписка на этот endpoint уже есть — убираем, потом вставляем.
  await rest(`/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' }).catch(() => {});
  await rest('/push_subscriptions', {
    method: 'POST',
    body: { endpoint, keys },
  });
}

export async function removePushSubscription(endpoint) {
  await rest(`/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: 'DELETE',
  });
}

/* ── Лайки на профили (репутация) ──────────────────────────────────────── */

export async function toggleProfileLike(userId) {
  const me = currentUserId();
  if (!me) throw new Error('Сначала войдите');
  if (me === userId) throw new Error('Нельзя лайкнуть самого себя');
  // Проверяем, есть ли уже лайк
  const existing = await rest(`/forum_profile_likes?from_user=eq.${me}&to_user=eq.${encodeURIComponent(userId)}`);
  if (Array.isArray(existing) && existing.length > 0) {
    await rest(`/forum_profile_likes?id=eq.${existing[0].id}`, { method: 'DELETE' });
    return { liked: false };
  }
  await rest('/forum_profile_likes', { method: 'POST', body: { from_user: me, to_user: userId } });
  return { liked: true };
}

/* ── Турниры (VS-матчапы) ─────────────────────────────────────────────────── */

function tournamentOut(row) {
  return {
    id: row.id,
    title: row.title || '',
    allyA: row.ally_a,
    allyB: row.ally_b,
    winsA: Number(row.wins_a || 0),
    winsB: Number(row.wins_b || 0),
    draws: Number(row.draws || 0),
    status: row.status || 'active',
    winner: row.winner || null,
    createdAt: toDate(row.created_at) ?? new Date(),
  };
}

export async function listTournaments() {
  const rows = await rest('/vs_tournaments?select=*&order=created_at.desc');
  return (Array.isArray(rows) ? rows : []).map(tournamentOut);
}

export async function createTournament(allyA, allyB, title = '') {
  if (allyA === allyB) throw new Error('Нужны два разных альянса');
  const rows = await rest('/vs_tournaments', {
    method: 'POST',
    prefer: 'return=representation',
    body: { ally_a: allyA, ally_b: allyB, title: String(title) },
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  return tournamentOut(created);
}

export async function addTournamentRound(tournamentId, winnerId = null, notes = '') {
  await rest('/vs_tournament_rounds', {
    method: 'POST',
    body: { tournament_id: tournamentId, winner: winnerId, notes: String(notes) },
  });
}

/* ── Гайды (wiki) ─────────────────────────────────────────────────────────── */

function guideOut(row, signals = []) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category || 'strategy',
    body: row.body,
    authorId: row.author_id,
    authorNick: row.author_nick || '',
    status: row.status || 'published',
    reviewStatus: row.review_status || 'none',
    reviewNote: row.review_note || '',
    reviewedAt: toDate(row.reviewed_at),
    signals,
    createdAt: toDate(row.created_at) ?? new Date(),
    updatedAt: toDate(row.updated_at) ?? new Date(),
  };
}

/*
  Сигналы игроков тянем отдельным запросом рядом со списком гайдов — тем же
  способом, каким лента склеивает подписки и счётчик непрочитанного. Причина
  здесь не размер, а живучесть: колонки обзора и таблица сигналов появились
  позже гайдов, и если миграция не выполнена, страница гайдов обязана открыться
  без знаков, а не ошибкой на весь экран. RLS сама решает, что увидит человек:
  модератору — все открытые сигналы, остальному — только свои.
*/
async function guideSignals() {
  const rows = await rest('/forum_guide_signals?select=guide_id,user_id,note,created_at&resolved=eq.false');
  return Array.isArray(rows) ? rows : [];
}

function signalsFor(rows, guideId) {
  return rows.filter((r) => r.guide_id === guideId)
    .map((r) => ({ note: r.note, createdAt: toDate(r.created_at) ?? new Date(), userId: r.user_id }));
}

export async function listGuides() {
  const [rows, sigs] = await Promise.all([
    rest('/forum_guides?select=*&status=eq.published&order=published_at.desc'),
    guideSignals().catch(() => []),
  ]);
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row) => guideOut(row, signalsFor(sigs, row.id)));
}

export async function getGuide(slug) {
  const [rows, sigs] = await Promise.all([
    rest(`/forum_guides?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`),
    guideSignals().catch(() => []),
  ]);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  return guideOut(row, signalsFor(sigs, row.id));
}

export async function createGuide(draft) {
  const rows = await rest('/forum_guides', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      slug: String(draft.slug),
      title: String(draft.title),
      category: String(draft.category || 'strategy'),
      body: String(draft.body),
    },
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  return guideOut(created);
}

export async function updateGuide(id, patch) {
  const body = {};
  if (patch.title != null) body.title = String(patch.title);
  if (patch.category != null) body.category = String(patch.category);
  if (patch.body != null) body.body = String(patch.body);
  if (patch.status != null) body.status = String(patch.status);
  const rows = await rest(`/forum_guides?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body,
  });
  const updated = Array.isArray(rows) ? rows[0] : rows;
  return guideOut(updated);
}

export async function deleteGuide(id) {
  await rest(`/forum_guides?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/*
  Оба действия идут через функции базы, а не прямым запросом к таблице.
  Отметку модерации нельзя доверить политике RLS: автор гайда вправе править
  свою строку, и вместе с текстом он унёс бы review_status. Решает триггер
  forum_guide_review_guard, а функция добавляет внятный отказ и дату решения.
  Сигнал игрока — про то же: повтор не должен плодить строки и должен
  объяснять, почему пять символов мало.
*/
export async function reviewGuide(id, status, note = '') {
  await rest('/rpc/forum_review_guide', {
    method: 'POST',
    body: { target: id, status: String(status), note: String(note ?? '') },
  });
}

export async function reportGuideStale(id, note) {
  await rest('/rpc/forum_report_guide_stale', {
    method: 'POST',
    body: { target: id, note: String(note ?? '') },
  });
}

/* ── Заявки на гайды ───────────────────────────────────────────────────────── */

function guideRequestOut(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userNick: row.user_nick || '',
    title: row.title,
    details: row.details || '',
    status: row.status || 'open',
    guideId: row.guide_id || null,
    answer: row.answer || '',
    createdAt: toDate(row.created_at) ?? new Date(),
    decidedAt: toDate(row.decided_at),
    decidedByNick: row.decided_by_nick || null,
  };
}

/*
  Список читается представлением с никами, а не голой таблицей: ник заявки
  нигде не хранится и берётся из профиля тем же порядком, что у очереди
  апелляций. Разбор по принадлежности делает политика forum_guide_requests, а
  не этот запрос: открытые строки видит и гость, разобранные — только автор и
  модерация.
*/
export async function listGuideRequests() {
  const rows = await rest('/forum_guide_request_list?select=*&order=created_at.desc&limit=200');
  return Array.isArray(rows) ? rows.map(guideRequestOut) : [];
}

/*
  Создание и отзыв идут через функции базы: «не больше трёх за сутки» и
  повтор названия политикой не выражаются, а отказ должен быть внятным, а не
  текстом нарушения ограничения. rpc возвращает один id, поэтому строку
  дочитываем отдельным запросом — иначе форма показывала бы заявку без ника и
  без времени, которые проставила база.
*/
export async function createGuideRequest(draft) {
  const id = await rest('/rpc/forum_open_guide_request', {
    method: 'POST',
    body: {
      p_title: String(draft.title ?? '').trim(),
      p_details: String(draft.details ?? '').trim(),
    },
  });
  const rows = await rest(`/forum_guide_request_list?id=eq.${encodeURIComponent(id)}&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error('Заявка не найдена сразу после отправки');
  return guideRequestOut(row);
}

export async function cancelGuideRequest(id) {
  await rest('/rpc/forum_cancel_guide_request', {
    method: 'POST',
    body: { p_target: id },
  });
}

export async function resolveGuideRequest(id, status, answer, guideId = null) {
  await rest('/rpc/forum_resolve_guide_request', {
    method: 'POST',
    body: {
      p_target: id,
      p_status: String(status),
      p_answer: String(answer ?? ''),
      p_guide: guideId || null,
    },
  });
}

/* ── Пульс обновлений игры ─────────────────────────────────────────────────── */

function updateNoteOut(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    sourceName: row.source_name || '',
    sourceUrl: row.source_url || '',
    sourceAt: toDate(row.source_at) ?? new Date(),
    gameVersion: row.game_version || '',
    status: row.status || 'published',
    authorNick: row.author_nick || '',
    createdAt: toDate(row.created_at) ?? new Date(),
    archivedAt: toDate(row.archived_at),
    archivedByNick: row.archived_by_nick || null,
  };
}

/*
  Список выходит представлением с никами: авторов у заметки две и ни у одной
  ник не хранится в самой таблице. Порядок задаёт source_at, а не created_at:
  читатель спрашивает, что изменилось в игре и когда, а не когда об этом
  вспомнил дежурный модератор. Ошибку не глушим: по ней страница называет файл
  миграции, которого не хватает, вместо вида «заметок нет».
*/
export async function listUpdateNotes() {
  const limit = CONFIG.forum.limits.updateListMax;
  const rows = await rest(
    `/forum_update_note_list?select=*&order=source_at.desc&limit=${limit}`,
    { retryOnAbort: true },
  );
  return (Array.isArray(rows) ? rows : []).map(updateNoteOut);
}

/*
  Публикация идёт только через функцию базы. Ссылку и дату обязана проверять
  база, а не форма: страница печатает href как есть, и один запрос мимо формы
  стоил бы чужого кода в браузере читателя. rpc отдаёт id новой строки, поэтому
  заметку дочитываем отдельным запросом — иначе карточка вышла бы без ника
  автора, который знала только база.
*/
export async function publishUpdateNote(draft) {
  const id = await rest('/rpc/forum_publish_update_note', {
    method: 'POST',
    body: {
      p_kind: String(draft.kind ?? ''),
      p_title: String(draft.title ?? '').trim(),
      p_summary: String(draft.summary ?? '').trim(),
      p_source_name: String(draft.sourceName ?? '').trim(),
      p_source_url: String(draft.sourceUrl ?? '').trim(),
      p_source_at: String(draft.sourceAt ?? ''),
      p_game_version: String(draft.gameVersion ?? '').trim(),
    },
  });
  const rows = await rest(`/forum_update_note_list?id=eq.${encodeURIComponent(id)}&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error('Заметка не найдена сразу после публикации');
  return updateNoteOut(row);
}

export async function setUpdateNoteArchived(id, archived) {
  await rest('/rpc/forum_set_update_note_archive', {
    method: 'POST',
    body: { p_target: id, p_archived: Boolean(archived) },
  });
}

/* ── Push-настройки (посты форума) ────────────────────────────────────────── */

export async function getPushPrefs() {
  const me = currentUserId();
  if (!me) return { newForumPost: false, newForumReply: false, quietStart: null, quietEnd: null };
  const rows = await rest(`/forum_push_prefs?user_id=eq.${encodeURIComponent(me)}&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    newForumPost: Boolean(row?.new_forum_post),
    newForumReply: Boolean(row?.new_forum_reply),
    quietStart: Number.isInteger(row?.quiet_start) ? row.quiet_start : null,
    quietEnd: Number.isInteger(row?.quiet_end) ? row.quiet_end : null,
  };
}

export async function setPushPrefs(prefs) {
  const me = currentUserId();
  if (!me) throw new Error('Сначала войдите');
  const body = { user_id: me };
  if (prefs.newForumPost != null) body.new_forum_post = Boolean(prefs.newForumPost);
  if (prefs.newForumReply != null) body.new_forum_reply = Boolean(prefs.newForumReply);
  const win = normalizeQuietWindow(prefs.quietStart, prefs.quietEnd);
  if (win) {
    // null уходит в базу как null: одной записью и включают, и выключают окно.
    body.quiet_start = win.start;
    body.quiet_end = win.end;
  }
  await rest('/forum_push_prefs', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body,
  });
}

/* ── Активность сервера: посты и сообщения по дням ────────────────────────── */

/**
 * Последняя неделя активности сервера через RPC get_server_activity.
 * Возвращает null, если функция в базе ещё не создана (миграция не прогнана) —
 * виджет просто не рисуется, форум от этого не падает.
 */
export async function getServerActivity() {
  const rows = await rest('/rpc/get_server_activity', {
    method: 'POST',
    body: { p_days: 7 },
  });
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => ({
    day: r.day ? new Date(`${r.day}T00:00:00`) : new Date(),
    forumPosts: Number(r.forum_posts ?? 0),
    forumComments: Number(r.forum_comments ?? 0),
    chatMessages: Number(r.chat_messages ?? 0),
  }));
}

/* ── Личная статистика: GitHub-график на странице участника ───────────────── */

/**
 * Активность конкретного пользователя по дням (для тепловой карты на его
 * странице) плюс число его чатов. chatsJoined приходит только себе, чужим —
 * null: личные чаты — не публичная статистика (см. миграцию
 * user-activity-daily.sql).
 */
export async function getUserActivity(userId) {
  const rows = await rest('/rpc/get_user_activity', {
    method: 'POST',
    body: { p_user_id: userId, p_days: 140 },
  });
  if (!Array.isArray(rows)) return null;
  const anyChats = rows.find((r) => r.chats_joined != null)?.chats_joined;
  return {
    days: rows.map((r) => ({
      day: r.day ? new Date(`${r.day}T00:00:00`) : new Date(),
      forumPosts: Number(r.posts ?? 0),
      forumComments: Number(r.comments ?? 0),
      chatMessages: Number(r.chat_messages ?? 0),
    })),
    chatsJoined: anyChats != null ? Number(anyChats) : null,
  };
}
