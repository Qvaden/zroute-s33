import { esc, deltaBadge, formDots, sparkline, plural, standingsRowLabel, unavailableNote, emptyState } from '../ui/helpers.js';
import { inkOf, tagColor } from '../ui/ink.js';
import { byWeekStart } from '../data/week-order.js';
import { CONFIG } from '../../config.js';

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
  weeks,
  eyebrow = 'Сезон целиком',
  title = 'Рейтинг альянсов',
  description = 'Победа +1 · Поражение −1 · Третьего не бывает',
  period = null,
  variant = 'season',
  achievements,
  loadError = '',
} = {}) {
  const list = Array.isArray(standings) ? standings : [];

  if (!list.length) return renderEmpty(eyebrow, title, loadError);

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
  const table = `
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

      ${emptyState({
        title: 'Ничего не нашлось',
        note: 'Проверьте написание.',
        attrs: 'data-ladder-empty',
        hidden: true,
      })}

      <p class="lad__count muted" data-ladder-count role="status" aria-live="polite">
        ${plural(active, 'активный альянс', 'активных альянса', 'активных альянсов')} из ${list.length}
      </p>
    </section>`;

  // Доска Кварта — тот же ряд, но за четыре недели; график сезона под ней
  // рассказывал бы про другой период и противоречил бы таблице над собой.
  return variant === 'quarter' ? table : `${table}${racePanel(list, weeks)}`;
}

/**
 * ГРАФИК СЕЗОНА — под таблицей, а не на главной.
 *
 * Причина переноса не в месте на сводке, а в том, с каким вопросом человек
 * спускается вниз: таблицу смотрят ради места, график — чтобы сравнить
 * двоих-троих за весь сезон. На главной он был картинкой про пятерых
 * лидеров, которых никто не выбирал; здесь он инструмент сравнения, и
 * кнопки выбора живут тут же, под ним.
 *
 * ЧЕМ ЭТА РАЗМЕТКА ОТЛИЧАЕТСЯ ОТ СОСЕДЕЙ ПО СТРАНИЦЕ. Строки рейтинга
 * рисуются целиком здесь, а драйвер только переставляет и скрывает их.
 * График так устроен быть не может: его линии зависят от выбора, а вместе
 * с ними и вертикальная шкала — снять одного лидера и оставить аутсайдера
 * значит перерисовать поле заново, а не спрятать одну `<polyline>`. Поэтому
 * страница печатает только пустой кадр (`[data-race-plot]`) и данные в
 * `<script type="application/json">`, а рисует ui/race-controls.js — один и
 * тот же файл на живом сайте и в собранной копии.
 *
 * ПОЧЕМУ ДАННЫЕ ЛЕЖАТ В СТРАНИЦЕ, А НЕ ВЫЧИТЫВАЮТСЯ ИЗ ТАБЛИЦЫ. Драйвер
 * собран без import и потому не доходит до `computeStandings`: ряды таблицы
 * несут очки и место, но не накопленную серию по неделям. Числа графика
 * записаны здесь ровно в том виде, в каком их посчитал слой данных, —
 * пересчитывать их во втором месте значит однажды получить два разных
 * сезона на одном экране.
 */
