/**
 * ЗАКРЫТЫЕ ЧАТЫ — ПОВЕДЕНИЕ.
 *
 * ГЛАВНОЕ ОТЛИЧИЕ ОТ ПРОШЛОЙ ВЕРСИИ — ИНКРЕМЕНТАЛЬНАЯ ПЕРЕРИСОВКА.
 *
 * Фоновый опрос (tick) и обновление списка чатов больше НЕ заменяют
 * host.innerHTML целиком. Обновляется только лента сообщений или список
 * чатов. Композер (textarea) при этом физически не пересоздаётся:
 * фокус остаётся, клавиатура на телефоне не закрывается, курсор не
 * прыгает. Полная перерисовка — только при смене чата или экрана.
 *
 * ЧЕРНОВИКИ ПО ЧАТАМ. Начал писать в одном чате, перешёл в другой —
 * текст сохранён и вернётся при переключении назад.
 */
import { forum } from './index.js';
import { esc } from '../ui/helpers.js';
import { renderChats, renderScrollArea, renderChatList, renderMessage } from '../pages/chats.js';
import { prepareImage } from '../ui/image-prep.js';
import { uploadFile, currentUserId } from '../db/client.js';

const POLL_MS = 4000;
const POLL_MS_LIST = 15000;
const MAX_FILES = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const state = {
  ready: false,
  loading: true,
  error: '',
  me: null,
  chats: [],
  openId: null,
  open: null,
  messages: [],
  members: [],
  membersOpen: false,
  inviteOpen: false,
  menuOpen: false,
  createOpen: false,
  pollOpen: false,
  hasMore: false,
  newMessages: 0,
  sending: false,
  pendingFiles: [],
  replyingTo: null,
  pollDraft: null,
  lightbox: null,
  searchOpen: false,
  searchQuery: '',
  leaderboardOpen: false,
  leaderboard: null,
  dmOpen: false,
};

let host = null;
let wired = false;
let token = 0;
let timer = 0;
let listTimer = 0;
let headWatch = null;
let vvWatch = null;

/** Черновики по чатам: id -> набранный текст. */
const chatDrafts = new Map();
/** Какой чат сейчас отрисован в DOM — чтобы не пересоздавать его без нужды. */
let renderedChatId;

/* ── Полноэкранный режим ────────────────────────────────────────────────── */

function fitFullscreen() {
  if (!host) return;
  const head = document.querySelector('.site-head');
  const vv = window.visualViewport;
  /*
    Телефонная клавиатура сжимает visualViewport, но не всегда пересчитывает
    100dvh: ввод оказывался под клавиатурой. Берём реальную видимую высоту —
    на десктопе она совпадает с окном, на телефоне корректно уменьшается.
  */
  const visible = Math.round(vv ? vv.height : window.innerHeight);
  host.style.setProperty('--chat-head-h', `${head ? head.offsetHeight : 0}px`);
  host.style.setProperty('--chat-vh', `${visible}px`);
}

/** Base64url → Uint8Array (для VAPID-ключа). */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
  return arr;
}

function watchHead() {
  headWatch?.disconnect();
  fitFullscreen();
  const head = document.querySelector('.site-head');
  if (head && typeof ResizeObserver !== 'undefined') {
    headWatch = new ResizeObserver(fitFullscreen);
    headWatch.observe(head);
  }
  if (vvWatch) { vvWatch(); vvWatch = null; }
  const vv = window.visualViewport;
  if (vv) {
    const onResize = () => fitFullscreen();
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    window.addEventListener('resize', onResize);
    vvWatch = () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
      window.removeEventListener('resize', onResize);
    };
  }
}

/* ── Отрисовка ──────────────────────────────────────────────────────────── */

function paint({ stick = false } = {}) {
  if (!host) return;
  const needsFull = renderedChatId !== state.openId
    || !host.querySelector('.chat-layout')
    || state.menuOpen || state.membersOpen || state.inviteOpen
    || state.pollOpen || state.createOpen;
  if (needsFull) paintFull({ stick });
  else { paintMessages({ stick }); paintList(); }
}

/**
 * Полная перерисовка. Сохраняет и восстанавливает: черновик по чату,
 * фокус и позицию курсора, позицию скролла ленты.
 */
