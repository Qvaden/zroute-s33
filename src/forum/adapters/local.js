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
import { CATEGORY_IDS, REACTION_IDS, reactionMeta, isChatReaction } from '../rules.js';
import {
  CHAT_LIMITS, checkFile, nameOf, readAsDataUrl, dataUrlToBlob, audioDuration, formatBytes, formatLimit,
} from '../media.js';

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
    chats: [],
    chatMembers: [],
    chatMessages: [],
    /*
      Вложения локального режима лежат здесь же, как data-URL: хранилища,
      куда положить файл, у одного браузера нет. Предел веса поэтому ниже
      общего (CONFIG.forum.chat.localMaxBytes) — у localStorage это 5 МБ
      на весь домен, и честнее отказать с объяснением, чем не сохранить молча.
    */
    chatAttachments: [],
    chatReactions: [],
    chatTyping: [],
  };
}

function read() {
  const raw = safe(() => localStorage.getItem(KEY), null);
  if (!raw) return emptyState();
  const parsed = safe(() => JSON.parse(raw), null);
  return parsed && typeof parsed === 'object' ? { ...emptyState(), ...parsed } : emptyState();
}

/**
 * Запись состояния. Возвращает признак успеха, и это важно именно для чатов:
 * браузер отказывает в записи, когда место кончилось (вложение не влезло),
 * а молчаливое «сохранили» показывало бы отправленное сообщение, которого
 * после перезагрузки нет.
 */
function write(state) {
  return safe(() => {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  }, false);
}

