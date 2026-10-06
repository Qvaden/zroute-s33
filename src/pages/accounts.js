/**
 * ДОСКА АККАУНТОВ — разметка.
 *
 * Чистые функции: получили состояние, вернули строку; поведение живёт в
 * `src/forum/accounts.js`. Тот же раздел, что у остальных страниц: строку
 * можно прочитать и проверить без браузера.
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ ВКЛАДКА, ХОТЬ ОБЪЯВЛЕНИЕ — ОБЫЧНАЯ ТЕМА.
 *
 * Тема остаётся темой: метка «Аккаунты», две колонки у неё, и всё остальное —
 * ответы, жалоба, срок, удаление — общие с форумом. Вкладка нужна затем, чтобы
 * купить и продать приходилось в одном месте, а не в семи разделах ленты:
 * человек ищет «почём аккаунт», а не «в какой теме это написал Ковыль».
 * Поэтому здесь только витрина — список тем с этой меткой, собранный тем же
 * `listPosts`, что и лента, и карточка, показывающая ровно две вещи: что в
 * аккаунте и почём он.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ КНОПКИ «КУПИТЬ».
 *
 * Сайта-продавца у нас нет и быть не может: денег форум не берёт, платёжного
 * шлюза, комиссии и способа вернуть сумму нет. Кнопка «купить» обещала бы то,
 * чего за ней не стоит, — поэтому единственный путь к договорённости это тема:
 * там автор, история и ответы, а сделка происходит мимо форума. Тот же смысл у
 * цены: это слово автора, а не счёт к оплате.
 *
 * ПОЧЕМУ НА ДОСКЕ НЕТ КНОПОК ПРАВКИ.
 *
 * Снять с доски, продлить срок, удалить — всё это кнопки карточки темы на
 * форуме. Дублировать их на витрине значило бы иметь два места, где один и тот
 * же PATCH считается по-разному, и второе неизбежно отстанет от первого.
 */
import { esc, pluralWord } from '../ui/helpers.js';
import { serverBadge } from '../forum/roles.js';
import { categoryLabel, ACCOUNT_TAG_ID } from '../forum/rules.js';
import { CONFIG } from '../../config.js';

const SHORT_DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

/** Короткая дата: витрина — список, и год в каждой строке его не читает. */
function shortDate(at) {
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? '' : SHORT_DATE.format(d);
}

/**
 * Порядок списка. Два, а не три, как в ленте: «лучшее» для доски — это
 * реакции, а их на объявления копят редко, и человек выбирает между «только
 * что выложили» и «вокруг него спорят».
 */
export const ACCOUNT_SORTS = [
  { id: 'fresh', label: 'Свежие' },
  { id: 'talked', label: 'Обсуждаемые' },
];

/**
 * Одна карточка объявления.
 *
 * Название, обе колонки доски и автор с его сервером — всё. Текст темы на
 * витрине не показываем: решение о просмотре принимается по «что в аккаунте»
 * и «почём», а остальное человек прочитает в теме, куда ведёт заголовок.
 *
 * Проданное и устаревшее не прячем: тема с ответами остаётся на месте, и
 * честнее показать её с пометкой, чем заставлять человека гадать, куда делось
 * объявление, которое он помнит.
 */
export function renderAccountCard(p) {
  const sold = Boolean(p.accountSoldAt);
  const expired = Boolean(p.expiresAt) && new Date(p.expiresAt).getTime() <= Date.now();
  const href = `#/forum/${esc(p.id)}`;
  const answers = p.commentCount ?? 0;
  return `
    <article class="accounts-card${sold ? ' accounts-card--sold' : ''}${expired ? ' accounts-card--expired' : ''}">
      <h3 class="accounts-card__title"><a href="${href}">${esc(p.title)}</a></h3>
      <p class="accounts-card__price">${esc(p.accountPrice || 'цена не названа')}</p>
      <p class="accounts-card__offer">${esc(p.accountOffer || '—')}</p>
      <div class="accounts-card__marks">
        ${sold ? `<span class="accounts-card__sold" title="Автор снял это объявление с доски ${esc(shortDate(p.accountSoldAt))}">Продано</span>` : ''}
        ${expired ? '<span class="accounts-card__over" title="Срок действия темы вышел">Срок вышел</span>' : ''}
        ${!expired && p.expiresAt ? `<span class="accounts-card__until" title="Объявление висит до ${esc(shortDate(p.expiresAt))}">до ${esc(shortDate(p.expiresAt))}</span>` : ''}
      </div>
      <footer class="accounts-card__foot">
        <a class="accounts-card__nick" href="#/user/${encodeURIComponent(p.authorNick)}">${esc(p.authorNick)}</a>${serverBadge(p.authorServer)}
        <span class="muted">${esc(categoryLabel(p.category))} · ${esc(shortDate(p.createdAt))}</span>
        <a class="accounts-card__talk" href="${href}">${answers} ${pluralWord(answers, 'ответ', 'ответа', 'ответов')}</a>
      </footer>
    </article>`;
}

