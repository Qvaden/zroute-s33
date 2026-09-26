/**
 * АДАПТЕР ФОРУМА: локальный, в браузере.
 *
 * РЕЖИМ РАЗРАБОТКИ, и он честно об этом говорит. Всё лежит в localStorage
 * одного браузера: посты видны только тому, кто их написал, и до другого
 * человека не доходят никогда.
 *
 * Зачем он вообще нужен, если общаться в нём нельзя. Ровно за тем же, за чем
 * json-адаптер у данных сайта: чтобы вёрстку, правила, реакции и модерацию
 * можно было сделать и проверить, не заведя ни одного аккаунта и ничего
 * не оплатив. Пока форум не подключён к общей базе, страница показывает
 * предупреждение вместо того, чтобы делать вид, что она форум.
 *
 * Пароль здесь НЕ проверяется по-настоящему: он не хешируется и вообще
 * не хранится. Так сделано нарочно — половинчатая «почти безопасность»
 * в localStorage опаснее её явного отсутствия, потому что выглядит защитой.
 * Настоящий вход живёт в supabase-адаптере, где пароли хеширует Postgres.
 */
import { CONFIG } from '../../../config.js';
import { CATEGORY_IDS, EVENT_RSVP_IDS, REACTION_IDS, TOPIC_TAG_IDS, needsBarterLines, needsEventDate, needsExpiry, reactionMeta } from '../rules.js';

export const name = 'локальный (только этот браузер)';

/** @type {import('../contract.js').ForumCapabilities} */
export const capabilities = {
  canWrite: true,
  isShared: false,
  canAuth: false,
  canModerate: true,
};

const KEY = 'zr33.forum.local';

/**
 * localStorage умеет бросать: приватный режим, отключённые куки, открытие
 * файла с диска. Форум от этого падать не должен — он просто окажется пустым.
 */
function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Пустое состояние. Это фабрика, а не константа: раздача одной и той же
 * константы с расшаренными массивами означала бы, что любой push в `users`
 * одного прочтения навсегда запоминается в следующем пустом прочтении.
 */
function emptyState() {
  return {
    users: [],
    me: null,
    posts: [],
    comments: [],
    reactions: [],
    thanks: [],
    repGrants: [],
    reports: [],
    topicSubscriptions: [],
    bookmarks: [],
    topicReads: [],
    allianceSubscriptions: [],
    moderationActions: [],
    polls: [],
    pollVotes: [],
    notifications: [],
    appeals: [],
    sectionMutes: [],
    eventRsvps: [],
    chats: [],
    chatMembers: [],
    chatMessages: [],
    reservedNicks: [],
    nickHistory: [],
  };
}

function read() {
  const raw = safe(() => localStorage.getItem(KEY), null);
  if (!raw) return emptyState();
  const parsed = safe(() => JSON.parse(raw), null);
  return parsed && typeof parsed === 'object' ? { ...emptyState(), ...parsed } : emptyState();
}

function write(state) {
  safe(() => localStorage.setItem(KEY, JSON.stringify(state)));
}

/** Идентификатор без внешних библиотек: времени достаточно, гонок тут нет. */
function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const toDate = (v) => (v ? new Date(v) : null);

/**
 * Нормализованный ключ ника, как в базе (supabase/nicks-verified.sql):
 * нижний регистр + подмена «двойников» — кириллических, украинских, греческих
 * и латинских с диакритикой букв, а также похожих цифр и букв (0/O, 1/l/I).
 * NFKC сначала приводит full-width буквы (ｋ) и комбинированные символы
 * к обычному виду, чтобы «Крeмль», «Крéмль» и «Крemль» нашли «Кремль».
 */
function nickKey(v) {
  const map = {
    // кириллические «двойники» латинских → как в базе
    а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
    // украинские: і и ї выглядят как i, є — как e
    і: 'i', ї: 'i', є: 'e',
    // греческие: омикрон, ро, тау и прочие неотличимы от латыни
    ο: 'o', ι: 'i', ε: 'e', ρ: 'p', τ: 't', χ: 'x', κ: 'k', ν: 'v',
    // латинские с диакритикой → базовая буква
    à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a', ą: 'a',
    è: 'e', é: 'e', ê: 'e', ë: 'e', ē: 'e', ě: 'e', ę: 'e',
    ì: 'i', í: 'i', î: 'i', ï: 'i', ī: 'i', ı: 'i',
    ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ø: 'o', ō: 'o',
    ù: 'u', ú: 'u', û: 'u', ü: 'u', ū: 'u', ũ: 'u', ů: 'u',
    ñ: 'n', ń: 'n',
    ç: 'c', ć: 'c', č: 'c',
    š: 's', ś: 's', ŝ: 's',
    ž: 'z', ź: 'z',
    ý: 'y', ÿ: 'y',
    ł: 'i',
    // цифры и похожие буквы: 0 как o, 1, l и I — как i
    '0': 'o', '1': 'i', l: 'i',
  };
  return String(v || '')
    .normalize('NFKC')
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] || ch)
    .join('');
}

/* Форма ника — то же правило, что в validateNick при регистрации и в
   forum_rename_nick базы: буквы/цифры, внутри ещё пробел, _ и -. */
const NICK_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N} _-]*[\p{L}\p{N}]$/u;

export async function isReady() {
  return true;
}

/* ── Вход ─────────────────────────────────────────────────────────────────── */

function userOut(u) {
  if (!u) return null;
  return {
    id: u.id,
    nick: u.nick,
    role: u.role,
    /*
      Поля профиля есть и здесь — для паритета с рабочим адаптером. Аватарку
      в локальном режиме загрузить некуда (хранилища нет), но страница профиля
      обязана открываться и рисоваться: иначе её нельзя ни проверить, ни
      показать, не подключив базу.
    */
    avatarUrl: u.avatarUrl || '',
    about: u.about || '',
    allianceTag: u.allianceTag || '',
    isBlogger: Boolean(u.isBlogger),
    isLeader: Boolean(u.isLeader || (u.leaderOf ?? '') !== ''),
    leaderOf: u.leaderOf || '',
    canEditSite: Boolean(u.canEditSite) || u.role === 'admin',
    createdAt: toDate(u.createdAt) ?? new Date(),
    mutedUntil: toDate(u.mutedUntil),
    banned: Boolean(u.banned),
    banReason: u.banReason || '',
    isVerified: Boolean(u.isVerified),
    verifiedBy: u.verifiedBy || null,
    verifiedAt: toDate(u.verifiedAt),
  };
}

export async function currentUser() {
  const s = read();
  if (!s.me) return null;
  return userOut(s.users.find((u) => u.id === s.me));
}

/**
 * Регистрация. Первый зарегистрировавшийся становится администратором —
 * иначе в локальном режиме модерацию нельзя было бы даже посмотреть.
 */
export async function signUp(nick) {
  const s = read();
  const nb = String(nick).trim();
  const key = nickKey(nb);

  if (s.reservedNicks.some((r) => nickKey(r.nick) === key)) {
    throw new Error('Этот ник зарезервирован');
  }

  if (s.users.some((u) => nickKey(u.nick) === key)) {
    throw new Error('Такой ник уже занят');
  }

  const user = {
    id: newId('u'),
    nick: String(nick).trim(),
    role: s.users.length === 0 ? 'admin' : 'member',
    createdAt: new Date().toISOString(),
    mutedUntil: null,
    banned: false,
    banReason: '',
  };
  s.users.push(user);
  s.me = user.id;
  write(s);
  return userOut(user);
}

export async function signIn(nick) {
  const s = read();
  // Ищем по тому же ключу, каким ники закреплены за людьми: иначе вход
  // с латинской «e» в нике с кириллической «е» не находил бы аккаунт,
  // хотя дубликаты запрещены именно по этому ключу.
  const key = nickKey(String(nick).trim());
  const user = s.users.find((u) => nickKey(u.nick) === key);
  if (!user) throw new Error('Такого ника здесь нет');
  s.me = user.id;
  write(s);
  return userOut(user);
}

export async function signOut() {
  const s = read();
  s.me = null;
  write(s);
}

/* ── Записи ───────────────────────────────────────────────────────────────── */

/**
 * Реакции в ленте: сколько каких и что поставил я.
 * Считаем на месте — объёмы локального режима заведомо крошечные.
 */
function reactionsFor(state, targetType, targetId) {
  const rows = state.reactions.filter((r) => r.targetType === targetType && r.targetId === targetId);
  const counts = {};
  let score = 0;
  for (const r of rows) {
    counts[r.reactionId] = (counts[r.reactionId] ?? 0) + 1;
    score += reactionMeta(r.reactionId)?.weight ?? 0;
  }
  const mine = state.me ? rows.find((r) => r.userId === state.me) : null;
  return { reactions: counts, myReaction: mine ? mine.reactionId : null, score };
}

/**
 * Благодарности этой строки: сколько их и была ли своя.
 *
 * Число, а не список имён — тот же порядок, что в базе: строки чужих
 * благодарностей локальному «профилю» недоступны по смыслу, наружу выходит
 * только счётчик и собственная отметка кнопки.
 */
function thanksFor(state, targetType, targetId) {
  const rows = (state.thanks || []).filter((t) => t.targetType === targetType && t.targetId === targetId);
  return {
    thanksCount: rows.length,
    iThanked: Boolean(state.me && rows.some((t) => t.giverId === state.me)),
  };
}

/**
 * Сколько чужих ответов в теме появилось после последнего входа сюда.
 *
 * То же правило, что у представления forum_topic_unread в базе: свои ответы не
 * считаем (человек знает, что написал сам), удалённые не считаем (заглушку
 * читают один раз), а без отметки считаем всё — темы ведь были до первого входа.
 */
function unreadCount(state, postId) {
  if (!state.me) return 0;
  const row = state.topicReads.find((r) => r.postId === postId && r.userId === state.me);
  const since = row ? new Date(row.lastReadAt).getTime() : 0;
  return state.comments.filter((c) => c.postId === postId
    && !c.deleted
    && c.authorId !== state.me
    && new Date(c.createdAt).getTime() > since).length;
}

function postOut(state, p) {
  const r = reactionsFor(state, 'post', p.id);
  const author = state.users.find((u) => u.id === p.authorId);
  return {
    id: p.id,
    authorId: p.authorId,
    authorNick: p.authorNick,
    /*
      Аватарка и альянс берутся из профиля автора, а ник — копией в записи.
      Разница та же, что в рабочем адаптере: ник это «кто сказал тогда»,
      аватарка — «как человек выглядит сейчас».
    */
    authorAvatar: author?.avatarUrl || '',
    authorAlliance: author?.allianceTag || '',
    authorRole: author?.role || 'member',
    authorIsBlogger: Boolean(author?.isBlogger),
    authorIsVerified: Boolean(author?.isVerified),
    category: p.category,
    tags: Array.isArray(p.tags) ? p.tags : [],
    title: p.title,
    body: p.body,
    createdAt: toDate(p.createdAt) ?? new Date(),
    editedAt: toDate(p.editedAt) ?? undefined,
    // null — срок не назначен; тот же смысл, что у рабочей базы.
    expiresAt: toDate(p.expiresAt) ?? null,
    // Момент встречи и лимит мест; оба null у обычной темы (см. шаг 1 миграции).
    eventAt: toDate(p.eventAt),
    eventCapacity: p.eventCapacity == null ? null : Number(p.eventCapacity),
    // Обе стороны обмена и отметка, что автор снял объявление с доски.
    barterGives: p.barterGives || null,
    barterWants: p.barterWants || null,
    barterClosedAt: toDate(p.barterClosedAt) ?? null,
    pinned: Boolean(p.pinned),
    deleted: Boolean(p.deleted),
    deletedReason: p.deletedReason || '',
    views: Number(p.views || 0),
    commentCount: state.comments.filter((c) => c.postId === p.id && !c.deleted).length,
    unread: unreadCount(state, p.id),
    subscribed: state.topicSubscriptions.some((s) => s.postId === p.id && s.userId === state.me),
    // Своя строка закладки — как подписка: ни числа, ни чужого взгляда.
    saved: state.bookmarks.some((b) => b.postId === p.id && b.userId === state.me),
    // Вложений в локальном режиме нет: файлы некуда класть, хранилища нет.
    attachments: [],
    ...r,
    ...thanksFor(state, 'post', p.id),
    myRsvp: myRsvpOf(state, p.id),
    myRemindMinutes: myRemindOf(state, p.id),
    poll: pollOut(state, p.id),
  };
}

/** Свой ответ на приглашение — та же строка, что у my_reaction: своё, не чужое. */
function myRsvpOf(state, postId) {
  if (!state.me) return null;
  const row = (state.eventRsvps || []).find((r) => r.postId === postId && r.userId === state.me);
  return row ? row.status : null;
}

/** Срок напоминания из той же строки: без него селект в теме сбрасывался бы в «не напоминать». */
function myRemindOf(state, postId) {
  if (!state.me) return null;
  const row = (state.eventRsvps || []).find((r) => r.postId === postId && r.userId === state.me);
  return row && row.remindMinutes != null ? Number(row.remindMinutes) : null;
}

function pollOut(state, postId) {
  const poll = state.polls.find((pl) => pl.postId === postId);
  if (!poll) return null;
  const options = state.pollVotes
    .filter((v) => v.pollId === poll.id)
    .reduce((acc, v) => { acc[v.optionId] = (acc[v.optionId] ?? 0) + 1; return acc; }, {});
  return {
    id: poll.id,
    question: poll.question,
    multiple: Boolean(poll.multiple),
    closed: Boolean(poll.closed),
    total: new Set(state.pollVotes.filter((v) => v.pollId === poll.id).map((v) => v.userId)).size,
    options: (poll.options || []).map((o) => ({
      id: o.id,
      text: o.text,
      votes: options[o.id] || 0,
      mine: state.me ? state.pollVotes.some((v) => v.pollId === poll.id && v.optionId === o.id && v.userId === state.me) : false,
    })),
  };
}

/**
 * Лента.
 *
 * Удалённые посты из ленты исчезают: причина удаления нужна модерации,
 * а не читателям.
 *
 * @param {{category?: string, sort?: string, limit?: number, offset?: number}} [opts]
 */
export async function listPosts(opts = {}) {
  const s = read();
  const { category = 'all', tag = 'all', sort = 'fresh', limit = CONFIG.forum.pageSize, offset = 0, q = '', saved = false } = opts;

  let list = s.posts.filter((p) => !p.deleted).map((p) => postOut(s, p));
  if (category !== 'all') list = list.filter((p) => p.category === category);
  if (tag !== 'all') list = list.filter((p) => p.tags.includes(tag));
  /*
    «Только мои закладки» — те же id, что перечисляет рабочий адаптер, и то же
    окно: последние savedWindow закладок, посчитанные по дате постановки.
    Без окна два режима расходились бы на списке длиннее окна, а проверить это
    в черновом режиме всё равно никто не стал бы.
  */
  if (saved) {
    if (!s.me) return { posts: [], total: 0 };
    const mine = new Set(
      s.bookmarks
        .filter((b) => b.userId === s.me)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, CONFIG.forum.limits.savedWindow)
        .map((b) => b.postId)
    );
    list = list.filter((p) => mine.has(p.id));
  }
  /*
    Поиск по названию и тексту. Регистр не важен — так же ведёт себя
    ilike в рабочем адаптере, и два режима не должны расходиться в этом.
  */
  const query = String(q ?? '').trim().toLowerCase();
  if (query) {
    list = list.filter((p) => `${p.title}\n${p.body}`.toLowerCase().includes(query));
  }

  const byFresh = (a, b) => b.createdAt - a.createdAt;
  const SORTS = {
    fresh: byFresh,
    top: (a, b) => b.score - a.score || byFresh(a, b),
    talked: (a, b) => b.commentCount - a.commentCount || byFresh(a, b),
  };
  list.sort(SORTS[sort] ?? byFresh);

  // Закреплённые всегда сверху, но внутри себя сортируются как обычно.
  list.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  return { posts: list.slice(offset, offset + limit), total: list.length };
}

export async function getPost(id) {
  const s = read();
  const p = s.posts.find((x) => x.id === id);
  return p ? postOut(s, p) : null;
}

/**
 * Один просмотр темы.
 *
 * Считается только здесь, а не в getPost: тот зовётся и для пересортировки
 * ленты, и после реакции или правки, и каждая перерисовка не должна засчитывать
 * новый просмотр. Регистрирует переход страница — в одном месте (см. mount.js).
 */
