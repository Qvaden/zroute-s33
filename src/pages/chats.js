/**
 * ЗАКРЫТЫЕ ЧАТЫ — РАЗМЕТКА.
 *
 * Чистые функции от состояния, как и у форума: ни одного обращения к базе
 * или к DOM. Поведение — в src/forum/chats.js.
 *
 * УСТРОЙСТВО СТРАНИЦЫ. Два вида:
 *   #/chats              — список моих чатов (+ вступить по коду, + создать).
 *   #/chats/<id>         — сам чат: лента снизу вверх, липкий ввод.
 *   #/chats/<id>/m/<mid> — тот же чат, но с переходом к сообщению.
 *
 * На мониторе список и открытый чат стоят рядом, как в любом мессенджере;
 * на телефоне — один экран за раз, с кнопкой «назад».
 *
 * ЧЕГО ЗДЕСЬ БЫЛО И ЧТО СТАЛО. Первая версия чата была перепиской текстом:
 * «короткие реплики, быстро, всё, что надо оформить, — на форуме». На живом
 * сервере так не выходит: в альянсовом чате кидают скриншот разведки, запись
 * замеса, файл со списком состава — и всё это уезжало в мессенджеры, то есть
 * ровно туда, откуда чат и должен был забрать разговор. Поэтому здесь
 * появились вложения (картинки, видео, голосовые, файлы), ответы на реплику,
 * реакции, закреплённое сообщение, поиск по переписке и «пишет…».
 *
 * ЧЕГО ЗДЕСЬ НЕТ ПО-ПРЕЖНЕМУ: правки сообщений. Сказанное сказано; удалить
 * можно, переписать — нет. Это решение из docs/FORUM.md, и оно не изменилось.
 *
 * ПОЛНОЭКРАННЫЙ МЕССЕНДЖЕР. Страница ведёт себя не как статья, а как
 * мессенджер: занимает всё окно под шапкой сайта, список и комната
 * скроллятся каждая сама, ввод прижат к низу. Высоту окна считает и кладёт
 * в --chat-head-h поведение (fitFullscreen в src/forum/chats.js), а не CSS:
 * рост шапки не константа.
 *
 * Все действия с чатом — в меню ⋯ у заголовка комнаты.
 */
import { esc, plural } from '../ui/helpers.js';
import { postBody, timeAgo, fullTime, nickColor, nickInitial, excerpt } from '../forum/format.js';
import { roleBadge } from '../forum/roles.js';
import { CHAT_REACTIONS } from '../forum/rules.js';
import { renderSelect } from '../ui/select.js';
import {
  CHAT_LIMITS, KIND_GLYPH, KIND_LABEL, attachmentLabel, formatBytes, formatDuration,
} from '../forum/media.js';

/**
 * @typedef {Object} ChatsState
 * @property {boolean} ready
 * @property {boolean} loading
 * @property {string} error
 * @property {any|null} me
 * @property {import('../forum/contract.js').ForumChat[]} chats
 * @property {'all'|'unread'} listFilter
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
 * @property {import('../forum/contract.js').ForumChatMessage|null} replyTo
 * @property {any[]} queue                 Очередь вложений: что ещё грузится или ждёт отправки.
 * @property {boolean} emojiOpen
 * @property {boolean} pinsOpen
 * @property {import('../forum/contract.js').ForumChatMessage[]} pins
 * @property {boolean} searchOpen
 * @property {string} searchQ
 * @property {import('../forum/contract.js').ForumChatMessage[]|null} searchResults
 * @property {boolean} searchBusy
 * @property {string|null} msgMenu
 * @property {string|null} reactFor
 * @property {boolean} settingsOpen
 * @property {{items: any[], index: number}|null} lightbox
 * @property {{userId: string, nick: string}[]} typing
 * @property {{action: string, title: string, text?: string} | null} dialog
 * @property {string|null} newFromId
 * @property {string|null} highlight
 * @property {{startedAt: number}|null} recording
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
        <a class="forum-btn" href="#/forum">Войти на форуме</a>
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
    </div>
    ${s.dialog ? renderDialog(s) : ''}`;
}

/**
 * Вопрос к человеку — своим окном, а не системным.
 *
 * Браузерные confirm и prompt рисует операционная система: серый ящик с чужими
 * кнопками поверх тёмной страницы, разный на каждой платформе, и текст в нём
 * не оформить. Форум от них отказался раньше (см. renderDeleteDialog
 * в pages/forum.js), и чат делает так же — тем же окном .forum-modal, чтобы
 * «Удалить чат» здесь и «Удалить запись» на форуме выглядели одинаково.
 *
 * Поле причины появляется только там, где причина нужна людям: при закрытии
 * чата и при удалении чужого сообщения. Своё сообщение удаляется без вопроса —
 * объяснять нечего.
 */
function renderDialog(s) {
  const d = s.dialog;
  return `
    <div class="forum-modal" data-chat-dialog>
      <div class="forum-modal__box" role="dialog" aria-modal="true" aria-label="${esc(d.title)}">
        <h3>${esc(d.title)}</h3>
        <form data-chat-dialog-form>
          ${d.text ? `<p class="muted">${esc(d.text)}</p>` : ''}
          ${d.field
            ? `<label class="forum-field">
                 <span>${esc(d.fieldLabel || 'Причина')}</span>
                 <input type="text" name="reason" maxlength="200" value="${esc(d.value || '')}"
                        placeholder="${esc(d.placeholder || '')}">
               </label>`
            : ''}
          <div class="forum-modal__actions">
            <button type="submit" class="forum-btn ${d.danger ? 'forum-btn--danger' : ''}">${esc(d.ok)}</button>
            <button type="button" class="forum-btn forum-btn--ghost" data-chat-dialog-cancel>Отмена</button>
          </div>
        </form>
      </div>
    </div>`;
}

