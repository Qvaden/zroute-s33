/**
 * ГАЙДЫ (wiki) — список стратегий и советы сообщества.
 *
 * Чистый рендер от состояния. Поведение — в src/forum/guides.js.
 */
import { esc } from '../ui/helpers.js';
import { postBody } from '../forum/format.js';
import { slaLevel, SLA_LABELS } from '../forum/sla.js';
import { renderMdBar } from './forum.js';
import { renderHandbookSearch, HANDBOOK_COUNT } from './handbook.js';
import { plural } from '../ui/helpers.js';
import { CONFIG } from '../../config.js';

const CATEGORIES = [
  { id: 'strategy', label: 'Стратегия' },
  { id: 'alliance', label: 'Альянсам' },
  { id: 'newbie', label: 'Новичкам' },
  { id: 'vs', label: 'VS и бои' },
];

const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || {}).label || 'Гайд';

/*
  Отметка «проверен / устарел» ставится живым модератором, поэтому надпись
  обязана говорить, кто и когда её поставил: без даты «проверено» неотличимо
  от вежливого молчания, а игрок решает по отметке, стоит ли верить совету.

  «Не проверен» — не отсутствие метки, а отдельная метка. Гайд публикуется
  сразу, и без неё свежий текст игрока выглядел бы так же, как прочитанный
  модератором: молчание читается как одобрение.
*/
const REVIEW_LABEL = { none: 'Не проверен', verified: 'Проверен модерацией', outdated: 'Устарел' };

function ruDate(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('ru-RU') : '';
}

const isStaff = (me) => Boolean(me && (me.role === 'admin' || me.role === 'moderator'));

/*
  Молчание закрывает и гайд, и заявку: в базе их пропускает та же проверка
  права писать, что и пост. Показывать форму повесившемуся игроку — значит
  выдать ему отказ после того, как он уже набрал текст.
*/
const isMuted = (me) => Boolean(me?.mutedUntil && new Date(me.mutedUntil) > new Date());

/** Писать может любой вошедший без запрета — право держит политика базы. */
const canPublish = (me) => Boolean(me) && !me.banned && !isMuted(me);

/** Короткий знак состояния у строки списка. */
function reviewBadge(g) {
  const label = REVIEW_LABEL[g.reviewStatus] || REVIEW_LABEL.none;
  const kind = g.reviewStatus && REVIEW_LABEL[g.reviewStatus] ? g.reviewStatus : 'none';
  return `<span class="guide-badge guide-badge--${esc(kind)}">${esc(label)}</span>`;
}

/** Сколько открытых сигналов видит модератор над своим списком. */
function signalBadge(g, staff) {
  const n = staff && Array.isArray(g.signals) ? g.signals.length : 0;
  if (!n) return '';
  return `<span class="guide-badge guide-badge--signal">${n === 1 ? 'сигнал об устаревании' : `сигналов: ${n}`}</span>`;
}

/** Рядом с заголовком — отметка модерации и, для модератора, счётчик сигналов. */
function guideMarks(g, staff) {
  const review = reviewBadge(g);
  const signals = signalBadge(g, staff);
  if (!review && !signals) return '';
  return `<span class="guide-card__marks">${review}${signals}</span>`;
}

/**
 * Поиск по гайдам: слово из запроса ищется в заголовке, тексте и авторе.
 * Порядок без учёта регистра; пустой запрос пропускает всё.
 */
function matchQuery(query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return () => true;
  return (g) =>
    String(g.title ?? '').toLowerCase().includes(q)
    || String(g.body ?? '').toLowerCase().includes(q)
    || String(g.authorNick ?? '').toLowerCase().includes(q);
}

/** Пустой список говорит разные вещи: по запросу, среди своих и вообще. */
function emptyHint(s) {
  if (s.query) return 'По запросу ничего не найдено.';
  if (s.mine) return 'Своих гайдов пока нет — напишите первый.';
  return 'Гайдов пока нет. Напишите первый: его прочтут другие участники.';
}

export function renderGuides(s) {
  if (s.selected) return renderDetail(s, s.selected);
  return renderList(s);
}