function paintFull({ stick = false } = {}) {
  if (!host) return;

  const input = host.querySelector('[data-chat-input]');
  const wasFocused = input && document.activeElement === input;
  const selStart = input?.selectionStart ?? null;
  const selEnd = input?.selectionEnd ?? null;
  if (input && state.openId) chatDrafts.set(state.openId, input.innerHTML);

  const scroll = host.querySelector('[data-chat-scroll]');
  const atBottom = scroll ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80 : true;
  const prevHeight = scroll?.scrollHeight ?? 0;
  const prevTop = scroll?.scrollTop ?? 0;

  host.innerHTML = renderChats(state);
  renderedChatId = state.openId;

  const nextInput = host.querySelector('[data-chat-input]');
  if (nextInput) {
    nextInput.innerHTML = state.openId ? (chatDrafts.get(state.openId) || '') : '';
    autosize(nextInput);
    if (wasFocused) {
      nextInput.focus({ preventScroll: true });
      // contenteditable: ставим курсор в конец.
      try {
        const range = document.createRange();
        range.selectNodeContents(nextInput);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch { /* не все браузеры */ }
    }
  }

  const nextScroll = host.querySelector('[data-chat-scroll]');
  if (nextScroll) {
    if (stick || atBottom) nextScroll.scrollTop = nextScroll.scrollHeight;
    else nextScroll.scrollTop = prevTop + (nextScroll.scrollHeight - prevHeight);
  }
}

/**
 * ТОЧЕЧНАЯ ПЕРЕРИСОВКА ЛЕНТЫ.
 * Заменяет только содержимое .chat-room__scroll. Композер и поле ввода
 * не трогаются вообще — это и есть фикс сброса клавиатуры.
 */
function paintMessages({ stick = false } = {}) {
  if (!host) return;
  const scroll = host.querySelector('[data-chat-scroll]');
  if (!scroll) { paintFull({ stick }); return; }

  const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
  const prevHeight = scroll.scrollHeight;
  const prevTop = scroll.scrollTop;

  scroll.innerHTML = renderScrollArea(state);

  if (stick || atBottom) {
    scroll.scrollTop = scroll.scrollHeight;
    state.newMessages = 0;
  } else {
    scroll.scrollTop = prevTop + (scroll.scrollHeight - prevHeight);
  }
  paintGoBottom();

  /* Наблюдаем сентинел для бесконечной прокрутки. */
  const sentinel = scroll.querySelector('[data-chat-sentinel]');
  if (sentinel && state._scrollObserver) state._scrollObserver.observe(sentinel);
}

/** Точечная перерисовка списка чатов (счётчики непрочитанного). */
function paintList() {
  if (!host) return;
  const area = host.querySelector('[data-chat-list-area]');
  if (area) area.innerHTML = renderChatList(state);
}

/**
 * Обновить кнопку «вниз» и счётчик новых сообщений.
 *
 * Кнопка живёт как сиблинг .chat-room__scroll и позиционируется
 * абсолютно над лентой — не зависит от перерисовки ленты.
 */
function paintGoBottom() {
  if (!host) return;
  const btn = host.querySelector('[data-chat-go-bottom]');
  if (!btn) return;
  const has = state.newMessages > 0;
  btn.classList.toggle('is-visible', has);
  const count = btn.querySelector('[data-chat-go-count]');
  if (count) count.textContent = state.newMessages > 99 ? '99+' : String(state.newMessages);
}

function autosize(el) {
  if (!el) return;
  // contenteditable не имеет rows, но scrollHeight работает так же.
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

function notice(text) {
  document.querySelector('.forum-toast')?.remove();
  const t = document.createElement('div');
  t.className = 'forum-toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/** Текст без HTML-тегов, обрезанный. */
function plainExcerpt(src, max = 80) {
  const t = String(src).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/* ── Вложения ───────────────────────────────────────────────────────────── */

function addFiles(fileList) {
  const room = MAX_FILES - state.pendingFiles.length;
  const files = [...fileList].slice(0, room);
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      notice(`«${file.name}» больше 25 МБ — не влезет`);
      continue;
    }
    state.pendingFiles.push({
      file,
      name: file.name || 'файл',
      preview: URL.createObjectURL(file),
      isImage: String(file.type || '').startsWith('image/'),
      isVideo: String(file.type || '').startsWith('video/'),
      isAudio: String(file.type || '').startsWith('audio/'),
      size: file.size,
    });
  }
  paintPending();
}

function dropFile(index) {
  const item = state.pendingFiles[index];
  if (!item) return;
  URL.revokeObjectURL(item.preview);
  state.pendingFiles.splice(index, 1);
  paintPending();
}

function clearPendingFiles({ keepUrls = false } = {}) {
  if (!keepUrls) for (const f of state.pendingFiles) URL.revokeObjectURL(f.preview);
  state.pendingFiles = [];
  paintPending();
}

/** Перерисовать полосу выбранных файлов, не трогая textarea. */
function paintPending() {
  if (!host) return;
  const wrap = host.querySelector('.chat-pending-files');
  if (!wrap) return;
  if (!state.pendingFiles.length) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = state.pendingFiles.map((f, i) => `
    <div class="chat-pending-file">
      ${f.isImage ? `<img src="${f.preview}" alt="">` : '<span class="chat-pending-file__icon">📄</span>'}
      <span class="chat-pending-file__name">${esc(f.name)}</span>
      <button type="button" class="chat-pending-file__drop" data-chat-drop-file="${i}" title="Убрать">✕</button>
    </div>
  `).join('');
}

async function uploadChatFiles() {
  if (!state.pendingFiles.length) return [];
  const shared = forum.capabilities?.isShared;

  if (!shared) {
    return state.pendingFiles.map((f) => ({
      name: f.name, url: f.preview, size: f.size,
      isImage: f.isImage, isVideo: f.isVideo, isAudio: f.isAudio,
    }));
  }

  const uid = currentUserId();
  if (!uid) throw new Error('Сначала войдите');

  const results = [];
  for (const f of state.pendingFiles) {
    if (f.isImage) {
      const blob = await prepareImage(f.file, 'photo');
      const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const path = `${uid}/chat/${name}`;
      const url = await uploadFile({ bucket: 'forum-uploads', path, bytes: blob, contentType: 'image/jpeg' });
      results.push({ name: f.name, url, size: blob.size, isImage: true, isVideo: false, isAudio: false });
    } else {
      const ext = (f.name.split('.').pop() || 'bin').toLowerCase();
      const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const path = `${uid}/chat/${name}`;
      const url = await uploadFile({
        bucket: 'forum-uploads', path, bytes: f.file,
        contentType: f.file.type || 'application/octet-stream',
      });
      results.push({ name: f.name, url, size: f.size, isImage: false, isVideo: f.isVideo, isAudio: f.isAudio });
    }
  }
  return results;
}

/* ── Данные ─────────────────────────────────────────────────────────────── */

async function loadList() {
  const my = token;
  try {
    const chats = await forum.listChats();
    if (my !== token) return;
    state.chats = chats;
    if (state.openId) state.open = chats.find((c) => c.id === state.openId) ?? state.open;
    state.error = '';
  } catch (err) {
    if (my !== token) return;
    state.error = String(err?.message ?? err);
  }
}

async function openChat(id) {
  const my = token;
  state.openId = id;
  state.open = state.chats.find((c) => c.id === id) ?? null;
  state.messages = [];
  state.members = [];
  state.membersOpen = false;
  state.inviteOpen = false;
  state.menuOpen = false;
  state.pollOpen = false;
  state.replyingTo = null;
  state.pollDraft = null;
  state.lightbox = null;
  state.searchOpen = false;
  state.searchQuery = '';
  state.hasMore = false;
  state.loading = true;
  paintFull({ stick: true });

  try {
    const [chat, messages] = await Promise.all([
      forum.getChat(id),
      forum.listChatMessages(id, { limit: 60 }),
    ]);
    if (my !== token) return;
    if (!chat) {
      state.open = null;
      state.error = 'Вы не участник этого чата или его больше нет.';
    } else {
      state.open = chat;
      state.messages = messages;
      state.hasMore = messages.length >= 60;
      state.error = '';
      forum.markChatRead(id).then(() => {
        const c = state.chats.find((x) => x.id === id);
        if (c) c.unread = 0;
        paintList();
      });
    }
  } catch (err) {
    if (my !== token) return;
    state.error = String(err?.message ?? err);
  }
  state.loading = false;
  paintFull({ stick: true });
}

/** Только новые сообщения — с даты последнего у нас. */
async function tick() {
  if (!host || !state.openId || document.hidden) return;
  const my = token;
  const id = state.openId;
  try {
    const fresh = await forum.listChatMessages(id, { limit: 60 });
    if (my !== token || id !== state.openId) return;
    const known = new Set(state.messages.map((m) => m.id));
    const added = fresh.filter((m) => !known.has(m.id));
    const byId = new Map(fresh.map((m) => [m.id, m]));
    let changed = added.length > 0;
    state.messages = state.messages.map((m) => {
      const f = byId.get(m.id);
      if (!f) return m;
      /*
        Аватарки обновляем, если сервер прислал, а локально пусто.
        Реакции — мерж: берём серверные массивы голосующих как основу.
        Если реакция текущего пользователя ещё не дошла до сервера
        (fire-and-forget), добавляем её локально, чтобы не мигала.
      */
      const meId = state.me?.id;
      const avatarChanged = !m.authorAvatar && f.authorAvatar;
      const serverR = f.reactions || {};
      const localR = m.reactions || {};
      const mergedR = {};
      for (const [k, v] of Object.entries(serverR)) {
        if (Array.isArray(v)) mergedR[k] = [...v];
      }
      if (meId) {
        const serverHasMe = Object.values(mergedR).some((v) => v.includes(meId));
        let localEmoji = null;
        for (const [k, v] of Object.entries(localR)) {
          if (Array.isArray(v) && v.includes(meId)) { localEmoji = k; break; }
        }
        if (localEmoji && !serverHasMe) {
          mergedR[localEmoji] = [...(mergedR[localEmoji] || []), meId];
        }
      }
      const reactionsChanged = JSON.stringify(mergedR) !== JSON.stringify(m.reactions || {});
      const pollChanged = JSON.stringify(f.poll || null) !== JSON.stringify(m.poll || null);
      if (f.deleted !== m.deleted || avatarChanged || reactionsChanged || pollChanged) {
        changed = true;
        return { ...f, reactions: mergedR };
      }
      return m;
    });
    if (added.length) {
      const scroll = host?.querySelector('[data-chat-scroll]');
      const atBottom = scroll ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80 : true;
      state.messages = [...state.messages, ...added].sort((a, b) => a.createdAt - b.createdAt);
      const newFromOthers = added.filter((m) => m.authorId !== state.me?.id);
      if (newFromOthers.length) forum.markChatRead(id).catch(() => {});
      if (!atBottom) state.newMessages += newFromOthers.length;

      /* Звук и уведомление: только для чужих сообщений, только когда видим. */
      if (newFromOthers.length && !document.hidden) {
        playNewMessageSound();
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const sender = newFromOthers[newFromOthers.length - 1].authorNick;
          const preview = plainExcerpt(newFromOthers[newFromOthers.length - 1].body || 'Вложение', 60);
          new Notification(`${sender}: ${preview}`, { silent: true });
        }
      }
    }
    if (changed) paintMessages();
  } catch {
    /* сеть моргнула — следующий тик попробует снова */
  }
}

function startPolling() {
  stopPolling();
  timer = window.setInterval(tick, POLL_MS);
  listTimer = window.setInterval(async () => {
    if (document.hidden) return;
    await loadList();
    paintList();
  }, POLL_MS_LIST);
}

function stopPolling() {
  window.clearInterval(timer);
  window.clearInterval(listTimer);
  timer = 0;
  listTimer = 0;
}

/* ── Действия ───────────────────────────────────────────────────────────── */

async function send(form) {
  const input = form.querySelector('[data-chat-input]');
  // contenteditable div: innerHTML сохраняет <span style="color:…">.
  // textContent для проверки пустоты (игнорируем <br>, &nbsp;).
  const rawHtml = input?.innerHTML ?? '';
  const body = rawHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .trim()
    ? rawHtml
    : '';
  const files = [...state.pendingFiles];
  const poll = state.pollDraft;
  if ((!body && !files.length && !poll) || state.sending || !state.openId) return;

  state.sending = true;
  const btn = form.querySelector('.chat-compose__send');
  if (btn) btn.disabled = true;

  const id = state.openId;
  const reply = state.replyingTo;
  try {
    const attachments = await uploadChatFiles();
    const m = await forum.sendChatMessage(id, body, {
      attachments,
      poll,
      replyTo: reply ? { id: reply.id, authorNick: reply.authorNick, body: reply.body } : null,
    });
    if (id !== state.openId) return;
    state.messages.push(m);
    chatDrafts.set(id, '');
    if (input) {
      input.innerHTML = '';
      requestAnimationFrame(() => autosize(input));
    }
    /*
      В рабочем режиме файл уже в хранилище, локальный preview больше не нужен.
      В локальном режиме адрес превью и есть адрес вложения — отзывать его
      нельзя, иначе сообщение сразу покажет битую картинку.
    */
    clearPendingFiles({ keepUrls: !forum.capabilities?.isShared });
    state.pollDraft = null;
    state.pollOpen = false;
    state.replyingTo = null;
    const c = state.chats.find((x) => x.id === id);
    if (c) { c.lastBody = body || (attachments.length ? '📎 Вложение' : '📊 Опрос'); c.lastNick = state.me.nick; c.lastAt = m.createdAt; }
    /*
      КЛЮЧЕВОЙ ФИКС «ТАНЦУЮЩЕЙ КЛАВИАТУРЫ».

      После отправки НЕ вызываем paintMessages (не заменяем весь innerHTML
      ленты) и НЕ трогаем autosize. Вместо этого дописываем ОДИН <li> в
      конец существующего <ol class="chat-msgs"> — браузер делает один
      layout, а не полный пересбор. Клавиатура не прыгает.

      Прокрутку вниз тоже не делаем: пользователь уже внизу (он только
      что написал), новое сообщение появляется прямо над вводом.
    */
    appendMessageToDOM(m);

    paintList();
    paintComposerMeta();
  } catch (err) {
    notice(String(err?.message ?? err));
  } finally {
    state.sending = false;
    if (btn?.isConnected) btn.disabled = false;
    /*
      Фокус возвращаем в поле ввода, но только если оно уже было
      активным: на телефоне «слепой» focus() после await не открывает
      клавиатуру, а закрытая клавиатура при работающем вводе выглядит
      как баг.
    */
    if (input && document.activeElement === btn) {
      input.focus({ preventScroll: true });
    }
  }
}

/** Обновить ответ/опрос над полем ввода, не пересоздавая сам textarea. */
function paintComposerMeta() {
  if (!host) return;
  // Баннер «Ответ для …».
  const replyBox = host.querySelector('.chat-reply-banner');
  if (replyBox) {
    if (!state.replyingTo) replyBox.remove();
  } else if (state.replyingTo) {
    const form = host.querySelector('[data-chat-send]');
    form?.insertAdjacentHTML('beforebegin', `
      <div class="chat-reply-banner">
        <div class="chat-reply-banner__info">
          <span class="chat-reply-banner__label">Ответ для <b>${esc(state.replyingTo.authorNick)}</b></span>
          <span class="chat-reply-banner__text muted">${esc(state.replyingTo.body)}</span>
        </div>
        <button type="button" class="chat-reply-banner__cancel" data-chat-reply-cancel title="Отменить ответ">✕</button>
      </div>`);
  }
  // Чип «Опрос: …» (после применения опроса, до отправки).
  const pollChip = host.querySelector('.chat-pending-poll');
  if (pollChip && !state.pollDraft) pollChip.remove();
  // Форма создания опроса.
  const pollForm = host.querySelector('[data-chat-poll-form]');
  if (pollForm && !state.pollOpen) pollForm.remove();
}

/**
 * Дописать одно сообщение в конец ленты — без пересборки innerHTML.
 *
 * Замена paintMessages при отправке: один вставленный <li> не вызывает
 * пересчёт layout ленты, и клавиатура на телефоне не прыгает.
 */
function appendMessageToDOM(m) {
  if (!host) return;
  const scroll = host.querySelector('[data-chat-scroll]');
  let msgs = scroll?.querySelector('.chat-msgs');
  // Лента может быть пустым плейсхолдером — тогда рисуем ленту целиком.
  if (!msgs) {
    const area = scroll?.querySelector('.chat-room__scroll') ?? scroll;
    if (!area) { paintMessages({ stick: true }); return; }
    area.innerHTML = renderScrollArea(state);
    scroll.scrollTop = scroll.scrollHeight;
    return;
  }

  const isMgr = state.open && (
    state.open.myRole === 'owner' || state.open.myRole === 'admin' ||
    state.open.ownerId === state.me?.id || state.me?.role === 'admin' || state.me?.role === 'moderator'
  );
  const prev = state.messages.length > 1 ? state.messages[state.messages.length - 2] : null;
  const grouped = prev && prev.authorId === m.authorId && !prev.deleted
    && m.createdAt - prev.createdAt < 5 * 60 * 1000
    && !m.replyTo && !m.poll;
  const day = new Date(m.createdAt);
  const dayStr = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  // Если день изменился — вставляем заголовок дня.
  if (prev) {
    const prevDay = new Date(prev.createdAt);
    const prevDayStr = `${prevDay.getFullYear()}-${prevDay.getMonth()}-${prevDay.getDate()}`;
    if (prevDayStr !== dayStr) {
      const dayLabel = day.toDateString() === new Date().toDateString()
        ? 'Сегодня'
        : new Date(Date.now() - 86400000).toDateString() === day.toDateString()
          ? 'Вчера'
          : day.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      msgs.insertAdjacentHTML('beforeend', `<div class="chat-day"><span>${esc(dayLabel)}</span></div>`);
    }
  }
  msgs.insertAdjacentHTML('beforeend', renderMessage(m, state, isMgr, grouped));
}

async function withBusy(btn, label, fn) {
  const was = btn.textContent;
  btn.disabled = true;
  if (label) btn.textContent = label;
  try {
    await fn();
  } catch (err) {
    notice(String(err?.message ?? err));
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.textContent = was; }
  }
}

