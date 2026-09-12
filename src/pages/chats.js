/**
 * ЗАКРЫТЫЕ ЧАТЫ — РАЗМЕТКА.
 *
 * Чистые функции от состояния: ни одного обращения к базе или к DOM.
 * Поведение — в src/forum/chats.js.
 *
 * УСТРОЙСТВО СТРАНИЦЫ:
 *   #/chats            — список моих чатов (+ вступить по коду, + создать).
 *   #/chats/<id>       — сам чат: лента снизу вверх, липкий ввод, вложения, опросы.
 */
import { esc, plural } from '../ui/helpers.js';
import { postBody, timeAgo, fullTime, nickColor, nickInitial } from '../forum/format.js';
import { roleBadge } from '../forum/roles.js';

/**
 * Рендер тела сообщения с @упоминаниями.
 *
 * postBody() санитизирует HTML и превращает ссылки. После этого
 * находим @Ник и оборачиваем в ссылку на профиль участника.
 * Парсинг идёт ПОСЛЕ sanitizeHtml, поэтому теги уже чистые.
 */
function renderBody(raw) {
  let html = postBody(raw);
  // @Ник — любой набор непробельных символов после @.
  // Не трогаем email-адреса (user@host).
  html = html.replace(/(^|[\s>])@([^\s<@]{2,40})/g, (m, pre, nick) => {
    // Не парсим, если уже внутри ссылки.
    return `${pre}<a href="#/user/${encodeURIComponent(nick)}">@${esc(nick)}</a>`;
  });
  return html;
}

/**
 * @typedef {Object} ChatsState
 * @property {boolean} ready
 * @property {boolean} loading
 * @property {string} error
 * @property {any|null} me
 * @property {import('../forum/contract.js').ForumChat[]} chats
 * @property {string|null} openId
 * @property {import('../forum/contract.js').ForumChat|null} open
 * @property {import('../forum/contract.js').ForumChatMessage[]} messages
 * @property {import('../forum/contract.js').ForumChatMember[]} members
 * @property {boolean} membersOpen
 * @property {boolean} inviteOpen
 * @property {boolean} menuOpen
 * @property {boolean} createOpen
 * @property {boolean} pollOpen
 * @property {boolean} hasMore
 * @property {boolean} sending
 * @property {any[]} [pendingFiles]
 * @property {any|null} [pollDraft]
 * @property {any|null} [replyingTo]
 * @property {string|null} [lightbox]
 */

export function renderChats(s) {
  if (!s.ready) {
    return `
      <section class="panel chat-empty">
        <span class="eyebrow">Чаты</span>
        <h2>Чаты ещё не подключены</h2>
        <p class="muted">${esc(s.error || 'База форума не настроена — см. docs/FORUM.md.')}</p>
      </section>`;
  }

  if (!s.me) {
    return `
      <section class="panel chat-empty">
        <span class="eyebrow">Закрытые чаты</span>
        <h2>Чат альянса — здесь, а не в трёх мессенджерах</h2>
        <p class="muted">
          Войдите на форум под своим ником, и лидер альянса даст вам код приглашения.
          Чаты закрытые: их видят только участники и модерация сайта.
        </p>
        <a class="forum-btn forum-btn--primary" href="#/forum">Войти на форуме</a>
      </section>`;
  }

  return `
    <div class="chat-layout ${s.openId ? 'is-open' : ''}">
      <aside class="chat-list" aria-label="Мои чаты">
        ${renderChatListHead(s)}
        ${renderJoin(s)}
        ${s.createOpen ? renderCreateForm(s) : ''}
        <div class="chat-list__area" data-chat-list-area>${renderChatList(s)}</div>
      </aside>
      <section class="chat-room" aria-live="polite">
        ${s.openId ? renderRoom(s) : renderRoomPlaceholder(s)}
      </section>
      ${s.lightbox ? renderLightbox(s.lightbox) : ''}
    </div>`;
}

/* ── Список ─────────────────────────────────────────────────────────────── */

