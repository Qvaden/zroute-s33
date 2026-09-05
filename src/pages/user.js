/**
 * СТРАНИЦА УЧАСТНИКА И ПРАВКА СВОЕГО ПРОФИЛЯ.
 *
 * Открывается по адресу #/user/Ковыль — по нику, а не по идентификатору:
 * такую ссылку читает человек и кидает в чат.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ, А ЧЕГО НЕТ. Видно только то, что можно показать чужому:
 * ник, аватарка, подпись, альянс, дата регистрации, счётчики и последние посты.
 * Запретов, тишины и служебных полей нет — не «скрыты», а не выбраны
 * (см. представление forum_profiles в supabase/profiles.sql).
 *
 * Функции чистые: получают данные, возвращают строку. Живое поведение —
 * в forum/mount.js, как и у ленты.
 */
import { esc } from '../ui/helpers.js';
import { excerpt, timeAgo, fullTime, nickColor, nickInitial } from '../forum/format.js';
import { roleBadge, roleLabel } from '../forum/roles.js';

/**
 * @param {{
 *   profile: import('../forum/profile.js').Profile|null,
 *   posts?: any[],
 *   me?: any,
 *   editing?: boolean,
 *   loading?: boolean,
 *   error?: string,
 *   nick?: string,
 * }} state
 */
export function renderUserPage(state = {}) {
  const { profile, posts = [], me, editing = false, loading = false, error = '', nick = '' } = state;

  if (loading) return '<div class="loading">Открываем профиль…</div>';

  if (error) {
    return `<section class="panel error">
      <h2>Не удалось открыть профиль</h2>
      <p>${esc(error)}</p>
      <a class="forum-btn" href="#/forum">К форуму</a>
    </section>`;
  }

  if (!profile) {
    /*
      Ник из адреса показываем в сообщении: ссылка могла прийти из чата
      с опечаткой, и «участник Ковылль не найден» объясняет, что искать,
      а просто «не найден» — нет.
    */
    return `<section class="panel forum-empty">
      <span class="eyebrow">Профиль</span>
      <h2>Такого участника нет</h2>
      <p class="muted">
        ${nick ? `Ник <b>${esc(nick)}</b> на форуме не зарегистрирован.` : 'Участник не найден.'}
        Возможно, в ссылке опечатка.
      </p>
      <a class="forum-btn" href="#/forum">К форуму</a>
    </section>`;
  }

  const isMe = Boolean(me && me.id === profile.id);

  return `
    ${renderCard(profile, isMe, editing)}
    ${editing && isMe ? renderEditForm(profile) : ''}
    ${renderStats(profile)}
    ${renderPosts(profile, posts)}`;
}

/* ── Карточка ─────────────────────────────────────────────────────────────── */

function renderCard(p, isMe, editing) {
  return `
    <section class="hero forum-profile">
      <div class="forum-profile__top">
        ${renderAvatar(p, 'lg')}

        <div class="forum-profile__ident">
          <h1 class="forum-profile__nick">${esc(p.nick)}</h1>
          <div class="forum-profile__meta">
            ${roleBadge(p) || `<span class="forum-profile__role">${esc(roleLabel(p))}</span>`}
            ${p.allianceTag ? `<span class="forum-profile__ally">${esc(p.allianceTag)}</span>` : ''}
            <span class="muted">с ${esc(joinDate(p.createdAt))}</span>
          </div>
          ${p.about ? `<p class="forum-profile__about">${esc(p.about)}</p>` : ''}
        </div>

        ${
          isMe
            ? `<button type="button" class="forum-btn forum-btn--ghost forum-profile__edit"
                       data-profile-edit>${editing ? 'Свернуть' : 'Изменить профиль'}</button>`
            : ''
        }
      </div>
    </section>`;
}

/**
 * Аватарка или буква в цветном квадрате.
 *
 * Буква — не заглушка «пока не загрузил», а полноценный вариант: цвет считается
 * из ника и всегда один и тот же, поэтому знакомого человека видно в ленте
 * по цвету, даже если картинки у него нет. Заставлять загружать фото ради
 * узнаваемости незачем.
 */
function renderAvatar(p, size = 'md') {
  const cls = `forum-ava forum-ava--${size}`;
  if (p.avatarUrl) {
    return `<img class="${cls} forum-ava--img" src="${esc(p.avatarUrl)}"
                 alt="Аватарка ${esc(p.nick)}" loading="lazy" width="96" height="96">`;
  }
  return `<span class="${cls}" style="--ava:${esc(nickColor(p.nick))}">${esc(nickInitial(p.nick))}</span>`;
}