/* ── Список ─────────────────────────────────────────────────────────────── */

function renderChatListHead(s) {
  const canCreate = s.me.isLeader || s.me.role === 'admin' || s.me.role === 'moderator';
  const unreadCount = s.chats.filter((c) => c.unread).length;
  return `
    <header class="chat-list__head">
      <div>
        <span class="eyebrow">Закрытые чаты</span>
        <h2 class="chat-list__title">Чаты</h2>
      </div>
      ${canCreate
        ? `<button type="button" class="forum-btn chat-list__new" data-chat-create-toggle
                   aria-expanded="${s.createOpen ? 'true' : 'false'}">
             <span aria-hidden="true">+</span> Новый
           </button>`
        : ''}
    </header>
    ${s.chats.length > 1
      ? `<div class="chat-filters" role="tablist" aria-label="Какие чаты показывать">
           <button type="button" class="chat-filter ${s.listFilter === 'all' ? 'is-on' : ''}"
                   role="tab" aria-selected="${s.listFilter === 'all'}" data-chat-filter="all">Все</button>
           <button type="button" class="chat-filter ${s.listFilter === 'unread' ? 'is-on' : ''}"
                   role="tab" aria-selected="${s.listFilter === 'unread'}" data-chat-filter="unread">
             Непрочитанные${unreadCount ? ` <b>${unreadCount}</b>` : ''}
           </button>
         </div>`
      : ''}`;
}

function renderJoin() {
  return `
    <form class="chat-join" data-chat-join>
      <input class="chat-join__input" name="code" inputmode="text" autocomplete="off"
             spellcheck="false" placeholder="Код приглашения" aria-label="Код приглашения" maxlength="16">
      <button type="submit" class="forum-btn forum-btn--ghost">Войти</button>
    </form>`;
}

/**
 * Создание чата.
 *
 * Вид чата выбирается своим списком (ui/select.js), а не системным <select>:
 * вариантов два, и у каждого есть что сказать — «Альянсовый» это штаб одного
 * альянса, «Межальянсовый» — общий чат нескольких. Системный список эти
 * подписи показать не может, и человек выбирал вслепую: по одному слову,
 * которое ни о чём не говорит, пока не нажмёшь.
 */
function renderCreateForm(s) {
  const options = [
    {
      value: 'alliance',
      label: 'Альянсовый',
      hint: 'штаб одного альянса: своё VS, свой сбор',
      mark: '⚔',
    },
    {
      value: 'inter',
      label: 'Межальянсовый',
      hint: 'несколько альянсов: координировать общий замес',
      mark: '🤝',
    },
  ];

  return `
    <form class="chat-create" data-chat-create>
      <label class="forum-field">
        <span>Название</span>
        <input name="title" maxlength="60" required placeholder="Например: Штаб [TAG]"
               value="${esc(s.createDraft?.title ?? '')}" autocomplete="off">
      </label>

      <div class="chat-create__row">
        <div class="forum-field chat-create__kind">
          <span>Вид чата</span>
          ${renderSelect({
            name: 'kind',
            value: s.createDraft?.kind ?? 'alliance',
            options,
            ariaLabel: 'Вид чата',
            attrs: 'data-chat-kind',
          })}
        </div>
        <label class="forum-field">
          <span>Тег</span>
          <input name="allianceTag" maxlength="12" value="${esc(s.createDraft?.allianceTag ?? (s.me.allianceTag || ''))}"
                 placeholder="TAG" autocomplete="off">
        </label>
      </div>

      <label class="forum-field">
        <span>О чём чат <small class="muted">— необязательно</small></span>
        <input name="topic" maxlength="${CHAT_LIMITS.topicMax}" placeholder="Например: сбор на VS по средам в 20:00"
               value="${esc(s.createDraft?.topic ?? '')}" autocomplete="off">
      </label>

      <div class="chat-create__note">
        <p class="muted">
          До 200 человек. Вступают по коду, который вы дадите. В чате можно отправлять
          картинки, видео и файлы, отвечать на реплики и закреплять важное.
        </p>
        <p class="muted">
          Чат видят участники и модерация сайта — это написано у входа, скрытых чатов здесь нет.
        </p>
      </div>

      <div class="chat-create__acts">
        <button type="submit" class="forum-btn">Создать</button>
        <button type="button" class="forum-btn forum-btn--ghost" data-chat-create-toggle>Отмена</button>
      </div>
      <p class="forum-error" data-chat-create-error hidden></p>
    </form>`;
}

function renderChatList(s) {
  const list = s.listFilter === 'unread' ? s.chats.filter((c) => c.unread) : s.chats;

  if (s.loading && !s.chats.length) {
    return '<div class="chat-list__empty muted">Загружаем…</div>';
  }
  if (!list.length) {
    if (s.listFilter === 'unread') {
      return `
        <div class="chat-list__empty">
          <b>Всё прочитано</b>
          <p class="muted">Непрочитанных чатов нет.</p>
        </div>`;
    }
    return `
      <div class="chat-list__empty">
        <b>Пока ни одного чата</b>
        <p class="muted">Попросите код у лидера альянса${s.me.isLeader ? ' или создайте свой' : ''}.</p>
      </div>`;
  }

  return `
    <ul class="chat-list__items">
      ${list.map((c) => renderChatItem(c, c.id === s.openId)).join('')}
    </ul>`;
}

