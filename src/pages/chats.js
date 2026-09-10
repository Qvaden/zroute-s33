/**
 * ЗАКРЫТЫЕ ЧАТЫ — РАЗМЕТКА.
 *
 * Чистые функции от состояния, как и у форума: ни одного обращения к базе
 * или к DOM. Поведение — в src/forum/chats.js.
 *
 * УСТРОЙСТВО СТРАНИЦЫ. Два вида:
 *   #/chats            — список моих чатов (+ вступить по коду, + создать).
 *   #/chats/<id>       — сам чат: лента снизу вверх, липкий ввод.
 *
 * На мониторе список и открытый чат стоят рядом, как в любом мессенджере;
 * на телефоне — один экран за раз, с кнопкой «назад».
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Реакций, вложений, правки сообщений. Чат это разговор:
 * короткие реплики, быстро. Всё, что требует «оформить», живёт на форуме,
 * а из чата туда ведёт ссылка.
 *
 * ПОЛНОЭКРАННЫЙ МЕССЕНДЖЕР. Страница ведёт себя не как статья, а как
 * мессенджер: занимает всё окно под шапкой сайта, список и комната
 * скроллятся каждая сама, ввод прижат к низу. Высоту окна считает и кладёт
 * в --chat-head-h поведение (fitFullscreen в src/forum/chats.js), а не CSS:
 * рост шапки не константа.
 *
 * Все действия с чатом — в меню ⋯ у заголовка комнаты. Строка кнопок
 * «Пригласить · Выйти · Закрыть» переносилась на телефоне и толкала
 * название в две строки; выпадающее меню — то, к чему рука привыкла
 * в любом мессенджере.
 */
import { esc, plural } from '../ui/helpers.js';
import { postBody, timeAgo, fullTime, nickColor, nickInitial } from '../forum/format.js';
import { roleBadge } from '../forum/roles.js';

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
 * @property {boolean} hasMore
 * @property {boolean} sending
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
        ${renderChatList(s)}
      </aside>
      <section class="chat-room" aria-live="polite">
        ${s.openId ? renderRoom(s) : renderRoomPlaceholder(s)}
      </section>
    </div>`;
}

/* ── Список ─────────────────────────────────────────────────────────────── */

function renderChatListHead(s) {
  const canCreate = s.me.isLeader || s.me.role === 'admin' || s.me.role === 'moderator';
  return `
    <header class="chat-list__head">
      <div>
        <span class="eyebrow">Закрытые чаты</span>
        <h2 class="chat-list__title">Чаты</h2>
      </div>
      ${canCreate
        ? `<button type="button" class="forum-btn forum-btn--primary chat-list__new" data-chat-create-toggle
                   aria-expanded="${s.createOpen ? 'true' : 'false'}">
             <span aria-hidden="true">+</span> Новый
           </button>`
        : ''}
    </header>`;
}

function renderJoin() {
  return `
    <form class="chat-join" data-chat-join>
      <input class="chat-join__input" name="code" inputmode="text" autocomplete="off"
             spellcheck="false" placeholder="Код приглашения" aria-label="Код приглашения" maxlength="16">
      <button type="submit" class="forum-btn forum-btn--ghost">Войти</button>
    </form>`;
}

function renderCreateForm(s) {
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
          <input name="allianceTag" maxlength="12" value="${esc(s.me.allianceTag || '')}" placeholder="TAG">
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

function renderChatList(s) {
  if (s.loading && !s.chats.length) {
    return '<div class="chat-list__empty muted">Загружаем…</div>';
  }
  if (!s.chats.length) {
    return `
      <div class="chat-list__empty">
        <b>Пока ни одного чата</b>
        <p class="muted">Попросите код у лидера альянса${s.me.isLeader ? ' или создайте свой' : ''}.</p>
      </div>`;
  }
  return `
    <ul class="chat-list__items">
      ${s.chats.map((c) => renderChatItem(c, c.id === s.openId)).join('')}
    </ul>`;
}

function renderChatItem(c, active) {
  const initial = (c.allianceTag || c.title).trim().slice(0, 2).toUpperCase();
  const last = c.lastBody
    ? `<span class="chat-item__last"><b>${esc(c.lastNick)}:</b> ${esc(plainExcerpt(c.lastBody, 60))}</span>`
    : `<span class="chat-item__last muted">Сообщений ещё нет</span>`;
  return `
    <li>
      <a class="chat-item ${active ? 'is-active' : ''} ${c.closed ? 'is-closed' : ''}" href="#/chats/${esc(c.id)}"
         ${active ? 'aria-current="page"' : ''}>
        <span class="chat-item__mark" style="--ava:${esc(nickColor(c.title))}">${esc(initial)}</span>
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