export function renderChatListHead(s) {
  const canCreate = s.me?.isLeader || s.me?.role === 'admin' || s.me?.role === 'moderator';
  return `
    <header class="chat-list__head">
      <div>
        <span class="eyebrow">Закрытые чаты</span>
        <h2 class="chat-list__title">Чаты</h2>
      </div>
      <div class="chat-list__head-actions">
        ${canCreate
          ? `<button type="button" class="forum-btn forum-btn--primary chat-list__new" data-chat-create-toggle
                     aria-expanded="${s.createOpen ? 'true' : 'false'}">
               <span aria-hidden="true">+</span> Новый
             </button>`
          : ''}
        <button type="button" class="forum-btn forum-btn--ghost chat-list__new"
                data-chat-leaderboard-toggle title="Лидерборд активности">
          🏆
        </button>
      </div>
    </header>
    ${s.leaderboardOpen ? renderLeaderboard(s) : ''}
    ${s.dmOpen ? renderDMForm(s) : ''}`;
}

export function renderJoin() {
  return `
    <form class="chat-join" data-chat-join>
      <input class="chat-join__input" name="code" inputmode="text" autocomplete="off"
             spellcheck="false" placeholder="Код приглашения" aria-label="Код приглашения" maxlength="16">
      <button type="submit" class="forum-btn forum-btn--ghost">Войти</button>
      <button type="button" class="forum-btn forum-btn--ghost" data-chat-dm-toggle title="Личное сообщение">✉</button>
    </form>`;
}

export function renderCreateForm(s) {
  return `
    <form class="chat-create" data-chat-create>
      <label class="forum-field">
        <span>Название</span>
        <input name="title" maxlength="60" required placeholder="Например: Штаб [TAG]">
      </label>
      <div class="chat-create__row">
        <label class="forum-field">
          <span>Вид</span>
          <select name="kind">
            <option value="alliance">Альянсовый</option>
            <option value="inter">Межальянсовый</option>
          </select>
        </label>
        <label class="forum-field">
          <span>Тег</span>
          <input name="allianceTag" maxlength="12" value="${esc(s.me?.allianceTag || '')}" placeholder="TAG">
        </label>
      </div>
      <p class="chat-create__note muted">
        До 200 человек. Вступают по коду, который вы дадите. Чат видят участники
        и модерация сайта — это написано у входа, скрытых чатов здесь нет.
      </p>
      <div class="chat-create__acts">
        <button type="submit" class="forum-btn forum-btn--primary">Создать</button>
        <button type="button" class="forum-btn forum-btn--ghost" data-chat-create-toggle>Отмена</button>
      </div>
      <p class="forum-error" data-chat-create-error hidden></p>
    </form>`;
}

export function renderLeaderboard(s) {
  const rows = s.leaderboard || [];
  return `
    <div class="chat-leaderboard">
      <div class="chat-leaderboard__head">
        <span class="eyebrow">🏆 Активность за неделю</span>
        <button type="button" class="chat-leaderboard__close" data-chat-leaderboard-toggle>✕</button>
      </div>
      ${rows.length ? `<ol class="chat-leaderboard__list">
        ${rows.map((r, i) => `
          <li class="chat-leaderboard__row">
            <span class="chat-leaderboard__place">${i + 1}</span>
            ${avatar(r.nick, r.avatarUrl)}
            <span class="chat-leaderboard__nick">
              <a href="#/user/${encodeURIComponent(r.nick)}">${esc(r.nick)}</a>
              ${r.allianceTag ? `<small class="muted">${esc(r.allianceTag)}</small>` : ''}
            </span>
            <span class="chat-leaderboard__count">${r.messageCount}</span>
          </li>
        `).join('')}
      </ol>` : `<p class="muted">Нет данных за эту неделю.</p>`}
    </div>`;
}

export function renderDMForm(s) {
  return `
    <form class="chat-dm" data-chat-dm>
      <label class="forum-field">
        <span>Ник игрока</span>
        <input name="nick" maxlength="40" required placeholder="Кому написать…">
      </label>
      <div class="chat-dm__acts">
        <button type="submit" class="forum-btn forum-btn--primary">Открыть ЛС</button>
        <button type="button" class="forum-btn forum-btn--ghost" data-chat-dm-toggle>Отмена</button>
      </div>
      <p class="forum-error" data-chat-dm-error hidden></p>
    </form>`;
}