function renderChatItem(c, active) {
  const last = c.lastBody
    ? `<span class="chat-item__last"><b>${esc(c.lastNick)}:</b> ${esc(excerpt(c.lastBody, 60))}</span>`
    : c.lastKind
      ? `<span class="chat-item__last"><b>${esc(c.lastNick)}:</b> ${esc(attachmentLabel(c.lastKind))}</span>`
      : '<span class="chat-item__last muted">Сообщений ещё нет</span>';

  return `
    <li>
      <a class="chat-item ${active ? 'is-active' : ''} ${c.closed ? 'is-closed' : ''}" href="#/chats/${esc(c.id)}"
         ${active ? 'aria-current="page"' : ''}>
        ${chatMark(c, 'chat-item__mark')}
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

/**
 * Метка чата: картинка, если её поставили, иначе две буквы на цветном поле.
 * Цвет считается из названия — свой чат узнаётся по цвету раньше, чем
 * прочитано имя.
 */
function chatMark(c, cls) {
  const initial = (c.allianceTag || c.title).trim().slice(0, 2).toUpperCase();
  if (c.avatarUrl) {
    return `<img class="${cls} ${cls}--img" src="${esc(c.avatarUrl)}" alt="" loading="lazy" width="42" height="42">`;
  }
  return `<span class="${cls}" style="--ava:${esc(nickColor(c.title))}" aria-hidden="true">${esc(initial)}</span>`;
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
  const canWrite = Boolean(c.myRole && !c.closed && !s.me.banned);

  return `
    ${renderRoomHead(s, c, isMgr)}
    ${s.settingsOpen ? renderSettings(s, c, isMgr) : ''}
    ${s.pinsOpen ? renderPins(s, isMgr) : ''}
    ${s.searchOpen ? renderSearch(s) : ''}
    ${s.membersOpen ? renderMembers(s, isMgr) : ''}
    ${s.inviteOpen ? renderInvite(c) : ''}

    <div class="chat-room__scroll" data-chat-scroll>
      ${s.hasMore ? '<button type="button" class="chat-room__more forum-act" data-chat-more>Показать раньше</button>' : ''}
      ${renderMessages(s, isMgr)}
      <button type="button" class="chat-tobottom" data-chat-bottom hidden>
        <span data-chat-bottom-label>Вниз</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
      </button>
    </div>

    ${renderComposer(s, c, canWrite)}
    ${s.lightbox ? renderLightbox(s) : ''}`;
}

/**
 * Шапка комнаты.
 *
 * Инструменты вынесены в ряд кнопок и остались только те, что нужны каждый
 * день: поиск, закреплённое, участники. Всё редкое (приглашение, смена кода,
 * настройки, закрытие) — по-прежнему в меню ⋯.
 */
function renderRoomHead(s, c, isMgr) {
  const kindWord = c.kind === 'inter' ? 'межальянсовый' : 'альянсовый';
  const membersWord = plural(c.memberCount, 'участник', 'участника', 'участников');
  const typing = typingLine(s);

  const menu = [
    `<button type="button" class="chat-menu__item" role="menuitem" data-chat-members-toggle>
      Участники<span class="chat-menu__count">${esc(c.memberCount)}</span>
    </button>`,
    `<button type="button" class="chat-menu__item" role="menuitem" data-chat-settings-toggle>Настройки чата</button>`,
    isMgr ? `<button type="button" class="chat-menu__item" role="menuitem" data-chat-invite>Пригласить по коду</button>` : '',
    `<button type="button" class="chat-menu__item" role="menuitem" data-chat-search-toggle>Поиск в переписке</button>`,
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
      ${chatMark(c, 'chat-room__mark')}
      <div class="chat-room__who">
        <b class="chat-room__title">${esc(c.title)}</b>
        <small class="chat-room__sub muted" ${typing ? 'data-chat-typing' : ''}>
          ${typing
            ? esc(typing)
            : `${esc(kindWord)}${c.allianceTag ? ` · ${esc(c.allianceTag)}` : ''} · ${esc(membersWord)}${c.closed ? ' · <span class="chat-room__closed">закрыт</span>' : ''}`}
        </small>
      </div>

      <div class="chat-room__tools">
        <button type="button" class="chat-tool" data-chat-search-toggle
                aria-expanded="${s.searchOpen ? 'true' : 'false'}" title="Поиск в переписке" aria-label="Поиск в переписке">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
        </button>
        <button type="button" class="chat-tool ${c.pinnedCount ? 'is-on' : ''}" data-chat-pins-toggle
                aria-expanded="${s.pinsOpen ? 'true' : 'false'}" title="Закреплённые сообщения" aria-label="Закреплённые сообщения">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>
          </svg>
          ${c.pinnedCount ? `<span class="chat-tool__badge">${esc(c.pinnedCount)}</span>` : ''}
        </button>
        <button type="button" class="chat-tool" data-chat-members-toggle
                aria-expanded="${s.membersOpen ? 'true' : 'false'}" title="Участники" aria-label="Участники">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/>
            <path d="M16 5.5a3.2 3.2 0 0 1 0 6.4"/><path d="M17.5 20a6 6 0 0 0-2-4.4"/>
          </svg>
        </button>
        <div class="chat-menu" data-chat-menu>
          <button type="button" class="chat-room__dots" data-chat-menu-toggle
                  aria-haspopup="menu" aria-expanded="${s.menuOpen ? 'true' : 'false'}" aria-label="Действия с чатом">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
            </svg>
          </button>
          ${s.menuOpen ? `<div class="chat-menu__pop" role="menu">${menu}</div>` : ''}
        </div>
      </div>
    </header>`;
}