/* ── События ────────────────────────────────────────────────────────────── */

function wire() {
  if (wired) return;
  wired = true;

  document.addEventListener('submit', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const form = e.target;

    if (form.matches('[data-chat-send]')) {
      e.preventDefault();
      send(form);
      return;
    }

    if (form.matches('[data-chat-join]')) {
      e.preventDefault();
      const code = String(form.elements.code?.value ?? '').trim();
      if (!code) return;
      const btn = form.querySelector('button');
      await withBusy(btn, '…', async () => {
        const id = await forum.joinChat(code);
        await loadList();
        location.hash = `#/chats/${id}`;
        notice('Вы в чате');
      });
      return;
    }

    if (form.matches('[data-chat-create]')) {
      e.preventDefault();
      const err = form.querySelector('[data-chat-create-error]');
      const title = String(form.elements.title?.value ?? '').trim();
      if (title.length < 2) {
        if (err) { err.textContent = 'Название короче двух символов'; err.hidden = false; }
        return;
      }
      const btn = form.querySelector('button[type="submit"]');
      await withBusy(btn, 'Создаём…', async () => {
        const chat = await forum.createChat({
          title,
          kind: form.elements.kind?.value === 'inter' ? 'inter' : 'alliance',
          allianceTag: String(form.elements.allianceTag?.value ?? '').trim(),
        });
        state.createOpen = false;
        await loadList();
        location.hash = `#/chats/${chat.id}`;
});
    }

    if (form.matches('[data-chat-dm]')) {
      e.preventDefault();
      const err = form.querySelector('[data-chat-dm-error]');
      const nick = String(form.elements.nick?.value ?? '').trim();
      if (!nick) return;
      const btn = form.querySelector('button[type="submit"]');
      await withBusy(btn, '…', async () => {
        const id = await forum.createDM?.(nick);
        if (!id) { if (err) { err.textContent = 'Не удалось открыть ЛС'; err.hidden = false; } return; }
        state.dmOpen = false;
        await loadList();
        location.hash = `#/chats/${id}`;
        notice('ЛС открыт');
      });
    }
    return;
  });

  document.addEventListener('click', async (e) => {
    if (!host || !e.target.closest) return;
    const t = e.target;

    if (state.menuOpen && !t.closest('[data-chat-menu]')) {
      state.menuOpen = false;
      host.querySelector('.chat-menu__pop')?.remove();
      host.querySelector('[data-chat-menu-toggle]')?.setAttribute('aria-expanded', 'false');
    }
    if (!t.closest('[data-chat-react-picker]')) {
      host.querySelectorAll('.chat-msg__reactions-pop.is-open').forEach((el) => el.classList.remove('is-open'));
    }
    if (!host.contains(t)) return;

    /* Лайтбокс: открыть по картинке, закрыть по фону или кнопке. */
    const lightOpen = t.closest('[data-chat-lightbox]');
    if (lightOpen) {
      state.lightbox = lightOpen.dataset.chatLightbox;
      host.querySelector('.chat-lightbox')?.remove();
      host.insertAdjacentHTML('beforeend', `
        <div class="chat-lightbox" data-chat-lightbox-close>
          <img src="${esc(state.lightbox)}" alt="" class="chat-lightbox__img">
          <button type="button" class="chat-lightbox__close" aria-label="Закрыть">✕</button>
        </div>`);
      return;
    }
    if (t.closest('[data-chat-lightbox-close]')) {
      state.lightbox = null;
      host.querySelector('.chat-lightbox')?.remove();
      return;
    }

    if (t.closest('[data-chat-menu-toggle]')) {
      state.menuOpen = !state.menuOpen;
      state.membersOpen = false;
      state.inviteOpen = false;
      paint();
      return;
    }
    if (t.closest('[data-chat-create-toggle]')) {
      state.createOpen = !state.createOpen;
      paint();
      if (state.createOpen) host.querySelector('[data-chat-create] input[name="title"]')?.focus();
      return;
    }
    if (t.closest('[data-chat-members-toggle]')) {
      state.membersOpen = !state.membersOpen;
      state.inviteOpen = false;
      state.menuOpen = false;
      if (state.membersOpen && state.openId) {
        state.members = await forum.listChatMembers(state.openId).catch(() => []);
      }
      paint();
      return;
    }
    if (t.closest('[data-chat-invite]')) {
      state.inviteOpen = !state.inviteOpen;
      state.membersOpen = false;
      state.menuOpen = false;
      paint();
      return;
    }
    const copy = t.closest('[data-chat-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.chatCopy);
        notice('Ссылка скопирована');
      } catch {
        notice(`Код: ${state.open?.inviteCode ?? ''}`);
      }
      return;
    }
    const rotate = t.closest('[data-chat-rotate]');
    if (rotate && state.openId) {
      await withBusy(rotate, '…', async () => {
        const code = await forum.rotateChatCode(state.openId);
        if (state.open) state.open.inviteCode = code;
        paint();
        notice('Код сменён — старый больше не работает');
      });
      return;
    }
    const leave = t.closest('[data-chat-leave]');
    if (leave && state.openId) {
      state.menuOpen = false;
      paint();
      if (!confirm('Выйти из чата? Вернуться можно будет только по коду.')) return;
      await withBusy(leave, '…', async () => {
        await forum.leaveChat(state.openId);
        await loadList();
        location.hash = '#/chats';
      });
      return;
    }

    /* Удаление чата: создателем или модерацией. */
    const delChat = t.closest('[data-chat-delete]');
    if (delChat && state.openId) {
      state.menuOpen = false;
      paint();
      const title = state.open?.title || 'этот чат';
      if (!confirm(`Удалить чат «${title}» навсегда? Сообщения и участники будут удалены без возврата.`)) return;
      await withBusy(delChat, '…', async () => {
        await forum.deleteChat(state.openId);
        await loadList();
        location.hash = '#/chats';
        notice('Чат удалён навсегда');
      });
      return;
    }

    const close = t.closest('[data-chat-close]');
    if (close && state.openId) {
      state.menuOpen = false;
      paint();
      const reason = prompt('Причина закрытия (увидят участники):', '') ?? null;
      if (reason === null) return;
      await withBusy(close, '…', async () => {
        await forum.updateChat(state.openId, { closed: true, closedReason: reason });
        await loadList();
        await openChat(state.openId);
      });
      return;
    }
    const reopen = t.closest('[data-chat-reopen]');
    if (reopen && state.openId) {
      state.menuOpen = false;
      paint();
      await withBusy(reopen, '…', async () => {
        await forum.updateChat(state.openId, { closed: false, closedReason: '' });
        await loadList();
        await openChat(state.openId);
      });
      return;
    }
    const roleBtn = t.closest('[data-chat-member-role]');
    if (roleBtn && state.openId) {
      await withBusy(roleBtn, '…', async () => {
        await forum.setChatMemberRole(state.openId, roleBtn.dataset.chatMemberRole, roleBtn.dataset.role);
        state.members = await forum.listChatMembers(state.openId);
        paint();
      });
      return;
    }
    const kick = t.closest('[data-chat-member-kick]');
    if (kick && state.openId) {
      if (!confirm('Выгнать из чата?')) return;
      await withBusy(kick, '…', async () => {
        await forum.kickChatMember(state.openId, kick.dataset.chatMemberKick);
        state.members = await forum.listChatMembers(state.openId);
        await loadList();
        paint();
      });
      return;
    }

    /* Ответить. */
    const replyBtn = t.closest('[data-chat-msg-reply]');
    if (replyBtn) {
      state.replyingTo = {
        id: replyBtn.dataset.chatMsgReply,
        authorNick: replyBtn.dataset.nick || '',
        body: replyBtn.dataset.excerpt || '',
      };
      paintComposerMeta();
      host?.querySelector('[data-chat-input]')?.focus({ preventScroll: true });
      return;
    }
    if (t.closest('[data-chat-reply-cancel]')) {
      state.replyingTo = null;
      paintComposerMeta();
      return;
    }

    /* Реакция: один пользователь — одна реакция на сообщение.
       Повторный клик по тому же эмодзи снимает его. Клик по другому —
       заменяет. Обрабатываем ДО панели реакций, чтобы клик по эмодзи
       внутри popup не съедался обработчиком открытия/закрытия popup. */
    const react = t.closest('[data-chat-react]');
    if (react) {
      const [msgId, emoji] = String(react.dataset.chatReact || '').split(':');
      if (msgId && emoji) {
        const m = state.messages.find((x) => x.id === msgId);
        const meId = state.me?.id;
        if (m && meId) {
          m.reactions = m.reactions || {};
          // Найти, какой эмодзи пользователь уже выбрал.
          let current = null;
          for (const [k, v] of Object.entries(m.reactions)) {
            if (Array.isArray(v) && v.includes(meId)) { current = k; break; }
          }
          // Убрать из старого.
          if (current && m.reactions[current]) {
            m.reactions[current] = m.reactions[current].filter((id) => id !== meId);
            if (!m.reactions[current].length) delete m.reactions[current];
          }
          // Поставить в новый, если это не повторный клик (снятие).
          if (current !== emoji) {
            m.reactions[emoji] = [...(m.reactions[emoji] || []), meId];
          }
          paintMessages();
        }
        forum.reactChatMessage?.(msgId, emoji).catch(() => {});
        host.querySelectorAll('.chat-msg__reactions-pop.is-open').forEach((el) => el.classList.remove('is-open'));
      }
      return;
    }

    /* Панель реакций: открыть/закрыть по нажатию (на телефоне hover нет). */
    const picker = t.closest('[data-chat-react-picker]');
    if (picker) {
      const pop = picker.querySelector('.chat-msg__reactions-pop');
      if (pop) {
        const open = pop.classList.contains('is-open');
        host.querySelectorAll('.chat-msg__reactions-pop.is-open').forEach((el) => el.classList.remove('is-open'));
        if (!open) pop.classList.add('is-open');
      }
      return;
    }

    /* Переход к сообщению, на которое ответили. */
    const jump = t.closest('[data-chat-jump]');
    if (jump) {
      host.querySelector(`#${CSS.escape(jump.dataset.chatJump)}`)?.scrollIntoView({
        behavior: 'smooth', block: 'center',
      });
      return;
    }

    /* Голос в опросе. */
    const vote = t.closest('[data-chat-vote]');
    if (vote) {
      const [msgId, rawIdx] = String(vote.dataset.chatVote || '').split(':');
      const idx = Number(rawIdx);
      if (msgId && Number.isInteger(idx)) {
        const m = state.messages.find((x) => x.id === msgId);
        if (m?.poll) {
          const meId = state.me?.id;
          const opt = m.poll.options?.[idx];
          if (opt) {
            opt.voters = Array.isArray(opt.voters) ? opt.voters : [];
            const mine = opt.voters.indexOf(meId);
            if (mine >= 0) opt.voters.splice(mine, 1);
            else if (!m.poll.multiple) {
              for (const o of m.poll.options) o.voters = (o.voters || []).filter((v) => v !== meId);
              opt.voters.push(meId);
            } else opt.voters.push(meId);
            m.poll.total = new Set(m.poll.options.flatMap((o) => o.voters || [])).size;
            paintMessages();
          }
        }
        forum.voteChatPoll?.(msgId, idx).catch(() => {});
      }
      return;
    }

    /* Опрос: открыть/закрыть форму, прикрепить. */
    if (t.closest('[data-chat-poll-toggle]')) {
      state.pollOpen = !state.pollOpen;
      paint();
      return;
    }
    if (t.closest('[data-chat-poll-apply]')) {
      const box = host.querySelector('[data-chat-poll-form]');
      const q = String(box?.querySelector('[name="pollQuestion"]')?.value ?? '').trim();
      const options = [...(box?.querySelectorAll('.chat-poll-creator__opt') ?? [])]
        .map((el) => String(el.value ?? '').trim())
        .filter(Boolean);
      if (q.length < 3 || options.length < 2) {
        notice('Нужен вопрос и хотя бы два варианта');
        return;
      }
      const multiple = Boolean(box?.querySelector('[name="pollMultiple"]')?.checked);
      state.pollDraft = {
        question: q,
        multiple,
        options: options.map((text) => ({ text, votes: 0, voters: [] })),
        total: 0,
      };
      state.pollOpen = false;
      paintFull();
      return;
    }
    if (t.closest('[data-chat-poll-clear]')) {
      state.pollDraft = null;
      paintFull();
      return;
    }

    const dropBtn = t.closest('[data-chat-drop-file]');
    if (dropBtn) {
      dropFile(Number(dropBtn.dataset.chatDropFile));
      return;
    }

    const del = t.closest('[data-chat-msg-delete]');
    if (del) {
      const id = del.dataset.chatMsgDelete;
      const m = state.messages.find((x) => x.id === id);
      const mine = m?.authorId === state.me?.id;
      const reason = mine ? '' : (prompt('Причина удаления (увидят участники):', 'нарушение правил') ?? null);
      if (reason === null) return;
      await withBusy(del, '', async () => {
        await forum.deleteChatMessage(id, reason);
        if (m) { m.deleted = true; m.deletedReason = reason; }
        paintMessages();
      });
      return;
    }
    const more = t.closest('[data-chat-more]');
    if (more && state.openId) {
      await withBusy(more, 'Загружаем…', async () => {
        const oldest = state.messages[0]?.createdAt;
        const older = await forum.listChatMessages(state.openId, { limit: 60, before: oldest });
        state.messages = [...older, ...state.messages];
        state.hasMore = older.length >= 60;
        paintMessages();
      });
      return;
    }

    /* Бесконечный скролл: IntersectionObserver следит за сентинелем
       в верху ленты и подгружает порцию, когда он появляется в зоне
       видимости. Срабатывает один раз на сентинел, потом сентинел
       удаляется (paintMessages перерисовывает ленту, и если hasMore —
       сентинел появляется снова). */
    const sentinel = t.closest('[data-chat-sentinel]');
    if (sentinel && state.openId && !state._loadingMore) {
      state._loadingMore = true;
      try {
        const oldest = state.messages[0]?.createdAt;
        const older = await forum.listChatMessages(state.openId, { limit: 60, before: oldest });
        state.messages = [...older, ...state.messages];
        state.hasMore = older.length >= 60;
        paintMessages();
      } finally {
        state._loadingMore = false;
      }
      return;
    }

    /* Кнопка «вниз» — прокрутка к последнему сообщению. */
    const goBottom = t.closest('[data-chat-go-bottom]');
    if (goBottom) {
      const scroll = host?.querySelector('[data-chat-scroll]');
      if (scroll) scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' });
      state.newMessages = 0;
      paintGoBottom();
      return;
    }

    /* Переименовать чат. */
    const rename = t.closest('[data-chat-rename]');
    if (rename && state.openId && state.open) {
      state.menuOpen = false;
      host.querySelector('.chat-menu__pop')?.remove();
      const title = prompt('Новое название чата:', state.open.title) ?? null;
      if (title === null || !title.trim() || title.trim() === state.open.title) return;
      await withBusy(rename, '…', async () => {
        await forum.updateChat(state.openId, { title: title.trim() });
        await loadList();
        await openChat(state.openId);
      });
      return;
    }

    /* Экспорт истории чата в JSON. */
    const exportBtn = t.closest('[data-chat-export]');
    if (exportBtn && state.openId) {
      state.menuOpen = false;
      host.querySelector('.chat-menu__pop')?.remove();
      const msgs = state.messages.map((m) => ({
        author: m.authorNick,
        date: m.createdAt?.toISOString?.() ?? m.createdAt,
        body: m.body,
        attachments: m.attachments,
        reactions: m.reactions,
        poll: m.poll,
      }));
      const blob = new Blob([JSON.stringify({ title: state.open?.title, messages: msgs }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `chat-${state.open?.title || state.openId}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      notice('История экспортирована');
      return;
    }

    /* Поиск по сообщениям: открыть/закрыть. */
    const searchToggle = t.closest('[data-chat-search-toggle]');
    if (searchToggle) {
      state.searchOpen = !state.searchOpen;
      state.searchQuery = '';
      paintFull();
      if (state.searchOpen) {
        host.querySelector('[data-chat-search-input]')?.focus({ preventScroll: true });
      }
      return;
    }

    /* Закрепить сообщение (для будущего). */
    const pinBtn = t.closest('[data-chat-pin]');
    if (pinBtn && state.openId) {
      const msgId = pinBtn.dataset.chatPin;
      state.open.pinnedId = state.open.pinnedId === msgId ? null : msgId;
      paintFull({ stick: true });
      notice(state.open.pinnedId ? 'Сообщение закреплено' : 'Откреплено');
      return;
    }

    /* Открепить сообщение (из баннера). */
    const unpinBtn = t.closest('[data-chat-unpin]');
    if (unpinBtn && state.openId) {
      state.menuOpen = false;
      await withBusy(unpinBtn, '…', async () => {
        await forum.unpinChatMessage?.(state.openId);
        await loadList();
        await openChat(state.openId);
        notice('Откреплено');
      });
      return;
    }

    /* Закрепить сообщение (из меню сообщения). */
    const pinMsg = t.closest('[data-chat-pin]');
    if (pinMsg && state.openId) {
      const msgId = pinMsg.dataset.chatPin;
      await withBusy(pinMsg, '…', async () => {
        await forum.pinChatMessage?.(state.openId, msgId);
        await loadList();
        await openChat(state.openId);
        notice('Сообщение закреплено');
      });
      return;
    }

    /* Лидерборд: показать/скрыть. */
    const lbToggle = t.closest('[data-chat-leaderboard-toggle]');
    if (lbToggle) {
      state.leaderboardOpen = !state.leaderboardOpen;
      if (state.leaderboardOpen && !state.leaderboard?.length) {
        try { state.leaderboard = await forum.chatLeaderboard?.() ?? []; } catch { state.leaderboard = []; }
      }
      paintFull();
      return;
    }

    /* Личные сообщения: показать/скрыть форму. */
    const dmToggle = t.closest('[data-chat-dm-toggle]');
    if (dmToggle) {
      state.dmOpen = !state.dmOpen;
      paintFull();
      if (state.dmOpen) host.querySelector('[data-chat-dm] input[name="nick"]')?.focus({ preventScroll: true });
      return;
    }

    /* Web Push подписка. */
    const pushBtn = t.closest('[data-chat-push]');
    if (pushBtn) {
      state.menuOpen = false;
      host.querySelector('.chat-menu__pop')?.remove();
      host.querySelector('[data-chat-menu-toggle]')?.setAttribute('aria-expanded', 'false');
      try {
        if (!('Notification' in window)) { notice('Браузер не поддерживает уведомления'); return; }
        if (!('serviceWorker' in navigator)) { notice('Service Worker не поддерживается'); return; }

        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { notice('Разрешение на уведомления не выдано'); return; }

        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) {
          // VAPID-ключ: после генерации вписать свой публичный сюда
          // и приватный в секреты Edge Function.
          // Генерация: npx web-push generate-vapid-keys
          const vapidPublicKey = (document.querySelector('meta[name="vapid-public-key"]')?.content) || '';
          const vapidBytes = vapidPublicKey ? urlBase64ToUint8Array(vapidPublicKey) : null;
          if (!vapidBytes) { notice('Push-ключ не настроен. Установите мету vapid-public-key.'); return; }
          try {
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes });
          } catch {
            notice('Не удалось подписаться на push. Попробуйте позже.');
            return;
          }
        }
        const keys = sub.keys || {};
        await forum.savePushSubscription?.(sub.endpoint, keys);
        notice('✅ Push-уведомления включены');
      } catch (err) {
        notice(String(err?.message ?? err));
      }
      return;
    }
  });

  /* Выбор файлов через скрепку. */
  document.addEventListener('change', (e) => {
    if (!host || !host.contains(e.target)) return;
    if (e.target.matches?.('[data-chat-file-input]')) {
      addFiles(e.target.files ?? []);
      e.target.value = '';
    }
  });

  /* Вставка скриншота из буфера обмена (Ctrl+V). */
  document.addEventListener('paste', (e) => {
    const input = e.target?.closest?.('[data-chat-input]');
    if (!input || !host?.contains(input)) return;
    const items = [...(e.clipboardData?.items ?? [])];
    const files = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });

  document.addEventListener('input', (e) => {
    if (!host || !host.contains(e.target)) return;
    if (e.target.matches?.('[data-chat-input]')) {
      autosize(e.target);
      // Typing indicator: send debounced.
      if (state.openId) {
        clearTimeout(state._typingTimer);
        state._typingTimer = setTimeout(() => { forum.setTyping?.(state.openId); }, 800);
      }
    }
    if (e.target.matches?.('[data-chat-search-input]')) {
      state.searchQuery = e.target.value;
      paintMessages();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!host) return;
    if (e.key === 'Escape') {
      if (state.lightbox) {
        state.lightbox = null;
        host.querySelector('.chat-lightbox')?.remove();
        return;
      }
      if (state.menuOpen) {
        state.menuOpen = false;
        paint();
        return;
      }
    }
    if (!e.target.matches?.('[data-chat-input]')) return;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !coarse) {
      e.preventDefault();
      e.target.closest('form')?.requestSubmit?.();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && host) tick();
  });

  /* Слушатель скролла: сбрасываем newMessages, когда пользователь докрутился до низа. */
  host?.addEventListener('scroll', (e) => {
    const target = e.target.closest('[data-chat-scroll]');
    if (!target) return;
    const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
    if (atBottom) {
      state.newMessages = 0;
      paintGoBottom();
    }
  }, { passive: true });

  /* Бесконечный скролл: IntersectionObserver следит за сентинелем
     в верху ленты и подгружает порцию, когда он появляется в зоне
     видимости. */
  const scrollObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && state.openId && !state._loadingMore && state.hasMore) {
        state._loadingMore = true;
        const oldest = state.messages[0]?.createdAt;
        forum.listChatMessages(state.openId, { limit: 60, before: oldest }).then((older) => {
          if (state.openId) {
            state.messages = [...older, ...state.messages];
            state.hasMore = older.length >= 60;
            paintMessages();
          }
        }).finally(() => { state._loadingMore = false; });
      }
    }
  }, { root: null, threshold: 0.1 });
  state._scrollObserver = scrollObserver;

  /* Уведомления о новых сообщениях: звук + системное уведомление. */
  async function playNewMessageSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      /* игнорируем ошибки звука */
    }
  }

  /* Запросить разрешение на уведомления при первом открытии чата. */
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

/* ── Входы ──────────────────────────────────────────────────────────────── */

export async function mountChats(container, param = null) {
  host = container;
  token++;
  wire();
  watchHead();

  state.loading = true;
  state.error = '';
  paintFull();

  try {
    state.ready = await forum.isReady();
  } catch (err) {
    state.ready = false;
    state.error = String(err?.message ?? err);
    state.loading = false;
    paintFull();
    return;
  }
  if (!state.ready) { state.loading = false; paintFull(); return; }

  try {
    state.me = await forum.currentUser();
  } catch {
    state.me = null;
  }
  if (!state.me) { state.loading = false; paintFull(); return; }

  if (param && param.startsWith('join/')) {
    const code = param.slice(5);
    try {
      const id = await forum.joinChat(code);
      location.replace(`#/chats/${id}`);
      return;
    } catch (err) {
      state.error = String(err?.message ?? err);
      notice(state.error);
      param = null;
    }
  }

  await loadList();
  state.loading = false;

  if (param) {
    await openChat(param);
  } else {
    state.openId = null;
    state.open = null;
    state.messages = [];
    paintFull();
  }
  startPolling();
}

export function unmountChats() {
  host = null;
  token++;
  stopPolling();
  headWatch?.disconnect();
  headWatch = null;
  vvWatch?.();
  vvWatch = null;
  if (state._scrollObserver) { state._scrollObserver.disconnect(); state._scrollObserver = null; }
  state.openId = null;
  state.open = null;
  state.messages = [];
  state.members = [];
  state.membersOpen = false;
  state.inviteOpen = false;
  state.menuOpen = false;
  state.createOpen = false;
  state.pollOpen = false;
  state.replyingTo = null;
  state.pollDraft = null;
  state.lightbox = null;
  state.searchOpen = false;
  state.searchQuery = '';
  state.newMessages = 0;
  state._loadingMore = false;
  clearPendingFiles();
  renderedChatId = undefined;
}

/** Сколько непрочитанных всего — для счётчика в меню. */
export async function unreadChatsTotal() {
  try {
    if (!(await forum.isReady())) return 0;
    if (!(await forum.currentUser())) return 0;
    const chats = await forum.listChats();
    return chats.reduce((n, c) => n + (c.unread || 0), 0);
  } catch {
    return 0;
  }
}