export function renderChatList(s) {
  if (s.loading && !s.chats.length) {
    return '<div class="chat-list__empty muted">Загружаем…</div>';
  }
  if (!s.chats.length) {
    return `
      <div class="chat-list__empty">
        <b>Пока ни одного чата</b>
        <p class="muted">Попросите код у лидера альянса${s.me?.isLeader ? ' или создайте свой' : ''}.</p>
      </div>`;
  }
  return `
    <ul class="chat-list__items">
      ${s.chats.map((c) => renderChatItem(c, c.id === s.openId)).join('')}
    </ul>`;
}

export function renderChatItem(c, active) {
  const initial = (c.allianceTag || c.title).trim().slice(0, 2).toUpperCase();
  const mark = c.avatarUrl
    ? `<img class="chat-item__avatar" src="${esc(c.avatarUrl)}" alt="" loading="lazy" width="42" height="42">`
    : `<span class="chat-item__mark" style="--ava:${esc(nickColor(c.title))}">${esc(initial)}</span>`;
  const last = c.lastBody
    ? `<span class="chat-item__last"><b>${esc(c.lastNick)}:</b> ${esc(plainExcerpt(c.lastBody, 60))}</span>`
    : `<span class="chat-item__last muted">Сообщений ещё нет</span>`;
  return `
    <li>
      <a class="chat-item ${active ? 'is-active' : ''} ${c.closed ? 'is-closed' : ''}" href="#/chats/${esc(c.id)}"
         ${active ? 'aria-current="page"' : ''}>
        ${mark}
        <span class="chat-item__body">
          <span class="chat-item__row">
            <span class="chat-item__title">${esc(c.title)}</span>
            ${c.lastAt ? `<time class="chat-item__time">${esc(timeAgo(c.lastAt))}</time>` : ''}
          </span>
          <span class="chat-item__row">
            ${last}
            ${c.unread ? `<span class="chat-item__unread">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
          </span>
        </span>
      </a>
    </li>`;
}

/* ── Комната ────────────────────────────────────────────────────────────── */

export function renderRoomPlaceholder(s) {
  return `
    <div class="chat-room__blank">
      <span class="chat-room__blank-mark" aria-hidden="true">💬</span>
      <b>Выберите чат</b>
      <p class="muted">${s.chats?.length ? 'Слева — ваши чаты.' : 'Введите код приглашения или создайте чат.'}</p>
    </div>`;
}

export function renderScrollArea(s) {
  const c = s.open;
  const isMgr = c && (
    c.myRole === 'owner' || c.myRole === 'admin' ||
    c.ownerId === s.me?.id || s.me?.role === 'admin' || s.me?.role === 'moderator'
  );
  const msgs = s.searchOpen && s.searchQuery.trim()
    ? s.messages.filter((m) => m.body?.toLowerCase().includes(s.searchQuery.toLowerCase()))
    : s.messages;
  return `${c && s.hasMore ? `<div class="chat-sentinel" data-chat-sentinel></div>` : ''}${renderMessages({ ...s, messages: msgs }, isMgr)}`;
}

function renderRoom(s) {
  const c = s.open;
  if (!c) {
    return `
      <div class="chat-room__blank">
        <b>${s.loading ? 'Открываем…' : 'Чат недоступен'}</b>
        ${s.error ? `<p class="muted">${esc(s.error)}</p>` : ''}
        <a class="forum-btn forum-btn--ghost" href="#/chats">К списку</a>
      </div>`;
  }
  const isOwner = c.myRole === 'owner' || (c.ownerId && c.ownerId === s.me?.id);
  const isMgr = isOwner || c.myRole === 'admin' || s.me?.role === 'admin' || s.me?.role === 'moderator';
  const kindWord = c.kind === 'inter' ? 'межальянсовый' : 'альянсовый';
  const membersWord = plural(c.memberCount, 'участник', 'участника', 'участников');
  const initial = (c.allianceTag || c.title).trim().slice(0, 2).toUpperCase();

  const menu = [
    `<button type="button" class="chat-menu__item" role="menuitem" data-chat-members-toggle>
      👥 Участники<span class="chat-menu__count">${esc(c.memberCount)}</span>
    </button>`,
    isMgr ? `<button type="button" class="chat-menu__item" role="menuitem" data-chat-invite>🔗 Пригласить по коду</button>` : '',
    isMgr ? `<button type="button" class="chat-menu__item" role="menuitem" data-chat-rename>✏️ Переименовать</button>` : '',
    `<button type="button" class="chat-menu__item" role="menuitem" data-chat-search-toggle>🔍 ${s.searchOpen ? 'Скрыть поиск' : 'Поиск по сообщениям'}</button>`,
    `<button type="button" class="chat-menu__item" role="menuitem" data-chat-export>📥 Экспорт истории</button>`,
    `<button type="button" class="chat-menu__item" role="menuitem" data-chat-push>🔔 Push-уведомления</button>`,
    c.myRole && c.myRole !== 'owner'
      ? `<button type="button" class="chat-menu__item chat-menu__item--danger" role="menuitem" data-chat-leave>🚪 Выйти из чата</button>`
      : '',
    isMgr && !c.closed
      ? `<button type="button" class="chat-menu__item" role="menuitem" data-chat-close>🔒 Закрыть чат</button>`
      : '',
    isMgr && c.closed
      ? `<button type="button" class="chat-menu__item" role="menuitem" data-chat-reopen>🔓 Снова открыть</button>`
      : '',
    (isOwner || s.me?.role === 'admin')
      ? `<button type="button" class="chat-menu__item chat-menu__item--danger" role="menuitem" data-chat-delete>🗑️ Удалить чат навсегда</button>`
      : '',
  ].filter(Boolean).join('');

  return `
    <header class="chat-room__head">
      <a class="chat-room__back" href="#/chats" aria-label="К списку чатов">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 19l-7-7 7-7"/></svg>
      </a>
      ${c.avatarUrl
        ? `<img class="chat-room__avatar" src="${esc(c.avatarUrl)}" alt="" width="36" height="36">`
        : `<span class="chat-room__mark" style="--ava:${esc(nickColor(c.title))}" aria-hidden="true">${esc(initial)}</span>`}
      <div class="chat-room__who">
        <b class="chat-room__title">${esc(c.title)}</b>
        <small class="chat-room__sub muted">
          ${esc(kindWord)}${c.allianceTag ? ` · ${esc(c.allianceTag)}` : ''} · ${esc(membersWord)}
          ${c.onlineCount > 1 ? ` · <span class="chat-room__online">${c.onlineCount} онлайн</span>` : ''}
          ${c.closed ? ' · <span class="chat-room__closed">закрыт</span>' : ''}
        </small>
      </div>
      <div class="chat-menu" data-chat-menu>
        <button type="button" class="chat-room__dots" data-chat-menu-toggle
                aria-haspopup="menu" aria-expanded="${s.menuOpen ? 'true' : 'false'}" aria-label="Действия с чатом">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
          </svg>
        </button>
        ${s.menuOpen ? `<div class="chat-menu__pop" role="menu">${menu}</div>` : ''}
      </div>
    </header>

    ${s.membersOpen ? renderMembers(s, isMgr) : ''}
    ${s.inviteOpen ? renderInvite(c) : ''}

    ${c.pinnedBody ? `
      <div class="chat-pinned">
        <span class="chat-pinned__badge">📌</span>
        <span class="chat-pinned__text"><b>${esc(c.pinnedNick || '')}:</b> ${esc(c.pinnedBody)}</span>
        ${isMgr ? `<button type="button" class="chat-pinned__unpin" data-chat-unpin title="Открепить">✕</button>` : ''}
      </div>` : ''}

    ${s.searchOpen ? `
      <div class="chat-search">
        <input class="chat-search__input" name="search" autocomplete="off" spellcheck="false"
               placeholder="Поиск по сообщениям…" aria-label="Поиск"
               data-chat-search-input value="${esc(s.searchQuery || '')}">
      </div>` : ''}

    <div class="chat-room__scroll" data-chat-scroll>
      ${renderScrollArea(s)}
    </div>

    <button type="button" class="chat-go-bottom${s.newMessages > 0 ? ' is-visible' : ''}"
            data-chat-go-bottom aria-label="К последнему сообщению">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
           stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6"/>
      </svg>
      <span data-chat-go-count>${s.newMessages > 99 ? '99+' : s.newMessages}</span>
    </button>

    ${renderComposer(s, c)}`;
}

export function renderMembers(s, isMgr) {
  const roleWord = { owner: 'создатель', admin: 'помощник', member: '' };
  return `
    <div class="chat-members" data-chat-members>
      <ul class="chat-members__list">
        ${(s.members || []).map((m) => `
          <li class="chat-member">
            ${avatar(m.nick, m.avatarUrl)}
            <span class="chat-member__who">
              <a class="forum-nick" href="#/user/${encodeURIComponent(m.nick)}">${esc(m.nick)}</a>
              ${m.isLeader ? leaderBadge() : ''}
              <small class="muted">${esc([m.allianceTag, roleWord[m.role]].filter(Boolean).join(' · '))}</small>
            </span>
            ${isMgr && m.role !== 'owner' && m.userId !== s.me?.id ? `
              <span class="chat-member__acts">
                <button type="button" class="forum-act" data-chat-member-role="${esc(m.userId)}"
                        data-role="${m.role === 'admin' ? 'member' : 'admin'}">
                  ${m.role === 'admin' ? 'Снять помощника' : 'В помощники'}
                </button>
                <button type="button" class="forum-act forum-act--danger" data-chat-member-kick="${esc(m.userId)}">Выгнать</button>
              </span>` : ''}
          </li>`).join('')}
      </ul>
    </div>`;
}

export function renderInvite(c) {
  const link = `${location.origin}${location.pathname}#/chats/join/${esc(c.inviteCode)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(link)}`;
  return `
    <div class="chat-invite" data-chat-invite-panel>
      <div class="chat-invite__code">
        <span class="eyebrow">Код приглашения</span>
        <b class="num" data-chat-code>${esc(c.inviteCode)}</b>
      </div>
      <div class="chat-invite__acts">
        <button type="button" class="forum-btn forum-btn--ghost" data-chat-copy="${esc(link)}">Скопировать ссылку</button>
        <button type="button" class="forum-act" data-chat-rotate>Сменить код</button>
      </div>
      <div class="chat-invite__qr">
        <img src="${esc(qrUrl)}" alt="QR-код приглашения" width="140" height="140" loading="lazy">
        <p class="muted">Наведите камеру телефона</p>
      </div>
      <p class="muted chat-invite__note">Кто знает код, тот войдёт. Утёк — смените, старый перестанет работать.</p>
    </div>`;
}