/** Кто печатает. Показываем в подписи под названием — там же, где состав. */
function typingLine(s) {
  const who = (s.typing ?? []).filter((t) => t.userId !== s.me.id);
  if (!who.length) return '';
  if (who.length === 1) return `${who[0].nick} печатает…`;
  if (who.length === 2) return `${who[0].nick} и ${who[1].nick} печатают…`;
  return `${who[0].nick} и ещё ${who.length - 1} печатают…`;
}

/* ── Панели: закреплённое, поиск, участники, приглашение, настройки ──────── */

function renderPins(s, isMgr) {
  return `
    <div class="chat-pins" data-chat-pins>
      <header class="chat-pins__head">
        <b>Закреплённые</b>
        <span class="muted">${s.pins.length ? plural(s.pins.length, 'сообщение', 'сообщения', 'сообщений') : ''}</span>
        <button type="button" class="chat-panel__x" data-chat-pins-toggle aria-label="Закрыть">✕</button>
      </header>
      ${s.pins.length
        ? `<ul class="chat-pins__list">
            ${s.pins.map((m) => `
              <li class="chat-pin">
                <button type="button" class="chat-pin__go" data-chat-jump="${esc(m.id)}">
                  <span class="chat-pin__who">
                    <b>${esc(m.authorNick)}</b>
                    <time>${esc(timeAgo(m.createdAt))}</time>
                  </span>
                  <span class="chat-pin__text">${esc(pinText(m))}</span>
                </button>
                ${isMgr
                  ? `<button type="button" class="chat-panel__x" data-chat-pin-off="${esc(m.id)}"
                             aria-label="Открепить" title="Открепить">✕</button>`
                  : ''}
              </li>`).join('')}
          </ul>`
        : '<p class="chat-panel__empty muted">Пока ничего не закреплено. Закрепить может владелец чата и его помощники — через меню сообщения.</p>'}
    </div>`;
}

function pinText(m) {
  const text = m.body?.trim();
  if (text) return excerpt(text, 140);
  const first = (m.attachments ?? [])[0];
  return first ? attachmentLabel(first.kind, m.attachments.length) : 'Сообщение';
}

function renderSearch(s) {
  return `
    <div class="chat-search" data-chat-search>
      <form class="chat-search__form" data-chat-search-form>
        <svg class="chat-search__icon" viewBox="0 0 24 24" width="16" height="16" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>
        </svg>
        <input class="chat-search__input" name="q" value="${esc(s.searchQ)}" autocomplete="off"
               placeholder="Что найти в переписке" aria-label="Поиск в переписке" maxlength="60" data-chat-search-input>
        <button type="submit" class="forum-btn forum-btn--ghost">Найти</button>
        <button type="button" class="chat-panel__x" data-chat-search-toggle aria-label="Закрыть">✕</button>
      </form>
      ${s.searchBusy ? '<p class="chat-panel__empty muted">Ищем…</p>' : ''}
      ${!s.searchBusy && s.searchResults
        ? (s.searchResults.length
          ? `<ul class="chat-search__list">
              ${s.searchResults.map((m) => `
                <li>
                  <button type="button" class="chat-found" data-chat-jump="${esc(m.id)}">
                    <span class="chat-found__who">
                      <b>${esc(m.authorNick)}</b>
                      <time>${esc(fullTime(m.createdAt))}</time>
                    </span>
                    <span class="chat-found__text">${markedText(m, s.searchQ)}</span>
                  </button>
                </li>`).join('')}
             </ul>
             <p class="chat-panel__empty muted">${plural(s.searchResults.length, 'найдено', 'найдено', 'найдено')} ${plural(s.searchResults.length, 'сообщение', 'сообщения', 'сообщений')}</p>`
          : '<p class="chat-panel__empty muted">Ничего не нашлось. Ищем по словам сообщения и по именам файлов.</p>')
        : ''}
      ${!s.searchResults && !s.searchBusy
        ? '<p class="chat-panel__empty muted">Ищем по словам сообщения и по именам файлов. Для поиска нужно хотя бы две буквы.</p>'
        : ''}
    </div>`;
}

/** Текст результата с подсветкой совпадения, но без разметки чужого HTML. */
function markedText(m, q) {
  const flat = m.body?.trim() ? excerpt(m.body, 160) : pinText(m);
  const needle = String(q ?? '').trim();
  if (!needle) return esc(flat);
  const lower = flat.toLowerCase();
  const at = lower.indexOf(needle.toLowerCase());
  if (at < 0) return esc(flat);
  return `${esc(flat.slice(0, at))}<mark>${esc(flat.slice(at, at + needle.length))}</mark>${esc(flat.slice(at + needle.length))}`;
}