function renderList(s) {
  const all = Array.isArray(s.guides) ? s.guides : [];
  const guides = (s.category === 'all' ? all : all.filter((g) => g.category === s.category))
    .filter((g) => !s.mine || (s.me && g.authorId === s.me.id))
    .filter(matchQuery(s.query ?? ''));
  const cats = [{ id: 'all', label: 'Все' }, ...CATEGORIES];
  const canWrite = canPublish(s.me);
  const staff = isStaff(s.me);

  /*
    Плашки разделов — переключатели (aria-pressed), а не вкладки. Роль
    `tablist` здесь висела раньше, не имея ни одной вкладки: у списка гайдов
    нет панели, связанной с кнопкой через aria-controls, а без неё программа
    экрана обещает поведение вкладок — «переключение по стрелкам», которого
    нет. Честное описание этого ряда: группа кнопок-переключателей с
    подписью. Класс `is-on` и `aria-pressed` считаются из одного `s.category`,
    поэтому после любой перерисовки страницы они не разъезжаются.
  */
  const chips = cats
    .map((c) => `<button type="button" class="guide-chip${s.category === c.id ? ' is-on' : ''}"
             data-guide-cat="${esc(c.id)}"
             aria-pressed="${s.category === c.id ? 'true' : 'false'}">${esc(c.label)}</button>`)
    .join('');

  /*
    «Мои гайды» — отдельная кнопка, а не категория: человек ищет свои тексты
    внутри любой категории, и прятать их в четвёртое окно значило бы заставлять
    его помнить, под каким ярлыком он сам себя записал.
  */
  const mineChip = s.me
    ? `<button type="button" class="guide-chip guide-chip--mine${s.mine ? ' is-on' : ''}"
            data-guide-mine aria-pressed="${Boolean(s.mine)}">Мои гайды</button>`
    : '';

  const list = guides.length
    ? `<ul class="guide-list">${guides
        .map((g) => `
          <li class="guide-card">
            <a href="#/guides/${esc(g.slug)}">
              <span class="guide-card__cat">${esc(catLabel(g.category))}</span>
              <b class="guide-card__title">${esc(g.title)}</b>
              <span class="guide-card__by muted">Автор: ${esc(g.authorNick || '—')}</span>
              ${guideMarks(g, staff)}
            </a>
          </li>`
        )
        .join('')}</ul>`
    : `<p class="muted">${emptyHint(s)}</p>`;

  return `
    <section class="panel guides-page">
      <header class="panel__head">
        <span class="eyebrow">Знания сообщества</span>
        <h1>Гайды</h1>
        <p class="muted">Стратегии, советы для новичков и разбор боёв — пишут участники.</p>
      </header>
      <div class="guide-cats" role="group" aria-label="Раздел гайда">${chips}${mineChip}</div>
      <label class="guide-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>
        </svg>
        <input type="search" placeholder="Поиск по гайдам…" autocomplete="off" spellcheck="false"
               data-guide-search value="${esc(s.query ?? '')}">
      </label>
      ${canWrite && !s.composing
        ? '<button type="button" class="forum-btn forum-btn--primary" data-guide-new>Написать гайд</button>'
        : ''}
      ${canWrite && s.composing ? composeForm(s) : ''}
      ${!s.me ? '<p class="guides-page__signin muted"><a href="#/forum">Войдите</a> — и сможете добавить свой гайд: его прочтут другие участники.</p>' : ''}
      <div class="guide-list-wrap">${list}</div>
      ${handbookBlock(s)}
      ${guideRequestsBlock(s)}
    </section>`;
}

function composeForm(s) {
  const opts = CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
  const L = CONFIG.forum.limits;
  return `
    <form class="guide-composer" data-guide-form>
      <label class="forum-field">
        <span>Заголовок</span>
        <input name="title" maxlength="120" required placeholder="О чём гайд" autocomplete="off">
        <small class="muted">По заголовку страница получит адрес — придумывать его отдельно не нужно.</small>
      </label>
      <label class="forum-field">
        <span>Категория</span>
        <select name="category">${opts}</select>
      </label>
      <label class="forum-field">
        <span>Текст гайда</span>
        <div class="forum-editor is-empty" contenteditable="true" role="textbox" aria-multiline="true"
             name="body" data-editor data-limit="${L.guideBodyMax}"
             data-placeholder="Опишите стратегию шаг за шагом. Жирный, списки, цитаты и цвет — как в посте форума."></div>
        <small class="muted">${L.guideBodyMin}–${L.guideBodyMax} символов видимого текста.
          Не больше ${L.guideDailyMax} гайдов в сутки. Гайд выходит сразу и виден всем
          с меткой «не проверен», пока модерация его не прочитала.</small>
      </label>
      ${renderMdBar()}
      ${s.shared ? attachRow('new') : ''}
      <div class="forum-composer__actions">
        <button type="submit" class="forum-btn forum-btn--primary">Опубликовать</button>
        <button type="button" class="forum-btn forum-btn--ghost" data-guide-cancel>Отмена</button>
      </div>
      <p class="forum-error" data-guide-error hidden></p>
    </form>`;
}