export function renderMessages(s, isMgr) {
  if (s.loading && !s.messages.length) return '<div class="chat-msgs__empty muted">Загружаем…</div>';
  if (!s.messages.length) {
    return `
      <div class="chat-msgs__empty">
        <b>Тишина</b>
        <p class="muted">Напишите первым — участники увидят это сразу.</p>
      </div>`;
  }
  let out = '';
  let prev = null;
  for (const m of s.messages) {
    const day = dayKey(m.createdAt);
    if (!prev || dayKey(prev.createdAt) !== day) {
      out += `<div class="chat-day"><span>${esc(dayLabel(m.createdAt))}</span></div>`;
    }
    const grouped = prev && prev.authorId === m.authorId && !prev.deleted
      && dayKey(prev.createdAt) === day
      && (m.createdAt - prev.createdAt < 5 * 60 * 1000)
      && !m.replyTo && !m.poll;
    out += renderMessage(m, s, isMgr, grouped);
    prev = m;
  }
  return `<ol class="chat-msgs">${out}</ol>`;
}

export function renderMessage(m, s, isMgr, grouped) {
  const mine = m.authorId === s.me?.id;
  if (m.deleted) {
    return `
      <li class="chat-msg chat-msg--gone ${mine ? 'is-mine' : ''}" id="m-${esc(m.id)}">
        <span class="chat-msg__gone">Сообщение удалено${m.deletedReason ? `: ${esc(m.deletedReason)}` : ''}</span>
      </li>`;
  }
  const canDelete = mine || isMgr;
  // Устойчивый аватар: проверяем сообщение, затем профиль текущего юзера, затем список участников
  const memberAvatar = s.members?.find((mb) => mb.userId === m.authorId)?.avatarUrl;
  const avaUrl = m.authorAvatar || (mine ? s.me?.avatarUrl : '') || memberAvatar || '';

  return `
    <li class="chat-msg ${mine ? 'is-mine' : ''} ${grouped ? 'is-grouped' : ''}" id="m-${esc(m.id)}">
      ${grouped ? '<span class="chat-msg__gap"></span>' : avatar(m.authorNick, avaUrl)}
      <div class="chat-msg__bubble">
        ${grouped ? '' : `
          <div class="chat-msg__head">
            <a class="forum-nick" href="#/user/${encodeURIComponent(m.authorNick)}">${esc(m.authorNick)}</a>
            ${roleBadge({ role: m.authorRole }, { short: true })}
            ${m.authorIsLeader ? leaderBadge() : ''}
            ${m.authorAlliance ? `<small class="chat-msg__tag">${esc(m.authorAlliance)}</small>` : ''}
          </div>`}

        ${m.replyTo ? renderReplyQuote(m.replyTo) : ''}
        ${m.body ? `<div class="chat-msg__body">${renderBody(m.body)}</div>` : ''}
        ${m.attachments?.length ? renderAttachments(m.attachments) : ''}
        ${m.poll ? renderPoll(m.id, m.poll, s.me?.id) : ''}
        ${renderReactionsBar(m.id, m.reactions, s.me?.id)}

          <div class="chat-msg__meta">
          <time title="${esc(fullTime(m.createdAt))}">${esc(clock(m.createdAt))}</time>
          <button type="button" class="chat-msg__reply-btn" data-chat-msg-reply="${esc(m.id)}"
                  data-nick="${esc(m.authorNick)}" data-excerpt="${esc(plainExcerpt(m.body || 'Вложение', 50))}"
                  title="Ответить" aria-label="Ответить">↩</button>
          ${isMgr ? `<button type="button" class="chat-msg__pin-btn" data-chat-pin="${esc(m.id)}"
                    title="Закрепить сообщение" aria-label="Закрепить">📌</button>` : ''}
          <div class="chat-msg__react-trigger" data-chat-react-picker="${esc(m.id)}">
            <button type="button" class="chat-msg__react-btn" title="Поставить реакцию">😊</button>
            <div class="chat-msg__reactions-pop">
              ${['👍', '❤️', '🔥', '😂', '😮', '😢', '👏'].map((em) => `
                <button type="button" class="chat-msg__em-btn" data-chat-react="${esc(m.id)}:${em}">${em}</button>
              `).join('')}
            </div>
          </div>
          ${canDelete ? `<button type="button" class="chat-msg__del" data-chat-msg-delete="${esc(m.id)}" aria-label="Удалить">✕</button>` : ''}
        </div>
      </div>
    </li>`;
}