function renderMembers(s, isMgr) {
  const roleWord = { owner: 'создатель', admin: 'помощник', member: '' };
  return `
    <div class="chat-members" data-chat-members>
      <header class="chat-pins__head">
        <b>Участники</b>
        <span class="muted">${plural(s.members.length, 'человек', 'человека', 'человек')}</span>
        <button type="button" class="chat-panel__x" data-chat-members-toggle aria-label="Закрыть">✕</button>
      </header>
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

/**
 * Настройки чата: то, что решает владелец.
 *
 * Правка названия и темы раньше была невозможна вовсе: ошиблись в названии —
 * создавай чат заново и зови людей по новой ссылке. Права на это в базе были,
 * не было экрана.
 */
function renderSettings(s, c, isMgr) {
  const canEdit = isMgr;
  return `
    <div class="chat-settings" data-chat-settings>
      <header class="chat-pins__head">
        <b>Настройки чата</b>
        <button type="button" class="chat-panel__x" data-chat-settings-toggle aria-label="Закрыть">✕</button>
      </header>

      ${canEdit
        ? `<form class="chat-settings__form" data-chat-settings-form>
            <div class="chat-settings__ava">
              ${chatMark(c, 'chat-settings__shot')}
              <div class="chat-settings__ava-acts">
                <label class="forum-act chat-settings__upload">
                  <input type="file" accept="image/*" hidden data-chat-avatar-input>
                  ${c.avatarUrl ? 'Заменить картинку' : 'Поставить картинку'}
                </label>
                ${c.avatarUrl ? '<button type="button" class="forum-act forum-act--danger" data-chat-avatar-clear>Убрать</button>' : ''}
                <small class="muted">Квадратная, до 256 точек.</small>
              </div>
            </div>

            <label class="forum-field">
              <span>Название</span>
              <input name="title" maxlength="60" value="${esc(c.title)}" required>
            </label>
            <div class="chat-settings__row">
              <label class="forum-field">
                <span>Тег</span>
                <input name="allianceTag" maxlength="12" value="${esc(c.allianceTag)}" placeholder="TAG">
              </label>
              <label class="forum-field">
                <span>Тема</span>
                <input name="topic" maxlength="${CHAT_LIMITS.topicMax}" value="${esc(c.topic)}"
                       placeholder="О чём чат">
              </label>
            </div>
            <div class="chat-settings__acts">
              <button type="submit" class="forum-btn">Сохранить</button>
              <button type="button" class="forum-btn forum-btn--ghost" data-chat-settings-toggle>Отмена</button>
            </div>
          </form>`
        : `<p class="chat-panel__empty muted">
             ${esc(c.topic || 'Тему чата пока не задали.')}
           </p>
           <p class="chat-panel__empty muted">Название и тему меняет владелец чата и его помощники.</p>`}

      ${isMgr
        ? `<div class="chat-settings__danger">
            <p class="muted">
              Удаление чата необратимо: вместе с ним уходят сообщения и файлы.
              Обычно хватает «Закрыть чат» — переписка останется читаемой.
            </p>
            <button type="button" class="forum-act forum-act--danger" data-chat-delete>Удалить чат навсегда</button>
          </div>`
        : ''}
    </div>`;
}

/* ── Лента ──────────────────────────────────────────────────────────────── */

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
    if (m.id === s.newFromId) {
      out += '<div class="chat-newline" data-chat-newline><span>Новые сообщения</span></div>';
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
      <li class="chat-msg chat-msg--gone ${mine ? 'is-mine' : ''}" id="m-${esc(m.id)}" data-chat-msg="${esc(m.id)}">
        <span class="chat-msg__gone">Сообщение удалено${m.deletedReason ? `: ${esc(m.deletedReason)}` : ''}</span>
      </li>`;
  }

  const canDelete = mine || isMgr;
  const canPin = canDelete || ['owner', 'admin'].includes(s.open?.myRole) || s.me.role === 'admin' || s.me.role === 'moderator';
  const attachments = (m.attachments ?? []).filter((a) => a?.url);
  const shots = attachments.filter((a) => a.kind === 'image');
  const others = attachments.filter((a) => a.kind !== 'image');
  const menuOpen = s.msgMenu === m.id;

  return `
    <li class="chat-msg ${mine ? 'is-mine' : ''} ${grouped ? 'is-grouped' : ''} ${s.highlight === m.id ? 'is-flash' : ''}"
        id="m-${esc(m.id)}" data-chat-msg="${esc(m.id)}">
      ${grouped ? '<span class="chat-msg__gap"></span>' : avatar(m.authorNick, m.authorAvatar)}
      <div class="chat-msg__bubble">
        ${grouped ? '' : `
          <div class="chat-msg__head">
            <a class="forum-nick" href="#/user/${encodeURIComponent(m.authorNick)}">${esc(m.authorNick)}</a>
            ${roleBadge({ role: m.authorRole }, { short: true })}
            ${m.authorIsLeader ? leaderBadge() : ''}
            ${m.authorAlliance ? `<small class="chat-msg__tag">${esc(m.authorAlliance)}</small>` : ''}
          </div>`}

        ${m.replyToId ? renderQuote(m) : ''}
        ${shots.length ? renderShots(m, shots) : ''}
        ${others.map((a) => renderOtherAttachment(a)).join('')}
        ${m.body?.trim() ? `<div class="chat-msg__body">${postBody(m.body)}</div>` : ''}

        ${renderReactions(m, s)}

        <div class="chat-msg__meta">
          ${m.pinned ? '<span class="chat-msg__pin" title="Закреплено">📌</span>' : ''}
          <time title="${esc(fullTime(m.createdAt))}">${esc(clock(m.createdAt))}</time>
          ${canDelete ? `<button type="button" class="chat-msg__del" data-chat-msg-delete="${esc(m.id)}" aria-label="Удалить">✕</button>` : ''}
        </div>
      </div>

      <div class="chat-msg__acts">
        <button type="button" class="chat-msg__act" data-chat-msg-reply="${esc(m.id)}" title="Ответить" aria-label="Ответить">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 7 7v3"/>
          </svg>
        </button>
        <button type="button" class="chat-msg__act" data-chat-msg-react="${esc(m.id)}" title="Реакция" aria-label="Поставить реакцию"
                aria-expanded="${s.reactFor === m.id ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01"/><path d="M15 9.5h.01"/>
          </svg>
        </button>
        <button type="button" class="chat-msg__act" data-chat-msg-menu="${esc(m.id)}" title="Ещё" aria-label="Ещё действия"
                aria-haspopup="menu" aria-expanded="${menuOpen ? 'true' : 'false'}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/>
          </svg>
        </button>
      </div>

      ${s.reactFor === m.id ? renderReactPicker(m) : ''}
      ${menuOpen ? renderMsgMenu(m, s, { canDelete, canPin }) : ''}
    </li>`;
}