/** Отказ записи: чаще всего это переполненное хранилище браузера. */
function writeOrThrow(state) {
  if (!write(state)) {
    throw new Error(
      'Браузер не сохранил данные: в локальном режиме место кончилось ' +
        `(вложения тут живут в самом браузере, до ${formatBytes(CHAT_LIMITS.localMaxBytes)}). ` +
        'Уберите вложение или подключите базу — см. docs/FORUM.md.'
    );
  }
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
    isLeader: Boolean(u.isLeader),
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

  return {
    ...userOut(u),
    postCount: mine.length,
    commentCount: myComments.length,
    likesReceived: likes,
    blogViews: blog.reduce((sum, p) => sum + Number(p.views || 0), 0),
    blogPostCount: blog.length,
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

/* ── Закрытые чаты (локально, в одном браузере) ───────────────────────────── */

function meOrThrow(s) {
  const me = s.users.find((u) => u.id === s.me);
  if (!me) throw new Error('Сначала войдите');
  return me;
}
const isStaff = (u) => u && (u.role === 'admin' || u.role === 'moderator');
const memberOf = (s, chatId, userId) => s.chatMembers.find((m) => m.chatId === chatId && m.userId === userId);
const canManage = (s, chatId, me) => isStaff(me) || ['owner', 'admin'].includes(memberOf(s, chatId, me.id)?.role);

/** Вложения одного сообщения — в порядке добавления. */
const attachmentsOf = (s, messageId) => s.chatAttachments.filter((a) => a.messageId === messageId);

/**
 * Реакции сообщения в том же виде, что отдаёт представление базы:
 * эмодзи, сколько человек поставило, поставил ли я и кто именно.
 */
function reactionsOf(s, messageId, meId) {
  const list = s.chatReactions.filter((r) => r.messageId === messageId);
  const byEmoji = new Map();
  for (const r of list) {
    const item = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, nicks: [] };
    item.count += 1;
    if (r.userId === meId) item.mine = true;
    const u = s.users.find((x) => x.id === r.userId);
    if (u) item.nicks.push(u.nick);
    byEmoji.set(r.emoji, item);
  }
  // Порядок как в подсказке быстрых реакций, а не как придётся.
  return [...byEmoji.values()].sort(
    (a, b) => CHAT_REACTIONS.indexOf(a.emoji) - CHAT_REACTIONS.indexOf(b.emoji)
  );
}

/**
 * Сообщение в том же виде, что отдают представления базы.
 *
 * Живёт одной функцией на все выходы (лента, поиск, закреплённые): иначе
 * в поиске ответ на сообщение показывался бы без цитаты, а в закреплённых
 * пропадали бы вложения — и это были бы три разных поведения одного экрана.
 *
 * Экспортируется ради теста паритета (tests/contract.test.js): два адаптера
 * обязаны отдавать ОДИН набор полей, иначе переключение источника данных
 * однажды покажет в чате пустые вложения. Проверяется без базы именно здесь.
 */
export function chatMessageView(s, x, meId) {
  const u = s.users.find((y) => y.id === x.authorId);
  const reply = x.replyToId ? s.chatMessages.find((m) => m.id === x.replyToId) : null;
  return {
    id: x.id,
    chatId: x.chatId,
    authorId: x.authorId,
    authorNick: x.authorNick,
    authorAvatar: u?.avatarUrl ?? '',
    authorAlliance: u?.allianceTag ?? '',
    authorRole: u?.role ?? 'member',
    authorIsLeader: Boolean(u?.isLeader),
    body: x.body,
    deleted: Boolean(x.deleted),
    deletedReason: x.deletedReason ?? '',
    createdAt: new Date(x.createdAt),
    pinned: Boolean(x.pinned),
    attachments: attachmentsOf(s, x.id).map((a) => ({
      id: a.id,
      kind: a.kind,
      url: a.url,
      name: a.name,
      mime: a.mime,
      sizeBytes: a.sizeBytes,
      width: a.width,
      height: a.height,
      durationMs: a.durationMs,
    })),
    reactions: reactionsOf(s, x.id, meId),
    replyToId: reply?.id ?? null,
    replyNick: reply?.authorNick ?? '',
    replyBody: reply?.body ?? '',
    replyDeleted: Boolean(reply?.deleted),
  };
}

function chatView(s, c, meId) {
  const members = s.chatMembers.filter((m) => m.chatId === c.id);
  const mine = members.find((m) => m.userId === meId);
  const msgs = s.chatMessages.filter((x) => x.chatId === c.id && !x.deleted);
  const last = msgs[msgs.length - 1];
  const lastFile = last ? attachmentsOf(s, last.id)[0] : null;
  const since = mine ? new Date(mine.lastReadAt).getTime() : 0;
  return {
    ...c,
    createdAt: new Date(c.createdAt),
    topic: c.topic ?? '',
    avatarUrl: c.avatarUrl ?? '',
    memberCount: members.length,
    myRole: mine?.role ?? null,
    unread: msgs.filter((x) => new Date(x.createdAt).getTime() > since && x.authorId !== meId).length,
    lastBody: last?.body ?? '',
    lastNick: last?.authorNick ?? '',
    lastKind: lastFile?.kind ?? '',
    lastAt: last ? new Date(last.createdAt) : null,
    pinnedCount: s.chatMessages.filter((x) => x.chatId === c.id && x.pinned && !x.deleted).length,
  };
}

export async function setLeader(userId, isLeader) {
  const s = read();
  if (!isStaff(meOrThrow(s))) throw new Error('Недостаточно прав');
  const user = s.users.find((u) => u.id === userId);
  if (!user) throw new Error('Игрок не найден');
  user.isLeader = Boolean(isLeader);
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
  const clean = String(title).trim().slice(0, 60);
  if (clean.length < 2) throw new Error('Название чата короче двух символов');
  const c = {
    id: newId('c'), title: clean, kind, allianceTag: String(allianceTag).trim().slice(0, 12),
    topic: '', avatarUrl: '',
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
  return list.slice(-limit).map((x) => chatMessageView(s, x, s.me));
}

/**
 * Отправка сообщения: текст, ответ на другое сообщение и уже загруженные
 * вложения. Вложения приходят готовыми (uploadChatFile) — тем же порядком,
 * что и в базе, где файл сначала ложится в хранилище.
 */
export async function sendChatMessage(chatId, body, { replyToId = null, attachments = [] } = {}) {
  const s = read();
  const me = meOrThrow(s);
  if (me.banned) throw new Error('Вам запрещено писать');
  if (!memberOf(s, chatId, me.id) && !isStaff(me)) throw new Error('Вы не участник этого чата');
  const c = s.chats.find((x) => x.id === chatId);
  if (!c || c.closed) throw new Error('Чат закрыт');

  const files = Array.isArray(attachments) ? attachments.filter((a) => a?.url) : [];
  if (files.length > CHAT_LIMITS.attachmentsMax) {
    throw new Error(`К сообщению можно приложить не больше ${CHAT_LIMITS.attachmentsMax} файлов`);
  }
  const text = String(body).slice(0, CHAT_LIMITS.messageMax);
  if (!text.trim() && !files.length) throw new Error('Пустое сообщение');

  const reply = replyToId ? s.chatMessages.find((x) => x.id === replyToId && x.chatId === chatId) : null;
  const createdAt = new Date().toISOString();
  const m = {
    id: newId('m'), chatId, authorId: me.id, authorNick: me.nick, body: text,
    replyToId: reply?.id ?? null, pinned: false, pinnedAt: null,
    deleted: false, deletedReason: '', createdAt,
  };
  s.chatMessages.push(m);
  for (const a of files) {
    s.chatAttachments.push({
      id: newId('a'), messageId: m.id, chatId, uploaderId: me.id,
      kind: a.kind ?? 'file', url: a.url, storagePath: a.storagePath ?? '',
      name: a.name ?? 'файл', mime: a.mime ?? '', sizeBytes: a.sizeBytes ?? 0,
      width: a.width ?? 0, height: a.height ?? 0, durationMs: a.durationMs ?? 0,
      createdAt,
    });
  }
  writeOrThrow(s);
  return chatMessageView(s, m, me.id);
}

export async function deleteChatMessage(id, reason = '') {
  const s = read();
  const me = meOrThrow(s);
  const m = s.chatMessages.find((x) => x.id === id);
  if (!m) return;
  if (m.authorId !== me.id && !canManage(s, m.chatId, me)) throw new Error('Недостаточно прав');
  m.deleted = true;
  m.deletedReason = String(reason || '');
  m.pinned = false;
  /*
    Файлы удалённого сообщения убираем вместе с ним: удаление здесь значит
    «этого не было», и оставлять вложение в браузере — держать место занятым
    ради того, чего никто не увидит.
  */
  s.chatAttachments = s.chatAttachments.filter((a) => a.messageId !== id);
  write(s);
}

/* ── Вложения, реакции, закрепления, «пишет…» ──────────────────────────────── */

/**
 * Загрузка файла. В локальном режиме «хранилище» — сам браузер, поэтому файл
 * превращается в data-URL, а предел веса берётся из CHAT_LIMITS.localMaxBytes.
 * Ограничение честное: иначе первое же видео на 20 МБ упало бы с отказом
 * localStorage, и человек не понял бы, что произошло.
 */
export async function uploadChatFile(chatId, file, { onProgress = null } = {}) {
  const s = read();
  const me = meOrThrow(s);
  if (!memberOf(s, chatId, me.id) && !isStaff(me)) throw new Error('Вы не участник этого чата');

  /*
    Вид и запрещённые типы проверяет общая функция — та же, что и в браузере
    перед отправкой. Локальный режим добавляет к ней только свой потолок:
    «хранилище» здесь — localStorage, и 25-мегабайтное видео в него не влезет.
  */
  const check = checkFile(file);
  if (!check.ok) throw new Error(check.error);
  const kind = check.kind;
  const max = Math.min(CHAT_LIMITS.maxBytes[kind] ?? CHAT_LIMITS.maxBytes.file, CHAT_LIMITS.localMaxBytes);
  if (file.size > max) {
    throw new Error(
      `${nameOf(file)} весит ${formatBytes(file.size)}. В локальном режиме предел — ${formatLimit(max)} ` +
        '(файлы хранит сам браузер). Подключите базу — см. docs/FORUM.md.'
    );
  }

  onProgress?.(0.1);
  const url = await readAsDataUrl(file);
  onProgress?.(1);

  const durationMs = kind === 'audio' ? await audioDuration(file) : 0;
  return {
    kind, url, storagePath: '', name: nameOf(file), mime: file.type || '',
    sizeBytes: file.size || 0, width: 0, height: 0, durationMs,
  };
}

/** Картинка чата: в локальном режиме просто ссылка на сжатый файл. */
export async function uploadChatAvatar(chatId, file) {
  const s = read();
  const me = meOrThrow(s);
  if (!canManage(s, chatId, me)) throw new Error('Недостаточно прав');
  const { prepareImage } = await import('../../ui/image-prep.js');
  const blob = await prepareImage(file, 'avatar');
  const url = await readAsDataUrl(blob);
  const c = s.chats.find((x) => x.id === chatId);
  if (c) { c.avatarUrl = url; write(s); }
  return url;
}

export async function toggleChatReaction(messageId, emoji) {
  const s = read();
  const me = meOrThrow(s);
  if (!isChatReaction(emoji)) throw new Error('Такой реакции нет');
  const m = s.chatMessages.find((x) => x.id === messageId);
  if (!m) throw new Error('Сообщение не найдено');
  if (!memberOf(s, m.chatId, me.id) && !isStaff(me)) throw new Error('Вы не участник этого чата');

  const at = s.chatReactions.findIndex(
    (r) => r.messageId === messageId && r.userId === me.id && r.emoji === emoji
  );
  if (at >= 0) s.chatReactions.splice(at, 1);
  else s.chatReactions.push({ messageId, userId: me.id, emoji, createdAt: new Date().toISOString() });
  write(s);
}

export async function pinChatMessage(messageId, pinned) {
  const s = read();
  const me = meOrThrow(s);
  const m = s.chatMessages.find((x) => x.id === messageId);
  if (!m) throw new Error('Сообщение не найдено');
  if (!canManage(s, m.chatId, me)) throw new Error('Закреплять сообщения может владелец чата или его помощник');
  if (pinned && s.chatMessages.filter((x) => x.chatId === m.chatId && x.pinned && !x.deleted).length >= CHAT_LIMITS.pinsMax) {
    throw new Error(`В чате уже ${CHAT_LIMITS.pinsMax} закреплённых — открепите что-нибудь`);
  }
  m.pinned = Boolean(pinned);
  m.pinnedAt = pinned ? new Date().toISOString() : null;
  write(s);
}

export async function listChatPinned(chatId) {
  const s = read();
  return s.chatMessages
    .filter((x) => x.chatId === chatId && x.pinned && !x.deleted)
    .slice(-CHAT_LIMITS.pinsMax)
    .reverse()
    .map((x) => chatMessageView(s, x, s.me));
}

/** Поиск по переписке: по тексту и по имени файла. */
export async function searchChatMessages(chatId, query, { limit = CHAT_LIMITS.searchLimit } = {}) {
  const s = read();
  const q = String(query ?? '').trim().toLowerCase();
  if (q.length < 2) return [];
  return s.chatMessages
    .filter((x) => x.chatId === chatId && !x.deleted)
    .filter((x) => {
      if (String(x.body).toLowerCase().includes(q)) return true;
      return attachmentsOf(s, x.id).some((a) => String(a.name).toLowerCase().includes(q));
    })
    .slice(-limit)
    .reverse()
    .map((x) => chatMessageView(s, x, s.me));
}

/**
 * Отметка «пишу». Хранится вместе с остальным состоянием, но живёт секунды:
 * список для показа отсекается по времени здесь же, как это делает
 * представление базы. Так «пишет…» не остаётся навсегда, если человек
 * закрыл вкладку.
 */
export async function touchChatTyping(chatId) {
  const s = read();
  if (!s.me) return;
  const at = new Date();
  const row = s.chatTyping.find((x) => x.chatId === chatId && x.userId === s.me);
  if (row) row.at = at.toISOString();
  else s.chatTyping.push({ chatId, userId: s.me, at: at.toISOString() });
  const fresh = new Date(at.getTime() - 60000).toISOString();
  s.chatTyping = s.chatTyping.filter((x) => x.at >= fresh);
  write(s);
}

export async function listChatTyping(chatId) {
  const s = read();
  const since = new Date(Date.now() - CHAT_LIMITS.typingMs).getTime();
  return s.chatTyping
    .filter((x) => x.chatId === chatId && new Date(x.at).getTime() >= since && x.userId !== s.me)
    .map((x) => ({ userId: x.userId, nick: s.users.find((u) => u.id === x.userId)?.nick ?? '' }))
    .filter((x) => x.nick);
}

export async function markChatRead(chatId) {
  const s = read();
  const m = s.me ? memberOf(s, chatId, s.me) : null;
  if (m) { m.lastReadAt = new Date().toISOString(); write(s); }
}

export async function updateChat(chatId, patch) {
  const s = read();
  const me = meOrThrow(s);
  if (!canManage(s, chatId, me)) throw new Error('Недостаточно прав');
  const c = s.chats.find((x) => x.id === chatId);
  if (!c) throw new Error('Чат не найден');
  if (patch.title != null) c.title = String(patch.title).trim().slice(0, 60);
  if (patch.allianceTag != null) c.allianceTag = String(patch.allianceTag).trim().slice(0, 12);
  if (patch.topic != null) c.topic = String(patch.topic).trim().slice(0, CHAT_LIMITS.topicMax);
  if (patch.avatarUrl != null) c.avatarUrl = String(patch.avatarUrl);
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
  const gone = new Set(s.chatMessages.filter((m) => m.chatId === chatId).map((m) => m.id));
  s.chats = s.chats.filter((c) => c.id !== chatId);
  s.chatMembers = s.chatMembers.filter((m) => m.chatId !== chatId);
  s.chatMessages = s.chatMessages.filter((m) => m.chatId !== chatId);
  // Вложения, реакции и отметки «пишу» уходят вместе с чатом: в базе это
  // делает каскад, здесь — эти четыре строки. Оставленные, они копились бы
  // в localStorage навсегда и однажды упёрлись бы в его предел.
  s.chatAttachments = s.chatAttachments.filter((a) => a.chatId !== chatId && !gone.has(a.messageId));
  s.chatReactions = s.chatReactions.filter((r) => !gone.has(r.messageId));
  s.chatTyping = s.chatTyping.filter((x) => x.chatId !== chatId);
  write(s);
}