/*
  Картинки к гайду — те же прикреплённые файлы форума, что у тем и ответов:
  тот же предел в двенадцать штук, то же сжатие и те же права на удаление.
  Поэтому здесь только разметка, а загрузка общая (attachImage с типом 'guide').

  Поле видно только когда записи общие: в черновом режиме хранилища нет,
  и кнопка, которая гарантированно откажет, была бы хуже её отсутствия.
*/
function attachRow(scope) {
  return `
    <div class="forum-attach" data-forum-attach="${esc(scope)}">
      <label class="forum-attach__btn">
        <span aria-hidden="true">🖼</span>
        <span>Прикрепить скриншоты</span>
        <input type="file" accept="image/*" multiple hidden data-attach-input="${esc(scope)}">
      </label>
      <div class="forum-attach__list" data-attach-list="${esc(scope)}"></div>
      <small class="forum-attach__hint">До ${CONFIG.forum.limits.attachmentsMax} картинок. Сжимаются автоматически.</small>
    </div>
    <p class="forum-error" data-attach-error="${esc(scope)}" hidden></p>`;
}

/** Прикреплённые картинки открытого гайда — тот же ряд, что у поста форума. */
function guideShots(g) {
  const shots = Array.isArray(g.attachments) ? g.attachments.filter((a) => a?.url) : [];
  if (!shots.length) return '';
  const multi = shots.length > 1;
  return `
    <div class="forum-shots ${multi ? 'forum-shots--multi' : ''}">
      ${shots
        .map(
          (a, i) => `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">
            <img src="${esc(a.url)}" alt="Скриншот ${i + 1}" loading="lazy">
          </a>`
        )
        .join('')}
    </div>`;
}

/*
  СПРАВОЧНИК ЗДЕСЬ ЖЕ, А НЕ НА ОТДЕЛЬНОЙ ВКЛАДКЕ.

  Ищут-то одним вопросом: «как это работает». Ответом может быть и текст самой
  игры, и разбор участника, а две вкладки заставляют помнить, где что лежит.
  Поэтому у дерева из Telegram-бота больше нет своего пункта меню: оно живёт
  под списком авторских гайдов, со своим поиском и со своими адресами
  (#/handbook/<узел>), которые никто не менял — присланные в чат ссылки
  продолжают открываться.

  Разделение при этом осталось в разметке: блок подписан как справочник игры,
  и меток модерации у него нет — «так написано в игре» и «так делает наш
  альянс» не должны становиться одинаковыми карточками.
*/
function handbookBlock(s) {
  return `
    <section class="guide-handbook">
      <header class="panel__head">
        <span class="eyebrow">Справочник</span>
        <h2>Официальные гайды игры</h2>
        <p class="muted">
          Правила и механики так, как их описывает сама игра:
          ${plural(HANDBOOK_COUNT.guides, 'гайд', 'гайда', 'гайдов')} в
          ${plural(HANDBOOK_COUNT.sections, 'раздел', 'раздела', 'разделов')}, с картинками из игры
          и без пересказов. Отметок «проверен / устарел» здесь нет намеренно:
          это текст разработчиков, а не совет участника.
        </p>
      </header>
      ${renderHandbookSearch(s.hbQuery ?? '')}
    </section>`;
}

function renderDetail(s, g) {
  return `
    <section class="panel guide-detail">
      <a class="back" href="#/guides">← Все гайды</a>
      <span class="guide-card__cat">${esc(catLabel(g.category))}</span>
      <h1>${esc(g.title)}</h1>
      <p class="muted">Автор: ${esc(g.authorNick || '—')} · обновлён ${esc(new Date(g.updatedAt).toLocaleDateString('ru-RU'))}</p>
      ${reviewNotice(g)}
      <div class="guide-content">${postBody(g.body)}</div>
      ${guideShots(g)}
      ${reviewPanel(s, g)}
      ${s.me && (s.me.id === g.authorId || s.me.role === 'admin' || s.me.role === 'moderator')
        ? `<div class="guide-detail__acts"><button type="button" class="forum-btn forum-btn--ghost" data-guide-delete="${esc(g.id)}">Удалить гайд</button></div>`
        : ''}
    </section>`;
}