/** Цитата ответа: нажатие ведёт к исходному сообщению. */
function renderQuote(m) {
  if (!m.replyToId) return '';
  const gone = m.replyDeleted;
  const text = gone
    ? 'сообщение удалено'
    : (m.replyBody?.trim() ? excerpt(m.replyBody, 120) : 'вложение');
  return `
    <button type="button" class="chat-quote" data-chat-jump="${esc(m.replyToId)}"
            title="Перейти к сообщению">
      <span class="chat-quote__who">${esc(m.replyNick || 'кто-то')}</span>
      <span class="chat-quote__text ${gone ? 'is-gone' : ''}">${esc(text)}</span>
    </button>`;
}

/**
 * Картинки.
 *
 * Одна — во всю ширину пузыря, дальше сеткой по две: скриншот интерфейса игры
 * при трёх в ряд на телефоне нечитаем. Если картинок больше, чем помещается
 * в сетку, на последней показываем «+N» — вместо стены мелких превью.
 */
function renderShots(m, shots) {
  const gridMax = CHAT_LIMITS.gridMax;
  const visible = shots.slice(0, gridMax);
  const rest = shots.length - visible.length;

  return `
    <div class="chat-shots chat-shots--${Math.min(visible.length, gridMax)}">
      ${visible.map((a, i) => `
        <button type="button" class="chat-shot" data-chat-shot="${esc(m.id)}:${i}"
                aria-label="Открыть картинку ${i + 1} из ${shots.length}">
          <img src="${esc(a.url)}" alt="${esc(a.name || 'Картинка')}" loading="lazy">
          ${rest && i === visible.length - 1 ? `<span class="chat-shot__more">+${rest}</span>` : ''}
        </button>`).join('')}
    </div>`;
}

/** Видео, голосовое, файл — всё, что не картинка. */
function renderOtherAttachment(a) {
  if (a.kind === 'video') {
    return `
      <figure class="chat-video">
        <video src="${esc(a.url)}" controls preload="metadata" playsinline></video>
        <figcaption class="chat-video__cap muted">
          ${esc(a.name)}${a.sizeBytes ? ` · ${esc(formatBytes(a.sizeBytes))}` : ''}
        </figcaption>
      </figure>`;
  }

  if (a.kind === 'audio') {
    return `
      <div class="chat-voice">
        <span class="chat-voice__mark" aria-hidden="true">🎤</span>
        <audio src="${esc(a.url)}" controls preload="metadata"></audio>
        ${a.durationMs ? `<span class="chat-voice__time">${esc(formatDuration(a.durationMs))}</span>` : ''}
      </div>`;
  }

  const ext = (a.name.split('.').pop() || 'файл').toUpperCase().slice(0, 5);
  return `
    <a class="chat-file" href="${esc(a.url)}" download="${esc(a.name)}" target="_blank" rel="noopener noreferrer">
      <span class="chat-file__mark" aria-hidden="true">${esc(KIND_GLYPH.file)}</span>
      <span class="chat-file__body">
        <b>${esc(a.name)}</b>
        <small class="muted">${esc(ext)}${a.sizeBytes ? ` · ${esc(formatBytes(a.sizeBytes))}` : ''}</small>
      </span>
      <svg class="chat-file__dl" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>
      </svg>
    </a>`;
}

/**
 * Реакции.
 *
 * В чате это быстрый отклик, поэтому своё нажатие идёт первым, а «кто именно»
 * показывается подсказкой: открывать список имён ради «+1» никто не станет.
 */
function renderReactions(m, s) {
  const list = Array.isArray(m.reactions) ? m.reactions.filter((r) => r?.emoji && r.count) : [];
  if (!list.length) return '';
  return `
    <div class="chat-reacts">
      ${list.map((r) => `
        <button type="button" class="chat-react ${r.mine ? 'is-mine' : ''}"
                data-chat-reaction="${esc(m.id)}" data-emoji="${esc(r.emoji)}"
                aria-pressed="${r.mine ? 'true' : 'false'}"
                title="${esc(`${r.count} · ${r.nicks.join(', ') || 'без имён'}`)}">
          <span aria-hidden="true">${esc(r.emoji)}</span><b>${esc(r.count)}</b>
        </button>`).join('')}
      <button type="button" class="chat-react chat-react--add" data-chat-msg-react="${esc(m.id)}"
              aria-label="Ещё реакция" title="Ещё реакция"><span aria-hidden="true">＋</span></button>
    </div>`;
}

function renderReactPicker(m) {
  const put = new Map((m.reactions ?? []).map((r) => [r.emoji, r]));
  return `
    <div class="chat-react-picker" role="menu" aria-label="Реакция">
      ${CHAT_REACTIONS.map((e) => `
        <button type="button" class="chat-react-picker__item ${put.get(e)?.mine ? 'is-mine' : ''}"
                data-chat-reaction="${esc(m.id)}" data-emoji="${esc(e)}" role="menuitem"
                title="${esc(e)}"><span aria-hidden="true">${esc(e)}</span></button>`).join('')}
    </div>`;
}