export async function registerView(postId) {
  const s = read();
  const post = s.posts.find((p) => p.id === postId);
  if (post && !post.deleted) post.views = (post.views || 0) + 1;
  write(s);
}

/**
 * Отметка «я здесь был» — то, по чему лента считает новые ответы.
 *
 * Ставится вместе с просмотром (см. mount.js): вошёл в тему — значит прочитал.
 * Без отметки счётчик показал бы все ответы темы, и человек бы к ней больше
 * не возвращался: отличить прочитанное от нового по такому счётчику нельзя.
 */
export async function markRead(postId) {
  const s = read();
  if (!s.me) return;
  const row = s.topicReads.find((r) => r.postId === postId && r.userId === s.me);
  if (row) row.lastReadAt = new Date().toISOString();
  else s.topicReads.push({ postId, userId: s.me, lastReadAt: new Date().toISOString() });
  write(s);
}

/** Кто сейчас пишет, и имеет ли он право. Общая проверка для поста и комментария. */
function requireWriter(state) {
  const me = state.users.find((u) => u.id === state.me);
  if (!me) throw new Error('Сначала войдите');
  if (me.banned) throw new Error(`Вам запрещено писать: ${me.banReason || 'нарушение правил'}`);
  const muted = toDate(me.mutedUntil);
  if (muted && muted > new Date()) {
    throw new Error(`Вам запрещено писать до ${muted.toLocaleString('ru')}`);
  }
  return me;
}

/**
 * Ключ текста, как forum_body_key в базе: тот же текст в разном оформлении
 * даёт одну строку. Регистр и лишние пробелы здесь не различаются, знаки
 * препинания остаются как есть — правило ловит копипасту, а не слова.
 */
function bodyKey(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * ВЫДЕРЖКА В ЧЕРНОВОМ РЕЖИМЕ.
 *
 * Правило держит база (supabase/20260925-spam-hold-and-topic-reads.sql), а
 * здесь та же проверка нужна, чтобы её можно было увидеть и проверить, не
 * подключая Supabase, — и чтобы текст отказа был тот же. Числа берутся из
 * CONFIG.forum.limits: тот же источник, что у подсказки под формой.
 * Безопасности защищать нечего — запросов мимо сайта в этом режиме не бывает.
 *
 * @param {object} state
 * @param {'post'|'comment'} kind
 * @param {object} me Кто пишет (роль решает потолок: staff — втрое больше).
 * @param {string} text Проверямый текст: у темы — название вместе с телом.
 */
function checkHold(state, kind, me, text) {
  const L = CONFIG.forum.limits;
  const staff = me.role === 'admin' || me.role === 'moderator';
  const isPost = kind === 'post';
  const max = (isPost ? L.postHoldMax : L.commentHoldMax) * (staff ? 3 : 1);
  const minutes = isPost ? L.postHoldMinutes : L.commentHoldMinutes;
  const rows = (isPost ? state.posts : state.comments)
    .filter((r) => r.authorId === me.id)
    .map((r) => ({
      at: new Date(r.createdAt).getTime(),
      key: bodyKey(isPost ? `${r.title} ${r.body}` : r.body),
    }));

  const since = Date.now() - minutes * 60 * 1000;
  const recent = rows.filter((r) => r.at > since);
  if (recent.length >= max) {
    const left = Math.ceil((Math.max(...recent.map((r) => r.at)) + minutes * 60000 - Date.now()) / 60000);
    throw new Error(isPost
      ? `Новую тему можно создать через ${Math.max(1, left)} мин — не больше ${max} за ${minutes} минут`
      : `Отвечать можно снова через ${Math.max(1, left)} мин — не больше ${max} за ${minutes} минуты`);
  }

  const repeatSince = Date.now() - L.repeatHoldMinutes * 60000;
  const key = bodyKey(text);
  if (rows.some((r) => r.at > repeatSince && r.key === key)) {
    throw new Error(isPost
      ? 'Такая тема у вас уже есть — правьте её, а не заводите копию'
      : 'Вы уже писали это — скопировать один и тот же ответ в несколько тем нельзя');
  }
}

/**
 * СРОК ДЕЙСТВИЯ ТЕМЫ В ЧЕРНОВОМ РЕЖИМЕ.
 *
 * Держит его база (supabase/20260925-announcement-expiry.sql, триггер
 * forum_posts_expiry), здесь проверка нужна по той же причине, что и выдержка:
 * увидеть правило и проверить его, не подключая Supabase. Формулировки отказов
 * совпадают со словами триггера дословно — за этим тоже следит тест.
 *
 * @param {string[]} tags  Метки темы.
 * @param {string|Date|null} when  Назначенный срок или null.
 * @returns {string}  Пусто, всё в порядке; иначе — текст отказа.
 */
function expiryProblem(tags, when) {
  const L = CONFIG.forum.limits;
  if (needsExpiry(tags) && !when) {
    return 'У темы с меткой «Набор», «Срочно» или «Обмен» должен быть срок действия — выберите, сколько дней она висит';
  }
  if (!when) return '';
  const at = new Date(when).getTime();
  const day = 86400000;
  if (at <= Date.now() + L.expiryDaysMin * day) {
    return 'Срок должен быть хотя бы на сутки впереди — вчерашнее объявление актуальным не станет';
  }
  if (at > Date.now() + L.expiryDaysMax * day) {
    return `Срок не дальше ${L.expiryDaysMax} дней — иначе тема зависнет в ленте навсегда`;
  }
  return '';
}

/**
 * СТОРОНЫ ОБМЕНА В ЧЕРНОВОМ РЕЖИМЕ.
 *
 * Требование обеих строк держит триггер forum_posts_barter
 * (supabase/20260926-barter-board.sql), и его текст здесь повторяется слово в
 * слово — за этим следит тест. Длина строк — проверка таблицы
 * (`char_length between 3 and 200`); она отвергла бы запрос текстом нарушения
 * ограничения, а не словами для человека, поэтому текст здесь свой, а числа те
 * же, что в проверке.
 *
 * @param {string[]} tags  Метки темы.
 * @param {string|null} gives  Что отдаёт автор.
 * @param {string|null} wants  Что он ищет.
 * @returns {string}  Пусто, всё в порядке; иначе — текст отказа.
 */
function barterProblem(tags, gives, wants) {
  const L = CONFIG.forum.limits;
  if (!needsBarterLines(tags)) return '';
  const a = String(gives ?? '').trim();
  const b = String(wants ?? '').trim();
  if (!a || !b) {
    return 'У темы с меткой «Обмен» должны быть названы обе стороны: что отдаёте и что ищете';
  }
  if (a.length < L.barterLineMin || a.length > L.barterLineMax
    || b.length < L.barterLineMin || b.length > L.barterLineMax) {
    return `Каждая сторона обмена — от ${L.barterLineMin} до ${L.barterLineMax} символов`;
  }
  return '';
}

/**
 * ДАТА СОБЫТИЯ В ЧЕРНОВОМ РЕЖИМЕ.
 *
 * Держит её база (supabase/20260925-event-rsvp.sql, триггер
 * forum_posts_event_at), здесь проверка нужна по той же причине, что и
 * выдержка: увидеть правило и проверить его, не подключая Supabase.
 * Формулировки отказов совпадают со словами триггера дословно — за этим тоже
 * следит тест.
 *
 * @param {string[]} tags  Метки темы.
 * @param {string|Date|null} when  Момент встречи или null.
 * @returns {string}  Пусто, всё в порядке; иначе — текст отказа.
 */
function eventWhenProblem(tags, when) {
  const L = CONFIG.forum.limits;
  if (needsEventDate(tags) && !when) {
    return 'У темы с меткой «Событие» должен быть момент — выберите дату и время';
  }
  if (!when) return '';
  const at = new Date(when).getTime();
  if (at <= Date.now() + L.eventMinLeadMinutes * 60000) {
    return `Назначайте встречу минимум через ${L.eventMinLeadMinutes} минут — иначе она родится уже прошедшей`;
  }
  if (at > Date.now() + L.eventHorizonDays * 86400000) {
    return `Не дальше ${L.eventHorizonDays} дней: планируют на квартал, а не на год`;
  }
  return '';
}

/**
 * Лимит мест. Проверку таблицы (от 2 до 200) держит CHECK в колонке, и она
 * отказала бы текстом нарушения ограничения, а не словами для человека, —
 * поэтому здесь текст свой, а числа те же, что в колонке.
 */
function eventSeatsProblem(capacity) {
  const L = CONFIG.forum.limits;
  if (capacity == null || capacity === '') return '';
  const n = Number(capacity);
  if (!Number.isInteger(n) || n < L.eventSeatsMin || n > L.eventSeatsMax) {
    return `Мест от ${L.eventSeatsMin} до ${L.eventSeatsMax} — или ничего, тогда без лимита`;
  }
  return '';
}

export async function createPost(draft) {
  const s = read();
  const me = requireWriter(s);
  if (!CATEGORY_IDS.includes(draft.category)) throw new Error('Неизвестный раздел');
  const tags = [...new Set((draft.tags || []).filter((tag) => TOPIC_TAG_IDS.includes(tag)))].slice(0, 3);
  /*
    Порядок проверок повторяет алфавит триггеров на forum_posts:
    forum_posts_barter идёт раньше forum_posts_event_at, а тот — раньше
    forum_posts_expiry. Тема сразу с тремя метками обязана получить отказ в том
    же порядке, в каком её отвергла бы база.
  */
  const barterError = barterProblem(tags, draft.barterGives ?? null, draft.barterWants ?? null);
  if (barterError) throw new Error(barterError);
  const eventError = eventWhenProblem(tags, draft.eventAt ?? null)
    || eventSeatsProblem(draft.eventCapacity ?? null);
  if (eventError) throw new Error(eventError);
  const expiryError = expiryProblem(tags, draft.expiresAt ?? null);
  if (expiryError) throw new Error(expiryError);
  checkHold(s, 'post', me, `${draft.title} ${draft.body}`);
  // Раздел закрыт для этого игрока — последняя проверка перед вставкой: в
  // базе триггеры перед insert идут по алфавиту, и forum_section_mute_insert
  // среди них последний.
  requireSectionOpen(s, me, draft.category);

  const post = {
    id: newId('p'),
    authorId: me.id,
    authorNick: me.nick,
    category: draft.category,
    tags,
    title: draft.title,
    body: draft.body,
    createdAt: new Date().toISOString(),
    expiresAt: draft.expiresAt ?? null,
    // Без метки момента не бывает: триггер базы обнуляет event_at, и черновик
    // обязан сохранить ту же картинку, иначе тема «почти встреча» осталась бы
    // висеть с датой, которую игрок никогда не утверждал.
    eventAt: needsEventDate(tags) ? (draft.eventAt ?? null) : null,
    eventCapacity: needsEventDate(tags) ? (draft.eventCapacity ?? null) : null,
    // Та же картинка, что и в базе: без метки «Обмен» строк обмена не бывает.
    barterGives: needsBarterLines(tags) ? String(draft.barterGives ?? '').trim() : '',
    barterWants: needsBarterLines(tags) ? String(draft.barterWants ?? '').trim() : '',
    barterClosedAt: null,
    pinned: false,
    deleted: false,
    views: 0,
  };
  s.posts.push(post);

  if (draft.poll && Array.isArray(draft.poll.options) && draft.poll.options.length >= 2) {
    const pollId = newId('pl');
    const options = draft.poll.options
      .filter((text) => text.trim())
      .map((text, i) => ({ id: newId('po'), text: text.trim(), position: i }));
    if (options.length >= 2) {
      s.polls.push({
        id: pollId,
        postId: post.id,
        question: draft.poll.question,
        multiple: Boolean(draft.poll.multiple),
        closed: false,
        options,
      });
    }
  }

  // Уведомления: упомянутые в заголовке и тексте. Как в базе триггером
  // forum_notify_post — себя пропускаем, остальным по одному (ник в тексте
  // может встретиться несколько раз, а уведомление должно быть одно).
  for (const user of mentionTargets(s, `${draft.title} ${draft.body}`, new Set([me.id]))) {
    pushNotification(s, {
      userId: user.id,
      actorId: me.id,
      actorNick: me.nick,
      kind: 'mention',
      postId: post.id,
      preview: draft.title,
    });
  }

  write(s);
  return postOut(s, post);
}

/** Свой пост правит автор, чужой — никто: у модерации есть удаление с причиной. */
export async function editPost(id, patch) {
  const s = read();
  const me = requireWriter(s);
  const post = s.posts.find((p) => p.id === id);
  if (!post) throw new Error('Пост не найден');
  if (post.authorId !== me.id) throw new Error('Это не ваш пост');
  if (post.deleted) throw new Error('Удалённый пост править нельзя');

  if (patch.title != null) post.title = patch.title;
  if (patch.body != null) post.body = patch.body;
  if (patch.category != null) {
    // Раздел проверяем и здесь: база откажет, но своя ошибка понятнее.
    if (!CATEGORY_IDS.includes(patch.category)) throw new Error('Неизвестный раздел');
    post.category = patch.category;
  }
  post.editedAt = new Date().toISOString();
  write(s);
  return postOut(s, post);
}

/** Автор удаляет свой пост, модератор — любой, но обязан назвать причину. */
export async function deletePost(id, reason) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');
  const post = s.posts.find((p) => p.id === id);
  if (!post) throw new Error('Пост не найден');

  const isStaff = me.role === 'admin' || me.role === 'moderator';
  if (!isStaff && post.authorId !== me.id) throw new Error('Это не ваш пост');

  post.deleted = true;
  post.deletedReason = isStaff && post.authorId !== me.id
    ? String(reason || 'Нарушение правил форума')
    : 'Удалено автором';
  write(s);
}

/**
 * Закрепление — модерация: свои темы так нельзя двигать в топ.
 *
 * Лимит тот же, что и в базе (CONFIG.forum.limits.pinsMax): браузер
 * предупреждает заранее, а настоящая защита — в триггере supabase/schema.sql.
 * Здесь проверка для понятного сообщения, а не для безопасности — в локальном
 * режиме запрос мимо сайта обойти некому.
 */
export async function setPinned(id, pinned) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');
  if (me.role !== 'admin' && me.role !== 'moderator') throw new Error('Недостаточно прав');

  const post = s.posts.find((p) => p.id === id);
  if (!post) throw new Error('Пост не найден');
  if (post.deleted) throw new Error('Удалённый пост закрепить нельзя');

  pinned = Boolean(pinned);
  if (pinned && !post.pinned) {
    const pinnedCount = s.posts.filter((p) => p.pinned && !p.deleted && p.id !== id).length;
    if (pinnedCount >= CONFIG.forum.limits.pinsMax) {
      throw new Error('Закреплено уже три темы — сначала открепите одну');
    }
  }
  post.pinned = pinned;
  write(s);
  return postOut(s, post);
}

/**
 * Срок действия темы: продлить, назначить или снять.
 *
 * В базе это право отдаёт RLS — строку правит автор, а модерация любую. Здесь
 * то же разделение, иначе черновой режим показывал бы то, чего настоящий
 * игроку откажет.
 */
export async function setExpiry(id, expiresAt) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');

  const post = s.posts.find((p) => p.id === id);
  if (!post) throw new Error('Пост не найден');
  const isStaff = me.role === 'admin' || me.role === 'moderator';
  if (!isStaff && post.authorId !== me.id) throw new Error('Это не ваш пост');

  const when = expiresAt ?? null;
  const error = expiryProblem(Array.isArray(post.tags) ? post.tags : [], when);
  if (error) throw new Error(error);

  post.expiresAt = when;
  write(s);
  return postOut(s, post);
}

/**
 * Момент встречи: назначить или перенести.
 *
 * Черновик повторяет триггер forum_posts_event_at и по правилам, и по словам
 * отказа (тест сторожит общность формулировок). Перенос вперёд возвращает
 * напоминание тем, кому оно ещё должно сработать: иначе человек молча
 * пропустил бы перенесённую встречу.
 */