function renderReplyQuote(r) {
  return `
    <div class="chat-reply-quote" data-chat-jump="m-${esc(r.id)}">
      <span class="chat-reply-quote__nick">${esc(r.authorNick)}</span>
      <span class="chat-reply-quote__body">${esc(plainExcerpt(r.body || 'Вложение', 60))}</span>
    </div>`;
}

function renderAttachments(atts) {
  if (!Array.isArray(atts) || !atts.length) return '';
  return `
    <div class="chat-attachments">
      ${atts.map((a) => {
        if (a.isImage || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(a.url || a.name || '')) {
          return `<div class="chat-attach chat-attach--img">
            <img src="${esc(a.url)}" alt="${esc(a.name || 'Скриншот')}" loading="lazy"
                 data-chat-lightbox="${esc(a.url)}">
          </div>`;
        }
        if (a.isVideo || /\.(mp4|webm|mov)$/i.test(a.url || a.name || '')) {
          return `<div class="chat-attach chat-attach--video">
            <video src="${esc(a.url)}" controls preload="metadata" playsinline></video>
          </div>`;
        }
        if (a.isAudio || /\.(mp3|wav|ogg|m4a|aac)$/i.test(a.url || a.name || '')) {
          return `<div class="chat-attach chat-attach--audio">
            <audio src="${esc(a.url)}" controls preload="metadata"></audio>
          </div>`;
        }
        return `<a class="chat-attach chat-attach--file" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" download="${esc(a.name || 'file')}">
          <span class="chat-attach__icon">📁</span>
          <span class="chat-attach__name">${esc(a.name || 'Файл')}</span>
          ${a.size ? `<span class="chat-attach__size muted">${esc(formatSize(a.size))}</span>` : ''}
        </a>`;
      }).join('')}
    </div>`;
}