/* ── Правка ───────────────────────────────────────────────────────────────── */

function renderEditForm(p) {
  return `
    <section class="panel forum-profile-edit">
      <header class="panel__head">
        <span class="eyebrow">Свой профиль</span>
        <h2>Как вас видят другие</h2>
      </header>

      <form data-profile-form>
        <div class="forum-profile-edit__ava">
          ${renderAvatar(p, 'lg')}
          <div class="forum-profile-edit__ava-acts">
            <label class="forum-btn forum-btn--ghost">
              <span>${p.avatarUrl ? 'Заменить фото' : 'Загрузить фото'}</span>
              <input type="file" accept="image/*" data-avatar-input hidden>
            </label>
            ${
              p.avatarUrl
                ? '<button type="button" class="forum-act" data-avatar-clear>Убрать фото</button>'
                : ''
            }
            <small class="muted">
              Любая картинка. Обрежется по центру в квадрат и уменьшится —
              загружать что-то особенное не нужно.
            </small>
          </div>
        </div>
        <p class="forum-error" data-avatar-error hidden></p>

        <label class="forum-field">
          <span>Ник</span>
          <input type="text" value="${esc(p.nick)}" disabled>
          <!--
            Ник не меняется, и об этом сказано прямо. Причина не в лени:
            на ник ссылаются копии в постах, и смена оставила бы старые записи
            подписанными прежним именем. Честнее не давать, чем дать наполовину.
          -->
          <small class="muted">Ник изменить нельзя: им подписаны все ваши посты.</small>
        </label>

        <label class="forum-field">
          <span>Альянс</span>
          <input type="text" name="allianceTag" maxlength="12" value="${esc(p.allianceTag)}"
                 placeholder="например KOP" autocomplete="off">
          <small class="muted">Тег как в игре. Можно оставить пустым.</small>
        </label>

        <label class="forum-field">
          <span>О себе</span>
          <textarea name="about" rows="3" maxlength="200"
                    placeholder="Одна строка о себе: роль в альянсе, часовой пояс, что угодно">${esc(p.about)}</textarea>
          <small class="muted">До 200 символов.</small>
        </label>

        <div class="forum-composer__actions">
          <button type="submit" class="forum-btn">Сохранить</button>
          <button type="button" class="forum-btn forum-btn--ghost" data-profile-cancel>Отмена</button>
        </div>
        <p class="forum-error" data-profile-error hidden></p>
      </form>
    </section>`;
}

/* ── Счётчики ─────────────────────────────────────────────────────────────── */

function renderStats(p) {
  const items = [
    { value: p.postCount, label: pluralWord(p.postCount, 'пост', 'поста', 'постов') },
    { value: p.commentCount, label: pluralWord(p.commentCount, 'ответ', 'ответа', 'ответов') },
    { value: p.likesReceived, label: pluralWord(p.likesReceived, 'согласие', 'согласия', 'согласий') },
  ];

  return `
    <div class="forum-profile__stats">
      ${items
        .map(
          (s) => `<div class="forum-profile__stat">
            <b class="num">${s.value}</b><span>${esc(s.label)}</span>
          </div>`
        )
        .join('')}
    </div>`;
}

/* ── Посты участника ──────────────────────────────────────────────────────── */

function renderPosts(profile, posts) {
  if (!posts.length) {
    return `<section class="panel">
      <p class="muted">${esc(profile.nick)} пока ничего не написал.</p>
    </section>`;
  }

  return `
    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Что писал</span>
        <h2>Последние посты</h2>
      </header>
      <ul class="forum-profile__posts">
        ${posts
          .map((p) => {
            const date = p.created_at ? new Date(p.created_at) : null;
            return `<li>
              <a href="#/forum/${esc(p.id)}">${esc(p.title)}</a>
              <div class="forum-profile__post-meta muted">
                ${date ? `<time title="${esc(fullTime(date))}">${esc(timeAgo(date))}</time>` : ''}
                ${Number(p.comment_count) ? `<span>💬 ${Number(p.comment_count)}</span>` : ''}
                ${Number(p.score) ? `<span>${Number(p.score) > 0 ? '+' : ''}${Number(p.score)}</span>` : ''}
              </div>
              ${p.body ? `<p class="forum-profile__post-text muted">${esc(excerpt(p.body, 140))}</p>` : ''}
            </li>`;
          })
          .join('')}
      </ul>
    </section>`;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function joinDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function pluralWord(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}