/** Меню действий сообщения: то, что делают редко, но метко. */
function renderMsgMenu(m, s, { canDelete, canPin }) {
  const link = `${location.origin}${location.pathname}#/chats/${esc(m.chatId)}/m/${esc(m.id)}`;
  const files = (m.attachments ?? []).filter((a) => a?.url);
  return `
    <div class="chat-msg__pop" role="menu">
      <button type="button" class="chat-menu__item" role="menuitem" data-chat-msg-reply="${esc(m.id)}">Ответить</button>
      ${m.body?.trim()
        ? `<button type="button" class="chat-menu__item" role="menuitem" data-chat-copy-text="${esc(m.id)}">Копировать текст</button>`
        : ''}
      ${files.length
        ? `<button type="button" class="chat-menu__item" role="menuitem" data-chat-copy="${esc(files[0].url)}">
             Скопировать ссылку на файл
           </button>`
        : ''}
      <button type="button" class="chat-menu__item" role="menuitem" data-chat-copy="${esc(link)}">Ссылка на сообщение</button>
      ${canPin
        ? `<button type="button" class="chat-menu__item" role="menuitem" data-chat-pin="${esc(m.id)}"
                   data-pin="${m.pinned ? 'off' : 'on'}">${m.pinned ? 'Открепить' : 'Закрепить'}</button>`
        : ''}
      ${canDelete
        ? `<button type="button" class="chat-menu__item chat-menu__item--danger" role="menuitem"
                   data-chat-msg-delete="${esc(m.id)}">Удалить</button>`
        : ''}
    </div>`;
}

/* ── Ввод ───────────────────────────────────────────────────────────────── */

function renderComposer(s, c, canWrite) {
  if (!canWrite) {
    if (c.closed) {
      return `<p class="chat-compose__locked muted">Чат закрыт${c.closedReason ? `: ${esc(c.closedReason)}` : ''}. Писать нельзя.</p>`;
    }
    if (!c.myRole) {
      return '<p class="chat-compose__locked muted">Вы смотрите этот чат как модерация — писать могут только участники.</p>';
    }
    return '<p class="chat-compose__locked muted">Вам запрещено писать.</p>';
  }

  if (s.recording) return renderRecording();

  const busy = s.sending || s.queue.some((q) => q.status === 'up' || q.status === 'wait');

  return `
    <form class="chat-compose ${s.queue.length ? 'has-queue' : ''}" data-chat-send>
      ${renderQueue(s)}
      ${s.replyTo ? renderReplyBanner(s.replyTo) : ''}
      <div class="chat-compose__row">
        <div class="chat-compose__tools">
          <label class="chat-tool" title="Прикрепить файл" aria-label="Прикрепить файл">
            <input type="file" multiple hidden data-chat-pick="file">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.6 3.6 0 0 1 5.1 5.1l-9.2 9.2a1.8 1.8 0 0 1-2.55-2.55l8.5-8.5"/>
            </svg>
          </label>
          <label class="chat-tool" title="Картинки и видео" aria-label="Картинки и видео">
            <input type="file" multiple accept="image/*,video/*" hidden data-chat-pick="media">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-5 4 4 3-3 4 4"/>
            </svg>
          </label>
          <button type="button" class="chat-tool" data-chat-voice title="Голосовое сообщение"
                  aria-label="Записать голосовое" ${supportsVoice() ? '' : 'hidden'}>
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>
            </svg>
          </button>
          <button type="button" class="chat-tool" data-chat-emoji-toggle title="Смайлы" aria-label="Смайлы"
                  aria-expanded="${s.emojiOpen ? 'true' : 'false'}">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01"/><path d="M15 9.5h.01"/>
            </svg>
          </button>
        </div>

        <textarea class="chat-compose__input" name="body" rows="1" maxlength="${CHAT_LIMITS.messageMax}"
                  placeholder="${s.queue.length ? 'Подпись к вложению…' : 'Сообщение…'}"
                  aria-label="Сообщение" data-chat-input></textarea>
        <button type="submit" class="chat-compose__send" aria-label="Отправить" ${busy ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
        </button>
      </div>
      ${s.emojiOpen ? renderEmoji(s) : ''}
      <p class="chat-compose__hint muted">
        Enter — отправить, Shift+Enter — новая строка. Картинку можно перетащить в окно или вставить из буфера.
      </p>
    </form>`;
}

/** В браузере, где нет записи звука, кнопка не показывается вовсе. */
function supportsVoice() {
  return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';
}

function renderRecording() {
  return `
    <div class="chat-compose chat-recording" data-chat-recording>
      <span class="chat-recording__dot" aria-hidden="true"></span>
      <b class="chat-recording__time" data-chat-rec-time>0:00</b>
      <span class="muted chat-recording__note">Идёт запись — говорите</span>
      <button type="button" class="forum-act" data-chat-rec-cancel>Отменить</button>
      <button type="button" class="chat-compose__send chat-recording__send" data-chat-rec-send aria-label="Отправить голосовое">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
      </button>
    </div>`;
}

function renderReplyBanner(m) {
  return `
    <div class="chat-reply-banner" data-chat-reply-banner>
      <span class="chat-reply-banner__bar" aria-hidden="true"></span>
      <span class="chat-reply-banner__body">
        <b>Ответ ${esc(m.authorNick)}</b>
        <small class="muted">${esc(m.body?.trim() ? excerpt(m.body, 90) : 'вложение')}</small>
      </span>
      <button type="button" class="chat-panel__x" data-chat-reply-cancel aria-label="Отменить ответ">✕</button>
    </div>`;
}

