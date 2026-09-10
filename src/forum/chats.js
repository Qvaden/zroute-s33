/**
 * ЗАКРЫТЫЕ ЧАТЫ — ПОВЕДЕНИЕ.
 *
 * Тот же приём, что у форума (mount.js): состояние в одном объекте, страница
 * перерисовывается строкой целиком, набранный текст переживает перерисовку.
 *
 * Страница — полноэкранный мессенджер: высоту от шапки сайта считает
 * fitFullscreen ниже, действия с чатом живут в меню ⋯.
 *
 * КАК ПРИХОДЯТ НОВЫЕ СООБЩЕНИЯ. Опросом раз в несколько секунд, пока вкладка
 * видна. Не Realtime-подпиской Supabase — она требует их клиентскую
 * библиотеку и веб-сокет, а проект держится на правиле «обычные ES-модули,
 * без сборки». Опрос спрашивает только «что новее последнего у меня», это
 * один дешёвый запрос; при 200 людях в чате и вкладке в фоне — ноль запросов.
 * Если однажды понадобится мгновенность — точка замены одна: tick().
 *
 * ЧЕГО СТОИЛО СДЕЛАТЬ ЧАТ ПОХОЖИМ НА МЕССЕНДЖЕР.
 *
 * 1. ВЛОЖЕНИЯ. Файл грузится сразу, как только его выбрали, а не в момент
 *    отправки: пока человек пишет подпись, видео уже едет. Полоска хода —
 *    не украшение, а необходимость: 20 МБ с телефона по мобильной сети едут
 *    десятки секунд, и без неё кнопку «отправить» жмут второй раз.
 *    Ход загрузки обновляет только карточку вложения, без перерисовки
 *    страницы — иначе на каждый процент перерисовывалась бы вся лента.
 *
 * 2. ПОРЯДОК ОТПРАВКИ. Сначала файлы в хранилище, потом сообщение со ссылкой.
 *    Обратный порядок показывал бы всем битую картинку, пока файл ещё едет.
 *
 * 3. ЧЕРНОВИКИ ПЕРЕЖИВАЮТ ПЕРЕРИСОВКУ. Лента обновляется опросом каждые
 *    несколько секунд, и раньше набранный текст в поле «Новый чат» пропадал:
 *    paint() перерисовывает разметку целиком. Поэтому текст, тема, тег, вид
 *    и строка поиска снимаются перед перерисовкой и возвращаются после.
 */
import { forum } from './index.js';
import { renderChats } from '../pages/chats.js';
import { textOf } from './format.js';
import { initSelects } from '../ui/select.js';
import { CHAT_LIMITS, checkFile, kindOfFile, nameOf, formatBytes } from './media.js';

const POLL_MS = 4000;
const POLL_MS_LIST = 15000;
const EMOJI_KEY = 'zr33.chat.emoji';

const state = {
  ready: false,
  loading: true,
  error: '',
  me: null,
  chats: [],
  listFilter: 'all',
  openId: null,
  open: null,
  messages: [],
  members: [],
  membersOpen: false,
  inviteOpen: false,
  menuOpen: false,
  createOpen: false,
  createDraft: null,
  hasMore: false,
  sending: false,

  /* Новое: вложения и разговорные механики. */
  queue: [],
  replyTo: null,
  emojiOpen: false,
  emojiRecent: [],
  pinsOpen: false,
  pins: [],
  searchOpen: false,
  searchQ: '',
  searchResults: null,
  searchBusy: false,
  settingsOpen: false,
  settingsDraft: null,
  msgMenu: null,
  reactFor: null,
  lightbox: null,
  dialog: null,
  typing: [],
  newFromId: null,
  highlight: null,
  recording: null,
  newCount: 0,
};

let host = null;
let wired = false;
let token = 0;
let timer = 0;
let listTimer = 0;
let draft = '';
let headWatch = null;
let queueSeq = 0;
let typeSentAt = 0;
let recTimer = 0;

/*
  ПОЛНОЭКРАННЫЙ РЕЖИМ.

  Высота мессенджера считается от шапки сайта, и её рост — не константа:
  президентская доска приезжает вместе с данными, телефон в альбоме
  переносит строку. Поэтому шапку меряем и следим за ней, а ответ кладём
  в --chat-head-h на контейнере — его читает refine.css. Без этого любая
  зашитая цифра то оставляла бы под шапкой щель, то уводила кнопку
  отправки под нижний край экрана.
*/
function fitFullscreen() {
  if (!host) return;
  const head = document.querySelector('.site-head');
  host.style.setProperty('--chat-head-h', `${head ? head.offsetHeight : 0}px`);
}

function watchHead() {
  headWatch?.disconnect();
  fitFullscreen();
  const head = document.querySelector('.site-head');
  if (head && typeof ResizeObserver !== 'undefined') {
    headWatch = new ResizeObserver(fitFullscreen);
    headWatch.observe(head);
  }
}

/* ── Отрисовка ──────────────────────────────────────────────────────────── */

/**
 * Снять то, что человек набрал, но ещё не отправил. Живёт до перерисовки:
 * лента обновляется опросом, и без этого набранный текст исчезал бы на
 * ровном месте — посреди написания длинного сообщения.
 */
function captureDrafts() {
  if (!host) return;
  const input = host.querySelector('[data-chat-input]');
  if (input) draft = input.value;

  const create = host.querySelector('[data-chat-create]');
  if (create) {
    state.createDraft = {
      title: create.elements.title?.value ?? '',
      allianceTag: create.elements.allianceTag?.value ?? '',
      topic: create.elements.topic?.value ?? '',
      kind: create.elements.kind?.value ?? 'alliance',
    };
  }

  const settings = host.querySelector('[data-chat-settings-form]');
  if (settings) {
    state.settingsDraft = {
      title: settings.elements.title?.value ?? '',
      allianceTag: settings.elements.allianceTag?.value ?? '',
      topic: settings.elements.topic?.value ?? '',
    };
  }

  const search = host.querySelector('[data-chat-search-input]');
  if (search) state.searchQ = search.value;
}