/*
  Вердикт стоит ПЕРЕД текстом гайда: читать совет, уже зная что он устарел,
  — другое чтение, чем узнать об этом в самом конце, когда решение принято.

  «Не проверен» показывает то же место: гайд опубликован сразу, и без этой
  строки непрочитанный модерацией совет выглядел бы одобренным.
*/
function reviewNotice(g) {
  const status = REVIEW_LABEL[g.reviewStatus] ? g.reviewStatus : 'none';
  const label = REVIEW_LABEL[status];
  const date = ruDate(g.reviewedAt);
  const why = status === 'outdated'
    ? 'Часть советов ниже могла перестать работать — сверяйтесь с текущей версией игры.'
    : status === 'verified'
      ? 'Модератор перечитал гайд и не нашёл того, что требует правки.'
      : 'Модерация ещё не читала этот гайд: это совет участника, а не проверенная инструкция.';
  return `
    <div class="guide-review guide-review--${esc(status)}">
      <p class="guide-review__title">${esc(label)}${date ? ` · ${esc(date)}` : ''}</p>
      ${g.reviewNote ? `<p class="guide-review__note">${esc(g.reviewNote)}</p>` : ''}
      <p class="guide-review__why">${esc(why)}</p>
    </div>`;
}

/**
 * Заявка — не голосование и не обещание. Игрок называет тему, модерация
 * решает её двумя словами: вот готовый гайд, или этого на сервере не будет.
 * Поэтому у исхода нет «взято в работу»: автор у нас никто, и статус без
 * хозяина висел бы вечно.
 */
const REQ_OUTCOME = {
  linked: 'Связана с гайдом',
  closed: 'Закрыта модерацией',
  cancelled: 'Отозвана автором',
};

function requestOutcome(r, s) {
  const label = REQ_OUTCOME[r.status] || '';
  if (!label) return '';
  const guide = r.status === 'linked'
    ? (Array.isArray(s.guides) ? s.guides.find((g) => g.id === r.guideId) : null)
    : null;
  /*
    Название связанного гайда ищется в уже загруженном списке, а не приходит
    из базы вместе с заявкой: у гостя нет прав на таблицу гайдов, а архивный
    или удалённый гайд иначе превратился бы в ссылку в никуда.
  */
  const link = r.status === 'linked'
    ? (guide
      ? `: <a href="#/guides/${esc(guide.slug)}">${esc(guide.title)}</a>`
      : ' — гайд недоступен')
    : '';
  const who = r.decidedByNick ? ` · ${esc(r.decidedByNick)}` : '';
  return `
    <p class="guide-req__outcome">
      <b>${esc(label)}</b>${link}${who}${r.decidedAt ? ` · ${esc(ruDate(r.decidedAt))}` : ''}
    </p>
    ${r.answer ? `<p class="guide-req__answer">${esc(r.answer)}</p>` : ''}`;
}

function openRequestRow(r) {
  return `
    <li class="guide-req">
      <b class="guide-req__title">${esc(r.title)}</b>
      <span class="guide-req__by muted">${esc(r.userNick || '—')} · ${esc(ruDate(r.createdAt))}</span>
      ${r.details ? `<p class="guide-req__details">${esc(r.details)}</p>` : ''}
    </li>`;
}

function ownRequestRow(r, s) {
  return `
    <li class="guide-req guide-req--mine">
      <b class="guide-req__title">${esc(r.title)}</b>
      <span class="guide-req__by muted">${esc(ruDate(r.createdAt))}</span>
      ${r.status === 'open'
        ? `<button type="button" class="forum-btn forum-btn--ghost" data-grq-cancel="${esc(r.id)}">Отозвать</button>`
        : requestOutcome(r, s)}
    </li>`;
}

function requestForm(L) {
  return `
    <form class="guide-req-form" data-grq-form>
      <label class="forum-field">
        <span>Какой гайд нужен</span>
        <input name="title" minlength="${L.guideRequestTitleMin}" maxlength="${L.guideRequestTitleMax}"
               required autocomplete="off" placeholder="Например: как собирать караван в одиночку">
      </label>
      <label class="forum-field">
        <span>Где именно встали (необязательно)</span>
        <textarea name="details" maxlength="${L.guideRequestDetailsMax}" rows="2"
                  placeholder="Что уже пробовали и чего не хватило"></textarea>
        <small class="muted">${L.guideRequestTitleMin}–${L.guideRequestTitleMax} символов в названии,
          не больше ${L.guideRequestDailyMax} заявок за сутки. Разбирает модерация: ссылка на готовый
          гайд или закрытие с объяснением.</small>
      </label>
      <div class="forum-composer__actions">
        <button type="submit" class="forum-btn forum-btn--primary">Отправить заявку</button>
      </div>
    </form>`;
}