function renderPoll(msgId, p, myId) {
  if (!p) return '';
  const total = Number(p.total || 0);
  return `
    <div class="chat-poll" data-chat-poll="${esc(msgId)}">
      <div class="chat-poll__head">
        <span class="chat-poll__badge">📊 Опрос</span>
        <b class="chat-poll__question">${esc(p.question)}</b>
      </div>
      <div class="chat-poll__options">
        ${(p.options || []).map((o, idx) => {
          const votes = Number(o.votes || (o.voters ? o.voters.length : 0));
          const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
          const isVoted = Array.isArray(o.voters) && myId && o.voters.includes(myId);
          return `
            <button type="button" class="chat-poll__opt ${isVoted ? 'is-voted' : ''}"
                    data-chat-vote="${esc(msgId)}:${idx}">
              <div class="chat-poll__bar" style="width:${pct}%"></div>
              <span class="chat-poll__text">${esc(o.text)}</span>
              <span class="chat-poll__stat">${pct}% (${votes})</span>
            </button>`;
        }).join('')}
      </div>
      <div class="chat-poll__foot muted">
        <span>Всего голосов: ${total}</span>
        ${p.multiple ? '<span>(несколько ответов)</span>' : ''}
      </div>
    </div>`;
}

function renderReactionsBar(msgId, reactions, meId) {
  if (!reactions || typeof reactions !== 'object') return '';
  const list = Object.entries(reactions)
    .map(([em, voters]) => ({ em, count: Array.isArray(voters) ? voters.length : 0, mine: Array.isArray(voters) && meId ? voters.includes(meId) : false }))
    .filter((r) => r.count > 0);
  if (!list.length) return '';
  return `
    <div class="chat-reactions">
      ${list.map((r) => `
        <button type="button" class="chat-reaction-chip${r.mine ? ' is-mine' : ''}" data-chat-react="${esc(msgId)}:${esc(r.em)}">
          <span>${esc(r.em)}</span><b>${r.count}</b>
        </button>
      `).join('')}
    </div>`;
}

