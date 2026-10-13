/**
 * РЯД СООБЩЕСТВА НА ГЛАВНОЙ.
 *
 * Главная — чистая функция: получила данные, вернула строку. Темы форума так
 * не умеют: они живут в другой базе и отвечают через сеть, а таблица итогов
 * уже лежит в view. Ждать ответ форума, чтобы напечатать неделю, — значит
 * задерживать первый экран чужой сетью. Поэтому страница рисует слот
 * (renderCommunitySlot в src/pages/home.js), а содержимое приносит этот
 * модуль после отрисовки.
 *
 * ЧТО ЗДЕСЬ ПОКАЗАНО. Три-четыре последних темы и цифры за сегодня — это
 * ответ на «жив ли сервер» после «как прошла неделя». Ни того, чего сайт не
 * знает: здесь нет «онлайн-игроков», «популярности раздела» и прочих
 * показателей, которые неоткуда взять.
 *
 * ПОЧЕМУ ПАНЕЛЬ НЕ ГОВОРИТ «ОШИБКА». Неудача этого запроса не ломает
 * страницу: рейтинг, летопись и герой уже на экране, и человек, пришедший за
 * итогами недели, их увидит. Поэтому вместо ошибки — короткая честная строка
 * с дорогой на форум, а не красное полотно.
 *
 * ПОЧЕМУ ОТВЕТ ПРОВЕРЯЕТ, ЧТО СЛОТ ЕЩЁ НА ЭКРАНЕ. Пока база молчала, человек
 * мог уйти с главной и вернуться: запись в выброшенный узел никто не увидит,
 * а предыдущий слот от неё живее не станет. Проверка оставляет запоздалому
 * ответу право ничего не делать.
 */
import { esc, plural } from '../ui/helpers.js';
import { forum } from '../forum/index.js';
import { siteServer } from '../data/server.js';
import { categoryLabel } from '../forum/rules.js';
import { timeAgo } from '../forum/format.js';

const TOPICS = 4;

/**
 * @param {Document|Element} root область поиска; обычно сам #app
 */
export async function mountHomeCommunity(root = document) {
  const slot = root.querySelector?.('[data-home-community]');
  const body = slot?.querySelector('[data-home-community-body]');
  if (!body) return;
  // Повторный вызов на уже занятом слоте ничего не просит у базы второй раз.
  if (slot.dataset.homeCommunity) return;
  slot.dataset.homeCommunity = 'pending';

  const [feed, activity] = await Promise.all([
    forum.listPosts({ sort: 'fresh', limit: TOPICS, serverId: siteServer() }).catch(() => null),
    // Источник опциональный: без него или без миграции ряд остаётся списками.
    typeof forum.getServerActivity === 'function'
      ? forum.getServerActivity().catch(() => null)
      : Promise.resolve(null),
  ]);

  slot.dataset.homeCommunity = 'done';
  if (!body.isConnected) return;
  body.innerHTML = feed ? topicsMarkup(feed.posts, activity) : offlineMarkup();
}

function topicsMarkup(posts, activity) {
  const list = (Array.isArray(posts) ? posts : [])
    .filter((p) => p && !p.deleted && p.title)
    .slice(0, TOPICS);

  if (!list.length) {
    return `<p class="community__note">На форуме пока нет ни одной темы. <a href="#/forum">Написать первой<span aria-hidden="true"> →</span></a></p>`;
  }

  const today = Array.isArray(activity) && activity.length ? activity[activity.length - 1] : null;

  return `
    <ul class="community__list">
      ${list
        .map(
          (p) => `
      <li class="community__item">
        <a class="community__topic" href="#/forum/${esc(p.id)}">${esc(p.title)}</a>
        <span class="community__meta">
          <span class="community__cat">${esc(categoryLabel(p.category))}</span>
          <a class="community__nick" href="#/user/${encodeURIComponent(p.authorNick ?? '')}">${esc(p.authorNick ?? 'аноним')}</a>
          <time class="community__when">${esc(timeAgo(p.createdAt))}</time>
          <span class="community__answers">${
            p.commentCount
              ? esc(plural(p.commentCount, 'ответ', 'ответа', 'ответов'))
              : 'без ответов'
          }</span>
        </span>
      </li>`
        )
        .join('')}
    </ul>
    ${
      today
        ? `<p class="community__pulse">
             ${esc(plural(today.forumPosts, 'пост', 'поста', 'постов'))} и
             ${esc(plural(today.forumComments, 'ответ', 'ответа', 'ответов'))}
             на форуме,
             ${esc(plural(today.chatMessages, 'сообщение', 'сообщения', 'сообщений'))} в чатах —
             <span class="community__pulse-day">за сегодня</span>
           </p>`
        : ''
    }
    <a class="community__all" href="#/forum">Весь форум<span aria-hidden="true"> →</span></a>`;
}

function offlineMarkup() {
  return `<p class="community__note">Обсуждения сейчас не загрузились — на главной они гостевые, сам форум это не ломает. <a href="#/forum">Открыть форум<span aria-hidden="true"> →</span></a></p>`;
}