function renderRoomPlaceholder(s) {
  return `
    <div class="chat-room__blank">
      <span class="chat-room__blank-mark" aria-hidden="true">💬</span>
      <b>Выберите чат</b>
      <p class="muted">${s.chats.length ? 'Слева — ваши чаты.' : 'Введите код приглашения или создайте чат.'}</p>
    </div>`;
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
  const isMgr = ['owner', 'admin'].includes(c.myRole) || s.me.role === 'admin' || s.me.role === 'moderator';
  const kindWord = c.kind === 'inter' ? 'межальянсовый' : 'альянсовый';
  const membersWord = plural(c.memberCount, 'участник', 'участника', 'участников');
  const initial = (c.allianceTag || c.title).trim().slice(0, 2).toUpperCase();

  /*
    Меню ⋯ собирается из тех же действий, что раньше стояли строкой кнопок.
    Пункт «Участники» — для всех: состав чата интересует не только
    управляющим. «Выйти» не показывают создателю: он уходит из чата
    только удалив чат целиком, и кнопка «Выйти» сбивала бы с толку.
  */
  const menu = [
    `<button type="button" class="chat-menu__item" role="menuitem" data-chat-members-toggle>
      Участники<span class="chat-menu__count">${esc(c.memberCount)}</span>
    </button>`,
    isMgr ? `<button type="button" class="chat-menu__item" role="menuitem" data-chat-invite>Пригласить по коду</button>` : '',
    c.myRole && c.myRole !== 'owner'
      ? `<button type="button" class="chat-menu__item chat-menu__item--danger" role="menuitem" data-chat-leave>Выйти из чата</button>`
      : '',
    isMgr && !c.closed
      ? `<button type="button" class="chat-menu__item" role="menuitem" data-chat-close>Закрыть чат</button>`
      : '',
    isMgr && c.closed
      ? `<button type="button" class="chat-menu__item" role="menuitem" data-chat-reopen>Снова открыть</button>`
      : '',
  ].filter(Boolean).join('');

  return `
    <header class="chat-room__head">
      <a class="chat-room__back" href="#/chats" aria-label="К списку чатов">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 19l-7-7 7-7"/></svg>
      </a>
      <span class="chat-room__mark" style="--ava:${esc(nickColor(c.title))}" aria-hidden="true">${esc(initial)}</span>
      <div class="chat-room__who">
        <b class="chat-room__title">${esc(c.title)}</b>
        <small class="chat-room__sub muted">
          ${esc(kindWord)}${c.allianceTag ? ` · ${esc(c.allianceTag)}` : ''} · ${esc(membersWord)}
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

    <div class="chat-room__scroll" data-chat-scroll>
      ${s.hasMore ? `<button type="button" class="chat-room__more forum-act" data-chat-more>Показать раньше</button>` : ''}
      ${renderMessages(s, isMgr)}
    </div>

    ${renderComposer(s, c)}`;
}

