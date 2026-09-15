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
import { esc, pluralWord } from '../ui/helpers.js';
import { excerpt, timeAgo, fullTime, avatarHtml } from '../forum/format.js';
import { roleBadge, roleLabel, verifiedBadge } from '../forum/roles.js';

function isOnline(lastSeen) {
  if (!lastSeen) return false;
  const d = lastSeen instanceof Date ? lastSeen : new Date(lastSeen);
  return Date.now() - d.getTime() < 5 * 60 * 1000;
}
import { levelOf, progressOf, achievementsOf, doneCount } from '../forum/rank.js';

/**
 * @param {{
 *   profile: import('../forum/profile.js').Profile|null,
 *   posts?: any[],
 *   activity?: import('../forum/contract.js').ForumUserActivity|null,
 *   me?: any,
 *   editing?: boolean,
 *   loading?: boolean,
 *   error?: string,
 *   nick?: string,
 *   history?: {createdAt: Date, oldNick: string, newNick: string, changedBy: string|null, reason: string}|null,
 * }} state
 */
export function renderUserPage(state = {}) {
  const { profile, posts = [], activity = null, me, editing = false, loading = false, error = '', nick = '', history = null } = state;

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
    ${renderVerify(profile, me)}
    ${renderNickLog(profile, me, history, isMe)}
    ${editing && isMe ? renderEditForm(profile) : ''}
    ${renderStats(profile)}
    ${renderActivity(activity, isMe)}
    ${profile.isBlogger ? renderBlog(profile, posts) : ''}
    ${renderRank(profile)}
    ${renderPosts(profile, posts)}`;
}

/* ── Карточка ─────────────────────────────────────────────────────────────── */

function renderCard(p, isMe, editing) {
  return `
    <section class="hero forum-profile">
      <div class="forum-profile__top">
        ${renderAvatar(p, 'lg')}

        <div class="forum-profile__ident">
          <h1 class="forum-profile__nick">${esc(p.nick)}${isOnline(p.lastSeenAt) ? '<span class="online-dot" title="В сети"></span>' : ''}</h1>
          <div class="forum-profile__meta">
            ${roleBadge(p) || `<span class="forum-profile__role">${esc(roleLabel(p))}</span>`}
            ${verifiedBadge(p.isVerified)}
            ${p.isBlogger ? '<span class="forum-profile__role forum-profile__role--blogger" title="Ведёт свой блог">✍️ Блогер</span>' : ''}
            ${p.allianceTag ? `<span class="forum-profile__ally">${esc(p.allianceTag)}</span>` : ''}
            <span class="muted">с ${esc(joinDate(p.createdAt))}</span>
          </div>
          ${p.about ? `<p class="forum-profile__about">${esc(p.about)}</p>` : ''}
        </div>

        ${
          isMe
            ? `<button type="button" class="forum-btn forum-btn--ghost forum-profile__edit"
                       data-profile-edit>${editing ? 'Свернуть' : 'Изменить профиль'}</button>`
            : `<button type="button" class="forum-btn forum-btn--ghost${p.iLiked ? ' is-liked' : ''}" data-profile-like data-user-id="${esc(p.id)}" title="Репутация">
                 <span class="forum-like-icon">${p.iLiked ? '♥' : '♡'}</span> <span class="forum-like-count">${p.profileLikes ?? 0}</span>
               </button>`
        }
      </div>
    </section>`;
}

/* ── Подтверждение ника ────────────────────────────────────────────────────── */

function isStaffMe(me) {
  return Boolean(me && (me.role === 'admin' || me.role === 'moderator'));
}

/*
  Кто может подтвердить ник здесь — ровно те же, кого пускает forum_set_verified
  в базе: модерация (любому) или лидер альянса (участнику своего альянса).
  Себе подтвердить нельзя — проверка вниз идёт сквозь, от разметки до базы.
*/
function canVerify(me, p) {
  if (!me || !p || me.id === p.id) return false;
  if (isStaffMe(me)) return true;
  return Boolean(me.leaderOf && p.allianceTag && me.leaderOf === p.allianceTag);
}

function renderVerify(p, me) {
  if (!canVerify(me, p)) return '';
  const verified = Boolean(p.isVerified);

  return `
    <section class="panel forum-verify">
      <div class="forum-verify__text">
        <b>Подтверждение ника</b>
        <p class="muted">
          ${
            verified
              ? 'Ник подтверждён: у имени стоит знак ✓, и игрок может открывать чаты.'
              : 'Ник не подтверждён: серая метка «!» и право открывать чаты закрыто.'
          }
          ${
            isStaffMe(me)
              ? ' Подтверждение снимается тем же нажатием.'
              : ' Вы лидер его альянса — подтвердите, что это свой человек.'
          }
        </p>
      </div>
      <button type="button" class="forum-btn${verified ? ' forum-btn--ghost' : ''}"
              data-profile-verify="${esc(p.id)}" data-profile-ver="${verified ? '1' : ''}">
        ${verified ? 'Снять подтверждение' : 'Подтвердить ник'}
      </button>
    </section>`;
}

/* ── Журнал переименований ────────────────────────────────────────────────── */

/*
  Виден самому игроку и модерации — тем, кому его отдаёт forum_nick_history_list.
  Лидер альянса журнал не видит: подтверждать — да, разбирать историю имён —
  задача модерации.
*/
function renderNickLog(p, me, history, isMe) {
  if (!isMe && !isStaffMe(me)) return '';
  if (!Array.isArray(history)) return '';

  return `
    <section class="panel forum-nicklog">
      <header class="panel__head">
        <span class="eyebrow">Журнал имён</span>
        <h2>История переименований</h2>
      </header>
      ${
        history.length
          ? `<ul class="forum-nicklog__list">
        ${history
          .map((h) => {
            const d = h.createdAt instanceof Date ? h.createdAt : new Date(h.createdAt);
            return `<li class="forum-nicklog__item">
              <code>${esc(h.oldNick)} → ${esc(h.newNick)}</code>
              <span class="muted">${esc(fullTime(d))} · ${h.changedBy ? 'владелец' : 'сам игрок'}${h.reason ? ` · ${esc(h.reason)}` : ''}</span>
            </li>`;
          })
          .join('')}
      </ul>`
          : '<p class="muted">Ник не менялся.</p>'
      }
    </section>`;
}

/* ── Блог ─────────────────────────────────────────────────────────────────── */
/*
  Блок блога появляется только у блогеров. Внутри — размер блога и общее число
  просмотров его записей: именно это «сколько посещений блога» видит сам автор.
  Список постов блога — это обычные посты раздела «Блоги», поэтому они уже
  в списке `posts` на этой странице.
*/
function renderBlog(p, posts) {
  const blogPosts = posts.filter((x) => x.category === 'blog');

  return `
    <section class="panel forum-blog">
      <div class="forum-blog__head">
        <span class="forum-blog__badge">✍️ Блог</span>
        <div class="forum-blog__stats">
          <div class="forum-profile__stat">
            <b class="num">${p.blogPostCount > 0 ? p.blogPostCount : blogPosts.length}</b><span>записей</span>
          </div>
          <div class="forum-profile__stat">
            <b class="num">${p.blogViews}</b><span>просмотров</span>
          </div>
        </div>
        <a class="forum-btn forum-btn--ghost" href="#/forum">Все записи блогов</a>
      </div>
      ${
        blogPosts.length
          ? `<ul class="forum-profile__posts">
          ${blogPosts
            .map((x) => {
              const date = x.created_at ? new Date(x.created_at) : null;
              return `<li>
                <a href="#/forum/${esc(x.id)}">${esc(x.title)}</a>
                <div class="forum-profile__post-meta muted">
                  ${date ? `<time title="${esc(fullTime(date))}">${esc(timeAgo(date))}</time>` : ''}
                  ${Number(x.views) ? `<span>👁 ${Number(x.views)}</span>` : ''}
                  ${Number(x.score) ? `<span>${Number(x.score) > 0 ? '+' : ''}${Number(x.score)}</span>` : ''}
                </div>
              </li>`;
            })
            .join('')}
        </ul>`
          : `<p class="muted">Записей в блоге пока нет.</p>`
      }
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
  return avatarHtml(p.nick, p.avatarUrl, { size, px: 96, alt: `Аватарка ${p.nick}` });
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
          <input type="text" name="nick" maxlength="40" value="${esc(p.nick)}" autocomplete="off">
          <small class="muted">
            Смена ника разрешена: старые записи переподписываются новым именем,
            а история переименований остаётся в журнале владельца.
          </small>
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
    { value: p.profileLikes ?? 0, label: '♡ репутация' },
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

/* ── Личная статистика: GitHub-график ─────────────────────────────────────── */

const WEEKDAY = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Тепловая карта активности за полгода — строками дни недели, колонками недели,
 * как в GitHub. Каждая клетка — один день, интенсивность — сколько записей
 * (посты + комментарии + сообщения) человек оставил. Рядом — число его чатов,
 * но только своё: чужая статистика площадей скрыта (см. контракт).
 */
function renderActivity(activity, isMe) {
  if (!activity || !Array.isArray(activity.days) || !activity.days.length) return '';

  const days = activity.days;
  const daily = days.map((d) => d.forumPosts + d.forumComments + d.chatMessages);
  const max = Math.max(...daily);

  // Режем массив дней по неделям с начала массива.
  const columns = [];
  for (let i = 0; i < days.length; i += 7) columns.push(days.slice(i, i + 7));

  const cell = (d, v) => {
    const level = v === 0 ? 0 : 1 + Math.min(3, Math.round((v / Math.max(1, max)) * 3));
    const title = v ? `${v} ${pluralWord(v, 'запись', 'записи', 'записей')}` : 'нет записей';
    return `<span class="gh-cell gh-cell--${level}" title="${title}"></span>`;
  };

  return `
    <section class="panel forum-ghlog" aria-label="Активность">
      <header class="panel__head">
        <span class="eyebrow">За последние 20 недель</span>
        <h2>Активность</h2>
        <span class="forum-ghlog__chats">${isMe && activity.chatsJoined != null
          ? `💬 в ${activity.chatsJoined} ${pluralWord(activity.chatsJoined, 'чате', 'чатах', 'чатах')}`
          : ''}</span>
      </header>
      <div class="forum-ghlog__wrap">
        <div class="forum-ghlog__labels">
          ${WEEKDAY.map((w, i) => (days.some((d) => (d.day.getDay() + 6) % 7 === i) ? `<span>${w}</span>` : '<span></span>')).join('')}
        </div>
        <div class="forum-ghlog__grid">
          ${columns.map((week) => {
            const dayCells = Array.from({ length: 7 });
            for (const d of week) {
              const i = (d.day.getDay() + 6) % 7;
              const dailyV = d.forumPosts + d.forumComments + d.chatMessages;
              dayCells[i] = cell(d, dailyV);
            }
            return `<div class="forum-ghlog__column">${dayCells.map((c) => c ?? '<span class="gh-cell gh-cell--0"></span>').join('')}</div>`;
          }).join('')}
        </div>
      </div>
    </section>`;
}

/* ── Уровень и достижения ────────────────────────────────────────────────── */

function renderRank(p) {
  const cur = levelOf(p);
  const prog = progressOf(p);
  const achs = achievementsOf(p);
  const done = doneCount(p);
  const total = achs.length;

  return `
    <section class="panel forum-rank">
      <header class="forum-rank__head">
        <span class="eyebrow">Активность</span>
        <span class="forum-rank__level">Уровень ${cur.level}: <b>${esc(cur.title)}</b></span>
      </header>

      ${prog.to
        ? `<div class="forum-rank__bar">
          <div class="forum-rank__fill" style="width:${prog.pct}%"></div>
          <span class="forum-rank__label">${prog.points} из ${prog.to} точек до следующего уровня</span>
        </div>`
        : `<p class="forum-rank__label forum-rank__label--top">Максимальный уровень</p>`}

      <div class="forum-rank__achs">
        ${achs
          .map(
            (a) => `<span class="forum-rank__ach ${a.done ? 'forum-rank__ach--done' : ''}"
                           title="${esc(a.hint)}">${esc(a.title)}</span>`
          )
          .join('')}
      </div>
      <p class="forum-rank__sum muted">${done} из ${total} достижений</p>
    </section>`;
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