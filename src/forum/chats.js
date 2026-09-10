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
 */
import { forum } from './index.js';
import { renderChats } from '../pages/chats.js';

const POLL_MS = 4000;
const POLL_MS_LIST = 15000;

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
  hasMore: false,
  sending: false,
};

let host = null;
let wired = false;
let token = 0;
let timer = 0;
let listTimer = 0;
let draft = '';
let headWatch = null;

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

function paint({ stick = false } = {}) {
  if (!host) return;
  const scroll = host.querySelector('[data-chat-scroll]');
  const input = host.querySelector('[data-chat-input]');
  if (input) draft = input.value;
  const atBottom = scroll ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80 : true;
  const prevHeight = scroll?.scrollHeight ?? 0;
  const prevTop = scroll?.scrollTop ?? 0;

  host.innerHTML = renderChats(state);

  const nextInput = host.querySelector('[data-chat-input]');
  if (nextInput && draft) { nextInput.value = draft; autosize(nextInput); }
  const nextScroll = host.querySelector('[data-chat-scroll]');
  if (nextScroll) {
    if (stick || atBottom) nextScroll.scrollTop = nextScroll.scrollHeight;
    else nextScroll.scrollTop = prevTop + (nextScroll.scrollHeight - prevHeight);
  }
}

function autosize(el) {
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
      forum.markChatRead(id).then(() => {
        const c = state.chats.find((x) => x.id === id);
        if (c) c.unread = 0;
        paint();
      });
    }
  } catch (err) {
    if (my !== token) return;
    state.error = String(err?.message ?? err);
  }
  state.loading = false;
  paint({ stick: true });
}

/** Только новые сообщения — с даты последнего у нас. */
async function tick() {
  if (!host || !state.openId || document.hidden) return;
  const my = token;
  const id = state.openId;
  const last = state.messages[state.messages.length - 1];
  try {
    const fresh = await forum.listChatMessages(id, { limit: 60 });
    if (my !== token || id !== state.openId) return;
    const known = new Set(state.messages.map((m) => m.id));
    const added = fresh.filter((m) => !known.has(m.id));
    // Удалённые модерацией — обновляем на месте.
    const byId = new Map(fresh.map((m) => [m.id, m]));
    let changed = added.length > 0;
    state.messages = state.messages.map((m) => {
      const f = byId.get(m.id);
      if (f && f.deleted !== m.deleted) { changed = true; return f; }
      return m;
    });
    if (added.length) {
      state.messages = [...state.messages, ...added].sort((a, b) => a.createdAt - b.createdAt);
      if (added.some((m) => m.authorId !== state.me?.id)) forum.markChatRead(id).catch(() => {});
    }
    if (changed) paint();
    void last;
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

/* ── Действия ───────────────────────────────────────────────────────────── */

async function send(form) {
  const input = form.querySelector('[data-chat-input]');
  const body = String(input?.value ?? '').trim();
  if (!body || state.sending || !state.openId) return;
  state.sending = true;
  const id = state.openId;
  try {
    const m = await forum.sendChatMessage(id, body);
    if (id !== state.openId) return;
    state.messages.push(m);
    draft = '';
    if (input) { input.value = ''; autosize(input); }
    const c = state.chats.find((x) => x.id === id);
    if (c) { c.lastBody = body; c.lastNick = state.me.nick; c.lastAt = m.createdAt; }
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
  });

  document.addEventListener('click', async (e) => {
    if (!host || !e.target.closest) return;
    const t = e.target;

    /*
      Меню ⋯ закрывается кликом мимо него — по всему окну, не только
      по полю чата: открытое меню не должно переживать уход внимания.
      Меню убираем из DOM точечно, без перерисовки страницы: клик мог
      прийтись по полю ввода или по другому чату в списке, и полная
      перерисовка отняла бы у них фокус и переход посреди нажатия.
    */
    if (state.menuOpen && !t.closest('[data-chat-menu]')) {
      state.menuOpen = false;
      host.querySelector('.chat-menu__pop')?.remove();
      host.querySelector('[data-chat-menu-toggle]')?.setAttribute('aria-expanded', 'false');
    }
    if (!host.contains(t)) return;

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
        paint();
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
        paint();
      });
    }
  });

  document.addEventListener('input', (e) => {
    if (host && e.target.matches?.('[data-chat-input]')) autosize(e.target);
  });

  // Enter — отправить, Shift+Enter — перенос. Как в любом мессенджере;
  // на телефоне Enter в textarea остаётся переносом (там есть кнопка).
  // Esc закрывает меню ⋯, не трогая ничего больше.
  document.addEventListener('keydown', (e) => {
    if (!host) return;
    if (e.key === 'Escape' && state.menuOpen) {
      state.menuOpen = false;
      paint();
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
 * @param {string|null} param  id чата или "join/<code>".
 */
export async function mountChats(container, param = null) {
  host = container;
  token++;
  wire();
  watchHead();

  state.loading = true;
  state.error = '';
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

  if (param) {
    await openChat(param);
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
  headWatch?.disconnect();
  headWatch = null;
  state.openId = null;
  state.open = null;
  state.messages = [];
  state.members = [];
  state.membersOpen = false;
  state.inviteOpen = false;
  state.menuOpen = false;
  state.createOpen = false;
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