export async function setEventAt(id, eventAt, eventCapacity = null) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');

  const post = s.posts.find((p) => p.id === id);
  if (!post) throw new Error('Пост не найден');
  if (!isStaff(me) && post.authorId !== me.id) throw new Error('Это не ваш пост');

  const error = eventWhenProblem(Array.isArray(post.tags) ? post.tags : [], eventAt ?? null)
    || eventSeatsProblem(eventCapacity ?? null);
  if (error) throw new Error(error);

  const was = toDate(post.eventAt);
  const now = toDate(eventAt);
  post.eventAt = eventAt ? new Date(eventAt).toISOString() : null;
  post.eventCapacity = eventCapacity == null ? null : Number(eventCapacity);

  if (was && now && now > was) {
    for (const r of s.eventRsvps || []) {
      if (r.postId !== post.id || !r.remindedAt || !r.remindMinutes) continue;
      if (now.getTime() - r.remindMinutes * 60000 > Date.now()) r.remindedAt = null;
    }
  }

  write(s);
  return postOut(s, post);
}

export async function closeBarter(id, closed) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');

  const post = s.posts.find((p) => p.id === id);
  if (!post) throw new Error('Пост не найден');
  if (!isStaff(me) && post.authorId !== me.id) throw new Error('Это не ваш пост');
  if (!needsBarterLines(Array.isArray(post.tags) ? post.tags : [])) {
    throw new Error('Снимать с доски можно только объявление с меткой «Обмен»');
  }

  /*
    Тема не удаляется: под объявлением могли договориться другие, и их ответы
    исчезли бы вместе с ним. Отметка закрытия — единственное, что меняет
    картина, и она обратима: нажатие мимо кнопки не должно навсегда прятать
    предложение, которое человек ещё не роздал.
  */
  post.barterClosedAt = closed ? new Date().toISOString() : null;
  write(s);
  return postOut(s, post);
}

/* ── Комментарии ──────────────────────────────────────────────────────────── */

function commentOut(state, c) {
  const r = reactionsFor(state, 'comment', c.id);
  const author = state.users.find((u) => u.id === c.authorId);
  return {
    id: c.id,
    postId: c.postId,
    authorId: c.authorId,
    authorNick: c.authorNick,
    authorAvatar: author?.avatarUrl || '',
    authorRole: author?.role || 'member',
    authorIsBlogger: Boolean(author?.isBlogger),
    authorIsVerified: Boolean(author?.isVerified),
    body: c.body,
    createdAt: toDate(c.createdAt) ?? new Date(),
    deleted: Boolean(c.deleted),
    deletedReason: c.deletedReason || '',
    attachments: [],
    ...r,
    ...thanksFor(state, 'comment', c.id),
  };
}

export async function listComments(postId) {
  const s = read();
  return s.comments
    .filter((c) => c.postId === postId)
    .map((c) => commentOut(s, c))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function addComment(postId, body) {
  const s = read();
  const me = requireWriter(s);
  const post = s.posts.find((p) => p.id === postId);
  if (!post) throw new Error('Пост не найден');
  if (post.deleted) throw new Error('Пост удалён, обсуждать нечего');
  checkHold(s, 'comment', me, body);
  requireSectionOpen(s, me, post.category);

  const comment = {
    id: newId('c'),
    postId,
    authorId: me.id,
    authorNick: me.nick,
    body,
    createdAt: new Date().toISOString(),
    deleted: false,
  };

  s.comments.push(comment);

  /*
    Уведомления. То же, что триггер forum_notify_comment: автору поста —
    ответ; упомянутым — ещё по одному. Автор поста, которого заодно
    и упомянули, получает одно уведомление, а не два.
  */
  const notified = new Set([me.id]);
  if (post.authorId && post.authorId !== me.id) {
    pushNotification(s, {
      userId: post.authorId,
      actorId: me.id,
      actorNick: me.nick,
      kind: 'reply',
      postId,
      commentId: comment.id,
      preview: body,
    });
    notified.add(post.authorId);
  }
  for (const user of mentionTargets(s, body, notified)) {
    pushNotification(s, {
      userId: user.id,
      actorId: me.id,
      actorNick: me.nick,
      kind: 'mention',
      postId,
      commentId: comment.id,
      preview: body,
    });
  }

  write(s);
  return commentOut(s, comment);
}
export async function deleteComment(id, reason) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');
  const comment = s.comments.find((c) => c.id === id);
  if (!comment) throw new Error('Комментарий не найден');

  const isStaff = me.role === 'admin' || me.role === 'moderator';
  if (!isStaff && comment.authorId !== me.id) throw new Error('Это не ваш комментарий');

  comment.deleted = true;
  comment.deletedReason = isStaff && comment.authorId !== me.id
    ? String(reason || 'Нарушение правил форума')
    : 'Удалено автором';
  write(s);
}

/* ── Реакции ──────────────────────────────────────────────────────────────── */

/**
 * Реакция у человека одна на запись. Повторное нажатие снимает её,
 * другая реакция — заменяет. Поставить лайк и дизлайк разом нельзя
 * по устройству, а не по проверке: это не мнение, а накрутка обоих счётчиков.
 *
 * @param {'post'|'comment'} targetType
 * @param {string} targetId
 * @param {string|null} reactionId
 */
export async function setReaction(targetType, targetId, reactionId) {
  const s = read();
  if (!s.me) throw new Error('Сначала войдите');
  if (reactionId != null && !REACTION_IDS.includes(reactionId)) {
    throw new Error('Неизвестная реакция');
  }

  s.reactions = s.reactions.filter(
    (r) => !(r.targetType === targetType && r.targetId === targetId && r.userId === s.me)
  );
  if (reactionId) {
    s.reactions.push({ targetType, targetId, userId: s.me, reactionId });
  }

  /*
    Уведомление о реакции приходит только за согласие и несогласие: смайлики
    ставят десятками, и каждое превратило бы список в шум. То же правило,
    что в триггере forum_notify_reaction: автору записи, себя не считаем.
  */
  if (reactionId === 'like' || reactionId === 'dislike') {
    const isPost = targetType === 'post';
    const post = isPost ? s.posts.find((p) => p.id === targetId) : null;
    const comment = isPost ? null : s.comments.find((c) => c.id === targetId);
    const target = post ?? comment;
    if (target && target.authorId && target.authorId !== s.me) {
      pushNotification(s, {
        userId: target.authorId,
        actorId: s.me,
        actorNick: s.users.find((u) => u.id === s.me)?.nick || '',
        kind: 'reaction',
        postId: isPost ? target.id : comment?.postId ?? null,
        commentId: isPost ? null : target.id,
        preview: isPost ? post.title : comment.body,
      });
    }
  }

  write(s);
}

/* ── Благодарности и репутация ────────────────────────────────────────────── */

/**
 * Кого и за что благодарят: автор, тема-контекст и кусок текста для
 * уведомления. Отказ «нет записи» отличается от «запись удалили» тем же
 * словом, что и в функции базы, поэтому состояние возвращается меткой,
 * а не просто null.
 *
 * Удалённая тема уносит с собой и ответ: благодарность висит на конкретной
 * строке, а показать её после удаления темы негде — тот же порядок, что
 * в функции forum_give_thank.
 */
function thankTarget(s, targetType, targetId) {
  const miss = () => ({ code: 'missing' });
  const gone = (authorId, postId, snippet) => ({ code: 'deleted', authorId, postId, snippet });

  if (targetType === 'post') {
    const p = s.posts.find((x) => x.id === targetId);
    if (!p) return miss();
    if (p.deleted) return gone(p.authorId, p.id, p.title);
    return { code: 'ok', authorId: p.authorId, postId: p.id, snippet: p.title };
  }

  const c = s.comments.find((x) => x.id === targetId);
  if (!c) return miss();
  const post = s.posts.find((p) => p.id === c.postId);
  if (c.deleted || !post || post.deleted) return gone(c.authorId, c.postId, c.body);
  return { code: 'ok', authorId: c.authorId, postId: c.postId, snippet: c.body };
}

/**
 * Благодарность автору записи.
 *
 * Одно нажатие — одна строка, и строка остаётся навсегда: снять благодарность
 * нельзя ни здесь, ни в базе (политик на изменение и удаление у таблицы нет).
 * Слова отказа совпадают с базой дословно — следит за этим тест.
 */
export async function giveThanks(targetType, targetId) {
  const L = CONFIG.forum.limits;
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Благодарность пишет вошедший игрок');
  if (targetType !== 'post' && targetType !== 'comment') {
    throw new Error('Благодарят за тему или за ответ');
  }

  const target = thankTarget(s, targetType, targetId);
  if (target.code === 'missing') throw new Error('Записи уже нет: страница устарела');
  if (target.code === 'deleted') throw new Error('Эту запись удалили — благодарить не за что');
  if (target.authorId === me.id) throw new Error('Свой текст не благодарят');

  if (!s.thanks) s.thanks = [];
  const rows = s.thanks.filter((t) => t.targetType === targetType && t.targetId === targetId);
  if (rows.some((t) => t.giverId === me.id)) {
    throw new Error('Вы уже благодарили автора этой записи');
  }

  /*
    Час браузера в черновом режиме — тот же час, что и у записи, поэтому
    окно считается просто по метке времени. В базе оно держится на now(),
    и перенос стрелок на компьютере limits не обходят: там отказ придёт
    от функции.
  */
  const since = Date.now() - L.thanksWindowMinutes * 60000;
  if (s.thanks.filter((t) => t.giverId === me.id && new Date(t.createdAt).getTime() > since).length
      >= L.thanksPerWindow) {
    throw new Error(`Не больше ${L.thanksPerWindow} благодарностей за ${L.thanksWindowMinutes} минут — спасибо говорят за дело, а не подряд`);
  }

  s.thanks.push({
    targetType,
    targetId,
    giverId: me.id,
    // Автор записан копией: факт «поблагодарили вот этого человека» не должен
    // поехать, если позже изменится профиль или сама запись.
    authorId: target.authorId,
    createdAt: new Date().toISOString(),
  });

  pushNotification(s, {
    userId: target.authorId,
    actorId: me.id,
    actorNick: me.nick,
    kind: 'thanks',
    postId: target.postId,
    commentId: targetType === 'comment' ? targetId : null,
    preview: target.snippet,
  });

  write(s);
}