function racePanel(list, weeks) {
  /*
    Недели берём отсортированными по старту, как это делает и
    `computeStandings`. Поле `weeks` приходит из состояния в порядке
    таблицы, а серия строится по порядку дат: без сортировки подпись
    «неделя 12» встала бы над точкой недели 3, и график начал бы врать
    ровно там, где его читают.
  */
  const ordered = [...(Array.isArray(weeks) ? weeks : [])].sort(byWeekStart);
  if (ordered.length < 2) return '';

  const lines = list
    .filter((r) => Array.isArray(r.series) && r.series.length === ordered.length)
    .map((r) => {
      /*
        `ink` и `inkLabel` — ссылки на CSS-переменные с контрастной краской
        альянса (ui/ink.js), а не сами цвета. Драйвер графика собран без
        import и поэтому не умеет ни считать контраст, ни sanitизовать id в
        имя переменной; правила с переменными печатает модуль, который до
        слоя данных дотягивается. Числа в атрибутах остались бы краской той
        темы, что была на экране при сборке разметки.
      */
      const color = tagColor(r.alliance.color);
      const ink = inkOf(r.alliance.id, color);
      return {
        id: r.alliance.id,
        tag: r.alliance.tag,
        name: r.alliance.name,
        color,
        ink: ink.line,
        inkLabel: ink.label,
        active: !!r.alliance.active,
        series: r.series,
      };
    });
  if (lines.length < 2) return '';

  /*
    Кнопок выбора ровно столько, сколько альянсов в таблице. Они
    не перерисовываются при клике — драйвер меняет только `aria-pressed` и
    класс, — и потому фокус после нажатия остаётся на той же кнопке: у
    человека с клавиатуры он не уезжает в начало списка.

    Про состояние «на графике». Здесь его нет ни в классе, ни в `aria-pressed`:
    поле при загрузке пустое, а подсветка кнопки обещала бы линию, которой не
    видно. Отмечает выбранное только драйвер — обоими способами сразу.
    Неактивный альянс помечен статически, тем же словом, что и строка выше.
  */
  const chips = lines
    .map(
      (l) => `
        <button type="button" class="race__chip${l.active ? '' : ' race__chip--off'}"
                data-race-chip="${esc(l.id)}" aria-pressed="false"
                aria-label="${esc(l.tag)} — ${esc(l.name)}${l.active ? '' : ' · неактивный'}">
          <i class="race__dot" style="--tag-color:${esc(l.color)}" aria-hidden="true"></i>${esc(l.tag)}
        </button>`
    )
    .join('');

  /*
    `<` в JSON заменяется на `\u003c` не косметически. Имя альянса вносит
    человек, и одно «</script>» внутри него закрыло бы блок с данными
    посередине: остальной текст страницы браузер прочитал бы как код.
  */
  const payload = JSON.stringify({ weeks: ordered.map((w) => w.number), lines }).replace(/</g, '\\u003c');
  const cap = CONFIG.raceMaxLines;
  const def = CONFIG.raceDefaultLines;

  return `
    <section class="panel panel--race" data-race-panel data-race-cap="${cap}" data-race-default="${def}">
      <header class="panel__head">
        <span class="eyebrow">График сезона</span>
        <h2 class="panel__title" tabindex="-1" data-race-title>Как менялись очки</h2>
        <p class="muted">Накопленные очки по неделям · на поле до ${cap} линий — отметьте, кого сравнивать</p>
      </header>

      <div class="race__plot" data-race-plot></div>

      ${emptyState({
        title: 'Не выбран ни один альянс',
        note: 'Отметьте кого-нибудь в списке ниже — и линия появится.',
        attrs: 'data-race-empty',
        hidden: true,
      })}

      <p class="lad__count muted" data-race-count role="status" aria-live="polite"></p>

      <details class="race__picker" data-race-picker>
        <summary class="race__summary">Выбрать альянсы</summary>
        <div class="race__tools">
          <button type="button" class="race__btn" data-race-preset="top">Топ-${def}</button>
          <button type="button" class="race__btn" data-race-preset="none">Снять все</button>
        </div>
        <div class="race__chips" role="group" aria-label="Альянсы на графике">${chips}</div>
      </details>

      <script type="application/json" data-race-data>${payload}</script>
    </section>`;
}

/**
 * Состояние без данных.
 *
 * Не «ошибка» и не пустая страница: то, что результатов ещё нет, — обычное
 * положение дел в начале сезона. Человек должен прочитать, почему пусто,
 * а не решить, что сайт сломался.
 *
 * Но пустой экран бывает и при готовой таблице: база молчит и снимок молчит,
 * до рейтинга не дошло ничего. Об этом рассказывает unavailableNote, и
 * различать два случая обязательно: «появится, как только внесут первые итоги»
 * про готовые итоги — просто неправда.
 */
function renderEmpty(eyebrow, title, loadError) {
  return `
    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">${esc(eyebrow)}</span>
        <h1 class="panel__title">${esc(title)}</h1>
      </header>
      ${loadError
        ? unavailableNote()
        : '<p class="muted">Результатов пока нет. Рейтинг появится, как только внесут первые итоги VS.</p>'}
    </section>`;
}

function rowHtml(r, byId, variant = 'season', achievements) {
  const a = r.alliance;
  const color = tagColor(a.color);
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
      <b class="num">${String(r.place).padStart(2, '0')}</b>${deltaBadge(r.delta)}
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

    ${isQuarter ? '' : `<span class="lad__spark">${sparkline(r.series, inkOf(a.id, color).line, 92, 26)}</span>`}
  </a>`;
}