/* ── Композер ───────────────────────────────────────────────────────────── */

export function renderComposer(s, c) {
  if (c.closed) {
    return `<p class="chat-compose__locked muted">Чат закрыт${c.closedReason ? `: ${esc(c.closedReason)}` : ''}. Писать нельзя.</p>`;
  }
  if (!c.myRole) {
    return `<p class="chat-compose__locked muted">Вы смотрите этот чат как модерация — писать могут только участники.</p>`;
  }
  if (s.me?.banned) {
    return `<p class="chat-compose__locked muted">Вам запрещено писать.</p>`;
  }

  // Typing indicator: other members who typed in the last 5 seconds.
  const now = Date.now();
  const typists = (s.members || [])
    .filter((m) => m.userId !== s.me?.id && m.typingAt && (now - new Date(m.typingAt).getTime()) < 5000)
    .map((m) => m.nick);

  return `
    <div class="chat-compose-wrap">
      ${typists.length ? `<div class="chat-typing">${esc(typists.join(', '))} ${typists.length === 1 ? 'печатает' : 'печатают'}…</div>` : ''}
      ${s.replyingTo ? renderReplyBanner(s.replyingTo) : ''}
      ${s.pollDraft ? `
        <div class="chat-pending-poll">
          <span>📊 Опрос: <b>${esc(s.pollDraft.question)}</b></span>
          <button type="button" class="chat-pending-poll__drop" data-chat-poll-clear title="Убрать опрос">✕</button>
        </div>` : ''}
      ${s.pollOpen ? renderPollCreator(s) : ''}
      <div class="chat-pending-files" data-chat-pending-list ${s.pendingFiles?.length ? '' : 'hidden'}>
        ${(s.pendingFiles || []).map((f, i) => `
          <div class="chat-pending-file">
            ${f.isImage ? `<img src="${esc(f.preview)}" alt="">` : `<span class="chat-pending-file__icon">📄</span>`}
            <span class="chat-pending-file__name">${esc(f.name)}</span>
            <button type="button" class="chat-pending-file__drop" data-chat-drop-file="${i}" title="Убрать">✕</button>
          </div>
        `).join('')}
      </div>

      <form class="chat-compose" data-chat-send>
        <div class="chat-compose__acts-left">
          <label class="chat-compose__btn" title="Прикрепить фото, видео или файл">
            <input type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.zip,.txt"
                   data-chat-file-input hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </label>
          <button type="button" class="chat-compose__btn" data-chat-poll-toggle title="Создать опрос">
            📊
          </button>
        </div>

        <div class="chat-compose__input" contenteditable="true" role="textbox"
             data-chat-input data-placeholder="Сообщение или вставьте скриншот (Ctrl+V)…" aria-label="Сообщение"></div>

        <button type="submit" class="chat-compose__send" aria-label="Отправить" ${s.sending ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
        </button>
      </form>
    </div>`;
}