/** Начисление репутации владельцем: только добавляет строку, ничего не правит. */
export async function grantReputation(userId, delta, reason) {
  const L = CONFIG.forum.limits;
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Награду выдаёт вошедший владелец');
  if (me.role !== 'admin') throw new Error('Репутацию меняет только владелец');
  if (!delta || Number(delta) === 0) {
    throw new Error('Ноль ничего не меняет — нужна дельта от −100 до 100');
  }
  if (Math.abs(Number(delta)) > L.repGrantMax) {
    throw new Error('Дельта награды умещается в сто очков');
  }
  const note = String(reason ?? '').trim();
  if (note.length < L.repReasonMin) {
    throw new Error(`Пояснение короче ${L.repReasonMin} символов — награду нужно описать словами`);
  }
  if (note.length > L.repReasonMax) {
    throw new Error(`Пояснение длиннее ${L.repReasonMax} символов`);
  }
  if (!s.users.some((u) => u.id === userId)) throw new Error('Такого игрока нет: страница устарела');
  if (userId === me.id) throw new Error('Себе награду не выдают');

  if (!s.repGrants) s.repGrants = [];
  s.repGrants.push({
    id: `rg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    userId,
    delta: Number(delta),
    reason: note,
    grantedBy: me.id,
    grantedByNick: me.nick,
    createdAt: new Date().toISOString(),
  });
  write(s);
}

/**
 * История начислений. Свою видит сам игрок, всю — модерация; чужая закрыта
 * и здесь, и в базе (forum_reputation_grant_list).
 */
export async function listReputationGrants(userId = null) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Историю читает вошедший игрок');
  const staff = me.role === 'admin' || me.role === 'moderator';
  if (userId && userId !== me.id && !staff) throw new Error('Чужая история начислений закрыта');
  if (!userId && !staff) throw new Error('Без указания игрока историю читает только модерация');

  // Разворот перед сортировкой — не украшение: метка времени ставится в
  // миллисекундах, и две награды за одну секунду равны для сравнения.
  // Сортировка устойчива, поэтому равные строки остаются в порядке «поздняя
  // впереди», как и делает база с точностью до микросекунд.
  return (s.repGrants || [])
    .filter((g) => !userId || g.userId === userId)
    .reverse()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100)
    .map((g) => {
      const owner = s.users.find((u) => u.id === g.userId);
      return {
        id: g.id,
        userId: g.userId,
        nick: owner?.nick || '',
        delta: Number(g.delta),
        reason: g.reason,
        grantedByNick: g.grantedByNick || 'владелец ушёл',
        createdAt: toDate(g.createdAt) ?? new Date(),
      };
    });
}

/* ── Уведомления ──────────────────────────────────────────────────────────── */

/**
 * Ники, упомянутые в тексте. То же правило, что `forum_mentioned_nicks`
 * в supabase/rich-forum.sql: адрес-разделитель перед «@» и ник из букв,
 * цифр, подчёркивания и дефиса. Разбор для рассылки, поэтому строгий:
 * показавшееся упоминание прощается, уведомление нет.
 */
function mentionedNicks(text) {
  const nicks = new Set();
  const re = /(?:^|[\s(«">])@([\p{L}\p{N}_-]{2,24})/gu;
  for (const m of String(text ?? '').matchAll(re)) {
    nicks.add(m[1].toLowerCase());
  }
  return [...nicks];
}

/**
 * Одно уведомление. У всех правил общее: себя не уведомляем (человек знает,
 * что написал), и на одного человека — одно уведомление за одно действие.
 */
function pushNotification(state, { userId, actorId, actorNick, kind, postId = null, commentId = null, preview = '' }) {
  if (!userId) return;
  state.notifications.push({
    id: newId('n'),
    userId,
    actorId,
    actorNick,
    kind,
    postId,
    commentId,
    preview: String(preview ?? '').slice(0, 120),
    readAt: null,
    createdAt: new Date().toISOString(),
  });
}

/** Упомянутые в тексте участники, которым ещё не уведомили за это действие. */
function mentionTargets(state, text, skip = new Set()) {
  const targets = [];
  for (const nick of mentionedNicks(text)) {
    const user = state.users.find((u) => u.nick.toLowerCase() === nick);
    if (user && !skip.has(user.id)) targets.push(user);
  }
  return targets;
}

/* ── Жалобы и модерация ───────────────────────────────────────────────────── */

export async function report({ targetType, targetId, ruleId, note = '' }) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');

  // Повторная жалоба того же человека на то же — не новая жалоба.
  const already = s.reports.some(
    (r) => r.targetId === targetId && r.targetType === targetType && r.reporterId === me.id
  );
  if (already) return;

  const isPost = targetType === 'post';
  const post = isPost ? s.posts.find((p) => p.id === targetId) : null;
  const comment = isPost ? null : s.comments.find((c) => c.id === targetId);
  const target = post ?? comment;

  s.reports.push({
    id: newId('r'),
    targetType,
    targetId,
    // Родительский пост: по нему строится ссылка «Открыть на сайте».
    targetPostId: isPost ? targetId : comment?.postId ?? null,
    // Поля цели в локальном режиме заполняются так же, как представление
    // forum_report_list в базе: иначе экран модерации показал бы «автор
    // неизвестен» и «текст недоступен» только потому, что форум не на Supabase.
    targetTitle: isPost ? String(post?.title ?? '') : '',
    targetBody: String(target?.body ?? '').slice(0, 400),
    targetAuthorNick: String(target?.authorNick ?? ''),
    targetAutoHidden: Boolean(target?.autoHidden),
    reporterId: me.id,
    reporterNick: me.nick,
    ruleId,
    note,
    createdAt: new Date().toISOString(),
    resolved: false,
  });
  const reports = s.reports.filter((r) => !r.resolved && r.targetType === targetType && r.targetId === targetId);
  if (reports.length >= 5 && target && !target.deleted) {
    target.deleted = true;
    target.autoHidden = true;
    // Дата скрытия нужна сигналу «материалы скрыты после пяти жалоб»: база
    // ставит deleted_at в том же update (20260916-forum-community.sql), и без
    // неё черновой режим не отличил бы свежее скрытие от недельного.
    target.deletedAt = new Date().toISOString();
    target.deletedReason = 'Скрыто автоматически после пяти жалоб: материал проверяет модератор.';
  }
  write(s);
}

export async function listReports() {
  const s = read();
  return s.reports
    .map((r) => ({ ...r, createdAt: toDate(r.createdAt) ?? new Date() }))
    .filter((r) => !r.resolved)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Жалоба разобрана. Строку не удаляем: список решений — тоже история. */
export async function resolveReport(reportId) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me || (me.role !== 'admin' && me.role !== 'moderator')) {
    throw new Error('Недостаточно прав');
  }
  const rep = s.reports.find((r) => r.id === reportId);
  if (rep) {
    rep.resolved = true;
    s.moderationActions.unshift({ id: newId('ma'), actorNick: me.nick, targetType: 'report', targetId: rep.id, targetNick: '', action: 'report_resolved', details: { ruleId: rep.ruleId }, createdAt: new Date().toISOString() });
  }
  write(s);
}

export async function subscribeTopic(postId) {
  const s = read();
  const me = meOrThrow(s);
  if (!s.topicSubscriptions.some((x) => x.postId === postId && x.userId === me.id)) {
    s.topicSubscriptions.push({ postId, userId: me.id });
    write(s);
  }
}

export async function unsubscribeTopic(postId) {
  const s = read();
  s.topicSubscriptions = s.topicSubscriptions.filter((x) => x.postId !== postId || x.userId !== s.me);
  write(s);
}

/**
 * Закладка в черновом режиме — ровно та же форма, что в базе: одна строка
 * «человек — тема» с датой постановки. Дубликат не удваивается, снятие
 * удаляет строку, а не прячет её, и ничего не сообщает автору: уведомлений
 * у закладки нет ни в одном из режимов.
 */
export async function bookmarkTopic(postId) {
  const s = read();
  const me = meOrThrow(s);
  if (!s.bookmarks.some((x) => x.postId === postId && x.userId === me.id)) {
    s.bookmarks.push({ postId, userId: me.id, createdAt: new Date().toISOString() });
    write(s);
  }
}

export async function unbookmarkTopic(postId) {
  const s = read();
  s.bookmarks = s.bookmarks.filter((x) => x.postId !== postId || x.userId !== s.me);
  write(s);
}

export async function subscribeAlliance(allianceId) {
  const s = read();
  const me = meOrThrow(s);
  if (!s.allianceSubscriptions) s.allianceSubscriptions = [];
  if (!s.allianceSubscriptions.some((x) => x.allianceId === allianceId && x.userId === me.id)) {
    s.allianceSubscriptions.push({ allianceId, userId: me.id });
    write(s);
  }
}

export async function unsubscribeAlliance(allianceId) {
  const s = read();
  s.allianceSubscriptions = (s.allianceSubscriptions || []).filter((x) => x.allianceId !== allianceId || x.userId !== s.me);
  write(s);
}

export async function listAllianceSubscriptions() {
  const s = read();
  return (s.allianceSubscriptions || []).filter((x) => x.userId === s.me).map((x) => x.allianceId);
}

export async function recordAllianceRankSnapshot() {}

export async function restoreAutoHiddenContent(targetType, targetId) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!isStaff(me)) throw new Error('Недостаточно прав');
  const list = targetType === 'post' ? s.posts : s.comments;
  const target = list.find((item) => item.id === targetId);
  if (!target?.autoHidden) throw new Error('Материал не был скрыт автоматически');
  target.deleted = false;
  target.autoHidden = false;
  target.deletedReason = '';
  write(s);
}

export async function listModerationQueue() {
  const s = read();
  const groups = new Map();
  for (const r of s.reports.filter((item) => !item.resolved)) {
    const key = `${r.targetType}:${r.targetId}`;
    const item = groups.get(key) || { targetType: r.targetType, targetId: r.targetId, reportCount: 0, firstReportAt: r.createdAt, lastReportAt: r.createdAt };
    item.reportCount += 1;
    if (new Date(r.createdAt) < new Date(item.firstReportAt)) item.firstReportAt = r.createdAt;
    if (new Date(r.createdAt) > new Date(item.lastReportAt)) item.lastReportAt = r.createdAt;
    groups.set(key, item);
  }
  return [...groups.values()].map((item) => ({ ...item, priority: item.reportCount >= 5 ? 'critical' : item.reportCount >= 3 ? 'urgent' : 'normal', firstReportAt: toDate(item.firstReportAt), lastReportAt: toDate(item.lastReportAt) })).sort((a, b) => b.reportCount - a.reportCount);
}

export async function listModerationActions() {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me || !isStaff(me)) throw new Error('Недостаточно прав');
  return (s.moderationActions || []).map((item) => ({ ...item, createdAt: toDate(item.createdAt) ?? new Date() }));
}

export async function listUsers() {
  const s = read();
  return s.users.map(userOut).sort((a, b) => a.nick.localeCompare(b.nick, 'ru'));
}

/* ── Сигналы о спаме ───────────────────────────────────────────────────────── */

/*
  Причины названы теми же словами, что в функции базы
  (supabase/20260926-spam-signals.sql). Список читает модератор, и одна
  формулировка на два режима дешевле, чем две, которые через месяц разойдутся:
  панель показывает то, что человек и так увидит на рабочем сайте.
*/
const SIGNAL_PACE_POSTS = 'темы на пределе выдержки';
const SIGNAL_PACE_COMMENTS = 'ответы на пределе выдержки';
const SIGNAL_REPORTS = 'открытые жалобы на его материалах';
const SIGNAL_HIDDEN = 'материалы скрыты после пяти жалоб';

/**
 * Сигналы о спаме в черновом режиме.
 *
 * Считается заново на каждый вызов — ровно как в базе, где список нигде не
 * лежит. Поэтому здесь нельзя увидеть вчерашний состав и нельзя поймать
 * сигнал, которого уже нет: окно живёт столько, сколько ему положено.
 *
 * Числа берутся из config.js, а не из памяти про миграцию: пределы выдержки,
 * multiplied для модерации втрое, срок свежести жалоб и скрытого. Совпадение
 * этих чисел с текстом триггеров сторожит тест.
 */
export async function listSpamSignals() {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!isStaff(me)) throw new Error('Сигналы о спаме видит модерация');

  const L = CONFIG.forum.limits;
  const now = Date.now();
  const minutes = (n) => now - n * 60000;
  const dayMs = minutes(24 * 60);
  const weekMs = minutes(L.spamSignalWindowDays * 24 * 60);

  /** Автор материала по его id: жалоба висит на теме или ответе, а не на человеке. */
  const materialAuthor = new Map();
  for (const p of s.posts) materialAuthor.set(p.id, p.authorId);
  for (const c of s.comments) materialAuthor.set(c.id, c.authorId);

  const rows = new Map();
  const lastSeen = new Map();
  const row = (userId) => {
    if (!rows.has(userId)) {
      rows.set(userId, {
        userId,
        nick: '',
        role: 'member',
        posts20m: 0,
        comments2m: 0,
        posts24h: 0,
        comments24h: 0,
        openReports: 0,
        autoHidden: 0,
        sectionMutes: 0,
        banned: false,
        mutedUntil: null,
        lastActivity: null,
        signals: [],
      });
    }
    return rows.get(userId);
  };
  const touched = (userId, at) => {
    const ms = new Date(at).getTime();
    if (Number.isFinite(ms) && ms > (lastSeen.get(userId) ?? 0)) lastSeen.set(userId, ms);
  };

  const pace = (list, shortMinutes, shortKey, dayKey) => {
    for (const r of list) {
      if (!r.authorId) continue;
      const ms = new Date(r.createdAt).getTime();
      if (!Number.isFinite(ms) || ms < dayMs) continue;
      const acc = row(r.authorId);
      acc[dayKey] += 1;
      if (ms > minutes(shortMinutes)) acc[shortKey] += 1;
      touched(r.authorId, ms);
    }
  };
  pace(s.posts, L.postHoldMinutes, 'posts20m', 'posts24h');
  pace(s.comments, L.commentHoldMinutes, 'comments2m', 'comments24h');

  for (const rep of s.reports) {
    if (rep.resolved) continue;
    const ms = new Date(rep.createdAt).getTime();
    if (!Number.isFinite(ms) || ms < weekMs) continue;
    const author = materialAuthor.get(rep.targetId);
    if (author) row(author).openReports += 1;
  }

  for (const r of [...s.posts, ...s.comments]) {
    if (!r.autoHidden || !r.authorId) continue;
    const ms = new Date(r.deletedAt ?? r.createdAt).getTime();
    if (!Number.isFinite(ms) || ms < weekMs) continue;
    row(r.authorId).autoHidden += 1;
  }

  for (const m of s.sectionMutes || []) {
    const until = toDate(m.mutedUntil);
    if (!until || until.getTime() <= now) continue;
    row(m.userId).sectionMutes += 1;
  }

  for (const u of s.users) {
    const r = rows.get(u.id);
    if (!r) continue;
    r.nick = u.nick || '';
    r.role = u.role || 'member';
    r.banned = Boolean(u.banned);
    r.mutedUntil = toDate(u.mutedUntil);
    r.lastActivity = lastSeen.has(u.id) ? new Date(lastSeen.get(u.id)) : null;
    const staff = u.role === 'admin' || u.role === 'moderator';
    /*
      «Предел рядом» = разрешено минус одна запись: человек ещё пишет, но
      следующий шаг упрётся в отказ. У модерации тот же тройной запас, что у
      триггера выдержки, — иначе сигнал ловил бы модератора за его работу.
    */
    if (r.posts20m >= L.postHoldMax * (staff ? 3 : 1) - 1) r.signals.push(SIGNAL_PACE_POSTS);
    if (r.comments2m >= L.commentHoldMax * (staff ? 3 : 1) - 1) r.signals.push(SIGNAL_PACE_COMMENTS);
    if (r.openReports >= L.spamSignalReportMin) r.signals.push(SIGNAL_REPORTS);
    if (r.autoHidden >= 1) r.signals.push(SIGNAL_HIDDEN);
  }

  /*
    Две границы, как в запросе базы: без причин строки не бывает, и без тем и
    ответов за сутки тоже — жалобу, висящую на материале месячной давности,
    разбирают в очереди жалоб.
  */
  return [...rows.values()]
    .filter((r) => r.signals.length && r.posts24h + r.comments24h > 0)
    .sort((a, b) => b.signals.length - a.signals.length
      || (b.posts24h + b.comments24h) - (a.posts24h + a.comments24h)
      || a.nick.localeCompare(b.nick, 'ru'));
}

/* ── Первые шаги новичка ──────────────────────────────────────────────────
 *
 * Черновой режим повторяет функцию базы
 * (supabase/20260926-starter-checklist.sql) строго по составу: те же пять
 * ключей, то же окно новичка и те же условия — шаг закрыт, только когда в
 * черновых строках действительно что-то лежит. Отмечать шаги нажатием здесь
 * нельзя ровно по той же причине, что и в базе: снял закладку — галочка
 * осталась бы висеть.
 *
 * Ни ответа базы, ни ошибок этот список не требует: он приватен и ни на что не
 * влияет, поэтому и в черновом режиме виден ровно одному человеку — тому, кто
 * вошёл.
 */
export async function listStarterSteps() {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) return [];

  /*
    Новичок — столько дней, сколько считает база (`starterWindowDays`), и ни
    днём больше. Отдельной кнопки «хватит меня учить» для этого нет ни здесь,
    ни там: срок хранит себя сам.
  */
  const L = CONFIG.forum.limits;
  const windowMs = L.starterWindowDays * 24 * 3600 * 1000;
  const born = toDate(me.createdAt);
  if (!born || Date.now() - born.getTime() > windowMs) return [];

  return [
    {
      /*
        Любой из трёх знаков профиля (правило 4 базы). Проверка совпадает с
        базовой до буквы: пустое значение аватарки — это отсутствие строки, а
        не пробел, поэтому пробел из неё вырезать не нужно.
      */
      id: 'profile',
      done: Boolean(
        String(me.about || '').trim()
        || String(me.allianceTag || '').trim()
        || String(me.avatarUrl || '')
      ),
    },
    {
      // Удалённый ответ не считается: его сняли за нарушение.
      id: 'reply',
      done: s.comments.some((c) => c.authorId === me.id && !c.deleted),
    },
    {
      // Своя благодарность автору, а не та, что поставили тебе.
      id: 'thanks',
      done: s.thanks.some((t) => t.giverId === me.id),
    },
    {
      id: 'save',
      done: (s.bookmarks || []).some((b) => b.userId === me.id),
    },
    {
      id: 'ally',
      done: (s.allianceSubscriptions || []).some((a) => a.userId === me.id),
    },
  ];
}

/* ── Страница участника ───────────────────────────────────────────────────── */

/*
  Профиль в локальном режиме. Раньше страница участника ходила за ним
  в базу напрямую (forum/profile.js) — и в черновом режиме, где базы нет,
  нажатие на ник давало «Не удалось связаться с базой». Это неверно:
  локальный режим обязан показывать всё, что показывает рабочий, иначе его
  нельзя ни проверить, ни показать.
*/

/** @param {string} nick */
export async function getProfile(nick) {
  const s = read();
  const key = String(nick ?? '').trim().toLowerCase();
  const u = s.users.find((x) => x.nick.toLowerCase() === key);
  if (!u) return null;

  const mine = s.posts.filter((p) => p.authorId === u.id && !p.deleted);
  const myComments = s.comments.filter((c) => c.authorId === u.id && !c.deleted);
  const ids = new Set([...mine.map((p) => p.id), ...myComments.map((c) => c.id)]);
  const likes = s.reactions.filter((r) => r.reactionId === 'like' && ids.has(r.targetId)).length;
  const blog = mine.filter((p) => p.category === 'blog');

  /*
    Профиль по колонкам совпадает с представлением forum_profiles: те же
    благодарности, те же проверенные разборы и те же состоявшиеся встречи.
    Считается по строкам, а не по счётчику — иначе черновик показывал бы то,
    чего рабочая база уже не скажет.
  */
  const thanked = (s.thanks || []).filter((t) => t.authorId === u.id).length;
  const guides = (s.guides || []).filter(
    (g) => g.authorId === u.id && (g.status || 'published') === 'published' && g.reviewStatus === 'verified'
  ).length;
  const grants = (s.repGrants || []).filter((g) => g.userId === u.id);
  const held = mine.filter((p) => {
    if (!needsEventDate(p.tags) || !p.eventAt || new Date(p.eventAt).getTime() > Date.now()) return false;
    return (s.eventRsvps || []).some((r) => r.postId === p.id && r.status === 'going' && r.userId !== u.id);
  }).length;

  return {
    ...userOut(u),
    postCount: mine.length,
    commentCount: myComments.length,
    likesReceived: likes,
    blogViews: blog.reduce((sum, p) => sum + Number(p.views || 0), 0),
    blogPostCount: blog.length,
    thanksReceived: thanked,
    verifiedGuides: guides,
    eventsHeld: held,
    repGrantPoints: grants.reduce((sum, g) => sum + Number(g.delta || 0), 0),
    repGrantCount: grants.length,
  };
}

/**
 * Посты участника — в том же виде, что отдаёт база (snake_case): страница
 * участника читает их именно так, и локальный режим не должен отличаться.
 */
export async function getUserPosts(userId, limit = 10) {
  const s = read();
  return s.posts
    .filter((p) => p.authorId === userId && !p.deleted)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, Number(limit))
    .map((p) => {
      const out = postOut(s, p);
      return {
        id: out.id,
        title: out.title,
        body: out.body,
        category: out.category,
        created_at: p.createdAt,
        views: out.views,
        score: out.score,
        comment_count: out.commentCount,
      };
    });
}

export async function saveProfile(patch) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');
  if (patch.about != null) me.about = String(patch.about).trim().slice(0, 200);
  if (patch.allianceTag != null) {
    me.allianceTag = String(patch.allianceTag).trim().toUpperCase().replace(/\s+/g, '').slice(0, 12);
  }
  write(s);
}

/**
 * ВОССТАНОВЛЕНИЕ ДОСТУПА В ЧЕРНОВОМ РЕЖИМЕ.
 *
 * Паролей здесь нет вовсе (см. `capabilities.canAuth` ниже), поэтому
 * восстанавливать нечего, а очередь заявок была бы бутафорией: двигать
 * строчку, за которой нет аккаунта, — не работа.
 *
 * Отказываемся честно и одним текстом, а не пустым списком: и панель, и
 * страница входа показывают тогда «здесь этого нет», а не молчаливую видимость
 * работы.
 */
const NO_RECOVERY = 'В локальном режиме паролей нет — восстанавливать нечего';

export async function beginRecovery() {
  throw new Error(NO_RECOVERY);
}

export async function recoveryStatus() {
  throw new Error(NO_RECOVERY);
}

export async function finishRecovery() {
  throw new Error(NO_RECOVERY);
}

export async function listRecoveryRequests() {
  throw new Error(NO_RECOVERY);
}

export async function reviewRecovery() {
  throw new Error(NO_RECOVERY);
}

export async function setRestriction(userId, opts) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me || (me.role !== 'admin' && me.role !== 'moderator')) {
    throw new Error('Недостаточно прав');
  }
  const user = s.users.find((u) => u.id === userId);
  if (!user) throw new Error('Игрок не найден');
  if (user.role === 'admin') throw new Error('Администратора ограничить нельзя');

  if (opts.banned != null) user.banned = Boolean(opts.banned);
  if (opts.mutedUntil !== undefined) {
    user.mutedUntil = opts.mutedUntil ? new Date(opts.mutedUntil).toISOString() : null;
  }
  if (opts.reason != null) user.banReason = String(opts.reason);
  s.moderationActions.unshift({ id: newId('ma'), actorNick: me.nick, targetType: 'user', targetId: user.id, targetNick: user.nick, action: 'restriction_changed', details: { banned: Boolean(user.banned), mutedUntil: user.mutedUntil, reason: user.banReason || '' }, createdAt: new Date().toISOString() });
  write(s);
}

export async function setBlogger(userId, isBlogger) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me || (me.role !== 'admin' && me.role !== 'moderator')) {
    throw new Error('Недостаточно прав');
  }
  const user = s.users.find((u) => u.id === userId);
  if (!user) throw new Error('Игрок не найден');
  user.isBlogger = Boolean(isBlogger);
  write(s);
}

/* ── Оспаривание запрета писать и тишины ─────────────────────────────────────
 *
 * Черновой режим повторяет базу по правилам и по словам отказа
 * (supabase/20260925-sanction-appeal.sql): страница в разработке обязана
 * показывать ровно тот диалог, который ждёт игрока на общем форуме.
 *
 * Право возразить здесь, как и в базе, НЕ проверяется через «может ли
 * писать»: забаненный человек проходит мимо banCanWrite(). Иначе черновой
 * режим отрабатывал бы сценарий, в котором апелляции не бывает вовсе.
 */

function appealOut(a) {
  return {
    id: a.id,
    userId: a.userId,
    userNick: a.userNick,
    kind: a.kind,
    sanction: a.sanction,
    message: a.message,
    status: a.status,
    answer: a.answer,
    createdAt: toDate(a.createdAt) ?? new Date(),
    decidedAt: toDate(a.decidedAt),
    decidedByNick: a.decidedByNick || '',
  };
}

export async function listAppeals() {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  const all = s.appeals.map(appealOut).sort((a, b) => b.createdAt - a.createdAt);
  // Как в представлении базы: свои видит игрок, всё — модерация. Ник
  // ответившего игроку черновик тоже прячет — в базе его не отдаёт политика
  // forum_users, а без этой строки черновой режим показывал бы то, чего на
  // живом форуме человек не увидит.
  if (isStaff(me)) return all;
  return all
    .filter((a) => a.userId === s.me)
    .map((a) => ({ ...a, decidedByNick: '' }));
}

export async function openAppeal(kind, message) {
  const L = CONFIG.forum.limits;
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Оспорить решение может только вошедший игрок');
  if (kind !== 'ban' && kind !== 'mute') throw new Error('Оспорить можно запрет писем или тишину');

  const mutedUntil = toDate(me.mutedUntil);
  if (kind === 'ban' && !me.banned) throw new Error('Запрета писем сейчас нет — оспаривать нечего');
  if (kind === 'mute' && (!mutedUntil || mutedUntil <= new Date())) {
    throw new Error('Тишина уже закончилась — оспаривать нечего');
  }

  const text = String(message ?? '').trim();
  if (text.length < L.appealMessageMin) {
    throw new Error(`Нужно хотя бы ${L.appealMessageMin} символов: опишите, что именно не так с решением`);
  }
  if (text.length > L.appealMessageMax) {
    throw new Error(`Не больше ${L.appealMessageMax} символов: важна суть, а не пересказ всей переписки`);
  }
  if (s.appeals.some((a) => a.userId === me.id && a.kind === kind && a.status === 'open')) {
    throw new Error('Такая апелляция уже открыта — модератор её ещё не разобрал');
  }

  const last = s.appeals
    .filter((a) => a.userId === me.id && a.kind === kind && a.status !== 'open')
    .map((a) => toDate(a.decidedAt))
    .filter(Boolean)
    .sort((a, b) => b - a)[0];

  if (last) {
    const left = Math.ceil((last.getTime() + L.appealCooldownDays * 86400000 - Date.now()) / 86400000);
    if (left > 0) {
      throw new Error(`По этому вопросу уже ответили: новую апелляцию можно открыть через ${left} дн.`);
    }
  }

  s.appeals.push({
    id: newId('ap'),
    userId: me.id,
    userNick: me.nick,
    kind,
    sanction: me.banReason || 'причина не указана',
    message: text.slice(0, L.appealMessageMax),
    status: 'open',
    answer: '',
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    decidedByNick: '',
  });

  for (const staff of s.users.filter(isStaff)) {
    pushNotification(s, {
      userId: staff.id,
      actorId: null,
      actorNick: 'Система',
      kind: 'moderation',
      preview: `Апелляция: ${me.nick} — ${kind === 'ban' ? 'запрет писем' : 'тишина'}`,
    });
  }

  write(s);
}

export async function reviewAppeal(id, status, answer) {
  const L = CONFIG.forum.limits;
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!isStaff(me)) throw new Error('Апелляцию разбирает модерация');
  if (status !== 'upheld' && status !== 'rejected') {
    throw new Error(`Неизвестное решение по апелляции: ${status}`);
  }

  const appeal = s.appeals.find((a) => a.id === id);
  if (!appeal) throw new Error('Апелляция не найдена');

  const text = String(answer ?? '').trim();
  if (text.length < L.appealAnswerMin) {
    throw new Error(`Нужно хотя бы ${L.appealAnswerMin} символов: игрок ждёт объяснения, а не молчаливого отказа`);
  }
  if (text.length > L.appealAnswerMax) {
    throw new Error(`Не больше ${L.appealAnswerMax} символов: объяснение должно читаться и с телефона`);
  }

  if (appeal.status !== 'open') {
    throw new Error(`Эта апелляция уже разобрана: ${appeal.status === 'upheld' ? 'удовлетворена' : 'отклонена'}`);
  }

  appeal.status = status;
  appeal.answer = text.slice(0, L.appealAnswerMax);
  appeal.decidedAt = new Date().toISOString();
  appeal.decidedBy = me.id;
  appeal.decidedByNick = me.nick;

  if (status === 'upheld') {
    const user = s.users.find((u) => u.id === appeal.userId);
    if (user) {
      if (appeal.kind === 'ban') {
        user.banned = false;
        user.banReason = '';
      } else {
        user.mutedUntil = null;
      }
      s.moderationActions.unshift({
        id: newId('ma'),
        actorNick: me.nick,
        targetType: 'user',
        targetId: user.id,
        targetNick: user.nick,
        action: 'restriction_changed',
        details: { banned: Boolean(user.banned), mutedUntil: user.mutedUntil, reason: user.banReason || '' },
        createdAt: new Date().toISOString(),
      });
    }
  }

  /*
    Молчать об исходе нельзя: игрок узнаёт о решении из уведомления, а не из
    очереди панели, которую он может и не открыть.
  */
  pushNotification(s, {
    userId: appeal.userId,
    actorId: me.id,
    actorNick: me.nick,
    kind: 'moderation',
    preview: `Апелация ${status === 'upheld' ? 'удовлетворена' : 'отклонена'}: ${appeal.answer}`,
  });

  write(s);
}

/* ── Тишина в одном разделе ──────────────────────────────────────────────────
 *
 * Черновик повторяет supabase/20260925-section-mute.sql и по правилам, и по
 * словам отказа: где человеку нельзя писать, страница обязана отказать теми же
 * словами, что скажет база, — иначе он узнает про меру только в момент, когда
 * та уже отказала.
 *
 * Границы срока (1–30 дней) и длины пояснения (5–200) здесь повторяют числа
 * функции, а не лежат в config.js: клиент ничего не проверяет на глаз, он
 * пересказывает то, что сказала база. Совпадение сторожит тест.
 */

/** Действующая тишина игрока в разделе; null — раздел открыт. */
function sectionMuteOf(state, userId, category) {
  const now = Date.now();
  return (state.sectionMutes || []).find((m) => {
    if (m.userId !== userId || m.category !== category) return false;
    const until = toDate(m.mutedUntil);
    return until !== null && until.getTime() > now;
  }) || null;
}

/** Отказ тому, кто пишет в закрытый для него раздел. */
function requireSectionOpen(state, me, category) {
  const mute = sectionMuteOf(state, me.id, category);
  if (mute) throw new Error(`Вам нельзя писать в этот раздел: ${mute.reason}`);
}

/** Свои тишины — игроку, любые — модерации; как политика чтения в базе. */
export async function listSectionMutes(userId) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  const id = String(userId || '');
  // Чужую тишину участника политика не отдала бы: пустой список, а не ошибка.
  if (id !== s.me && !isStaff(me)) return [];
  return (s.sectionMutes || [])
    .filter((m) => m.userId === id)
    .map((m) => ({
      userId: m.userId,
      category: m.category,
      mutedUntil: toDate(m.mutedUntil) ?? new Date(),
      reason: m.reason || '',
    }))
    .sort((a, b) => a.mutedUntil - b.mutedUntil);
}

export async function setSectionMute(userId, category, days, reason) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!isStaff(me)) throw new Error('Тишину в разделе налагает и снимает модерация');
  if (!CATEGORY_IDS.includes(category)) throw new Error('Неизвестный раздел');

  const user = s.users.find((u) => u.id === userId);
  if (!user) throw new Error('Игрок не найден');
  if (user.role === 'admin') throw new Error('Администратора тишине не подвергают');

  const vDays = Number(days);
  if (!Number.isInteger(vDays) || vDays < 1 || vDays > 30) {
    throw new Error('Тишина в разделе — от 1 до 30 дней: дольше держит общий запрет');
  }

  const vReason = String(reason ?? '').trim();
  if (vReason.length < 5 || vReason.length > 200) {
    throw new Error('Нужно пояснение от 5 до 200 символов: игрок видит причину');
  }

  /*
    Разделов, которые останутся открытыми. Закрыть последний нельзя: мера
    станет общей, а у общей меры есть дверь апелляции — у суммы частных её нет.
  */
  const free = CATEGORY_IDS.filter(
    (c) => c !== category && !sectionMuteOf(s, user.id, c)
  ).length;
  if (free === 0) {
    throw new Error('Это уже общий запрет: наложите тишину целиком — тогда игрок сможет её оспорить');
  }

  const until = new Date(Date.now() + vDays * 86400000).toISOString();
  const row = (s.sectionMutes || []).find(
    (m) => m.userId === user.id && m.category === category
  );
  if (row) {
    row.mutedUntil = until;
    row.reason = vReason;
    row.setBy = me.id;
  } else {
    s.sectionMutes.push({
      userId: user.id,
      category,
      mutedUntil: until,
      reason: vReason,
      setBy: me.id,
      createdAt: new Date().toISOString(),
    });
  }

  s.moderationActions.unshift({
    id: newId('ma'),
    actorNick: me.nick,
    targetType: 'user',
    targetId: user.id,
    targetNick: user.nick,
    action: 'section_mute',
    details: { category, days: vDays, reason: vReason },
    createdAt: new Date().toISOString(),
  });

  pushNotification(s, {
    userId: user.id,
    actorId: me.id,
    actorNick: me.nick,
    kind: 'moderation',
    preview: `Тишина в разделе: ${vReason}`,
  });

  write(s);
}

export async function clearSectionMute(userId, category) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!isStaff(me)) throw new Error('Тишину в разделе налагает и снимает модерация');
  if (!CATEGORY_IDS.includes(category)) throw new Error('Неизвестный раздел');

  const user = s.users.find((u) => u.id === userId);
  if (!user) throw new Error('Игрок не найден');

  const before = (s.sectionMutes || []).length;
  s.sectionMutes = (s.sectionMutes || []).filter(
    (m) => !(m.userId === user.id && m.category === category)
  );
  if (s.sectionMutes.length === before) {
    // В базе снятие несуществующей тишины молча ничего не делает.
    return;
  }

  s.moderationActions.unshift({
    id: newId('ma'),
    actorNick: me.nick,
    targetType: 'user',
    targetId: user.id,
    targetNick: user.nick,
    action: 'section_mute_removed',
    details: { category },
    createdAt: new Date().toISOString(),
  });

  write(s);
}

/* ── Календарь встреч ─────────────────────────────────────────────────────── */

/**
 * Строка календаря из темы и ответов на неё.
 *
 * Числа считаются по месту, а не хранятся копией: в базе их даёт представление
 * с функциями-счётчиками, и копия разошлась бы с ответами при первой же
 * гонке. Черновику гонки нет — здесь всё читается в один проход.
 */
function eventOut(s, post) {
  const rows = (s.eventRsvps || []).filter((r) => r.postId === post.id);
  const going = rows.filter((r) => r.status === 'going').length;
  const mine = rows.find((r) => r.userId === s.me);
  const capacity = post.eventCapacity == null ? null : Number(post.eventCapacity);
  return {
    id: post.id,
    title: post.title,
    body: post.body,
    category: post.category,
    tags: Array.isArray(post.tags) ? post.tags : [],
    authorId: post.authorId,
    authorNick: post.authorNick,
    createdAt: toDate(post.createdAt) ?? new Date(),
    eventAt: toDate(post.eventAt),
    eventCapacity: capacity,
    goingCount: going,
    maybeCount: rows.filter((r) => r.status === 'maybe').length,
    spotsLeft: capacity == null ? null : Math.max(0, capacity - going),
    myStatus: mine ? mine.status : null,
    myRemindMinutes: mine && mine.remindMinutes != null ? Number(mine.remindMinutes) : null,
  };
}

/**
 * Напоминание в черновом режиме.
 *
 * В базе их носит планировщик (Supabase Cron, см. ЗАПУСК в миграции), а
 * черновику неоткуда взяться задаче, которая просыпается сама: отметку догона
 * ставит та страница, которую открыли. Разница одна — «забытый» календарь
 * напомнит о себе в следующий заход, а не ровно в названный срок.
 *
 * @returns {boolean}  Появились ли новые уведомления: тогда состояние пишут.
 */
function sweepEventReminders(s) {
  const now = Date.now();
  let changed = false;
  for (const r of s.eventRsvps || []) {
    if (!r.remindMinutes || r.remindedAt || r.status === 'declined') continue;
    const post = s.posts.find((p) => p.id === r.postId);
    if (!post || post.deleted || !post.eventAt) continue;
    const at = new Date(post.eventAt).getTime();
    // Те же два условия, что у запроса рассылки: встреча ещё не началась,
    // и её срок наступил.
    if (at <= now || at - r.remindMinutes * 60000 > now) continue;
    pushNotification(s, {
      userId: r.userId,
      actorId: null,
      // Служебное слово на месте ника — тот же порядок, что у «Рейтинга»
      // и «Дайджеста»: напоминание пишет не человек.
      actorNick: 'Календарь',
      kind: 'event',
      postId: post.id,
      preview: `Скоро: ${post.title} — через ${Math.max(1, Math.floor((at - now) / 60000))} мин`,
    });
    r.remindedAt = new Date().toISOString();
    changed = true;
  }
  return changed;
}

export async function listEvents() {
  const s = read();
  if (sweepEventReminders(s)) write(s);
  return s.posts
    // Прошедшие остаются: страница делит ленту на «предстоящие» и «итог»,
    // а удалённые уходят — отменённая встреча не должна числиться в плане.
    .filter((p) => !p.deleted && needsEventDate(p.tags) && p.eventAt)
    .map((p) => eventOut(s, p))
    .sort((a, b) => a.eventAt - b.eventAt);
}

/**
 * Ответ на приглашение.
 *
 * Право писать здесь не смотрим сознательно: забаненный не спорит словами, но
 * прийти на встречу ему никто не мешал (правило 5 в начале миграции). Места
 * считаются в этом же вызове — как в функции форума, где их занимает одна
 * операция, а не две.
 */
export async function answerEvent(postId, status, remindMinutes = null) {
  const L = CONFIG.forum.limits;
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Отвечает на приглашение вошедший игрок');
  if (!EVENT_RSVP_IDS.includes(status)) {
    throw new Error('Отвечают одним из трёх слов: буду, возможно, не приду');
  }
  if (remindMinutes != null && !L.eventRemindChoices.includes(Number(remindMinutes))) {
    throw new Error('Напоминание ставят на готовый срок: за 15 минут, за час или за сутки');
  }

  const post = s.posts.find((p) => p.id === postId);
  if (!post) throw new Error('События уже нет: страница устарела');
  if (!needsEventDate(post.tags)) throw new Error('Отвечать можно только на тему с меткой «Событие»');
  if (post.deleted) throw new Error('Событие отменено — отвечать не на что');
  if (!post.eventAt) throw new Error('У события нет даты — модератору или автору нужно её поставить');
  if (new Date(post.eventAt).getTime() <= Date.now()) {
    throw new Error('Событие уже началось: участие записывают до начала');
  }

  const row = (s.eventRsvps || []).find((r) => r.postId === postId && r.userId === me.id);
  const capacity = post.eventCapacity == null ? null : Number(post.eventCapacity);
  if (status === 'going' && capacity != null && row?.status !== 'going') {
    const going = (s.eventRsvps || []).filter((r) => r.postId === postId && r.status === 'going').length;
    if (going >= capacity) {
      throw new Error(`Мест больше нет: занято ${going} из ${capacity} — организатор ждёт «возможно»`);
    }
  }

  /*
    Напоминание имеет смысл только там, где человек собирается: «не приду» с
    будильником — это будильник, который звонит в пустоту. Новый срок — старое
    напоминание сбрасывается, иначе игрок выбрал бы сутки, а ему однажды
    пришла бы четверть часа.
  */
  const remind = status === 'declined' || remindMinutes == null
    ? null
    : Number(remindMinutes);

  if (row) {
    if (row.remindMinutes !== remind) row.remindedAt = null;
    row.status = status;
    row.remindMinutes = remind;
    row.updatedAt = new Date().toISOString();
  } else {
    s.eventRsvps.push({
      postId,
      userId: me.id,
      status,
      remindMinutes: remind,
      remindedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  write(s);
}

/**
 * УДАЛЕНИЕ АККАУНТА.
 *
 * Профиль исчезает, а его посты и комментарии остаются: ник лежит копией
 * в самой записи, и авторская связь рвётся (пустой id), как и в базе.
 */
export async function adminDeleteUser(userId) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me || (me.role !== 'admin' && me.role !== 'moderator')) {
    throw new Error('Недостаточно прав');
  }
  const target = s.users.find((u) => u.id === userId);
  if (!target) throw new Error('Игрок не найден');
  if (target.role === 'admin') throw new Error('Владельца удалить нельзя');

  s.users = s.users.filter((u) => u.id !== userId);
  for (const p of s.posts) if (p.authorId === userId) p.authorId = null;
  for (const c of s.comments) if (c.authorId === userId) c.authorId = null;
  // Уведомления этого участника уходят вместе с ним — как в базе
  // (on delete cascade по user_id), копию ника автора оставляем.
  s.notifications = s.notifications.filter((n) => n.userId !== userId);
  if (s.me === userId) s.me = null;
  write(s);
}

/* ── Ники и верификация (паритет с рабочей базой, см. nicks-verified.sql) ── */

export async function checkNick(nick) {
  const s = read();
  const key = nickKey(nick);
  if (s.reservedNicks.some((r) => nickKey(r.nick) === key)) {
    return { status: 'reserved' };
  }
  const mine = s.me;
  if (s.users.some((u) => nickKey(u.nick) === key && u.id !== mine)) {
    return { status: 'taken' };
  }
  return { status: 'free' };
}

export async function setVerified(userId, verified) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');
  const target = s.users.find((u) => u.id === userId);
  if (!target) throw new Error('Игрок не найден');
  if (target.id === me.id) throw new Error('Проверить самого себя нельзя: это сделает лидер вашего альянса, модератор или владелец');
  const ownAlliance = target.allianceTag && target.allianceTag === me.leaderOf;
  if (!isStaff(me) && !ownAlliance) throw new Error('Подтверждать игроков может владелец, модератор или лидер альянса игрока');
  target.isVerified = Boolean(verified);
  target.verifiedBy = verified ? me.id : null;
  target.verifiedAt = verified ? new Date().toISOString() : null;
  write(s);
}

export async function renameNick(newNick, reason = '') {
  const s = read();
  const me = meOrThrow(s);
  const v = String(newNick).trim();
  if (v.length < 2 || v.length > 40) throw new Error('Ник должен быть от 2 до 40 символов');
  if (!NICK_SHAPE.test(v)) throw new Error('В нике допустимы только буквы, цифры, пробел, _ и -');
  if (me.nick === v) return;
  const key = nickKey(v);
  if (s.reservedNicks.some((r) => nickKey(r.nick) === key)) throw new Error('Этот ник зарезервирован');
  if (s.users.some((u) => nickKey(u.nick) === key && u.id !== me.id)) throw new Error('Этот ник уже занят');
  const old = me.nick;
  const oldKey = nickKey(old);
  if (!s.reservedNicks.some((r) => r.nick === oldKey)) {
    s.reservedNicks.push({ nick: oldKey, createdAt: new Date().toISOString() });
  }
  me.nick = v;
  for (const p of s.posts) if (p.authorId === me.id) p.authorNick = v;
  for (const c of s.comments) if (c.authorId === me.id) c.authorNick = v;
  for (const ch of s.chats) if (ch.ownerId === me.id) ch.ownerNick = v;
  for (const m of s.chatMessages) if (m.authorId === me.id) m.authorNick = v;
  for (const n of s.notifications) if (n.actorId === me.id) n.actorNick = v;
  s.nickHistory.push({ userId: me.id, oldNick: old, newNick: v, changedBy: null, reason: String(reason), createdAt: new Date().toISOString() });
  write(s);
}

export async function renameNickAs(userId, newNick, reason) {
  const s = read();
  const me = meOrThrow(s);
  if (me.role !== 'admin') throw new Error('Переименовывать игроков может только владелец');
  const target = s.users.find((u) => u.id === userId);
  if (!target) throw new Error('Игрок не найден');
  const v = String(newNick).trim();
  if (v.length < 2 || v.length > 40) throw new Error('Ник должен быть от 2 до 40 символов');
  if (!NICK_SHAPE.test(v)) throw new Error('В нике допустимы только буквы, цифры, пробел, _ и -');
  if (target.nick === v) return;
  const key = nickKey(v);
  if (s.reservedNicks.some((r) => nickKey(r.nick) === key)) throw new Error('Этот ник зарезервирован');
  if (s.users.some((u) => nickKey(u.nick) === key && u.id !== target.id)) throw new Error('Этот ник уже занят');
  const old = target.nick;
  const oldKey = nickKey(old);
  if (!s.reservedNicks.some((r) => r.nick === oldKey)) {
    s.reservedNicks.push({ nick: oldKey, createdAt: new Date().toISOString() });
  }
  target.nick = v;
  for (const p of s.posts) if (p.authorId === target.id) p.authorNick = v;
  for (const c of s.comments) if (c.authorId === target.id) c.authorNick = v;
  for (const ch of s.chats) if (ch.ownerId === target.id) ch.ownerNick = v;
  for (const m of s.chatMessages) if (m.authorId === target.id) m.authorNick = v;
  for (const n of s.notifications) if (n.actorId === target.id) n.actorNick = v;
  s.nickHistory.push({ userId: target.id, oldNick: old, newNick: v, changedBy: me.id, reason: String(reason || ''), createdAt: new Date().toISOString() });
  write(s);
}

export async function listReservedNicks() {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me || me.role !== 'admin') throw new Error('Стоп-лист ников ведёт владелец');
  return s.reservedNicks.map((r) => ({ nick: r.nick, createdAt: new Date(r.createdAt) }));
}

export async function addReservedNick(nick) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me || me.role !== 'admin') throw new Error('Стоп-лист ников ведёт владелец');
  const key = nickKey(nick);
  if (!key) throw new Error('Пустой ник нельзя добавить в стоп-лист');
  if (!s.reservedNicks.some((r) => r.nick === key)) {
    s.reservedNicks.push({ nick: key, createdAt: new Date().toISOString() });
    write(s);
  }
}

export async function removeReservedNick(nick) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me || me.role !== 'admin') throw new Error('Стоп-лист ников ведёт владелец');
  const key = nickKey(nick);
  s.reservedNicks = s.reservedNicks.filter((r) => r.nick !== key);
  write(s);
}

export async function nickHistory(userId) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  const staff = me && (me.role === 'admin' || me.role === 'moderator');
  if (!me || (userId !== me.id && !staff)) throw new Error('Историю смены ника смотрит модерация или сам игрок');
  return s.nickHistory
    .filter((h) => h.userId === userId)
    .map((h) => ({
      createdAt: new Date(h.createdAt),
      oldNick: h.oldNick,
      newNick: h.newNick,
      changedBy: h.changedBy || null,
      reason: h.reason || '',
    }));
}

export async function votePoll(pollId, optionId) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');

  const poll = s.polls.find((pl) => pl.id === pollId);
  if (!poll) throw new Error('Опрос не найден');
  if (poll.closed) throw new Error('Опрос закрыт');

  // Голос за тот же вариант уже стоит — повторное нажатие ничего не меняет.
  const sameOption = s.pollVotes.find(
    (v) => v.pollId === pollId && v.userId === me.id && v.optionId === optionId
  );
  if (sameOption) return;

  // Один вариант: прежний голос заменяется новым. Несколько — голоса
  // складываются, у каждого варианта своя строка.
  if (!poll.multiple) {
    s.pollVotes = s.pollVotes.filter((v) => !(v.pollId === pollId && v.userId === me.id));
  }

  s.pollVotes.push({
    pollId,
    optionId,
    userId: me.id,
    votedAt: new Date().toISOString(),
  });
  write(s);
}

export async function unvotePoll(pollId, optionId) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');

  const poll = s.polls.find((pl) => pl.id === pollId);
  if (!poll) throw new Error('Опрос не найден');
  if (poll.closed) throw new Error('Опрос закрыт');

  s.pollVotes = s.pollVotes.filter(
    (v) => !(v.pollId === pollId && v.optionId === optionId && v.userId === me.id)
  );
  write(s);
}

export async function closePoll(pollId) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');
  if (me.role !== 'admin' && me.role !== 'moderator') throw new Error('Недостаточно прав');

  const poll = s.polls.find((pl) => pl.id === pollId);
  if (!poll) throw new Error('Опрос не найден');
  poll.closed = true;
  write(s);
}

/* ── Уведомления ───────────────────────────────────────────────────────────── */

function notificationOut(s, n) {
  if (!n || n.userId !== s.me) return null;
  return {
    id: n.id,
    userId: n.userId,
    actorId: n.actorId || null,
    actorNick: n.actorNick || '',
    kind: n.kind,
    postId: n.postId || null,
    commentId: n.commentId || null,
    preview: n.preview || '',
    readAt: toDate(n.readAt),
    createdAt: toDate(n.createdAt) ?? new Date(),
  };
}

/** Свои уведомления, свежие сверху. В локальном режиме их создают те же
 *  действия, что и триггеры базы в рабочем режиме (см. выше). */
export async function listNotifications() {
  const s = read();
  return s.notifications
    .filter((n) => n.userId === s.me)
    .sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt))
    .map((n) => notificationOut(s, n));
}

/** Отметить прочитанными перечисленные. Чужие не трогаем — их и не видно. */
export async function markNotificationsRead(ids) {
  const s = read();
  const want = new Set(ids);
  const stamp = new Date().toISOString();
  for (const n of s.notifications) {
    if (n.userId === s.me && want.has(n.id) && !n.readAt) n.readAt = stamp;
  }
  write(s);
}

export async function markAllNotificationsRead() {
  const s = read();
  const stamp = new Date().toISOString();
  for (const n of s.notifications) {
    if (n.userId === s.me && !n.readAt) n.readAt = stamp;
  }
  write(s);
}

/* ── Закрытые чаты (локально, в одном браузере) ───────────────────────────── */

function meOrThrow(s) {
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');
  return me;
}
const isStaff = (u) => u && (u.role === 'admin' || u.role === 'moderator');
const memberOf = (s, chatId, userId) => s.chatMembers.find((m) => m.chatId === chatId && m.userId === userId);
const canManage = (s, chatId, me) => isStaff(me) || ['owner', 'admin'].includes(memberOf(s, chatId, me.id)?.role);

function chatView(s, c, meId) {
  const members = s.chatMembers.filter((m) => m.chatId === c.id);
  const mine = members.find((m) => m.userId === meId);
  const msgs = s.chatMessages.filter((x) => x.chatId === c.id && !x.deleted);
  const last = msgs[msgs.length - 1];
  const lastText = last
    ? (last.body
      || (last.poll ? '📊 Опрос' : '')
      || (last.attachments?.length ? '📎 Вложение' : ''))
    : '';
  const since = mine ? new Date(mine.lastReadAt).getTime() : 0;
  const pinned = c.pinnedMessageId
    ? s.chatMessages.find((m) => m.id === c.pinnedMessageId && !m.deleted)
    : null;
  return {
    ...c,
    createdAt: new Date(c.createdAt),
    memberCount: members.length,
    onlineCount: members.filter((m) => {
      const seen = m.lastSeenAt ? new Date(m.lastSeenAt).getTime() : 0;
      return seen > Date.now() - 5 * 60 * 1000;
    }).length,
    myRole: mine?.role ?? null,
    unread: msgs.filter((x) => new Date(x.createdAt).getTime() > since && x.authorId !== meId).length,
    myLastReadAt: mine?.lastReadAt ? new Date(mine.lastReadAt) : null,
    lastBody: lastText,
    lastNick: last?.authorNick ?? '',
    lastAt: last ? new Date(last.createdAt) : null,
    avatarUrl: c.avatarUrl || '',
    pinnedBody: pinned ? pinned.body?.slice(0, 80) || '' : null,
    pinnedNick: pinned ? pinned.authorNick || null : null,
  };
}

export async function setLeader(userId, allianceTag) {
  const s = read();
  if (!isStaff(meOrThrow(s))) throw new Error('Недостаточно прав');
  const user = s.users.find((u) => u.id === userId);
  if (!user) throw new Error('Игрок не найден');
  const tag = String(allianceTag || '').trim().toUpperCase().slice(0, 12);
  if (tag) {
    // Один лидер на альянс: предыдущего держателя тега снимаем.
    for (const u of s.users) {
      if (u.id !== userId && (u.leaderOf || '') === tag) u.leaderOf = '';
    }
  }
  user.leaderOf = tag;
  user.isLeader = tag !== '';
  // Назначение лидера — доверие владельца: ник игрока тем самым подтверждается.
  if (tag) {
    user.isVerified = true;
    user.verifiedBy = me.id;
    user.verifiedAt = user.verifiedAt || new Date().toISOString();
  }
  write(s);
}

export async function listChats() {
  const s = read();
  if (!s.me) return [];
  const me = s.users.find((u) => u.id === s.me);
  return s.chats
    .filter((c) => isStaff(me) || memberOf(s, c.id, s.me))
    .map((c) => chatView(s, c, s.me))
    .sort((a, b) => (b.lastAt ?? b.createdAt) - (a.lastAt ?? a.createdAt));
}

export async function getChat(id) {
  const s = read();
  const c = s.chats.find((x) => x.id === id);
  if (!c || !s.me) return null;
  const me = s.users.find((u) => u.id === s.me);
  if (!isStaff(me) && !memberOf(s, id, s.me)) return null;
  return chatView(s, c, s.me);
}

export async function createChat({ title, kind = 'alliance', allianceTag = '' }) {
  const s = read();
  const me = meOrThrow(s);
  if (!me.isLeader && !isStaff(me)) throw new Error('Чаты создают лидеры альянсов');
  if (!me.isVerified && !isStaff(me)) throw new Error('Непроверенные не создают чаты');
  const clean = String(title).trim().slice(0, 60);
  if (clean.length < 2) throw new Error('Название чата короче двух символов');
  const c = {
    id: newId('c'), title: clean, kind, allianceTag: String(allianceTag).trim().slice(0, 12),
    ownerId: me.id, ownerNick: me.nick, inviteCode: Math.random().toString(36).slice(2, 10),
    maxMembers: 200, closed: false, closedReason: '', createdAt: new Date().toISOString(),
  };
  s.chats.push(c);
  s.chatMembers.push({ chatId: c.id, userId: me.id, role: 'owner', joinedAt: c.createdAt, lastReadAt: c.createdAt });
  write(s);
  return chatView(s, c, me.id);
}

export async function joinChat(code) {
  const s = read();
  const me = meOrThrow(s);
  const c = s.chats.find((x) => x.inviteCode === String(code).trim().toLowerCase());
  if (!c) throw new Error('Такого приглашения нет — проверьте код');
  if (c.closed) throw new Error('Чат закрыт');
  if (!memberOf(s, c.id, me.id)) {
    if (s.chatMembers.filter((m) => m.chatId === c.id).length >= c.maxMembers) throw new Error('В чате уже 200 участников');
    const now = new Date().toISOString();
    s.chatMembers.push({ chatId: c.id, userId: me.id, role: 'member', joinedAt: now, lastReadAt: now });
    write(s);
  }
  return c.id;
}

export async function leaveChat(chatId) {
  const s = read();
  const me = meOrThrow(s);
  s.chatMembers = s.chatMembers.filter((m) => !(m.chatId === chatId && m.userId === me.id));
  write(s);
}

export async function listChatMembers(chatId) {
  const s = read();
  const order = { owner: 0, admin: 1, member: 2 };
  return s.chatMembers
    .filter((m) => m.chatId === chatId)
    .map((m) => {
      const u = s.users.find((x) => x.id === m.userId);
      return { chatId, userId: m.userId, nick: u?.nick ?? '—', avatarUrl: u?.avatarUrl ?? '', allianceTag: u?.allianceTag ?? '', isLeader: Boolean(u?.isLeader), role: m.role, joinedAt: new Date(m.joinedAt) };
    })
    .sort((a, b) => order[a.role] - order[b.role] || a.nick.localeCompare(b.nick, 'ru'));
}

export async function setChatMemberRole(chatId, userId, role) {
  const s = read();
  const me = meOrThrow(s);
  if (!canManage(s, chatId, me)) throw new Error('Недостаточно прав');
  const m = memberOf(s, chatId, userId);
  if (!m) throw new Error('Участник не найден');
  if (m.role === 'owner' && !isStaff(me)) throw new Error('Владельца чата не разжаловать');
  m.role = role;
  write(s);
}

export async function kickChatMember(chatId, userId) {
  const s = read();
  const me = meOrThrow(s);
  if (!canManage(s, chatId, me)) throw new Error('Недостаточно прав');
  const m = memberOf(s, chatId, userId);
  if (m?.role === 'owner' && !isStaff(me)) throw new Error('Владельца чата выгнать нельзя');
  s.chatMembers = s.chatMembers.filter((x) => !(x.chatId === chatId && x.userId === userId));
  write(s);
}

export async function listChatMessages(chatId, { limit = 60, before = null } = {}) {
  const s = read();
  let list = s.chatMessages.filter((x) => x.chatId === chatId);
  if (before) list = list.filter((x) => new Date(x.createdAt) < new Date(before));
  return list.slice(-limit).map((x) => {
    const u = s.users.find((y) => y.id === x.authorId);
    return {
      ...x,
      createdAt: new Date(x.createdAt),
      authorAvatar: u?.avatarUrl ?? '',
      authorAlliance: u?.allianceTag ?? '',
      authorRole: u?.role ?? 'member',
      authorIsLeader: Boolean(u?.isLeader),
      authorIsVerified: Boolean(u?.isVerified),
      attachments: Array.isArray(x.attachments) ? x.attachments : [],
      poll: x.poll || null,
      replyTo: x.replyTo || null,
      reactions: x.reactions && typeof x.reactions === 'object' ? x.reactions : {},
    };
  });
}

export async function sendChatMessage(chatId, body, opts = {}) {
  const s = read();
  const me = meOrThrow(s);
  if (me.banned) throw new Error('Вам запрещено писать');
  if (!memberOf(s, chatId, me.id) && !isStaff(me)) throw new Error('Вы не участник этого чата');
  const c = s.chats.find((x) => x.id === chatId);
  if (!c || c.closed) throw new Error('Чат закрыт');
  const text = String(body || '').slice(0, 2000);
  if (!text.trim() && !opts.attachments?.length && !opts.poll) throw new Error('Пустое сообщение');
  const m = {
    id: newId('m'),
    chatId,
    authorId: me.id,
    authorNick: me.nick,
    body: text,
    attachments: Array.isArray(opts.attachments) ? opts.attachments : [],
    poll: opts.poll || null,
    replyTo: opts.replyTo || null,
    reactions: {},
    deleted: false,
    deletedReason: '',
    createdAt: new Date().toISOString(),
  };
  s.chatMessages.push(m);
  write(s);
  return {
    ...m,
    createdAt: new Date(m.createdAt),
    authorAvatar: me.avatarUrl ?? '',
    authorAlliance: me.allianceTag ?? '',
    authorRole: me.role,
    authorIsLeader: Boolean(me.isLeader),
    // Метка проверки нужна сразу: своё сообщение не должно мелькать
    // серым «! не проверен» до первого обновления ленты.
    authorIsVerified: Boolean(me.isVerified),
  };
}

export async function deleteChatMessage(id, reason = '') {
  const s = read();
  const me = meOrThrow(s);
  const m = s.chatMessages.find((x) => x.id === id);
  if (!m) return;
  if (m.authorId !== me.id && !canManage(s, m.chatId, me)) throw new Error('Недостаточно прав');
  m.deleted = true;
  m.deletedReason = String(reason || '');
  write(s);
}

export async function deleteChat(chatId) {
  const s = read();
  const me = meOrThrow(s);
  const c = s.chats.find((x) => x.id === chatId);
  if (!c) return;
  const isOwner = c.ownerId === me.id;
  if (!isOwner && !isStaff(me)) throw new Error('Удалить чат может только создатель или модерация');
  s.chats = s.chats.filter((x) => x.id !== chatId);
  s.chatMembers = s.chatMembers.filter((m) => m.chatId !== chatId);
  s.chatMessages = s.chatMessages.filter((m) => m.chatId !== chatId);
  write(s);
}

export async function reactChatMessage(messageId, emoji) {
  const s = read();
  const me = meOrThrow(s);
  const m = s.chatMessages.find((x) => x.id === messageId);
  if (!m) return;
  m.reactions = m.reactions || {};

  // Найти текущую реакцию пользователя.
  let currentEmoji = null;
  for (const [key, voters] of Object.entries(m.reactions)) {
    if (Array.isArray(voters) && voters.includes(me.id)) { currentEmoji = key; break; }
  }

  // Убрать из старого.
  if (currentEmoji && m.reactions[currentEmoji]) {
    m.reactions[currentEmoji] = m.reactions[currentEmoji].filter((id) => id !== me.id);
    if (!m.reactions[currentEmoji].length) delete m.reactions[currentEmoji];
  }

  // Поставить в новый, если не снятие.
  if (currentEmoji !== emoji) {
    m.reactions[emoji] = [...(m.reactions[emoji] || []), me.id];
  }

  write(s);
}

export async function voteChatPoll(messageId, optionIndex) {
  const s = read();
  const me = meOrThrow(s);
  const m = s.chatMessages.find((x) => x.id === messageId);
  if (!m || !m.poll || !Array.isArray(m.poll.options)) return;
  const poll = m.poll;
  const opt = poll.options[optionIndex];
  if (!opt) return;
  opt.voters = Array.isArray(opt.voters) ? opt.voters : [];
  const idx = opt.voters.indexOf(me.id);
  if (idx >= 0) {
    opt.voters.splice(idx, 1);
  } else {
    if (!poll.multiple) {
      for (const o of poll.options) {
        if (Array.isArray(o.voters)) o.voters = o.voters.filter((v) => v !== me.id);
        o.votes = (o.voters || []).length;
      }
    }
    opt.voters.push(me.id);
  }
  opt.votes = opt.voters.length;
  poll.total = new Set(poll.options.flatMap((o) => o.voters || [])).size;
  write(s);
}

export async function markChatRead(chatId) {
  const s = read();
  const m = s.me ? memberOf(s, chatId, s.me) : null;
  if (m) { m.lastReadAt = new Date().toISOString(); m.lastSeenAt = new Date().toISOString(); write(s); }
}

export async function updateChat(chatId, patch) {
  const s = read();
  const me = meOrThrow(s);
  if (!canManage(s, chatId, me)) throw new Error('Недостаточно прав');
  const c = s.chats.find((x) => x.id === chatId);
  if (!c) throw new Error('Чат не найден');
  if (patch.title != null) c.title = String(patch.title).trim().slice(0, 60);
  if (patch.allianceTag != null) c.allianceTag = String(patch.allianceTag).trim().slice(0, 12);
  if (patch.closed != null) c.closed = Boolean(patch.closed);
  if (patch.closedReason != null) c.closedReason = String(patch.closedReason);
  write(s);
}

export async function rotateChatCode(chatId) {
  const s = read();
  const me = meOrThrow(s);
  if (!canManage(s, chatId, me)) throw new Error('Недостаточно прав');
  const c = s.chats.find((x) => x.id === chatId);
  if (!c) throw new Error('Чат не найден');
  c.inviteCode = Math.random().toString(36).slice(2, 10);
  write(s);
  return c.inviteCode;
}

export async function adminDeleteChat(chatId) {
  const s = read();
  if (!isStaff(meOrThrow(s))) throw new Error('Недостаточно прав');
  s.chats = s.chats.filter((c) => c.id !== chatId);
  s.chatMembers = s.chatMembers.filter((m) => m.chatId !== chatId);
  s.chatMessages = s.chatMessages.filter((m) => m.chatId !== chatId);
  write(s);
}

export async function pinChatMessage(chatId, messageId) {
  const s = read();
  const me = meOrThrow(s);
  const c = s.chats.find((x) => x.id === chatId);
  if (!c) throw new Error('Чат не найден');
  const m = memberOf(s, chatId, me.id);
  if (!m || !['owner', 'admin'].includes(m.role)) throw new Error('Недостаточно прав');
  c.pinnedMessageId = messageId;
  write(s);
}

export async function unpinChatMessage(chatId) {
  const s = read();
  const me = meOrThrow(s);
  const c = s.chats.find((x) => x.id === chatId);
  if (!c) throw new Error('Чат не найден');
  const m = memberOf(s, chatId, me.id);
  if (!m || !['owner', 'admin'].includes(m.role)) throw new Error('Недостаточно прав');
  c.pinnedMessageId = null;
  write(s);
}

export async function setTyping(chatId) {
  /* Локальный режим: больше никого в комнате нет, поэтому индикатору набора некого показывать. */
}

export async function createDM(otherUserNick) {
  const s = read();
  const me = meOrThrow(s);
  const other = s.users.find((u) => u.nick.toLowerCase() === String(otherUserNick).toLowerCase());
  if (!other) throw new Error('Игрок не найден');
  const otherUserId = other.id;
  const existing = s.chats.find((c) =>
    c.kind === 'dm' &&
    s.chatMembers.some((m) => m.chatId === c.id && m.userId === me.id) &&
    s.chatMembers.some((m) => m.chatId === c.id && m.userId === otherUserId)
  );
  if (existing) return existing.id;
  const c = {
    id: newId('c'),
    title: other.nick,
    kind: 'dm',
    allianceTag: '',
    ownerId: me.id,
    ownerNick: me.nick,
    inviteCode: '',
    maxMembers: 2,
    closed: false,
    closedReason: '',
    avatarUrl: '',
    pinnedMessageId: null,
    createdAt: new Date().toISOString(),
  };
  s.chats.push(c);
  const now = new Date().toISOString();
  s.chatMembers.push({ chatId: c.id, userId: me.id, role: 'owner', joinedAt: now, lastReadAt: now, lastSeenAt: now, typingAt: null });
  s.chatMembers.push({ chatId: c.id, userId: otherUserId, role: 'member', joinedAt: now, lastReadAt: now, lastSeenAt: now, typingAt: null });
  write(s);
  return c.id;
}

export async function chatLeaderboard() {
  const s = read();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekStartMs = weekStart.getTime();
  const counts = {};
  for (const m of s.chatMessages) {
    if (m.deleted || !m.authorId) continue;
    const created = new Date(m.createdAt).getTime();
    if (created < weekStartMs) continue;
    counts[m.authorId] = (counts[m.authorId] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([uid, count]) => {
      const u = s.users.find((x) => x.id === uid);
      return { userId: uid, nick: u?.nick ?? '—', avatarUrl: u?.avatarUrl ?? '', allianceTag: u?.allianceTag ?? '', messageCount: count };
    })
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 20);
}

/* ── Комментарии к летописи ────────────────────────────────────────────── */

export async function listEventComments(eventId) {
  const s = read();
  return (s.eventComments || [])
    .filter((c) => c.eventId === eventId)
    .map((c) => ({
      ...c,
      createdAt: new Date(c.createdAt),
    }));
}

export async function addEventComment(eventId, body) {
  const s = read();
  const me = meOrThrow(s);
  const text = String(body).trim().slice(0, 2000);
  if (!text) throw new Error('Пустой комментарий');
  const c = {
    id: newId('ec'),
    eventId,
    authorId: me.id,
    authorNick: me.nick,
    body: text,
    deleted: false,
    deletedReason: '',
    createdAt: new Date().toISOString(),
  };
  if (!s.eventComments) s.eventComments = [];
  s.eventComments.push(c);
  write(s);
  return { ...c, createdAt: new Date(c.createdAt) };
}

export async function deleteEventComment(id, reason = '') {
  const s = read();
  const me = meOrThrow(s);
  const c = (s.eventComments || []).find((x) => x.id === id);
  if (!c) return;
  if (c.authorId !== me.id && !isStaff(me)) throw new Error('Недостаточно прав');
  c.deleted = true;
  c.deletedReason = String(reason || '');
  write(s);
}

/* ── Web Push подписки (noop в локальном режиме) ───────────────────────── */

export async function savePushSubscription() {}
export async function removePushSubscription() {}

/* ── Лайки на профили ─────────────────────────────────────────────────── */

export async function toggleProfileLike(userId) {
  const s = read();
  const me = meOrThrow(s);
  if (me.id === userId) throw new Error('Нельзя лайкнуть самого себя');
  if (!s.profileLikes) s.profileLikes = [];
  const idx = s.profileLikes.findIndex((l) => l.from === me.id && l.to === userId);
  if (idx >= 0) {
    s.profileLikes.splice(idx, 1);
    write(s);
    return { liked: false };
  }
  s.profileLikes.push({ from: me.id, to: userId, createdAt: new Date().toISOString() });
  write(s);
  return { liked: true };
}

/* ── Турниры ────────────────────────────────────────────────────────────── */

export async function listTournaments() {
  const s = read();
  return (s.tournaments || []).map((t) => ({ ...t, createdAt: new Date(t.createdAt) }));
}

export async function createTournament(allyA, allyB, title = '') {
  const s = read();
  if (allyA === allyB) throw new Error('Нужны два разных альянса');
  const t = {
    id: newId('tr'),
    title: String(title),
    allyA,
    allyB,
    winsA: 0,
    winsB: 0,
    draws: 0,
    status: 'active',
    winner: null,
    createdAt: new Date().toISOString(),
  };
  if (!s.tournaments) s.tournaments = [];
  s.tournaments.push(t);
  write(s);
  return { ...t, createdAt: new Date(t.createdAt) };
}

export async function addTournamentRound(tournamentId, winnerId = null, notes = '') {
  const s = read();
  const t = (s.tournaments || []).find((x) => x.id === tournamentId);
  if (!t) throw new Error('Турнир не найден');
  if (t.status === 'finished') throw new Error('Турнир завершён');
  if (winnerId === t.allyA) t.winsA += 1;
  else if (winnerId === t.allyB) t.winsB += 1;
  else t.draws += 1;
  // Победа: разрыв больше, чем оставшихся раундов до ничьей 10 (потолок).
  const remaining = Math.max(0, 10 - (t.winsA + t.winsB + t.draws));
  if (t.winsA > t.winsB + remaining) { t.winner = t.allyA; t.status = 'finished'; }
  else if (t.winsB > t.winsA + remaining) { t.winner = t.allyB; t.status = 'finished'; }
  write(s);
}

/* ── Гайды (wiki) в локальном режиме ─────────────────────────────────────── */

/* Те же границы, что у проверки в базе; числа лежат в config.js. */
const NOTE_MIN = CONFIG.forum.limits.guideNoteMin;
const NOTE_MAX = CONFIG.forum.limits.guideNoteMax;

function guideOut(row, signals = []) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category || 'strategy',
    body: row.body,
    authorId: row.authorId,
    authorNick: row.authorNick || '',
    status: row.status || 'published',
    reviewStatus: row.reviewStatus || 'none',
    reviewNote: row.reviewNote || '',
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt) : null,
    signals,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

/*
  Кому какие сигналы видно — ровно как в базе: модератору все открытые,
  остальному только свои. Черновой режим нужен ещё и для того, чтобы это
  можно было пощупать без Supabase, поэтому здесь та же развилка, а не
  «показываем всё».
*/
function guideSignalsFor(s, guideId, me) {
  const open = (s.guideSignals || []).filter((x) => x.guideId === guideId && !x.resolved);
  const staff = isStaff(me);
  return open
    .filter((x) => staff || x.userId === (me && me.id))
    .map((x) => ({ note: x.note, createdAt: new Date(x.createdAt), userId: x.userId }));
}

export async function listGuides() {
  const s = read();
  const me = s.users.find((u) => u.id === s.me) || null;
  return (s.guides || [])
    .filter((g) => g.status === 'published')
    .map((g) => guideOut(g, guideSignalsFor(s, g.id, me)));
}

export async function getGuide(slug) {
  const s = read();
  const me = s.users.find((u) => u.id === s.me) || null;
  const g = (s.guides || []).find((x) => x.slug === slug);
  return g ? guideOut(g, guideSignalsFor(s, g.id, me)) : null;
}

export async function createGuide(draft) {
  const s = read();
  const me = meOrThrow(s);
  if (!me.isLeader && !isStaff(me)) throw new Error('Гайды пишут лидеры альянсов');
  const slug = String(draft.slug || '').toLowerCase().trim();
  if (!/^[a-z0-9а-яё-]{2,80}$/.test(slug)) throw new Error('Slug: только буквы, цифры и дефис');
  if ((s.guides || []).some((g) => g.slug === slug)) throw new Error('Такой slug уже занят');
  const title = String(draft.title).trim();
  if (title.length < 2) throw new Error('Заголовок слишком короткий');
  const now = new Date().toISOString();
  const g = {
    id: newId('g'), slug, title,
    category: String(draft.category || 'strategy'),
    body: String(draft.body),
    authorId: me.id, authorNick: me.nick,
    status: 'published',
    createdAt: now, updatedAt: now,
  };
  if (!s.guides) s.guides = [];
  s.guides.push(g);
  write(s);
  return guideOut(g);
}

export async function updateGuide(id, patch) {
  const s = read();
  const me = meOrThrow(s);
  const g = (s.guides || []).find((x) => x.id === id);
  if (!g) throw new Error('Гайд не найден');
  if (g.authorId !== me.id && !isStaff(me)) throw new Error('Недостаточно прав');
  if (patch.title != null) g.title = String(patch.title).trim();
  if (patch.category != null) g.category = String(patch.category);
  if (patch.body != null) g.body = String(patch.body);
  if (patch.status != null) g.status = String(patch.status);
  g.updatedAt = new Date().toISOString();
  write(s);
  return guideOut(g, guideSignalsFor(s, id, me));
}

export async function deleteGuide(id) {
  const s = read();
  const me = meOrThrow(s);
  const g = (s.guides || []).find((x) => x.id === id);
  if (!g) return;
  if (g.authorId !== me.id && !isStaff(me)) throw new Error('Недостаточно прав');
  s.guides = s.guides.filter((x) => x.id !== id);
  write(s);
}

/*
  ОТМЕТКА МОДЕРАЦИИ И СИГНАЛ ИГРОКА В ЧЕРНОВОМ РЕЖИМЕ.

  Держатся здесь не для красоты списка: это единственный способ увидеть, как
  страница ведёт себя без отметки, с отметкой «устарело» и с сигналом игрока, —
  и проверить, что отказ звучит теми же словами, что в базе
  (supabase/20260925-guide-review.sql). Безопасности защищать нечего, запросов
  мимо сайта в этом режиме не бывает.
*/
export async function reviewGuide(id, status, note = '') {
  const s = read();
  const me = meOrThrow(s);
  if (!isStaff(me)) throw new Error('Отметку «проверен / устарел» ставит модерация');
  if (!['none', 'verified', 'outdated'].includes(status)) {
    throw new Error(`Неизвестный статус проверки: ${status}`);
  }
  const g = (s.guides || []).find((x) => x.id === id);
  if (!g) throw new Error('Гайд не найден');

  g.reviewStatus = status;
  g.reviewNote = String(note).trim().slice(0, NOTE_MAX);
  g.reviewedAt = status === 'none' ? null : new Date().toISOString();
  g.reviewedBy = status === 'none' ? null : me.id;

  // Решение модератора закрывает сигналы: разобранный вопрос не должен
  // висеть в очереди вечно.
  (s.guideSignals || []).forEach((x) => { if (x.guideId === id && !x.resolved) x.resolved = true; });
  write(s);
}

export async function reportGuideStale(id, note) {
  const s = read();
  const me = requireWriter(s);
  const text = String(note ?? '').trim();
  if (text.length < NOTE_MIN) {
    throw new Error('Нужно хотя бы пять символов: что именно перестало работать');
  }
  if (!(s.guides || []).some((x) => x.id === id)) throw new Error('Гайд не найден');

  if (!s.guideSignals) s.guideSignals = [];
  const row = s.guideSignals.find((x) => x.guideId === id && x.userId === me.id);
  if (row) {
    // Повтор уточняет прошлый сигнал и открывает вопрос заново.
    row.note = text.slice(0, NOTE_MAX);
    row.createdAt = new Date().toISOString();
    row.resolved = false;
  } else {
    s.guideSignals.push({
      guideId: id, userId: me.id, note: text.slice(0, NOTE_MAX),
      createdAt: new Date().toISOString(), resolved: false,
    });
  }
  write(s);
}

/* ── Заявки на гайды в локальном режиме ───────────────────────────────────── */

const REQ_TITLE_MIN = CONFIG.forum.limits.guideRequestTitleMin;
const REQ_TITLE_MAX = CONFIG.forum.limits.guideRequestTitleMax;
const REQ_DETAILS_MAX = CONFIG.forum.limits.guideRequestDetailsMax;
const REQ_DAILY_MAX = CONFIG.forum.limits.guideRequestDailyMax;

/*
  Нормализация названия — то же выражение, что в индексе и в функции базы
  (supabase/20260926-guide-requests.sql): обрезка, нижний регистр, схлопнутые
  пробелы. Расхождение означало бы, что черновой режим видит дубликаты, которых
  база не заметила бы, и наоборот.
*/
const normalizeRequestTitle = (t) => String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const requestOutcomeWord = (status) => (status === 'linked' ? 'связана с гайдом'
  : status === 'closed' ? 'закрыта' : 'отозвана');

function guideRequestOut(r) {
  return {
    id: r.id,
    userId: r.userId,
    userNick: r.userNick || '',
    title: r.title,
    details: r.details || '',
    status: r.status,
    guideId: r.guideId || null,
    answer: r.answer || '',
    createdAt: toDate(r.createdAt) ?? new Date(),
    decidedAt: toDate(r.decidedAt),
    decidedByNick: r.decidedByNick || null,
  };
}

/*
  Видимость повторяет политику forum_guide_requests: открытая заявка публична
  (это вопрос «чего не хватает», и он полезен тому, кто мог бы написать гайд),
  разбор видят только автор и модерация.
*/
export async function listGuideRequests() {
  const s = read();
  const me = s.users.find((u) => u.id === s.me) || null;
  return (s.guideRequests || [])
    .filter((r) => r.status === 'open' || (me && r.userId === me.id) || isStaff(me))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(guideRequestOut);
}

/*
  Нижняя граница названия — не придирка, а то же правило, что в базе: заявка
  из слова «гайд» неразбираема. Порядок проверок повторяет функцию базы
  (право писать → длина названия → длина описания → частота → повтор), чтобы
  черновой режим не показывал человеку другой отказ, чем получит боевой.
*/
export async function createGuideRequest(draft) {
  const s = read();
  /*
    Первым делом — вход: в базе это первая же проверка функции, и её слово
    («Заявку отправляет только вошедший игрок») черновик обязан давать тот же,
    иначе человек в черновом режиме увидит отказ, которого в бою не бывает.
  */
  if (!s.users.find((u) => u.id === s.me)) {
    throw new Error('Заявку отправляет только вошедший игрок');
  }
  const me = requireWriter(s);
  const title = String(draft?.title ?? '').trim();
  const details = String(draft?.details ?? '').trim();

  if (title.length < REQ_TITLE_MIN) {
    throw new Error(`Название темы короче ${REQ_TITLE_MIN} символов: по трём словам гайд не написать`);
  }
  if (title.length > REQ_TITLE_MAX) {
    throw new Error(`Название темы длиннее ${REQ_TITLE_MAX} символов: его не прочитает ни модератор, ни автор гайда`);
  }
  if (details.length > REQ_DETAILS_MAX) {
    throw new Error(`Описание длиннее ${REQ_DETAILS_MAX} символов: суть влезает и в меньшее`);
  }

  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const recent = (s.guideRequests || [])
    .filter((r) => r.userId === me.id && new Date(r.createdAt).getTime() > dayAgo);
  if (recent.length >= REQ_DAILY_MAX) {
    throw new Error(`Не больше ${REQ_DAILY_MAX} заявок за сутки: их читают люди`);
  }

  if ((s.guideRequests || []).some((r) => r.userId === me.id && r.status === 'open'
    && normalizeRequestTitle(r.title) === normalizeRequestTitle(title))) {
    throw new Error('У вас уже есть открытая заявка с таким названием');
  }

  const row = {
    id: newId('grq'),
    userId: me.id,
    userNick: me.nick,
    title: title.slice(0, REQ_TITLE_MAX),
    details: details.slice(0, REQ_DETAILS_MAX),
    status: 'open',
    guideId: null,
    answer: '',
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    decidedByNick: null,
  };
  if (!s.guideRequests) s.guideRequests = [];
  s.guideRequests.push(row);
  write(s);
  return guideRequestOut(row);
}

/*
  Отзыв — единственное, что автор может сделать после отправки. Разобранную
  заявку отозвать нельзя: под ней уже лежит объяснение модерации, и «отозвал»
  стёр бы его из истории.
*/
export async function cancelGuideRequest(id) {
  const s = read();
  const me = meOrThrow(s);
  const row = (s.guideRequests || []).find((x) => x.id === id);
  if (!row) throw new Error('Заявка не найдена');
  if (row.userId !== me.id) throw new Error('Отозвать можно только свою заявку');
  if (row.status !== 'open') throw new Error('Отозвать можно только открытую заявку');

  row.status = 'cancelled';
  row.decidedAt = new Date().toISOString();
  row.decidedBy = me.id;
  row.decidedByNick = me.nick;
  write(s);
}

export async function resolveGuideRequest(id, status, answer, guideId = null) {
  const s = read();
  /*
    Гость слышит то же слово, что и игрок без прав: в базе проверка одна —
    forum_is_staff(), и она не различает «не вошёл» и «вошёл без прав».
  */
  const me = s.users.find((u) => u.id === s.me) || null;
  if (!isStaff(me)) throw new Error('Заявку разбирает модерация');
  if (!['linked', 'closed'].includes(status)) {
    throw new Error(`Неизвестное решение по заявке: ${status}`);
  }

  const row = (s.guideRequests || []).find((x) => x.id === id);
  if (!row) throw new Error('Заявка не найдена');

  const text = String(answer ?? '').trim();
  if (text.length < NOTE_MIN) {
    throw new Error(`Нужно хотя бы ${NOTE_MIN} символов: игрок ждёт объяснения, а не молчаливого отказа`);
  }
  if (text.length > NOTE_MAX) {
    throw new Error(`Не больше ${NOTE_MAX} символов: объяснение должно читаться и с телефона`);
  }

  if (status === 'linked') {
    if (!guideId) throw new Error('Нужно указать гайд, которым закрывается заявка');
    if (!(s.guides || []).some((g) => g.id === guideId && g.status === 'published')) {
      throw new Error('Связать заявку можно только с опубликованным гайдом');
    }
  }

  if (row.status !== 'open') {
    throw new Error(`Эта заявка уже разобрана: ${requestOutcomeWord(row.status)}`);
  }

  row.status = status;
  row.answer = text.slice(0, NOTE_MAX);
  row.guideId = status === 'linked' ? guideId : null;
  row.decidedAt = new Date().toISOString();
  row.decidedBy = me.id;
  row.decidedByNick = me.nick;

  /*
    Исход приходит уведомлением, а не лежит в очереди панели: игрок в панель
    не заходит вообще. Вид 'moderation' тот же, что у ответа на апелляцию, —
    новых слов в проверку вида не заводим и здесь.
  */
  pushNotification(s, {
    userId: row.userId,
    actorId: me.id,
    actorNick: me.nick,
    kind: 'moderation',
    preview: `Заявка «${row.title}» ${requestOutcomeWord(status)}: ${text}`,
  });
  write(s);
}

/* ── Push-настройки (посты форума) в локальном режиме ─────────────────────── */

export async function getPushPrefs() {
  const s = read();
  const p = s.pushPrefs || {};
  return { newForumPost: Boolean(p.newForumPost), newForumReply: Boolean(p.newForumReply) };
}

export async function setPushPrefs(prefs) {
  const s = read();
  s.pushPrefs = { ...(s.pushPrefs || {}) };
  if (prefs.newForumPost != null) s.pushPrefs.newForumPost = Boolean(prefs.newForumPost);
  if (prefs.newForumReply != null) s.pushPrefs.newForumReply = Boolean(prefs.newForumReply);
  write(s);
}

/* ── Активность сервера: посты и сообщения по дням, из локальных данных ──── */

export async function getServerActivity() {
  const s = read();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const at = new Date();
    at.setHours(0, 0, 0, 0);
    at.setDate(at.getDate() - (6 - i));
    const day = at.toISOString();
    const key = (d) => toDate(d) && new Date(d).toISOString().slice(0, 10);
    const stamp = (iso) => iso?.slice(0, 10);
    days.push({
      day: at,
      forumPosts: s.posts.filter((p) => !p.deleted && stamp(key(p.createdAt)) === day.slice(0, 10)).length,
      forumComments: s.comments.filter((c) => !c.deleted && stamp(key(c.createdAt)) === day.slice(0, 10)).length,
      chatMessages: s.chatMessages.filter((m) => !m.deleted && stamp(key(m.createdAt)) === day.slice(0, 10)).length,
    });
  }
  return days;
}

/* ── Личная статистика: GitHub-график на странице участника ───────────────── */

/**
 * Активность по дням конкретного участника за последние 20 недель. Число чатов
 * отдаём только себе, чужим — null, как в рабочем адаптере: локальный режим
 * весь в одном браузере, но приватность должна вести себя одинаково в обоих.
 */
export async function getUserActivity(userId) {
  const s = read();
  const hours = new Date().getHours();
  const days = [];
  for (let i = 0; i < 140; i++) {
    const at = new Date();
    at.setHours(hours, 0, 0, 0);
    const shift = (140 - 1 - i) * 86400000;
    at = new Date(at.getTime() - shift);
    const target = at.toDateString();
    days.push({
      day: at,
      forumPosts: s.posts.filter((p) => !p.deleted && p.authorId === userId && new Date(p.createdAt).toDateString() === target).length,
      forumComments: s.comments.filter((c) => !c.deleted && c.authorId === userId && new Date(c.createdAt).toDateString() === target).length,
      chatMessages: s.chatMessages.filter((m) => !m.deleted && m.authorId === userId && new Date(m.createdAt).toDateString() === target).length,
    });
  }
  const chatsJoined = userId === s.me ? s.chatMembers.filter((cm) => cm.userId === userId).length : null;
  return { days, chatsJoined };
}
