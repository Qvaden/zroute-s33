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
import { CATEGORY_IDS, REACTION_IDS, reactionMeta } from '../rules.js';

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
    reports: [],
    polls: [],
    pollVotes: [],
    notifications: [],
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
    canEditSite: Boolean(u.canEditSite) || u.role === 'admin',
    createdAt: toDate(u.createdAt) ?? new Date(),
    mutedUntil: toDate(u.mutedUntil),
    banned: Boolean(u.banned),
    banReason: u.banReason || '',
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
  const key = String(nick).trim().toLowerCase();

  if (s.users.some((u) => u.nick.toLowerCase() === key)) {
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
  const key = String(nick).trim().toLowerCase();
  const user = s.users.find((u) => u.nick.toLowerCase() === key);
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
    category: p.category,
    title: p.title,
    body: p.body,
    createdAt: toDate(p.createdAt) ?? new Date(),
    editedAt: toDate(p.editedAt) ?? undefined,
    pinned: Boolean(p.pinned),
    deleted: Boolean(p.deleted),
    deletedReason: p.deletedReason || '',
    views: Number(p.views || 0),
    commentCount: state.comments.filter((c) => c.postId === p.id && !c.deleted).length,
    // Вложений в локальном режиме нет: файлы некуда класть, хранилища нет.
    attachments: [],
    ...r,
    poll: pollOut(state, p.id),
  };
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
 * Удалённые посты из ленты НЕ выкидываются: на их месте остаётся заглушка
 * с причиной. Молча исчезнувший пост читается как поломка сайта и порождает
 * второй такой же — см. рассуждение в contract.js.
 *
 * @param {{category?: string, sort?: string, limit?: number, offset?: number}} [opts]
 */
export async function listPosts(opts = {}) {
  const s = read();
  const { category = 'all', sort = 'fresh', limit = CONFIG.forum.pageSize, offset = 0, q = '' } = opts;

  let list = s.posts.map((p) => postOut(s, p));
  if (category !== 'all') list = list.filter((p) => p.category === category);
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

export async function createPost(draft) {
  const s = read();
  const me = requireWriter(s);
  if (!CATEGORY_IDS.includes(draft.category)) throw new Error('Неизвестный раздел');

  const post = {
    id: newId('p'),
    authorId: me.id,
    authorNick: me.nick,
    category: draft.category,
    title: draft.title,
    body: draft.body,
    createdAt: new Date().toISOString(),
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
    body: c.body,
    createdAt: toDate(c.createdAt) ?? new Date(),
    deleted: Boolean(c.deleted),
    deletedReason: c.deletedReason || '',
    attachments: [],
    ...r,
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
    reporterId: me.id,
    reporterNick: me.nick,
    ruleId,
    note,
    createdAt: new Date().toISOString(),
    resolved: false,
  });
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
  if (rep) rep.resolved = true;
  write(s);
}

export async function listUsers() {
  const s = read();
  return s.users.map(userOut).sort((a, b) => a.nick.localeCompare(b.nick, 'ru'));
}

/**
 * Сброс пароля. В локальном режиме паролей нет вовсе, поэтому честно
 * отказываемся вместо того, чтобы изобразить успех: администратор должен
 * видеть, что здесь этой возможности нет, а не думать, что он сбросил пароль.
 */
export async function resetPassword() {
  throw new Error('В локальном режиме паролей нет — сбрасывать нечего');
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