function renderReplyBanner(r) {
  return `
    <div class="chat-reply-banner">
      <div class="chat-reply-banner__info">
        <span class="chat-reply-banner__label">Ответ для <b>${esc(r.authorNick)}</b></span>
        <span class="chat-reply-banner__text muted">${esc(plainExcerpt(r.body || 'Вложение', 50))}</span>
      </div>
      <button type="button" class="chat-reply-banner__cancel" data-chat-reply-cancel title="Отменить ответ">✕</button>
    </div>`;
}

function renderPollCreator(s = {}) {
  const d = s.pollDraft || {};
  const opts = d.options?.length ? d.options : [{ text: '' }, { text: '' }, { text: '' }];
  const labels = ['Вариант 1', 'Вариант 2', 'Вариант 3 (необязательно)'];
  return `
    <div class="chat-poll-creator" data-chat-poll-form>
      <div class="chat-poll-creator__head">
        <b>📊 Создание опроса</b>
        <button type="button" class="chat-poll-creator__close" data-chat-poll-toggle>✕</button>
      </div>
      <input class="chat-poll-creator__q" name="pollQuestion" placeholder="Вопрос для опроса…"
             maxlength="140" value="${esc(d.question || '')}">
      <div class="chat-poll-creator__options" data-chat-poll-options>
        ${opts.slice(0, 3).map((o, i) => `
          <input class="chat-poll-creator__opt" placeholder="${esc(labels[i] || `Вариант ${i + 1}`)}"
                 maxlength="60" value="${esc(o.text || '')}">
        `).join('')}
      </div>
      <div class="chat-poll-creator__foot">
        <label class="chat-poll-creator__multi">
          <input type="checkbox" name="pollMultiple" ${d.multiple ? 'checked' : ''}> <span>Несколько вариантов</span>
        </label>
        <button type="button" class="forum-btn forum-btn--primary forum-btn--sm" data-chat-poll-apply>Прикрепить опрос</button>
      </div>
    </div>`;
}

function renderLightbox(url) {
  return `
    <div class="chat-lightbox" data-chat-lightbox-close>
      <img src="${esc(url)}" alt="Увеличенное изображение" class="chat-lightbox__img">
      <button type="button" class="chat-lightbox__close" aria-label="Закрыть">✕</button>
    </div>`;
}

/* ── Мелочи ─────────────────────────────────────────────────────────────── */

export function leaderBadge() {
  return '<span class="role-badge role-badge--leader" style="--role-tone:#5cc8ff" title="лидер альянса" role="img" aria-label="лидер альянса"><i aria-hidden="true">⚑</i><b>лидер</b></span>';
}

function avatar(nick, url) {
  if (url) return `<img class="forum-ava forum-ava--sm" src="${esc(url)}" alt="" loading="lazy" width="28" height="28">`;
  return `<span class="forum-ava forum-ava--sm" style="--ava:${esc(nickColor(nick))}">${esc(nickInitial(nick))}</span>`;
}

function plainExcerpt(src, max) {
  const t = String(src).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function dayKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
}

function dayLabel(d, now = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  if (dayKey(dt) === dayKey(now)) return 'Сегодня';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (dayKey(dt) === dayKey(y)) return 'Вчера';
  return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function clock(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes) {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
}
