import { esc, plural } from '../../ui/helpers.js';
import { roleLabel } from '../../forum/roles.js';
import { fullTime, timeAgo, textOf } from '../../forum/format.js';

/**
 * ЭКРАН «ЧАТЫ» — закрытые чаты альянсов глазами модерации.
 *
 * Здесь видно всё: какие чаты есть, кто их создал, сколько людей, когда
 * последнее сообщение. Открыв чат — участников и последние сто сообщений.
 * Это не тайное чтение: у входа в каждый чат написано, что модерация сайта
 * его видит. Чат без ответственного за него человека — это не чат, а канал
 * для того, что нельзя сказать вслух.
 *
 * ЧТО ЗДЕСЬ МОЖНО: закрыть чат (история остаётся, писать нельзя), открыть
 * обратно, удалить целиком, выгнать участника, удалить сообщение с причиной.
 * Кого назначать лидером — на вкладке «Игроки».
 *
 * Права держит база (supabase/chats.sql), панель только показывает кнопки.
 */
export function renderChatsAdmin(view) {
  const forum = view.forum ?? {};

  if (!forum.configured) {
    return `
      <section class="panel">
        <header class="panel__head">
          <span class="eyebrow">Форум</span>
          <h1 class="adm-h1">Чаты</h1>
        </header>
        <p class="adm-lead">Форум не подключён — чатов нет. Порядок подключения в <code>docs/FORUM.md</code>.</p>
      </section>`;
  }
  if (forum.error) {
    return `
      <section class="panel error">
        <h1 class="adm-h1">Форум не отвечает</h1>
        <p class="adm-lead">${esc(forum.error)}</p>
        <div class="adm-actions"><button type="button" class="adm-btn" data-forum-reload>Попробовать снова</button></div>
      </section>`;
  }
  if (!forum.me) {
    return `
      <section class="panel">
        <header class="panel__head"><span class="eyebrow">Форум</span><h1 class="adm-h1">Чаты</h1></header>
        <p class="adm-lead">Вы не вошли на форум в этом браузере. Откройте сайт, войдите и вернитесь.</p>
        <div class="adm-actions">
          <a class="adm-btn" href="./index.html#/forum">Открыть форум</a>
          <button type="button" class="adm-btn" data-forum-reload>Проверить снова</button>
        </div>
      </section>`;
  }
  if (forum.me.role !== 'admin' && forum.me.role !== 'moderator') {
    return `
      <section class="panel">
        <header class="panel__head"><span class="eyebrow">Форум</span><h1 class="adm-h1">Чаты</h1></header>
        <p class="adm-lead">Вы вошли как <b>${esc(forum.me.nick)}</b> (${esc(roleLabel(forum.me))}). Чаты видит модерация.</p>
      </section>`;
  }
  if (!forum.chats) return '<div class="loading">Читаем чаты…</div>';

  const chats = forum.chats;
  const open = chats.filter((c) => !c.closed).length;
  const people = chats.reduce((n, c) => n + c.memberCount, 0);

  return `
    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Форум · закрытые чаты</span>
        <h1 class="adm-h1">Чаты</h1>
        <p class="adm-lead">
          ${esc(String(chats.length))} ${esc(plural(chats.length, 'чат', 'чата', 'чатов').replace(/^\d+\s/, ''))},
          ${esc(String(open))} открыт${open === 1 ? '' : 'о'}, ${esc(plural(people, 'участие', 'участия', 'участий'))}.
          Лидеров назначают на вкладке «Игроки». Здесь — сами чаты: закрыть, удалить, выгнать, убрать сообщение.
        </p>
      </header>

      <div class="adm-result" data-chats-result hidden></div>

      ${chats.length ? `<div class="adm-chats">${chats.map((c) => renderChatRow(c, forum)).join('')}</div>` : `
        <p class="muted">Чатов ещё нет. Появятся, когда первый лидер создаст свой.</p>`}
    </section>`;
}

