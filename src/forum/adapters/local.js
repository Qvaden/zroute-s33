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

const EMPTY = { users: [], me: null, posts: [], comments: [], reactions: [], reports: [] };

function read() {
  const raw = safe(() => localStorage.getItem(KEY), null);
  if (!raw) return { ...EMPTY };
  const parsed = safe(() => JSON.parse(raw), null);
  return parsed && typeof parsed === 'object' ? { ...EMPTY, ...parsed } : { ...EMPTY };
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
      Первый зарегистрировавшийся в локальном режиме становится администратором
      (иначе модерацию нельзя было бы даже посмотреть) — он же и владелец.
      В рабочем режиме признак считает база как «первый администратор
      по дате регистрации».
    */
    isOwner: u.role === 'admin' && read().users[0]?.id === u.id,
    /*
      Поля профиля есть и здесь — для паритета с рабочим адаптером. Аватарку
      в локальном режиме загрузить некуда (хранилища нет), но страница профиля
      обязана открываться и рисоваться: иначе её нельзя ни проверить, ни
      показать, не подключив базу.
    */
    avatarUrl: u.avatarUrl || '',
    about: u.about || '',
    allianceTag: u.allianceTag || '',
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
    authorIsOwner: Boolean(author?.isOwner),
    category: p.category,
    title: p.title,
    body: p.body,
    createdAt: toDate(p.createdAt) ?? new Date(),
    editedAt: toDate(p.editedAt) ?? undefined,
    pinned: Boolean(p.pinned),
    deleted: Boolean(p.deleted),
    deletedReason: p.deletedReason || '',
    commentCount: state.comments.filter((c) => c.postId === p.id && !c.deleted).length,
    // Вложений в локальном режиме нет: файлы некуда класть, хранилища нет.
    attachments: [],
    ...r,
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
  const { category = 'all', sort = 'fresh', limit = CONFIG.forum.pageSize, offset = 0 } = opts;

  let list = s.posts.map((p) => postOut(s, p));
  if (category !== 'all') list = list.filter((p) => p.category === category);

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
  };
  s.posts.push(post);
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
    authorIsOwner: Boolean(author?.isOwner),
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
  write(s);
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

  s.reports.push({
    id: newId('r'),
    targetType,
    targetId,
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