/** Вернуть набранное после перерисовки. */
function restoreDrafts() {
  if (!host) return;
  const input = host.querySelector('[data-chat-input]');
  if (input && draft) { input.value = draft; autosize(input); }

  const settings = host.querySelector('[data-chat-settings-form]');
  const sd = state.settingsDraft;
  if (settings && sd) {
    if (settings.elements.title) settings.elements.title.value = sd.title;
    if (settings.elements.allianceTag) settings.elements.allianceTag.value = sd.allianceTag;
    if (settings.elements.topic) settings.elements.topic.value = sd.topic;
  }
}

function paint({ stick = false } = {}) {
  if (!host) return;
  captureDrafts();

  const scroll = host.querySelector('[data-chat-scroll]');
  const atBottom = scroll ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80 : true;
  const prevHeight = scroll?.scrollHeight ?? 0;
  const prevTop = scroll?.scrollTop ?? 0;

  host.innerHTML = renderChats(state);
  restoreDrafts();

  const nextScroll = host.querySelector('[data-chat-scroll]');
  if (nextScroll) {
    if (stick || atBottom) nextScroll.scrollTop = nextScroll.scrollHeight;
    else nextScroll.scrollTop = prevTop + (nextScroll.scrollHeight - prevHeight);
  }
  updateBottomButton();
  restoreHighlight();
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

/**
 * Вопрос к человеку — своим окном.
 *
 * Системные confirm и prompt рисует операционная система: на телефоне это
 * серый ящик с чужими кнопками, на компьютере — окно из другого приложения,
 * и в обоих случаях страница на мгновение перестаёт быть собой. Здесь вместо
 * них то же окно, что у форума (.forum-modal), — см. renderDialog в
 * src/pages/chats.js.
 *
 * Действие не выполняется сразу: окно только запоминает, о чём спросили,
 * а выполняет ответ — runDialog ниже.
 */
function ask(question) {
  state.dialog = question;
  paint();
}

async function runDialog(form) {
  const d = state.dialog;
  if (!d) return;
  const reason = String(form?.elements?.reason?.value ?? '').trim();
  const chatId = state.openId;
  state.dialog = null;
  paint();

  try {
    if (d.action === 'delete-chat') {
      await forum.adminDeleteChat(chatId);
      await loadList();
      location.hash = '#/chats';
    } else if (d.action === 'leave') {
      await forum.leaveChat(chatId);
      await loadList();
      location.hash = '#/chats';
    } else if (d.action === 'close-chat') {
      await forum.updateChat(chatId, { closed: true, closedReason: reason });
      await loadList();
      await openChat(chatId);
    } else if (d.action === 'kick') {
      await forum.kickChatMember(chatId, d.targetId);
      state.members = await forum.listChatMembers(chatId);
      await loadList();
      paint();
    } else if (d.action === 'delete-message') {
      const m = state.messages.find((x) => x.id === d.targetId);
      await forum.deleteChatMessage(d.targetId, reason);
      if (m) {
        m.deleted = true;
        m.deletedReason = reason;
        m.pinned = false;
        m.attachments = [];
      }
      paint();
    }
  } catch (err) {
    notice(String(err?.message ?? err));
    paint();
  }
}

function notice(text) {
  document.querySelector('.forum-toast')?.remove();
  const t = document.createElement('div');
  t.className = 'forum-toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
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

async function openChat(id, { targetMessage = null } = {}) {
  const my = token;
  state.openId = id;
  state.open = state.chats.find((c) => c.id === id) ?? null;
  state.messages = [];
  state.members = [];
  state.membersOpen = false;
  state.inviteOpen = false;
  state.menuOpen = false;
  state.settingsOpen = false;
  state.pinsOpen = false;
  state.searchOpen = false;
  state.searchResults = null;
  state.searchQ = '';
  state.msgMenu = null;
  state.reactFor = null;
  state.lightbox = null;
  state.dialog = null;
  state.replyTo = null;
  state.hasMore = false;
  state.loading = true;
  draft = '';

  paint({ stick: true });

  try {
    const [chat, messages] = await Promise.all([forum.getChat(id), forum.listChatMessages(id, { limit: 60 })]);
    if (my !== token) return;
    if (!chat) {
      state.open = null;
      state.error = 'Вы не участник этого чата или его больше нет.';
    } else {
      state.open = chat;
      state.messages = messages;
      state.hasMore = messages.length >= 60;
      state.error = '';
      /*
        ГРАНИЦА «НОВЫХ». Считаем её ДО отметки о прочтении: chat.unread — это
        сколько сообщений человек не видел, а последние `unread` в ленте — ровно
        они. Отметим прочитанным раньше — и полоска «Новые сообщения» исчезнет
        прежде, чем её увидят.
      */
      const unread = Math.max(0, Math.min(Number(chat.unread) || 0, messages.length));
      state.newFromId = unread ? messages[messages.length - unread].id : null;
      forum.markChatRead(id).then(() => {
        const c = state.chats.find((x) => x.id === id);
        if (c) c.unread = 0;
      });
    }
  } catch (err) {
    if (my !== token) return;
    state.error = String(err?.message ?? err);
  }
  state.loading = false;

  if (targetMessage) await jumpToMessage(targetMessage, { walkBack: true });
  paint({ stick: !targetMessage });
}

/**
 * Переход к сообщению по ссылке #/chats/<id>/m/<mid>.
 *
 * Сообщение может быть далеко в истории: в ленте его нет, и «перейти» тогда
 * означает подгружать страницы назад, пока не найдётся. Ограничение в пять
 * страниц — не жадность: ссылка может быть на сообщение годичной давности,
 * и качать всю переписку ради одного перехода нельзя. Не нашли — честно
 * говорим об этом.
 */
async function jumpToMessage(messageId, { walkBack = false } = {}) {
  let found = state.messages.find((m) => m.id === messageId);
  let pages = 0;

  while (!found && walkBack && pages < 5 && state.messages.length) {
    const oldest = state.messages[0]?.createdAt;
    if (!oldest) break;
    const older = await forum.listChatMessages(state.openId, { limit: 60, before: oldest }).catch(() => []);
    if (!older.length) break;
    state.messages = [...older, ...state.messages];
    state.hasMore = older.length >= 60;
    pages += 1;
    found = state.messages.find((m) => m.id === messageId);
  }

  if (!found) {
    notice('Сообщение не нашлось — возможно, его удалили');
    return;
  }
  state.highlight = messageId;
}

/** Подсветка найденного сообщения и прокрутка к нему. */
function restoreHighlight() {
  if (!host || !state.highlight) return;
  const el = host.querySelector(`#m-${cssEsc(state.highlight)}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('is-flash');

  const mine = state.highlight;
  state.highlight = null;
  setTimeout(() => host?.querySelector(`#m-${cssEsc(mine)}`)?.classList.remove('is-flash'), 2200);
}

/** Только новые сообщения и «пишет…» — с последнего, что у нас есть. */
async function tick() {
  if (!host || !state.openId || document.hidden) return;
  const my = token;
  const id = state.openId;

  try {
    const [fresh, typing] = await Promise.all([
      forum.listChatMessages(id, { limit: 60 }),
      forum.listChatTyping(id),
    ]);
    if (my !== token || id !== state.openId) return;

    const known = new Set(state.messages.map((m) => m.id));
    const added = fresh.filter((m) => !known.has(m.id));
    // Удалённые модерацией — обновляем на месте.
    const byId = new Map(fresh.map((m) => [m.id, m]));
    let changed = false;
    state.messages = state.messages.map((m) => {
      const f = byId.get(m.id);
      if (!f) return m;
      const same = f.deleted === m.deleted
        && JSON.stringify(f.reactions) === JSON.stringify(m.reactions)
        && f.pinned === m.pinned;
      if (!same) { changed = true; return f; }
      return m;
    });

    const typingChanged = JSON.stringify(typing) !== JSON.stringify(state.typing);
    state.typing = typing;

    if (added.length) {
      state.messages = [...state.messages, ...added].sort((a, b) => a.createdAt - b.createdAt);
      const fromOthers = added.some((m) => m.authorId !== state.me?.id);
      if (fromOthers) {
        const scroll = host.querySelector('[data-chat-scroll]');
        const atBottom = scroll ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90 : true;
        if (atBottom) forum.markChatRead(id).catch(() => {});
        else state.newCount += added.length;
      }
      paint({ stick: true });
      return;
    }

    if (changed || typingChanged) paint();
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
    paint();
  }, POLL_MS_LIST);
}

function stopPolling() {
  window.clearInterval(timer);
  window.clearInterval(listTimer);
  timer = 0;
  listTimer = 0;
}

/* ── Вложения ───────────────────────────────────────────────────────────── */

function loadEmojiRecent() {
  try {
    const raw = localStorage.getItem(EMOJI_KEY);
    const list = raw ? JSON.parse(raw) : [];
    state.emojiRecent = Array.isArray(list) ? list.slice(0, 12) : [];
  } catch {
    state.emojiRecent = [];
  }
}

function rememberEmoji(emoji) {
  state.emojiRecent = [emoji, ...state.emojiRecent.filter((e) => e !== emoji)].slice(0, 12);
  try {
    localStorage.setItem(EMOJI_KEY, JSON.stringify(state.emojiRecent));
  } catch {
    /* приватный режим — не беда, список просто не запомнится */
  }
}

/** Сколько вложений уже в очереди и годится ли ещё одно. */
function queueRoom() {
  return CHAT_LIMITS.attachmentsMax - state.queue.length;
}

/**
 * Добавить файлы в очередь. Ошибка одного файла не отменяет остальные:
 * человек выбрал пять скриншотов, и из-за одного слишком большого терять
 * четыре — обидно. Поэтому отказ показывается карточкой с причиной, а
 * остальные грузятся.
 */
function addFiles(files) {
  if (!state.openId) return;
  const list = [...files];
  if (!list.length) return;

  if (queueRoom() <= 0) {
    notice(`К одному сообщению можно приложить не больше ${CHAT_LIMITS.attachmentsMax} файлов`);
    return;
  }

  const room = queueRoom();
  for (const file of list.slice(0, room)) {
    const check = checkFile(file);
    const item = {
      id: `q${++queueSeq}`,
      file,
      kind: check.ok ? check.kind : kindOfFile(file),
      name: nameOf(file),
      size: file.size,
      preview: file.type?.startsWith('image/') ? URL.createObjectURL(file) : '',
      status: check.ok ? 'wait' : 'error',
      progress: 0,
      error: check.ok ? '' : check.error,
      draft: null,
      promise: null,
    };
    state.queue.push(item);
    if (check.ok) startUpload(item);
  }
  const dropped = list.length - Math.min(room, list.length);
  if (dropped > 0) {
    notice(`Взяли первые ${room} файлов — к одному сообщению можно не больше ${CHAT_LIMITS.attachmentsMax}`);
  }
  paint();
}

/** Загрузка вложения. Ход обновляет только свою карточку — см. paintQueueItem. */
function startUpload(item) {
  item.status = 'up';
  const chatId = state.openId;
  item.promise = forum.uploadChatFile(chatId, item.file, {
    onProgress: (part) => {
      item.progress = part;
      paintQueueItem(item);
    },
  })
    .then((draft) => {
      if (chatId !== state.openId) return;
      item.draft = draft;
      item.status = 'done';
      item.progress = 1;
      paintQueueItem(item);
      paint();
    })
    .catch((err) => {
      if (chatId !== state.openId) return;
      item.status = 'error';
      item.error = String(err?.message ?? err);
      paintQueueItem(item);
      paint();
    });
  return item.promise;
}

/**
 * Точечное обновление карточки вложения.
 *
 * Не paint(): он перерисовывает страницу целиком, и на каждые несколько
 * процентов загрузки это стоило бы секунды работы браузера и сброшенного
 * фокуса в поле ввода.
 */
function paintQueueItem(item) {
  const box = host?.querySelector(`[data-chat-drop="${item.id}"]`);
  if (!box) return;
  box.classList.toggle('is-error', item.status === 'error');
  const meta = box.querySelector('.chat-drop__meta');
  if (meta) {
    meta.textContent = item.status === 'error'
      ? item.error
      : item.status === 'done'
        ? `${formatBytes(item.size)} · готово`
        : `${formatBytes(item.size)} · ${Math.round((item.progress ?? 0) * 100)}%`;
  }
  const bar = box.querySelector('.chat-drop__bar i');
  if (bar) bar.style.width = `${Math.round((item.progress ?? 0) * 100)}%`;
}

function dropQueueItem(id) {
  const at = state.queue.findIndex((q) => q.id === id);
  if (at < 0) return;
  const [item] = state.queue.splice(at, 1);
  if (item.preview) URL.revokeObjectURL(item.preview);
  paint();
}

function clearQueue() {
  for (const item of state.queue) {
    if (item.preview) URL.revokeObjectURL(item.preview);
  }
  state.queue = [];
}

/* ── Отправка ───────────────────────────────────────────────────────────── */

async function send(form) {
  const input = form.querySelector('[data-chat-input]');
  const body = String(input?.value ?? '').trim();
  if (state.sending || !state.openId) return;

  // Дожидаемся загрузок: отправлять сообщение со ссылкой на ещё не доехавший
  // файл нельзя, а заставлять человека ждать кнопкой «отправка…» — хуже,
  // чем подождать здесь.
  await Promise.all(state.queue.map((q) => q.promise).filter(Boolean));

  const ready = state.queue.filter((q) => q.status === 'done' && q.draft);
  const broken = state.queue.filter((q) => q.status === 'error');
  if (!body && !ready.length) {
    if (broken.length) notice('Вложение не загрузилось — уберите его или попробуйте снова');
    return;
  }

  state.sending = true;
  const id = state.openId;
  const replyToId = state.replyTo?.id ?? null;

  try {
    const m = await forum.sendChatMessage(id, body, {
      replyToId,
      attachments: ready.map((q) => q.draft),
    });
    if (id !== state.openId) return;
    state.messages.push(m);
    draft = '';
    state.replyTo = null;
    state.emojiOpen = false;
    clearQueue();
    if (input) { input.value = ''; autosize(input); }
    const c = state.chats.find((x) => x.id === id);
    if (c) { c.lastBody = body; c.lastNick = state.me.nick; c.lastAt = m.createdAt; c.lastKind = m.attachments?.[0]?.kind ?? ''; }
  } catch (err) {
    notice(String(err?.message ?? err));
  } finally {
    state.sending = false;
    paint({ stick: true });
    host?.querySelector('[data-chat-input]')?.focus({ preventScroll: true });
  }
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

/* ── Реакции и закрепления ──────────────────────────────────────────────── */

/**
 * Реакция на сообщение: сразу меняем у себя, потом говорим базе.
 *
 * Так реакция ощущается мгновенной, а при отказе (нет прав, нет сети) мы
 * возвращаем всё как было и говорим причину. Обратный порядок — «нажал,
 * ждём базу, потом показываем» — на мобильной сети ощущается как «кнопка
 * не работает».
 */
function applyReactionLocal(message, emoji) {
  const me = state.me;
  const list = message.reactions ?? (message.reactions = []);
  const at = list.findIndex((r) => r.emoji === emoji);
  if (at < 0) {
    list.push({ emoji, count: 1, mine: true, nicks: [me.nick] });
    return;
  }
  const r = list[at];
  if (r.mine) {
    r.count -= 1;
    r.mine = false;
    r.nicks = r.nicks.filter((n) => n !== me.nick);
    if (r.count <= 0) list.splice(at, 1);
  } else {
    r.count += 1;
    r.mine = true;
    if (!r.nicks.includes(me.nick)) r.nicks.push(me.nick);
  }
}

async function react(messageId, emoji) {
  const m = state.messages.find((x) => x.id === messageId);
  if (!m) return;
  applyReactionLocal(m, emoji);
  state.reactFor = null;
  paint();
  try {
    await forum.toggleChatReaction(messageId, emoji);
  } catch (err) {
    applyReactionLocal(m, emoji);
    paint();
    notice(String(err?.message ?? err));
  }
}

async function togglePin(messageId, on) {
  try {
    await forum.pinChatMessage(messageId, on);
    const m = state.messages.find((x) => x.id === messageId);
    if (m) m.pinned = on;
    if (state.open) {
      state.open.pinnedCount = Math.max(0, (state.open.pinnedCount ?? 0) + (on ? 1 : -1));
    }
    if (state.pinsOpen) state.pins = await forum.listChatPinned(state.openId).catch(() => []);
    else state.pins = state.pins.filter((p) => p.id !== messageId);
    notice(on ? 'Закреплено' : 'Откреплено');
  } catch (err) {
    notice(String(err?.message ?? err));
  }
  paint();
}

/* ── Поиск ──────────────────────────────────────────────────────────────── */

async function runSearch(query) {
  const q = String(query ?? '').trim();
  state.searchQ = q;
  state.searchResults = null;
  if (q.length < 2) {
    state.searchBusy = false;
    paint();
    return;
  }
  state.searchBusy = true;
  paint();
  const my = token;
  const id = state.openId;
  try {
    const found = await forum.searchChatMessages(id, q, { limit: CHAT_LIMITS.searchLimit });
    if (my !== token || id !== state.openId) return;
    state.searchResults = found;
  } catch (err) {
    if (my !== token) return;
    state.searchResults = [];
    notice(String(err?.message ?? err));
  }
  state.searchBusy = false;
  paint();
}

/* ── «Пишет…» ───────────────────────────────────────────────────────────── */

function pingTyping() {
  if (!state.openId) return;
  const now = Date.now();
  if (now - typeSentAt < CHAT_LIMITS.typingEveryMs) return;
  typeSentAt = now;
  forum.touchChatTyping(state.openId).catch(() => {});
}

/* ── Голосовые сообщения ────────────────────────────────────────────────── */

async function startVoice() {
  if (state.recording || !state.openId) return;
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    notice('Браузер не умеет записывать звук');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    notice('Без доступа к микрофону записать не получится');
    return;
  }

  const recorder = new MediaRecorder(stream);
  const chunks = [];
  const rec = { startedAt: Date.now(), recorder, stream, cancelled: false };
  state.recording = rec;

  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    stopRecTimer();
    state.recording = null;
    const ms = Date.now() - rec.startedAt;

    if (rec.cancelled) { paint(); return; }
    if (ms < CHAT_LIMITS.voice.minMs) {
      paint();
      notice('Слишком коротко — получилось не сообщение, а шум');
      return;
    }

    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    const item = {
      id: `q${++queueSeq}`,
      file: new File([blob], `voice-${Date.now().toString(36)}.webm`, { type: blob.type }),
      kind: 'audio',
      name: `Голосовое · ${Math.round(ms / 1000)} с`,
      size: blob.size,
      preview: '',
      status: 'wait',
      progress: 0,
      error: '',
      draft: null,
      promise: null,
    };
    state.queue.push(item);
    /*
      Голосовое уходит сразу, без кнопки «отправить»: подписи у него не
      бывает, а держать запись в очереди — это лишнее нажатие на ровном месте.
    */
    startUpload(item)?.then(() => {
      const form = host?.querySelector('[data-chat-send]');
      if (form && item.status === 'done') form.requestSubmit?.();
    });
    paint();
  };

  recorder.start();
  paint();
  startRecTimer();
}

/** Остановка записи. send=false — отмена: файл никуда не уходит. */
function stopVoice({ send = true } = {}) {
  const rec = state.recording;
  if (!rec) return;
  rec.cancelled = !send;
  try {
    rec.recorder.stop();
  } catch {
    stopRecTimer();
    state.recording = null;
    paint();
  }
}

function startRecTimer() {
  recTimer = window.setInterval(() => {
    const el = host?.querySelector('[data-chat-rec-time]');
    if (!el || !state.recording) return;
    const sec = Math.floor((Date.now() - state.recording.startedAt) / 1000);
    el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    if (Date.now() - state.recording.startedAt > CHAT_LIMITS.voice.maxMs) stopVoice({ send: true });
  }, 250);
}

function stopRecTimer() {
  window.clearInterval(recTimer);
  recTimer = 0;
}

/* ── Прокрутка ──────────────────────────────────────────────────────────── */

function updateBottomButton() {
  const btn = host?.querySelector('[data-chat-bottom]');
  const scroll = host?.querySelector('[data-chat-scroll]');
  if (!btn || !scroll) return;
  const away = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 220;
  btn.hidden = !away;
  const label = btn.querySelector('[data-chat-bottom-label]');
  if (label) label.textContent = state.newCount ? `${state.newCount} новых` : 'Вниз';
  btn.classList.toggle('is-fresh', state.newCount > 0);
}

function scrollToBottom() {
  const scroll = host?.querySelector('[data-chat-scroll]');
  if (!scroll) return;
  state.newCount = 0;
  scroll.scrollTop = scroll.scrollHeight;
  if (state.openId) forum.markChatRead(state.openId).catch(() => {});
  updateBottomButton();
}

function cssEsc(v) {
  return String(v).replace(/["\\]/g, '\\$&');
}

/* ── Обработчики ────────────────────────────────────────────────────────── */

function wire() {
  if (wired) return;
  wired = true;

  document.addEventListener('submit', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const form = e.target;

    if (form.matches('[data-chat-dialog-form]')) {
      e.preventDefault();
      runDialog(form);
      return;
    }

    if (form.matches('[data-chat-send]')) {
      e.preventDefault();
      send(form);
      return;
    }

    if (form.matches('[data-chat-search-form]')) {
      e.preventDefault();
      runSearch(form.elements.q?.value ?? '');
      return;
    }

    if (form.matches('[data-chat-settings-form]')) {
      e.preventDefault();
      if (!state.openId) return;
      const btn = form.querySelector('button[type="submit"]');
      await withBusy(btn, 'Сохраняем…', async () => {
        await forum.updateChat(state.openId, {
          title: String(form.elements.title?.value ?? '').trim(),
          allianceTag: String(form.elements.allianceTag?.value ?? '').trim(),
          topic: String(form.elements.topic?.value ?? '').trim(),
        });
        state.settingsDraft = null;
        state.settingsOpen = false;
        await loadList();
        state.open = state.chats.find((c) => c.id === state.openId) ?? state.open;
        paint();
        notice('Настройки сохранены');
      });
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
        const topic = String(form.elements.topic?.value ?? '').trim();
        if (topic) await forum.updateChat(chat.id, { topic });
        state.createOpen = false;
        state.createDraft = null;
        await loadList();
        location.hash = `#/chats/${chat.id}`;
      });
    }
  });

  document.addEventListener('click', async (e) => {
    if (!host || !e.target.closest) return;
    const t = e.target;

    /*
      Открытые меню закрываются кликом мимо них. Точечно, без перерисовки:
      клик мог прийтись по полю ввода, и полная перерисовка отняла бы у него
      фокус посреди нажатия.
    */
    const insideMenus = t.closest('[data-chat-menu], .chat-msg__pop, .chat-react-picker, [data-chat-pins], [data-chat-search], [data-chat-settings], [data-chat-members], [data-chat-invite-panel]');
    const isMenuToggle = t.closest('[data-chat-menu-toggle], [data-chat-msg-menu], [data-chat-msg-react]');
    if (!insideMenus && !isMenuToggle && (state.menuOpen || state.msgMenu || state.reactFor)) {
      state.menuOpen = false;
      state.msgMenu = null;
      state.reactFor = null;
      /*
        Убираем всплывающие меню точечно, а не перерисовкой: клик мог прийтись
        по полю ввода, и полная перерисовка отняла бы у него фокус посреди
        нажатия. Обработчик ниже продолжает работать — нажатие не пропадает.
      */
      host.querySelector('.chat-menu__pop')?.remove();
      host.querySelector('.chat-msg__pop')?.remove();
      host.querySelector('.chat-react-picker')?.remove();
      host.querySelectorAll('[aria-expanded="true"]').forEach((el) => {
        if (el.hasAttribute('data-chat-msg-menu') || el.hasAttribute('data-chat-msg-react')
          || el.hasAttribute('data-chat-menu-toggle')) {
          el.setAttribute('aria-expanded', 'false');
        }
      });
    }
    if (!host.contains(t)) return;

    /* Вложения. */
    if (t.closest('[data-chat-dialog-cancel]') || t.matches?.('[data-chat-dialog]')) {
      state.dialog = null;
      paint();
      return;
    }

    if (t.closest('[data-chat-queue-drop]')) {
      dropQueueItem(t.closest('[data-chat-queue-drop]').dataset.chatQueueDrop);
      return;
    }
    if (t.closest('[data-chat-voice]')) {
      startVoice();
      return;
    }
    if (t.closest('[data-chat-rec-send]')) {
      stopVoice({ send: true });
      return;
    }
    if (t.closest('[data-chat-rec-cancel]')) {
      stopVoice({ send: false });
      return;
    }
    if (t.closest('[data-chat-emoji-toggle]')) {
      state.emojiOpen = !state.emojiOpen;
      paint();
      return;
    }
    const emoji = t.closest('[data-chat-emoji]');
    if (emoji) {
      const input = host.querySelector('[data-chat-input]');
      if (input) {
        const at = input.selectionStart ?? input.value.length;
        input.value = `${input.value.slice(0, at)}${emoji.dataset.chatEmoji}${input.value.slice(input.selectionEnd ?? at)}`;
        input.focus();
        autosize(input);
        draft = input.value;
      }
      rememberEmoji(emoji.dataset.chatEmoji);
      paint();
      return;
    }

    /* Ответ на сообщение. */
    const replyBtn = t.closest('[data-chat-msg-reply]');
    if (replyBtn) {
      const m = state.messages.find((x) => x.id === replyBtn.dataset.chatMsgReply);
      state.replyTo = m ?? null;
      state.msgMenu = null;
      paint();
      host.querySelector('[data-chat-input]')?.focus({ preventScroll: true });
      return;
    }
    if (t.closest('[data-chat-reply-cancel]')) {
      state.replyTo = null;
      paint();
      return;
    }

    /* Реакции. */
    const reactBtn = t.closest('[data-chat-reaction]');
    if (reactBtn) {
      await react(reactBtn.dataset.chatReaction, reactBtn.dataset.emoji);
      return;
    }
    const reactFor = t.closest('[data-chat-msg-react]');
    if (reactFor) {
      state.reactFor = state.reactFor === reactFor.dataset.chatMsgReact ? null : reactFor.dataset.chatMsgReact;
      state.msgMenu = null;
      paint();
      return;
    }

    /* Меню действий сообщения. */
    const msgMenu = t.closest('[data-chat-msg-menu]');
    if (msgMenu) {
      state.msgMenu = state.msgMenu === msgMenu.dataset.chatMsgMenu ? null : msgMenu.dataset.chatMsgMenu;
      state.reactFor = null;
      paint();
      return;
    }
    const pin = t.closest('[data-chat-pin]');
    if (pin) {
      state.msgMenu = null;
      await togglePin(pin.dataset.chatPin, pin.dataset.pin === 'on');
      return;
    }
    const pinOff = t.closest('[data-chat-pin-off]');
    if (pinOff) {
      await togglePin(pinOff.dataset.chatPinOff, false);
      return;
    }
    const copyText = t.closest('[data-chat-copy-text]');
    if (copyText) {
      const m = state.messages.find((x) => x.id === copyText.dataset.chatCopyText);
      state.msgMenu = null;
      try {
        await navigator.clipboard.writeText(textOf(m?.body ?? ''));
        notice('Текст скопирован');
      } catch {
        notice('Браузер не дал скопировать');
      }
      paint();
      return;
    }

    /* Переход к сообщению (цитата, закреплённое, результат поиска). */
    const jump = t.closest('[data-chat-jump]');
    if (jump) {
      state.pinsOpen = false;
      state.searchOpen = false;
      await jumpToMessage(jump.dataset.chatJump);
      paint();
      return;
    }

    /* Просмотр картинок. */
    const shot = t.closest('[data-chat-shot]');
    if (shot) {
      const [msgId, idx] = shot.dataset.chatShot.split(':');
      const m = state.messages.find((x) => x.id === msgId);
      const items = (m?.attachments ?? []).filter((a) => a.kind === 'image' && a.url);
      if (items.length) state.lightbox = { items, index: Math.min(Number(idx) || 0, items.length - 1) };
      paint();
      return;
    }
    if (t.closest('[data-chat-lightbox-close]') || t.matches('[data-chat-lightbox]')) {
      state.lightbox = null;
      paint();
      return;
    }
    const step = t.closest('[data-chat-lightbox-step]');
    if (step && state.lightbox) {
      const next = state.lightbox.index + Number(step.dataset.chatLightboxStep);
      if (next >= 0 && next < state.lightbox.items.length) state.lightbox.index = next;
      paint();
      return;
    }

    /* Панели. */
    if (t.closest('[data-chat-pins-toggle]')) {
      state.pinsOpen = !state.pinsOpen;
      state.searchOpen = false;
      state.settingsOpen = false;
      state.membersOpen = false;
      state.menuOpen = false;
      if (state.pinsOpen) state.pins = await forum.listChatPinned(state.openId).catch(() => []);
      paint();
      return;
    }
    if (t.closest('[data-chat-search-toggle]')) {
      state.searchOpen = !state.searchOpen;
      state.pinsOpen = false;
      state.settingsOpen = false;
      state.membersOpen = false;
      state.menuOpen = false;
      paint();
      if (state.searchOpen) host.querySelector('[data-chat-search-input]')?.focus();
      return;
    }
    if (t.closest('[data-chat-settings-toggle]')) {
      state.settingsOpen = !state.settingsOpen;
      state.settingsDraft = null;
      state.pinsOpen = false;
      state.searchOpen = false;
      state.membersOpen = false;
      state.menuOpen = false;
      paint();
      return;
    }
    if (t.closest('[data-chat-filter]')) {
      state.listFilter = t.closest('[data-chat-filter]').dataset.chatFilter === 'unread' ? 'unread' : 'all';
      paint();
      return;
    }
    if (t.closest('[data-chat-bottom]')) {
      scrollToBottom();
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
      if (!state.createOpen) state.createDraft = null;
      paint();
      if (state.createOpen) host.querySelector('[data-chat-create] input[name="title"]')?.focus();
      return;
    }
    if (t.closest('[data-chat-members-toggle]')) {
      state.membersOpen = !state.membersOpen;
      state.inviteOpen = false;
      state.menuOpen = false;
      state.pinsOpen = false;
      state.searchOpen = false;
      state.settingsOpen = false;
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
      state.msgMenu = null;
      try {
        await navigator.clipboard.writeText(copy.dataset.chatCopy);
        notice('Ссылка скопирована');
      } catch {
        notice(`Код: ${state.open?.inviteCode ?? ''}`);
      }
      paint();
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
    const avatarClear = t.closest('[data-chat-avatar-clear]');
    if (avatarClear && state.openId) {
      await withBusy(avatarClear, '…', async () => {
        await forum.updateChat(state.openId, { avatarUrl: '' });
        if (state.open) state.open.avatarUrl = '';
        paint();
      });
      return;
    }
    const delChat = t.closest('[data-chat-delete]');
    if (delChat && state.openId) {
      ask({
        action: 'delete-chat',
        title: 'Удалить чат',
        text: 'Вместе с перепиской и файлами. Это необратимо: вернуть чат будет нечем.',
        ok: 'Удалить чат',
        danger: true,
      });
      return;
    }
    const leave = t.closest('[data-chat-leave]');
    if (leave && state.openId) {
      ask({
        action: 'leave',
        title: 'Выйти из чата',
        text: 'Вернуться можно будет только по коду приглашения.',
        ok: 'Выйти',
        danger: true,
      });
      return;
    }
    const close = t.closest('[data-chat-close]');
    if (close && state.openId) {
      ask({
        action: 'close-chat',
        title: 'Закрыть чат',
        text: 'Новые сообщения в нём писать будет нельзя — только читать. Причина останется у всех на виду.',
        ok: 'Закрыть чат',
        field: true,
        fieldLabel: 'Причина закрытия',
        placeholder: 'Например: сбор закончен, вернёмся в следующем сезоне',
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
      const userId = kick.dataset.chatMemberKick;
      const nick = state.members.find((m) => m.userId === userId)?.nick ?? '';
      ask({
        action: 'kick',
        targetId: userId,
        title: 'Выгнать из чата',
        text: nick
          ? `${nick} больше не увидит чат. Вернуться он сможет только по новому коду приглашения.`
          : 'Этот человек больше не увидит чат.',
        ok: 'Выгнать',
        danger: true,
      });
      return;
    }
    const del = t.closest('[data-chat-msg-delete]');
    if (del) {
      const id = del.dataset.chatMsgDelete;
      const m = state.messages.find((x) => x.id === id);
      const mine = m?.authorId === state.me?.id;
      state.msgMenu = null;
      /*
        Своё сообщение удаляется молча: автор и так знает, что он убрал.
        Чужое — только с причиной, и она останется в ленте у всех.
      */
      if (mine) {
        state.dialog = {
          action: 'delete-message',
          targetId: id,
          title: 'Удалить своё сообщение',
          text: 'Оно останется на месте с пометкой «удалено автором», а вложения исчезнут.',
          ok: 'Удалить',
          danger: true,
        };
        paint();
      } else {
        ask({
          action: 'delete-message',
          targetId: id,
          title: 'Удалить сообщение',
          text: 'Автор увидит причину — она останется в ленте рядом с пометкой.',
          ok: 'Удалить',
          danger: true,
          field: true,
          fieldLabel: 'Причина удаления',
          value: 'нарушение правил',
        });
      }
      return;
    }
    const more = t.closest('[data-chat-more]');
    if (more && state.openId) {
      await withBusy(more, 'Загружаем…', async () => {
        const oldest = state.messages[0]?.createdAt;
        const older = await forum.listChatMessages(state.openId, { limit: 60, before: oldest });
        state.messages = [...older, ...state.messages];
        state.hasMore = older.length >= 60;
        paint();
      });
    }
  });

  /* Поля выбора файлов и постановка вложений в очередь. */
  document.addEventListener('change', (e) => {
    if (!host || !host.contains(e.target)) return;
    const pick = e.target.closest('[data-chat-pick]');
    if (pick) {
      addFiles(pick.files ?? []);
      pick.value = '';
      return;
    }
    const avatarInput = e.target.closest('[data-chat-avatar-input]');
    if (avatarInput && state.openId && avatarInput.files?.[0]) {
      const file = avatarInput.files[0];
      avatarInput.value = '';
      forum.uploadChatAvatar(state.openId, file)
        .then((url) => { if (state.open) state.open.avatarUrl = url; paint(); notice('Картинка чата обновлена'); })
        .catch((err) => notice(String(err?.message ?? err)));
    }
  });

  document.addEventListener('input', (e) => {
    if (!host) return;
    if (e.target.matches?.('[data-chat-input]')) {
      autosize(e.target);
      draft = e.target.value;
      if (e.target.value.trim()) pingTyping();
    }
  });

  /* Вставка картинки из буфера: скриншот в чат — обычное дело. */
  document.addEventListener('paste', (e) => {
    if (!host || !host.contains(e.target)) return;
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    if (!e.target.matches?.('[data-chat-input]')) return;
    e.preventDefault();
    addFiles(files);
  });

  /* Перетаскивание файлов в окно чата. */
  document.addEventListener('dragover', (e) => {
    if (!host || !host.contains(e.target) || !state.openId) return;
    e.preventDefault();
    host.querySelector('.chat-room')?.classList.add('is-dropping');
  });
  document.addEventListener('dragleave', (e) => {
    if (!host) return;
    if (e.target === host.querySelector('.chat-room')) {
      host.querySelector('.chat-room')?.classList.remove('is-dropping');
    }
  });
  document.addEventListener('drop', (e) => {
    if (!host || !host.contains(e.target)) return;
    host.querySelector('.chat-room')?.classList.remove('is-dropping');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });

  /* Прокрутка: показать кнопку «вниз» и отметить прочитанным. */
  document.addEventListener('scroll', (e) => {
    if (!host || e.target !== host.querySelector('[data-chat-scroll]')) return;
    updateBottomButton();
    if (state.newCount) {
      const scroll = e.target;
      if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90) {
        state.newCount = 0;
        if (state.openId) forum.markChatRead(state.openId).catch(() => {});
        updateBottomButton();
      }
    }
  }, true);

  // Enter — отправить, Shift+Enter — перенос. Как в любом мессенджере;
  // на телефоне Enter в textarea остаётся переносом (там есть кнопка).
  // Escape закрывает то, что открыто поверх ленты.
  document.addEventListener('keydown', (e) => {
    if (!host) return;

    if (e.key === 'Escape') {
      if (state.lightbox) { state.lightbox = null; paint(); return; }
      if (state.menuOpen || state.msgMenu || state.reactFor || state.emojiOpen) {
        state.menuOpen = false;
        state.msgMenu = null;
        state.reactFor = null;
        state.emojiOpen = false;
        paint();
        return;
      }
    }

    if (state.lightbox && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const next = state.lightbox.index + (e.key === 'ArrowRight' ? 1 : -1);
      if (next >= 0 && next < state.lightbox.items.length) {
        state.lightbox.index = next;
        paint();
      }
      return;
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
}

/* ── Входы ──────────────────────────────────────────────────────────────── */

/**
 * @param {HTMLElement} container
 * @param {string|null} param  id чата, «join/<код>» или «<id>/m/<сообщение>».
 */
export async function mountChats(container, param = null) {
  host = container;
  token++;
  wire();
  initSelects();
  loadEmojiRecent();
  watchHead();

  state.loading = true;
  state.error = '';
  state.queue = [];
  state.replyTo = null;
  state.msgMenu = null;
  state.reactFor = null;
  state.lightbox = null;
  state.typing = [];
  state.newFromId = null;
  state.newCount = 0;
  state.recording = null;
  paint();

  try {
    state.ready = await forum.isReady();
  } catch (err) {
    state.ready = false;
    state.error = String(err?.message ?? err);
    state.loading = false;
    paint();
    return;
  }
  if (!state.ready) { state.loading = false; paint(); return; }

  try {
    state.me = await forum.currentUser();
  } catch {
    state.me = null;
  }
  if (!state.me) { state.loading = false; paint(); return; }

  // Ссылка-приглашение: #/chats/join/<code>.
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

  /* Ссылка на сообщение: #/chats/<id>/m/<mid> — переход внутри чата. */
  const [chatId, marker, messageId] = String(param ?? '').split('/');

  if (chatId) {
    await openChat(chatId, { targetMessage: marker === 'm' && messageId ? messageId : null });
  } else {
    state.openId = null;
    state.open = null;
    state.messages = [];
    paint();
  }
  startPolling();
}

export function unmountChats() {
  host = null;
  token++;
  stopPolling();
  stopRecTimer();
  headWatch?.disconnect();
  headWatch = null;
  clearQueue();
  state.openId = null;
  state.open = null;
  state.messages = [];
  state.members = [];
  state.membersOpen = false;
  state.inviteOpen = false;
  state.menuOpen = false;
  state.createOpen = false;
  state.settingsOpen = false;
  state.pinsOpen = false;
  state.searchOpen = false;
  state.msgMenu = null;
  state.reactFor = null;
  state.lightbox = null;
  state.typing = [];
  state.replyTo = null;
  state.recording = null;
  state.newFromId = null;
  state.newCount = 0;
  state.dialog = null;
  draft = '';
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