/** Очередь вложений: что грузится, что готово, что не приняли. */
function renderQueue(s) {
  if (!s.queue.length) return '';
  return `
    <div class="chat-queue" data-chat-queue>
      ${s.queue.map((q) => `
        <div class="chat-drop ${q.status === 'error' ? 'is-error' : ''}" data-chat-drop="${esc(q.id)}">
          ${q.preview
            ? `<img class="chat-drop__shot" src="${esc(q.preview)}" alt="">`
            : `<span class="chat-drop__shot chat-drop__shot--mark" aria-hidden="true">${esc(KIND_GLYPH[q.kind] ?? '📎')}</span>`}
          <span class="chat-drop__body">
            <b class="chat-drop__name">${esc(q.name)}</b>
            <small class="chat-drop__meta">
              ${q.status === 'error'
                ? esc(q.error || 'не загрузилось')
                : q.status === 'done'
                  ? `${esc(formatBytes(q.size))} · готово`
                  : `${esc(formatBytes(q.size))} · ${Math.round((q.progress ?? 0) * 100)}%`}
            </small>
            ${q.status === 'up' || q.status === 'wait'
              ? `<span class="chat-drop__bar"><i style="width:${Math.round((q.progress ?? 0) * 100)}%"></i></span>`
              : ''}
          </span>
          <button type="button" class="chat-drop__x" data-chat-queue-drop="${esc(q.id)}"
                  aria-label="Убрать вложение">✕</button>
        </div>`).join('')}
    </div>`;
}

/**
 * Смайлы.
 *
 * Короткий набор, а не полная таблица Unicode: в игре и в разговоре
 * о замесах хватает сотни знаков, а список на две тысячи пунктов на телефоне
 * не листается. Недавние — сверху, их помнит браузер (см. src/forum/chats.js).
 */
const EMOJI_GROUPS = [
  {
    name: 'Часто в игре',
    list: ['👍', '🔥', '⚔', '🛡', '🏆', '💪', '🎯', '🚀', '⏰', '📌', '✅', '❌', '⚠', '🤝', '🫡', '👏'],
  },
  {
    name: 'Смайлы',
    list: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂', '😉', '😊', '😍', '😎', '🤔', '🤨', '😐', '😴',
      '😢', '😭', '😤', '😡', '🤯', '😱', '🥳', '🤒', '🤢', '😇', '🙃', '😬'],
  },
  {
    name: 'Жесты',
    list: ['👋', '✌', '🤞', '👌', '🙏', '💯', '👊', '🤜', '🫶', '👀', '🧠', '❤️', '💔', '🎉', '🎁', '🍺'],
  },
];

function renderEmoji(s) {
  const recent = Array.isArray(s.emojiRecent) ? s.emojiRecent : [];
  return `
    <div class="chat-emoji" data-chat-emoji>
      ${recent.length
        ? `<div class="chat-emoji__row">
             <span class="chat-emoji__title muted">Недавние</span>
             ${recent.map((e) => `<button type="button" class="chat-emoji__item" data-chat-emoji="${esc(e)}"><span aria-hidden="true">${esc(e)}</span></button>`).join('')}
           </div>`
        : ''}
      ${EMOJI_GROUPS.map((g) => `
        <div class="chat-emoji__row">
          <span class="chat-emoji__title muted">${esc(g.name)}</span>
          ${g.list.map((e) => `<button type="button" class="chat-emoji__item" data-chat-emoji="${esc(e)}"><span aria-hidden="true">${esc(e)}</span></button>`).join('')}
        </div>`).join('')}
    </div>`;
}

/* ── Просмотр картинки ──────────────────────────────────────────────────── */

function renderLightbox(s) {
  const items = s.lightbox.items ?? [];
  const a = items[s.lightbox.index];
  if (!a) return '';
  const many = items.length > 1;
  return `
    <div class="chat-lightbox" data-chat-lightbox role="dialog" aria-modal="true" aria-label="Просмотр картинки">
      <button type="button" class="chat-lightbox__x" data-chat-lightbox-close aria-label="Закрыть">✕</button>
      ${many && s.lightbox.index > 0
        ? '<button type="button" class="chat-lightbox__nav chat-lightbox__nav--prev" data-chat-lightbox-step="-1" aria-label="Предыдущая">‹</button>'
        : ''}
      <img class="chat-lightbox__img" src="${esc(a.url)}" alt="${esc(a.name || 'Картинка')}">
      ${many && s.lightbox.index < items.length - 1
        ? '<button type="button" class="chat-lightbox__nav chat-lightbox__nav--next" data-chat-lightbox-step="1" aria-label="Следующая">›</button>'
        : ''}
      <footer class="chat-lightbox__foot">
        <span class="muted">${esc(many ? `${s.lightbox.index + 1} из ${items.length}` : a.name || '')}</span>
        <a class="forum-act" href="${esc(a.url)}" download="${esc(a.name || 'картинка')}"
           target="_blank" rel="noopener noreferrer">Открыть в новой вкладке</a>
      </footer>
    </div>`;
}

/* ── Мелочи ─────────────────────────────────────────────────────────────── */

export function leaderBadge() {
  return '<span class="role-badge" style="--role-tone:#5cc8ff" title="лидер альянса" role="img" aria-label="лидер альянса"><i aria-hidden="true">⚑</i><b>лидер</b></span>';
}

function avatar(nick, url) {
  if (url) return `<img class="forum-ava forum-ava--sm" src="${esc(url)}" alt="" loading="lazy" width="28" height="28">`;
  return `<span class="forum-ava forum-ava--sm" style="--ava:${esc(nickColor(nick))}">${esc(nickInitial(nick))}</span>`;
}

export function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(d, now = new Date()) {
  if (dayKey(d) === dayKey(now)) return 'Сегодня';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function clock(d) {
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