/*
  Список для модерирующего — не отдельный экран, а те же открытые заявки, но
  с полем объяснения и выбором гайда. Гайд берётся из соседнего списка, поэтому
  решение принимается там, где видно, что уже написано.
*/

/** Метка ожидания: слово то же, что в панели, класс — с приставкой страницы. */
function slaMark(createdAt) {
  const level = slaLevel(createdAt);
  if (level === 'fresh') return '';
  return `<span class="guide-req__sla guide-req__sla--${level}">${esc(SLA_LABELS[level])}</span>`;
}

function staffQueue(open, s) {
  if (!open.length) return '';
  const L = CONFIG.forum.limits;
  const guideOptions = (Array.isArray(s.guides) ? s.guides : [])
    .map((g) => `<option value="${esc(g.id)}">${esc(g.title)}</option>`)
    .join('');
  /* Очередь читается от давности, а не от свежести: заявка, которую ждут
     дольше обещанного, должна лежать под рукой, а не в конце списка. */
  const waiting = [...open].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return `
    <h3 class="guide-requests__sub">Очередь модерации (${open.length})</h3>
    <ul class="guide-req-list guide-req-list--staff">${waiting
      .map((r) => `
        <li class="guide-req">
          <b class="guide-req__title">${esc(r.title)}</b>
          <span class="guide-req__by muted">${esc(r.userNick || '—')} · ${esc(ruDate(r.createdAt))}</span>
          ${slaMark(r.createdAt)}
          ${r.details ? `<p class="guide-req__details">${esc(r.details)}</p>` : ''}
          <div class="guide-req__acts">
            <label class="forum-field">
              <span>Объяснение</span>
              <input data-grq-answer="${esc(r.id)}" maxlength="${L.guideNoteMax}" autocomplete="off"
                     placeholder="Что именно изменилось или почему темы не будет">
            </label>
            ${guideOptions
              ? `<label class="forum-field">
                   <span>Готовый гайд</span>
                   <select data-grq-guide="${esc(r.id)}">${guideOptions}</select>
                 </label>`
              : ''}
            <div class="guide-req__btns">
              <button type="button" class="forum-btn forum-btn--ghost"
                      data-grq-resolve="linked" data-grq-id="${esc(r.id)}"
                      ${guideOptions ? '' : 'disabled'}>Есть такой гайд</button>
              <button type="button" class="forum-btn forum-btn--ghost"
                      data-grq-resolve="closed" data-grq-id="${esc(r.id)}">Закрыть</button>
            </div>
          </div>
        </li>`)
      .join('')}</ul>`;
}

/**
 * Место блока — под списком гайдов, а не над ним: сначала человек видит, что
 * уже написано, и только потом понимает, чего не хватает. Форма видна
 * вошедшему без запрета писать; гостю показывается список открытых тем, но не
 * кнопка, иначе первая же отправка кончилась бы отказом без объяснения.
 */
function guideRequestsBlock(s) {
  const L = CONFIG.forum.limits;
  const all = Array.isArray(s.requests) ? s.requests : [];
  const open = all.filter((r) => r.status === 'open');
  const staff = isStaff(s.me);
  const mine = s.me ? all.filter((r) => r.userId === s.me.id) : [];
  const canAsk = Boolean(s.me) && !s.me.banned && !isMuted(s.me);
  const none = '<p class="guide-requests__note muted">Открытых заявок нет: всё, что просили, уже разобрано.</p>';

  if (s.requestsNote) {
    return `
      <section class="guide-requests">
        <header class="panel__head">
          <span class="eyebrow">Чего не хватает</span>
          <h2>Заявки на гайды</h2>
        </header>
        <p class="guide-requests__note">${esc(s.requestsNote)}</p>
      </section>`;
  }

  return `
    <section class="guide-requests">
      <header class="panel__head">
        <span class="eyebrow">Чего не хватает</span>
        <h2>Заявки на гайды</h2>
        <p class="muted">Назовите тему, которой нет в списке выше. Модерация либо
          покажет готовый гайд, либо закроет заявку с объяснением. Голосования
          здесь нет намеренно: счётчик голосов показывает не потребность, а
          активность одного кружка.</p>
      </header>

      ${canAsk ? requestForm(L) : `<p class="guide-requests__note muted">${
        !s.me ? 'Войдите на сайт, чтобы предложить тему.'
        : 'Сейчас вы не можете писать — заявка ушла бы в отказ.'}</p>`}

      <p class="forum-error guide-requests__error" data-grq-error hidden></p>

      ${staff
        ? (open.length ? staffQueue(open, s) : none)
        : `<h3 class="guide-requests__sub">Открытые заявки${open.length ? ` (${open.length})` : ''}</h3>
           ${open.length
             ? `<ul class="guide-req-list">${open.map((r) => openRequestRow(r)).join('')}</ul>`
             : none}`}

      ${mine.length
        ? `<h3 class="guide-requests__sub">Мои заявки</h3>
           <ul class="guide-req-list">${mine.map((r) => ownRequestRow(r, s)).join('')}</ul>`
        : ''}
    </section>`;
}

