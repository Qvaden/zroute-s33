/**
 * МАГАЗИН АККАУНТОВ — разметка.
 *
 * Чистые функции: получили состояние, вернули строку; поведение живёт в
 * `src/forum/accounts.js`. Тот же раздел, что у остальных страниц: строку
 * можно прочитать и проверить без браузера.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНАЯ ВКЛАДКА, А НЕ РАЗДЕЛ ЛЕНТЫ.
 *
 * Объявление остаётся темой форума: метка «Аккаунты», две колонки у неё, и всё
 * остальное — ответы, жалоба, срок, удаление — общие с форумом. Вкладка нужна
 * затем, чтобы покупать и продавать приходилось в одном месте, а не в семи
 * разделах ленты: человек ищет «почём аккаунт», а не «в какой теме это
 * написал Ковыль».
 *
 * ПОЧЕМУ ОБЪЯВЛЕНИЕ ПИШЕТСЯ ЗДЕСЬ, А НЕ В КОМПОЗЕРЕ ФОРУМА.
 *
 * Метка «Аккаунты» не предлагается в форме новой темы (см. `shopOnly` в
 * `rules.js`): у витрины свой ящик с четырьмя полями, и человек, который
 * пришёл продать, не обязан разбираться, зачем ему «Раздел» и «Теги темы».
 * Один путь, а не два, — и расходить им нечему. Тема при этом создаётся тем же
 * `createPost`, что и любая другая: метку ставит форма, раздел берёт «Разное»,
 * а текстом темы становится описание аккаунта, если комментарий не написан.
 *
 * ПОЧЕМУ НА ВИТРИНЕ НЕТ КНОПКИ «КУПИТЬ».
 *
 * Сайта-продавца у нас нет и быть не может: денег форум не берёт, платёжного
 * шлюза, комиссии и способа вернуть сумму нет. Кнопка «купить» обещала бы то,
 * чего за ней не стоит, — поэтому единственный путь к договорённости это тема:
 * там автор, история и ответы, а сделка происходит мимо форума. Тот же смысл у
 * цены: это слово автора, а не счёт к оплате.
 *
 * ПОЧЕМУ ДЕЙСТВИЯ АВТОРА ВСЁ-ТАКИ ЕСТЬ.
 *
 * Снять с доски и поправить состав с ценой — это про своё объявление, и делать
 * это через переход в ленту значило бы гнать человека за кнопку, которую он
 * видит рядом. Удаление и жалоба по-прежнему в теме: там модература, причина и
 * история ответов, и второй вход в ту же политику витрине не нужен.
 */
import { esc, pluralWord } from '../ui/helpers.js';
import { skWithCaption } from '../ui/skeleton.js';
import { serverBadge } from '../forum/roles.js';
import { renderMdBar, renderAttachRow } from './forum.js';
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

/** Раздел, в который кладётся тема-объявление. См. пояснение в шапке файла. */
export const ACCOUNT_CATEGORY = 'offtop';

/** Сколько дней объявление проживёт по умолчанию — то же число, что в config. */
function defaultExpiryDays() {
  const days = Number(CONFIG.forum.limits.expiryDefaultDays?.accounts) || 0;
  return expiryChoices().includes(days) ? days : expiryChoices()[0] || 0;
}

/** Варианты срока из config'а — те же числа держит триггер базы. */
function expiryChoices() {
  return (CONFIG.forum.limits.expiryChoices || []).map(Number).filter((d) => d > 0);
}

/**
 * Ящик объявления — форма, которая живёт на вкладке.
 *
 * Поля ровно те, что держат колонки темы: состав, цена, срок и заголовок.
 * Местной проверки длины у строк нет нарочно: её держат проверка таблицы и
 * триггер базы, и их текст человек должен увидеть целиком, а не молча
 * упираться в `minlength` браузера. `maxlength` оставлен — он не отказывает, а
 * не даёт набрать лишнего.
 *
 * Комментарий — обычный форумный редактор (тот же `data-editor` и та же
 * панель формата, что у темы и чата): второй редактор на те же кнопки
 * расходился бы при первой же правке. Поле необязательное: пустой комментарий
 * означает «текстом темы станет описание аккаунта», и человек не обязан
 * печатать одно и то же дважды.
 *
 * `s.editing` — правка существующего объявления: те же поля, другие подписи и
 * другая кнопка, поэтому форма одна, а не две.
 *
 * Скриншоты — та же строка прикрепления, что у композера темы
 * (`renderAttachRow` из `pages/forum.js`): тот же предел из config'а, те же
 * слова про сжатие и та же область превью по `scope`. У правки свой scope
 * (`ad:<id>`), чтобы выбранные для одного объявления картинки не переезжали в
 * форму другого.
 */
