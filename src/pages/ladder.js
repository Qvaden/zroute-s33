import { esc, deltaBadge, formDots, sparkline, plural, standingsRowLabel } from '../ui/helpers.js';

/**
 * Общий рейтинг — главная ценность сайта.
 *
 * Сделано не таблицей, а строками на grid. Причина в телефоне: семь колонок
 * в <table> на экране 375px превращаются в горизонтальный скролл, а на grid
 * ту же строку можно перестроить в два яруса и ничего не потерять.
 *
 * ПОЧЕМУ ПАРАМЕТР ПРИНИМАЕТСЯ С ПОДСТАНОВКОЙ ПО УМОЛЧАНИЮ. Раньше страница
 * разбирала объект сразу и падала, если данные не пришли. Пока источник был
 * один и обязательный, это было незаметно: без данных весь сайт всё равно
 * показывал страницу с ошибкой.
 *
 * Теперь недоступная таблица результатов не закрывает сайт — форум с ней
 * не связан. Значит рейтинг может законно получить пустоту, и упасть ему
 * нельзя: одна страница без данных не должна ронять остальные.
 */
export function renderLadder({
  standings,
  eyebrow = 'Сезон целиком',
  title = 'Рейтинг альянсов',
  description = 'Победа +1 · Поражение −1 · Третьего не бывает',
  period = null,
  variant = 'season',
  achievements,
} = {}) {
  const list = Array.isArray(standings) ? standings : [];

  if (!list.length) return renderEmpty(eyebrow, title);

  const byId = new Map(list.map((r) => [r.alliance.id, r.alliance]));
  const rows = list.map((r) => rowHtml(r, byId, variant, achievements)).join('');
  const active = list.filter((r) => r.alliance.active).length;

  /*
    ДВЕ ВЕЩИ В ЭТОЙ РАЗМЕТКЕ СДЕЛАНЫ ДЛЯ ЧИТАТЕЛЯ С ПРОГРАММОЙ ЭКРАНА, И
    ОБЕ ДЕРЖАТСЯ В СООТВЕТСТВИИ КОДОМ ДРАЙВЕРА (ui/ladder-controls.js).

    1. Переключатели порядка и состава несут `aria-pressed` наряду с классом
       `is-on`. Класс — то, что видит глаз; нажатие — то, что слышит человек.
       Без второго кнопка звучит как обычная кнопка: «Победы» нажал, а что
       порядок именно этот — нечем прочитать. Размечать нужно при первой
       отрисовке, а не только в обработчике: вернувшись на страницу, читатель
       увидел бы «не нажато» под горящей кнопкой.

    2. Счётчик найденного — зона объявлений (`role="status"`). На него смотрит
       тот, кто только что печатал в поиске: без объявления он не знает,
       применилась ли фильтрация. Роль поставлена на счёт, а не на строки:
       объявлять перемену места 65 строк при каждой сортировке — это час
       бормотания вместо ответа. `aria-live="polite"` ролью status дан неявно и
       здесь повторён явно, потому что этот файл читают как договорённость о
       поведении.
  */
  return `
    <section class="panel${variant === 'quarter' ? ' panel--quarter' : ''}">
      <header class="panel__head">
        <span class="eyebrow">${eyebrow}</span>
        <h1 class="panel__title">${title}</h1>
        <p class="muted">${description}</p>
        ${period ? `<p class="lad__period">Недели ${period.startNumber}–${period.endNumber} · период ${period.number}</p>` : ''}
      </header>

      <div class="ctl">
        <label class="search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>
          </svg>
          <input type="search" placeholder="Найти альянс или тег…" data-ladder-search
                 autocomplete="off" spellcheck="false">
        </label>

        <div class="seg" role="group" aria-label="Кого показывать">
          <button type="button" class="seg__btn is-on" data-ladder-filter="active" aria-pressed="true">Активные</button>
          <button type="button" class="seg__btn" data-ladder-filter="all" aria-pressed="false">Все</button>
        </div>

        <div class="seg" role="group" aria-label="Сортировка">
          <button type="button" class="seg__btn is-on" data-ladder-sort="points" aria-pressed="true">Очки</button>
          <button type="button" class="seg__btn" data-ladder-sort="wins" aria-pressed="false">Победы</button>
          <button type="button" class="seg__btn" data-ladder-sort="form" aria-pressed="false">Форма</button>
          <button type="button" class="seg__btn" data-ladder-sort="name" aria-pressed="false">А–Я</button>
        </div>
      </div>

      <div class="lad__head" aria-hidden="true">
        <span>#</span><span>Альянс</span><span>Форма</span><span>П / Пр</span>
        <span class="ta-r">Очки</span><span>Динамика</span>
      </div>

      <div class="lad" data-ladder-list>${rows}</div>

      <p class="lad__empty" data-ladder-empty hidden>Ничего не нашлось. Проверьте написание.</p>
      <p class="lad__count muted" data-ladder-count role="status" aria-live="polite">
        ${plural(active, 'активный альянс', 'активных альянса', 'активных альянсов')} из ${list.length}
      </p>
    </section>`;
}