function renderMembers(s, isMgr) {
  const roleWord = { owner: 'создатель', admin: 'помощник', member: '' };
  return `
    <div class="chat-members" data-chat-members>
      <ul class="chat-members__list">
        ${s.members.map((m) => `
          <li class="chat-member">
            ${avatar(m.nick, m.avatarUrl)}
            <span class="chat-member__who">
              <a class="forum-nick" href="#/user/${encodeURIComponent(m.nick)}">${esc(m.nick)}</a>
              ${m.isLeader ? leaderBadge() : ''}
              <small class="muted">${esc([m.allianceTag, roleWord[m.role]].filter(Boolean).join(' · '))}</small>
            </span>
            ${isMgr && m.role !== 'owner' && m.userId !== s.me.id ? `
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

function renderInvite(c) {
  const link = `${location.origin}${location.pathname}#/chats/join/${esc(c.inviteCode)}`;
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
      <p class="muted chat-invite__note">Кто знает код, тот войдёт. Утёк — смените, старый перестанет работать.</p>
    </div>`;
}

function renderMessages(s, isMgr) {
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
    // Подряд от одного автора в пределах 5 минут — склеиваем в группу.
    const grouped = prev && prev.authorId === m.authorId && !prev.deleted
      && dayKey(prev.createdAt) === day
      && m.createdAt - prev.createdAt < 5 * 60 * 1000;
    out += renderMessage(m, s, isMgr, grouped);
    prev = m;
  }
  return `<ol class="chat-msgs">${out}</ol>`;
}

function renderMessage(m, s, isMgr, grouped) {
  const mine = m.authorId === s.me.id;
  if (m.deleted) {
    return `
      <li class="chat-msg chat-msg--gone ${mine ? 'is-mine' : ''}" id="m-${esc(m.id)}">
        <span class="chat-msg__gone">Сообщение удалено${m.deletedReason ? `: ${esc(m.deletedReason)}` : ''}</span>
      </li>`;
  }
  const canDelete = mine || isMgr;
  return `
    <li class="chat-msg ${mine ? 'is-mine' : ''} ${grouped ? 'is-grouped' : ''}" id="m-${esc(m.id)}">
      ${grouped ? '<span class="chat-msg__gap"></span>' : avatar(m.authorNick, m.authorAvatar)}
      <div class="chat-msg__bubble">
        ${grouped ? '' : `
          <div class="chat-msg__head">
            <a class="forum-nick" href="#/user/${encodeURIComponent(m.authorNick)}">${esc(m.authorNick)}</a>
            ${roleBadge({ role: m.authorRole }, { short: true })}
            ${m.authorIsLeader ? leaderBadge() : ''}
            ${m.authorAlliance ? `<small class="chat-msg__tag">${esc(m.authorAlliance)}</small>` : ''}
          </div>`}
        <div class="chat-msg__body">${postBody(m.body)}</div>
        <div class="chat-msg__meta">
          <time title="${esc(fullTime(m.createdAt))}">${esc(clock(m.createdAt))}</time>
          ${canDelete ? `<button type="button" class="chat-msg__del" data-chat-msg-delete="${esc(m.id)}" aria-label="Удалить">✕</button>` : ''}
        </div>
      </div>
    </li>`;
}

function renderComposer(s, c) {
  if (c.closed) {
    return `<p class="chat-compose__locked muted">Чат закрыт${c.closedReason ? `: ${esc(c.closedReason)}` : ''}. Писать нельзя.</p>`;
  }
  if (!c.myRole) {
    return `<p class="chat-compose__locked muted">Вы смотрите этот чат как модерация — писать могут только участники.</p>`;
  }
  if (s.me.banned) {
    return `<p class="chat-compose__locked muted">Вам запрещено писать.</p>`;
  }
  return `
    <form class="chat-compose" data-chat-send>
      <textarea class="chat-compose__input" name="body" rows="1" maxlength="2000" required
                placeholder="Сообщение…" aria-label="Сообщение" data-chat-input></textarea>
      <button type="submit" class="chat-compose__send" aria-label="Отправить" ${s.sending ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
      </button>
    </form>`;
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
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(d, now = new Date()) {
  if (dayKey(d) === dayKey(now)) return 'Сегодня';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function clock(d) {
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