function renderChatRow(c, forum) {
  const isOpen = forum.chatOpenId === c.id;
  const kind = c.kind === 'inter' ? 'межальянсовый' : 'альянсовый';
  return `
    <div class="adm-chat ${c.closed ? 'is-closed' : ''} ${isOpen ? 'is-open' : ''}">
      <div class="adm-chat__row">
        <div class="adm-chat__who">
          <b>${esc(c.title)} ${c.closed ? '<span class="adm-badge adm-badge--stop">закрыт</span>' : ''}</b>
          <small>
            ${esc(kind)}${c.allianceTag ? ` · ${esc(c.allianceTag)}` : ''} ·
            создал ${esc(c.ownerNick || '—')} · ${esc(plural(c.memberCount, 'участник', 'участника', 'участников'))}
            ${c.lastAt ? ` · последнее ${esc(timeAgo(c.lastAt))}` : ' · сообщений нет'}
          </small>
        </div>
        <div class="adm-chat__acts">
          <button type="button" class="adm-btn ${isOpen ? '' : 'adm-btn--primary'}" data-chat-open="${esc(c.id)}">
            ${isOpen ? 'Свернуть' : 'Открыть'}
          </button>
          <button type="button" class="adm-btn" data-chat-close="${esc(c.id)}" data-chat-closed="${c.closed ? '1' : ''}">
            ${c.closed ? 'Открыть снова' : 'Закрыть'}
          </button>
          <button type="button" class="adm-btn adm-btn--danger" data-chat-delete="${esc(c.id)}" data-chat-title="${esc(c.title)}">
            Удалить
          </button>
        </div>
      </div>
      ${isOpen ? renderChatDetail(c, forum) : ''}
    </div>`;
}

function renderChatDetail(c, forum) {
  if (forum.chatError) return `<p class="adm-error">${esc(forum.chatError)}</p>`;
  if (!forum.chatMessages) return '<div class="loading">Читаем…</div>';
  const members = forum.chatMembers ?? [];
  const roleWord = { owner: 'создатель', admin: 'помощник', member: '' };
  return `
    <div class="adm-chat__detail">
      <div class="adm-chat__members">
        <span class="eyebrow">Участники · ${esc(String(members.length))}</span>
        <ul>
          ${members.map((m) => `
            <li>
              <span><b>${esc(m.nick)}</b>${m.allianceTag ? ` <small class="muted">${esc(m.allianceTag)}</small>` : ''}${roleWord[m.role] ? ` <small class="muted">· ${roleWord[m.role]}</small>` : ''}</span>
              ${m.role !== 'owner' ? `<button type="button" class="adm-btn adm-btn--sm" data-chat-kick="${esc(m.userId)}">Выгнать</button>` : ''}
            </li>`).join('')}
        </ul>
        <p class="muted" style="margin:8px 0 0;font-size:11.5px">Код приглашения: <code class="adm-mono">${esc(c.inviteCode)}</code></p>
      </div>
      <div class="adm-chat__messages">
        <span class="eyebrow">Последние сообщения · ${esc(String(forum.chatMessages.length))}</span>
        ${forum.chatMessages.length ? `
          <ul>
            ${forum.chatMessages.map((m) => `
              <li class="${m.deleted ? 'is-deleted' : ''}">
                <span class="adm-chat__msg-head">
                  <b>${esc(m.authorNick || '—')}</b>
                  <time title="${esc(fullTime(m.createdAt))}">${esc(timeAgo(m.createdAt))}</time>
                  ${m.deleted ? '' : `<button type="button" class="adm-chat__msg-del" data-chat-msg-delete="${esc(m.id)}" aria-label="Удалить">✕</button>`}
                </span>
                <span class="adm-chat__msg-body">${m.deleted ? `<i>удалено${m.deletedReason ? `: ${esc(m.deletedReason)}` : ''}</i>` : esc(textOf(m.body))}</span>
              </li>`).join('')}
          </ul>` : '<p class="muted">Пусто.</p>'}
      </div>
    </div>`;
}