/**
 * Панель решений: модерация ставит отметку, игрок подаёт сигнал.
 * Разделение не косметика — права на отметку нет у автора, даже у лидера.
 */
function reviewPanel(s, g) {
  const staff = isStaff(s.me);
  const signals = Array.isArray(g.signals) ? g.signals : [];
  const mine = signals.find((x) => s.me && x.userId === s.me.id);
  const max = CONFIG.forum.limits.guideNoteMax;
  const min = CONFIG.forum.limits.guideNoteMin;

  const queue = staff && signals.length
    ? `<ul class="guide-review__queue">${signals
        .map((x) => `<li><b>${esc(ruDate(x.createdAt))}</b> — ${esc(x.note)}</li>`)
        .join('')}</ul>`
    : '';

  const own = !staff && mine
    ? `<p class="guide-review__own">Вы сообщили ${esc(ruDate(mine.createdAt))}: ${esc(mine.note)}
         <button type="button" class="forum-btn forum-btn--ghost" data-guide-stale-open>Уточнить сигнал</button></p>`
    : '';

  const readerForm = s.me && !staff
    ? (s.staleOpen
      ? `<div class="guide-review__stale">
           <label class="forum-field">
             <span>Что именно перестало работать</span>
             <textarea data-guide-stale-note maxlength="${max}" rows="2"
                       placeholder="После обновления сменились цены, раздел работает не так, как описано…">${esc(mine?.note ?? '')}</textarea>
             <small class="muted">${min}–${max} символов. Сигнал увидит модерация; повтор уточняет прошлый.</small>
           </label>
           <div class="guide-review__acts">
             <button type="button" class="forum-btn forum-btn--primary" data-guide-stale-send>Отправить</button>
             <button type="button" class="forum-btn forum-btn--ghost" data-guide-stale-cancel>Отмена</button>
           </div>
         </div>`
      : (mine
        ? ''  // своя строка уже несёт кнопку «Уточнить сигнал»: дублировать её незачем
        : '<button type="button" class="forum-btn forum-btn--ghost" data-guide-stale-open>Сообщить, что гайд устарел</button>'))
    : '';

  const staffForm = staff
    ? `<div class="guide-review__staff">
         <label class="forum-field">
           <span>Комментарий модерации</span>
           <input data-guide-review-note maxlength="${max}" value="${esc(g.reviewNote ?? '')}" autocomplete="off"
                  placeholder="Что проверили или что именно устарело">
         </label>
         <div class="guide-review__acts">
           <button type="button" class="forum-btn forum-btn--ghost" data-guide-review="verified">Проверен</button>
           <button type="button" class="forum-btn forum-btn--ghost" data-guide-review="outdated">Устарел</button>
           ${g.reviewStatus && g.reviewStatus !== 'none'
             ? '<button type="button" class="forum-btn forum-btn--ghost" data-guide-review="none">Снять отметку</button>'
             : ''}
         </div>
       </div>`
    : '';

  if (!staff && !s.me) return '';
  if (!staff && !readerForm && !own) return '';

  return `
    <section class="guide-review-box">
      <p class="guide-review__rule">Отметку ставит модератор по своему чтению гайда — не просмотры, не реакции и не давность публикации.</p>
      ${queue}${own}${readerForm}${staffForm}
      <p class="forum-error" data-guide-error hidden></p>
    </section>`;
}