/**
 * Состояние без данных.
 *
 * Не «ошибка» и не пустая страница: то, что результатов ещё нет, — обычное
 * положение дел в начале сезона и при недоступном источнике. Человек должен
 * прочитать, почему пусто, а не решить, что сайт сломался.
 */
function renderEmpty(eyebrow, title) {
  return `
    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">${esc(eyebrow)}</span>
        <h1 class="panel__title">${esc(title)}</h1>
      </header>
      <p class="muted">
        Результатов пока нет. Рейтинг появится, как только внесут первые итоги VS.
      </p>
    </section>`;
}

function rowHtml(r, byId, variant = 'season', achievements) {
  const a = r.alliance;
  const color = a.color || '#7a8494';
  const isQuarter = variant === 'quarter';
  const mergedTarget = a.mergedInto ? byId.get(a.mergedInto) : null;

  // Свежая форма: сколько побед в последних пяти. Нужна для сортировки «по форме».
  const formScore = r.form.filter((o) => o === 'win').length;

  const streak =
    r.streak && r.streak.length > 1
      ? `<span class="streak streak--${r.streak.type}">${r.streak.type === 'win' ? '🔥' : '💀'}${r.streak.length}</span>`
      : '';

  const medal = r.place <= 3 ? ` lad__row--m${r.place}` : '';
  const achievementCount = achievements?.get(a.id)?.length ?? 0;
  const achievementMark = achievementCount ? `<span class="achievement-count" title="Достижения: ${achievementCount}">✦${achievementCount}</span>` : '';

  /*
    Строка — ссылка на карточку альянса. data-go нужен только собранному
    одним файлом превью: там нет роутера, и клик перехватывается вручную.
    В настоящем сайте отрабатывает обычный href.

    ИМЯ СТРОКИ — ГЛАВНОЕ, ЧЕМ СТРОКА ОТЛИЧАЕТСЯ ОТ КАРТИНКИ.

    Внутри строки шесть колонок, и четыре из них — голые знаки: «2», «—»,
    «●●○○○», «8/1», «+6». Строка при этом не таблица, а ссылка: ассоциировать
    её клетки с шапкой столбцов невозможно, даже если подписать шапку. Поэтому
    читателю с программой экрана имя даёт сама строка — целиком, в нужном
    порядке, словами. Шапка столбцов остаётся декоративной (aria-hidden): для
    зрячего она полезна, читатель получил бы по ней второе копирование тех же
    слов.
  */
  return `
  <a class="lad__row${medal}${isQuarter ? ' lad__row--quarter' : ''}${a.active ? '' : ' lad__row--off'}"
     href="#/alliance/${esc(a.id)}" data-go="alliance-${esc(a.id)}"
     aria-label="${esc(standingsRowLabel(r, { mergedTarget, achievementCount }))}"
     style="--tag-color:${esc(color)}"
     data-name="${esc(a.name.toLowerCase())}"
     data-tag="${esc(a.tag.toLowerCase())}"
     data-points="${r.points}"
     data-wins="${r.wins}"
     data-form="${formScore}"
     data-place="${r.place}"
     data-active="${a.active ? 1 : 0}">

    <span class="lad__place">
      <b class="num">${r.place}</b>${deltaBadge(r.delta)}
    </span>

    <span class="lad__ident">
      <span class="tag">${esc(a.tag)}</span>
      <span class="lad__name">${esc(a.name)}</span>
      ${streak}${achievementMark}
      ${
        mergedTarget
          ? `<em class="lad__off">слился с ${esc(mergedTarget.tag)}</em>`
          : a.active ? '' : '<em class="lad__off">распался</em>'
      }
    </span>

    <span class="lad__form">${formDots(r.form)}</span>

    <span class="lad__wl num">
      <b class="c-win">${r.wins}</b><i>/</i><b class="c-loss">${r.losses}</b>
    </span>

    <span class="lad__pts num ${r.points > 0 ? 'pos' : r.points < 0 ? 'neg' : ''}">
      ${r.points > 0 ? '+' : ''}${r.points}
    </span>

    ${isQuarter ? '' : `<span class="lad__spark">${sparkline(r.series, color, 92, 26)}</span>`}
  </a>`;
}