/**
 * Фильтры и кнопки: порядок, показывать ли снятые, и место, откуда пишут
 * объявление.
 *
 * Кнопка «Разместить объявление» ведёт не на отдельную форму, а в обычный
 * композер форума с уже отмеченной меткой (`#/forum?new=accounts`): объявление
 * — тема, и вторая форма на те же два поля означала бы два правила, которые
 * расходятся при каждой правке.
 */
function renderControls(s) {
  return `
    <div class="accounts-controls">
      <div class="accounts-controls__sorts" role="group" aria-label="Порядок объявлений">
        ${ACCOUNT_SORTS.map((item) => `<button type="button" class="accounts-chip${s.sort === item.id ? ' is-on' : ''}"
                data-accounts-sort="${esc(item.id)}">${esc(item.label)}</button>`).join('')}
      </div>
      <label class="accounts-controls__sold">
        <input type="checkbox" name="show_sold"${s.showSold ? ' checked' : ''}>
        <span>показывать проданные</span>
      </label>
      <a class="forum-btn forum-btn--primary accounts-controls__new" href="#/forum?new=${ACCOUNT_TAG_ID}">Разместить объявление</a>
    </div>`;
}

/**
 * Правила доски одним абзацем.
 *
 * Повторяем их здесь, а не полагаясь на вкладку «Правила», потому что решение
 * «покупать или нет» принимается на этой странице, а не за три перехода.
 * Формулировка — та же, что у правила `ads`: разница не в разрешении торговать,
 * а в месте.
 */
function renderNotice() {
  const L = CONFIG.forum.limits;
  return `
    <p class="accounts-notice">
      Объявление — обычная тема форума с меткой «Аккаунты»: торг, вопросы и
      договорённости пишутся в её ответах. Сайт денег не берёт: цена — слово
      автора, сделка происходит мимо форума, гарантий и возврата у нас нет.
      Телефон, почту и дискорд в объявлении не пишите — для связи есть ник
      автора. Срок действия обязателен: по умолчанию ${L.expiryDefaultDays?.accounts ?? 7}
      ${pluralWord(L.expiryDefaultDays?.accounts ?? 7, 'день', 'дня', 'дней')}.
    </p>`;
}

/**
 * Витрина целиком.
 *
 * Число в шапке — про то, что легло на экран, а не про всю базу: «ещё»
 * остаётся кнопкой, и человек видит, что список продолжается, не досчитываясь
 * до конца. Шапка повторяет оболочку «Обновлений игры» (`panel__head`):
 * живые страницы должны читаться как один сайт, а не как семь макетов.
 *
 * Пустая доска и пустой превью-файл — разные вещи: без подключённого форума
 * писать «объявлений нет» значило бы отчитаться ложью, и в статичном превью
 * постов не бывает по построению.
 */
export function renderAccounts(s) {
  const shown = s.posts.filter((p) => s.showSold || !p.accountSoldAt);
  const total = s.posts.length
    ? `${shown.length} ${pluralWord(shown.length, 'объявление', 'объявления', 'объявлений')} на экране. `
    : '';
  const empty = s.ready === false
    ? 'Доска появится вместе с форумом.'
    : 'Объявлений на доске нет.';
  return `
    <section class="panel accounts-page">
      <header class="panel__head">
        <span class="eyebrow">Доска аккаунтов</span>
        <h1>Кто отдаёт аккаунт и почём</h1>
        <p class="muted">
          ${total}Здесь только то, что отмечено меткой «Аккаунты»; договор и
          вопросы — в теме, ссылка на неё в заголовке карточки.
        </p>
      </header>

      ${renderNotice()}
      ${renderControls(s)}

      ${s.error ? `<p class="accounts-error">${esc(s.error)}</p>` : ''}

      ${s.loading && !s.posts.length
        ? '<p class="muted">Читаем доску…</p>'
        : shown.length
          ? `<div class="accounts-grid">${shown.map((p) => renderAccountCard(p)).join('')}</div>`
          : `<div class="accounts-empty">
              <p>${s.loading ? 'Читаем доску…' : empty}</p>
              <p class="muted">${s.showSold
                ? 'Можно написать первыми: нажмите «Разместить объявление» — это обычная тема с меткой «Аккаунты».'
                : 'Проданные скрыты: снимите галочку «показывать проданные», чтобы увидеть их все.'}</p>
            </div>`}

      ${s.more ? '<button type="button" class="forum-btn forum-btn--wide" data-accounts-more>Показать ещё</button>' : ''}
    </section>`;
}