function renderComposer(s) {
  const L = CONFIG.forum.limits;
  const editing = s.editing || null;
  const days = expiryChoices();
  const chosen = Number(editing?.expiresIn ?? 0) || defaultExpiryDays();
  const shotScope = editing ? `ad:${editing.id}` : 'ad';
  const already = editing
    ? (s.posts.find((p) => p.id === editing.id)?.attachments?.length ?? 0)
    : 0;
  const draft = {
    title: editing?.title ?? '',
    offer: editing?.offer ?? '',
    price: editing?.price ?? '',
  };
  return `
    <form class="accounts-composer" data-accounts-form>
      <div class="accounts-composer__head">
        <b>${editing ? 'Правка объявления' : 'Новое объявление'}</b>
        <span class="muted">Тема с меткой «Аккаунты» — торг и вопросы пишутся в её ответах.</span>
      </div>

      <div class="accounts-fields">
        <label class="forum-field">
          <span>Заголовок</span>
          <input type="text" name="title" maxlength="${L.titleMax}" autocomplete="off"
                 value="${esc(draft.title)}" placeholder="Аккаунт 40 лвл, собран гарнизон">
          <small class="muted">От ${L.titleMin} символов. По нему объявление ищут в ленте.</small>
        </label>

        <label class="forum-field">
          <span>Что в аккаунте</span>
          <textarea name="account_offer" rows="4" maxlength="${L.accountOfferMax}"
                    placeholder="уровень, техника, ресурсы, альянс — что реально внутри">${esc(draft.offer)}</textarea>
          <small class="muted">${L.accountOfferMin}–${L.accountOfferMax} символов. Это витрина: «аккаунт норм» покупатель не прочитает.</small>
        </label>

        <label class="forum-field">
          <span>Почём</span>
          <input type="text" name="account_price" maxlength="${L.accountPriceMax}" autocomplete="off"
                 value="${esc(draft.price)}" placeholder="1500 ₽, торг, по договорённости">
          <small class="muted">${L.accountPriceMin}–${L.accountPriceMax} символов, словами. Счета и контакты сюда не пишут — для связи есть ник автора.</small>
        </label>

        <label class="forum-field">
          <span>Актуально до</span>
          <select name="expires_in">
            ${days.map((d) => `<option value="${d}"${d === chosen ? ' selected' : ''}>${d} ${
              pluralWord(d, 'день', 'дня', 'дней')} — до ${esc(shortDate(Date.now() + d * 86400000))}</option>`).join('')}
          </select>
          <small class="muted">Срок обязателен: просроченное объявление снимается с витрины само.</small>
        </label>
      </div>

      <label class="forum-field">
        <span>Комментарий к объявлению <small class="muted">необязательно</small></span>
        <div class="forum-editor is-empty" contenteditable="true" role="textbox" aria-multiline="true"
             name="body" data-editor data-limit="${L.bodyMax}"
             data-placeholder="Что добавить к описанию: почему отдаёте, что осталось за кадром. Пусто — и текстом темы станет описание аккаунта."></div>
      </label>

      ${renderMdBar()}

      ${renderAttachRow(shotScope)}
      ${already ? `<p class="muted accounts-attach__note">К объявлению уже приложено ${already}
        ${pluralWord(already, 'картинка', 'картинки', 'картинок')} — новые встанут после них, прежние останутся
        на месте.</p>` : ''}

      <div class="accounts-composer__actions">
        <button type="submit" class="forum-btn forum-btn--primary" data-accounts-submit>${
          editing ? 'Сохранить' : 'Выставить на доску'}</button>
        <button type="button" class="forum-btn forum-btn--ghost" data-accounts-cancel>Отмена</button>
      </div>
      <p class="forum-error" data-accounts-error hidden></p>
    </form>`;
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
 * Шапка витрины: заголовок, два числа и главное действие.
 *
 * Число в шапке — про то, что легло на экран, а не про всю базу: «ещё»
 * остаётся кнопкой, и человек видит, что список продолжается, не досчитываясь
 * до конца. Второе число берёт `total` у адаптера: это сколько объявлений
 * посчитала база тем же запросом, что читал список.
 *
 * Кнопка объявления видна только вошедшему: без входа она вела бы к форме,
 * которую база отвергнет текстом «сначала войдите», а это обещание вслух.
 */
function renderHero(s, shownCount) {
  const total = Number(s.total) || 0;
  const cta = s.me
    ? '<button type="button" class="forum-btn accounts-hero__cta" data-accounts-new>Выставить аккаунт</button>'
    : '<a class="forum-btn forum-btn--ghost accounts-hero__cta" href="#/forum">Войдите и выставьте аккаунт</a>';
  return `
    <header class="panel__head accounts-hero">
      <div class="accounts-hero__text">
        <span class="eyebrow">Магазин аккаунтов</span>
        <h1>Кто отдаёт аккаунт и почём</h1>
        <p class="muted">
          Здесь только то, что отмечено меткой «Аккаунты»; договор и вопросы — в
          теме, ссылка на неё в заголовке карточки.
        </p>
      </div>
      <div class="accounts-hero__aside">
        <dl class="accounts-stats">
          <div class="accounts-stat">
            <dt>на доске</dt>
            <dd>${total} ${pluralWord(total, 'объявление', 'объявления', 'объявлений')}</dd>
          </div>
          <div class="accounts-stat accounts-stat--screen">
            <dt>на экране</dt>
            <dd>${shownCount} ${pluralWord(shownCount, 'объявление', 'объявления', 'объявлений')}</dd>
          </div>
        </dl>
        ${cta}
      </div>
    </header>`;
}

/**
 * Фильтры: порядок, снятые объявления и поиск.
 *
 * Поиск идёт тем же запросом, что и лента (`q` у `listPosts`), а не по
 * прочитанной странице: «ищу банки» на доске должно находить объявление,
 * которое ещё не доехало до экрана.
 */
function renderControls(s) {
  return `
    <div class="accounts-controls">
      <div class="accounts-controls__sorts" role="group" aria-label="Порядок объявлений">
        ${ACCOUNT_SORTS.map((item) => `<button type="button" class="accounts-chip${s.sort === item.id ? ' is-on' : ''}"
                data-accounts-sort="${esc(item.id)}"
                aria-pressed="${s.sort === item.id ? 'true' : 'false'}">${esc(item.label)}</button>`).join('')}
      </div>
      <label class="accounts-controls__sold">
        <input type="checkbox" name="show_sold"${s.showSold ? ' checked' : ''}>
        <span>показывать проданные</span>
      </label>
      <label class="accounts-search">
        <input type="search" name="q" data-accounts-q autocomplete="off" spellcheck="false"
               aria-label="Поиск по доске объявлений"
               placeholder="Поиск по доске: уровень, ресурс, цена" value="${esc(s.query ?? '')}">
      </label>
    </div>`;
}

/**
 * Сколько скриншотов показываем на карточке.
 *
 * Предел вложений — 12 картинок к записи, и все двенадцать в плитки витрины
 * встанут ценой полосы на три экрана: доска — список, её читают глазами по
 * строкам. Три плитки дают увидеть «аккаунт живой или пустой», а остальное
 * человек открывает в теме, куда ведёт чип с числом.
 */
const SHOTS_ON_CARD = 3;

/**
 * Превью скриншотов объявления.
 *
 * Картинки лежат у темы (та же `forum_attachments`, что у постов и гайдов),
 * поэтому лента доски приносит их вместе с строкой — отдельного запроса не
 * нужно. Ссылка каждой плитки ведёт в тему, а не на файл: на витрине решение
 * «смотреть или нет», а торговля и все остальное — там же, где ответы.
 */
function renderCardShots(p, href) {
  const shots = (Array.isArray(p.attachments) ? p.attachments : []).filter((a) => a?.url);
  if (!shots.length) return '';
  const shown = shots.slice(0, SHOTS_ON_CARD);
  const extra = shots.length - shown.length;
  return `
    <div class="accounts-card__shots">
      ${shown.map((a, i) => `<a class="accounts-card__shot" href="${href}" aria-label="Скриншот ${i + 1} — в теме объявления">
        <img src="${esc(a.url)}" alt="Скриншот ${i + 1} к объявлению «${esc(p.title)}»" loading="lazy">
      </a>`).join('')}
      ${extra ? `<a class="accounts-card__more" href="${href}">+${extra}</a>` : ''}
    </div>`;
}

/**
 * Одна карточка объявления.
 *
 * Название, обе колонки доски, срок и автор с его сервером — всё. Текст темы на
 * витрине не показываем: решение о просмотре принимается по «что в аккаунте»
 * и «почём», а остальное человек прочитает в теме, куда ведёт заголовок.
 * Скриншоты — исключение нарочно: аккаунт покупают глазами, и описать
 * собранный гарнизон словами так, чтобы он не выглядел пустым, невозможно.
 *
 * Проданное и устаревшее не прячем: тема с ответами остаётся на месте, и
 * честнее показать её с пометкой, чем заставлять человека гадать, куда делось
 * объявление, которое он помнит.
 *
 * Кнопки автора — снятие с доски и правка — только у владельца: модерируется
 * тема, а не витрина, и удаление с причиной по-прежнему живёт в теме.
 */
export function renderAccountCard(p, canManage = false) {
  const sold = Boolean(p.accountSoldAt);
  const expired = Boolean(p.expiresAt) && new Date(p.expiresAt).getTime() <= Date.now();
  const href = `#/forum/${esc(p.id)}`;
  const answers = p.commentCount ?? 0;
  return `
    <article class="accounts-card${sold ? ' accounts-card--sold' : ''}${expired ? ' accounts-card--expired' : ''}">
      <div class="accounts-card__marks">
        ${sold ? `<span class="accounts-card__sold" title="Автор снял это объявление с доски ${esc(shortDate(p.accountSoldAt))}">Продано</span>` : ''}
        ${expired ? '<span class="accounts-card__over" title="Срок действия темы вышел">Срок вышел</span>' : ''}
        ${!expired && p.expiresAt ? `<span class="accounts-card__until" title="Объявление висит до ${esc(shortDate(p.expiresAt))}">до ${esc(shortDate(p.expiresAt))}</span>` : ''}
      </div>
      <h3 class="accounts-card__title"><a href="${href}">${esc(p.title)}</a></h3>
      ${renderCardShots(p, href)}
      <p class="accounts-card__offer">${esc(p.accountOffer || '—')}</p>
      <p class="accounts-card__price">${esc(p.accountPrice || 'цена не названа')}</p>
      <footer class="accounts-card__foot">
        <a class="accounts-card__nick" href="#/user/${encodeURIComponent(p.authorNick)}">${esc(p.authorNick)}</a>${serverBadge(p.authorServer)}
        <span class="muted">${esc(shortDate(p.createdAt))}</span>
        <a class="accounts-card__talk" href="${href}">${answers} ${pluralWord(answers, 'ответ', 'ответа', 'ответов')}</a>
      </footer>
      ${canManage ? `
        <div class="accounts-card__acts">
          <button type="button" class="accounts-act" data-accounts-edit="${esc(p.id)}">Править</button>
          <button type="button" class="accounts-act accounts-act--${sold ? 'return' : 'sold'}"
                  data-accounts-close="${esc(p.id)}" data-accounts-sold="${sold ? '0' : '1'}">${
            sold ? 'Вернуть на доску' : 'Аккаунт продан'}</button>
        </div>` : ''}
    </article>`;
}

/**
 * Витрина целиком.
 *
 * Пустая доска и пустой превью-файл — разные вещи: без подключённого форума
 * писать «объявлений нет» значило бы отчитаться ложью, и в статичном превью
 * постов не бывает по построению.
 */
export function renderAccounts(s) {
  const shown = s.posts.filter((p) => s.showSold || !p.accountSoldAt);
  const mine = (p) => Boolean(s.me) && s.me.id === p.authorId;
  const empty = s.ready === false
    ? 'Доска появится вместе с форумом.'
    : s.query
      ? `По запросу «${s.query}» на доске ничего нет.`
      : 'Объявлений на доске нет.';
  return `
    <section class="panel accounts-page">
      ${renderHero(s, shown.length)}

      ${renderNotice()}

      ${s.composing || s.editing ? renderComposer(s) : ''}

      ${renderControls(s)}

      ${s.error ? `<p class="accounts-error">${esc(s.error)}</p>` : ''}

      ${s.loading && !s.posts.length
        ? skWithCaption('Читаем доску…', 'tile', 6)
        : shown.length
          ? `<div class="accounts-grid">${shown.map((p) => renderAccountCard(p, mine(p))).join('')}</div>`
          : `<div class="accounts-empty">
              <p>${s.loading ? 'Читаем доску…' : empty}</p>
              <p class="muted">${s.showSold
                ? 'Можно написать первыми: «Выставить аккаунт» — форма здесь, на доске.'
                : 'Проданные скрыты: снимите галочку «показывать проданные», чтобы увидеть их все.'}</p>
            </div>`}

      ${s.more ? '<button type="button" class="forum-btn forum-btn--wide" data-accounts-more>Показать ещё</button>' : ''}
    </section>`;
}
