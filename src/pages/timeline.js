import { esc, fmtDate, fmtDateFull, plural, pluralWord, safeUrl } from '../ui/helpers.js';
import { EVENT_TYPE, EVENT_TYPE_ORDER, serverEvents, verdictText, pillText } from '../logic/event-types.js';

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/* Сколько свежих плашек в шапке видно сразу, остальные — за «Показать все». */
const WEEKS_SHOWN = 4;

/**
 * Хронология: «прикольно будет смотреть, когда какая Столица была взята».
 *
 * Сверху крупно — что делал сервер последним: брал чужую Столицу или отбивал
 * свою. Ниже стена трофеев с номерами взятых серверов, а за ней лента событий
 * для тех, кому нужны детали.
 *
 * Про подстановку по умолчанию: недоступная таблица результатов больше
 * не закрывает сайт целиком, поэтому страница может законно получить пустоту.
 */
export function renderTimeline({ events } = {}) {
  const list = Array.isArray(events) ? events : [];

  /*
    Серверные события — захваты и защиты — это то, за чем на эту вкладку
    и заходят. Они живут среди обычных событий, а не у недели: кампания может
    тянуться через несколько недель, и один и тот же захват не должен
    записываться в двух местах.
  */
  const server = serverEvents(list);

  if (!list.length) {
    return `
      <section class="hero hero--tl">
        <span class="eyebrow">Хроника завоеваний</span>
        <h2 class="tl__title">Ещё ни одной записи</h2>
        <p class="guide__sub">
          Здесь будет летопись сервера: чьи Столицы забрали и как отбивали свою,
          взятые Столицы крупными плитками и события по датам — войны, слияния
          альянсов, всё, что стоит запомнить. Первая запись появится, как только
          её внесут.
        </p>
      </section>`;
  }

  /*
    Записи без даты в ленту не попадают: дата — это ось, по которой строится
    вся страница, а строка без неё встанет в произвольное место и попадёт
    в фильтр не того месяца. Такая запись — состояние данных, а не события,
    и молча пропустить её честнее, чем показать в случайном году.
  */
  const sorted = list
    .filter((e) => e?.date instanceof Date && !Number.isNaN(e.date.getTime()))
    .sort((a, b) => b.date - a.date);

  if (!sorted.length) {
    return `
      <section class="hero hero--tl">
        <span class="eyebrow">Хроника завоеваний</span>
        <h2 class="tl__title">Записи есть, но без дат</h2>
        <p class="guide__sub">
          Летопись строится по датам, и записи без даты показать негде.
          Проверьте столбец с датой в таблице.
        </p>
      </section>`;
  }

  const captures = sorted.filter((e) => e.type === 'server_capture');

  return `
    ${renderServerSection(sorted)}
    ${captures.length || sorted.length ? renderTrophies(captures, sorted) : ''}
    ${sorted.length ? renderFilters(sorted) : ''}
    ${sorted.length ? renderFeed(sorted) : ''}
    <p class="tl__empty" data-tl-empty hidden>Событий такого типа пока нет.</p>`;
}

/** «2026-09» — ключ месяца, по которому фильтрует скрипт. */
const ymKey = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const MONTH_NAME = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/**
 * ЧТО ДЕЛАЛ СЕРВЕР — крупный вердикт и летопись под ним.
 *
 * Список — вся летопись целиком (свежие сверху), а не только захваты
 * и защиты: самый последний вердикт и первая плашка должны отвечать
 * на вопрос «что в летописи происходит прямо сейчас».
 *
 * Вердикт показывает не обязательно последнее событие: по нажатию на любую
 * плашку он переключается на неё. Календарь (год → месяц) фильтрует и плашки,
 * и ленту событий ниже — «сентябрь» означает сентябрь везде.
 *
 * Все вердикты отрисованы сразу и спрятаны, а скрипт только переключает
 * видимость. Причина не в лени: так страница работает и в собранном одним
 * файлом превью, где данных для перерисовки нет вовсе.
 */
function renderServerSection(list) {
  if (!list.length) return '';

  const cards = list
    .map((e, i) => {
      const m = EVENT_TYPE[e.type] ?? EVENT_TYPE.other;
      // У исходов вердикт готов («Захватили Столицу сервера 36»), у остальных
      // типов — это название записи, как в ленте ниже.
      const text = m.verdict ? verdictText(e.type, e.serverNumber) : (e.title || pillText(e.type, e.serverNumber));
      return `
        <div class="verdict${m.kind ? ` verdict--${esc(m.kind)}` : ''}" data-tl-open="${esc(e.id)}"
             data-tl-verdict="${esc(e.id)}" ${i === 0 ? '' : 'hidden'}
             title="Перейти к записи в ленте" role="link" tabindex="0">
          <div class="verdict__week">
            <span>${esc(MONTH_SHORT[e.date.getUTCMonth()])}</span>
            <b class="num">${e.date.getUTCDate()}</b>
          </div>
          <div class="verdict__body">
            <h2 class="verdict__text">${esc(text)}</h2>
            <p class="verdict__dates">
              ${esc(fmtDateFull(e.date))}
              ${e.durationDays ? `<span class="hero__sep">·</span> ${plural(e.durationDays, 'день', 'дня', 'дней')}` : ''}
            </p>
          </div>
        </div>`;
    })
    .join('');

  const years = [...new Set(list.map((e) => e.date.getUTCFullYear()))].sort((a, b) => b - a);
  const months = [...new Set(list.map((e) => ymKey(e.date)))].sort().reverse();

  const yearChips = years
    .map((y) => `<button type="button" class="cal__btn" data-tl-yr="${y}">${y}</button>`)
    .join('');

  const monthChips = months
    .map((ym) => {
      const label = MONTH_NAME[Number(ym.slice(5, 7)) - 1];
      return `<button type="button" class="cal__btn" data-tl-mo="${ym}" hidden>${esc(label)}</button>`;
    })
    .join('');

  /*
    Подпись плашки собирает словарь: у атаки и у защиты номер значит разное,
    и «отбились от 51» нельзя склеить теми же кусками, что «взяли 74».

    Плашек со временем становится десятки, и лента в шапке съедает экран,
    поэтому по умолчанию показываем только несколько самых свежих, а остальные
    прячем за кнопкой «Показать все». Скрипт режет список после фильтра по
    году и месяцу, поэтому кнопка жива и в «сентябре», где плашек может быть
    больше четырёх.
  */
  const pills = list
    .map((e, i) => {
      const m = EVENT_TYPE[e.type] ?? EVENT_TYPE.other;
      return `<li${i >= WEEKS_SHOWN ? ' hidden' : ''}>
        <button type="button" class="wk${m.kind ? ` wk--${esc(m.kind)}` : ''}${m.action ? ` wk--${esc(m.action)}` : ''}"
                data-tl-week="${esc(e.id)}" data-tl-ym="${ymKey(e.date)}"
                title="${esc(fmtDateFull(e.date))}">
          <span class="wk__num num">${esc(fmtDate(e.date))}</span>
          <span class="wk__what">${esc(pillText(e.type, e.serverNumber))}</span>
        </button>
      </li>`;
    })
    .join('');

  const moreBtn = `
    <button type="button" class="wks__more" data-tl-more aria-expanded="false"
            ${list.length > WEEKS_SHOWN ? '' : 'hidden'}>
      Показать все (${Math.max(0, list.length - WEEKS_SHOWN)})
    </button>`;

  return `
    <section class="hero hero--tl">
      <span class="eyebrow">Что делал сервер</span>

      ${cards}

      <div class="cal">
        <span class="cal__label">Найти запись</span>
        <div class="cal__row">
          <button type="button" class="cal__btn is-on" data-tl-yr="all">За всё время</button>
          ${yearChips}
        </div>
        <!-- Скрыт до выбора года: иначе до первого запуска скрипта здесь
             висела бы пустая строка с отступом. -->
        <div class="cal__row cal__row--mo" data-tl-months hidden>${monthChips}</div>
      </div>

      <ul class="wks">${pills}</ul>
      ${moreBtn}
      <p class="wks__empty" data-tl-noweeks hidden>В этом месяце записей нет.</p>
    </section>`;
}

/** Стена трофеев: захваченные серверы крупными плитками. */
function renderTrophies(captures, all) {
  const durations = all.map((e) => e.durationDays).filter((d) => typeof d === 'number');
  const capDurations = captures.map((e) => e.durationDays).filter((d) => typeof d === 'number');

  const first = all[all.length - 1].date;
  const last = all[0].date;
  const months = Math.max(1, Math.round((last - first) / (1000 * 60 * 60 * 24 * 30.4)));

  // Число выводится отдельно и крупно, поэтому в подписи его быть не должно —
  // иначе получается «10 · 10 месяцев истории».
  const fastest = capDurations.length ? Math.min(...capDurations) : null;
  const longest = capDurations.length ? Math.max(...capDurations) : null;

  const stats = [
    {
      value: captures.length,
      label: pluralWord(captures.length, 'Столица взята', 'Столицы взято', 'Столиц взято'),
    },
    {
      value: months,
      label: pluralWord(months, 'месяц истории', 'месяца истории', 'месяцев истории'),
    },
    fastest !== null
      ? { value: fastest, label: `${pluralWord(fastest, 'день', 'дня', 'дней')} — самый быстрый` }
      : null,
    longest !== null && longest !== fastest
      ? { value: longest, label: `${pluralWord(longest, 'день', 'дня', 'дней')} — самый долгий` }
      : null,
  ].filter(Boolean);

  // Трофеи в хронологическом порядке: приятнее читать как летопись.
  const tiles = [...captures]
    .sort((a, b) => a.date - b.date)
    .map(
      (e, i) => `<div class="trophy" style="--i:${i}">
        <span class="trophy__num num">${e.serverNumber ?? '?'}</span>
        <span class="trophy__date">${MONTH_SHORT[e.date.getUTCMonth()]} ${String(e.date.getUTCFullYear()).slice(2)}</span>
        ${e.durationDays ? `<span class="trophy__days">${plural(e.durationDays, 'день', 'дня', 'дней')}</span>` : ''}
      </div>`
    )
    .join('');

  return `
    <section class="hero hero--tl">
      <span class="eyebrow">Хроника завоеваний</span>
      <h2 class="tl__title">Чьи Столицы забрали</h2>

      <div class="tl__stats">
        ${stats
          .map(
            (s) => `<div class="tl__stat">
              <b class="num">${s.value}</b><span>${s.label}</span>
            </div>`
          )
          .join('')}
      </div>

      ${tiles ? `<div class="trophies">${tiles}</div>` : ''}
    </section>`;
}

function renderFilters(events) {
  const present = [...new Set(events.map((e) => e.type))];
  const types = EVENT_TYPE_ORDER.filter((t) => present.includes(t));
  const buttons = types
    .map(
      (t) => `<button type="button" class="seg__btn" data-tl-filter="${t}">${esc(EVENT_TYPE[t].filter)}</button>`
    )
    .join('');

  return `<div class="ctl ctl--tl">
    <div class="seg seg--type" role="group" aria-label="Тип события">
      <button type="button" class="seg__btn is-on" data-tl-filter="all">Все</button>
      ${buttons}
    </div>
    <div class="pick pick--tl">
      <span class="pick__cap">Тип</span>
      <button type="button" class="pick__btn" data-pick-open
              aria-haspopup="listbox" aria-expanded="false" aria-label="Выбрать тип события">
        <span class="pick__val">Все</span>
        <span class="pick__carat" aria-hidden="true"></span>
      </button>
      <div class="pick__menu" role="listbox" aria-label="Тип события">
        <button type="button" class="pick__opt" role="option" data-tl-filter="all" aria-selected="true">Все</button>
        ${types.map((t) => `<button type="button" class="pick__opt" role="option" data-tl-filter="${esc(t)}">${esc(EVENT_TYPE[t].filter)}</button>`).join('')}
      </div>
    </div>
  </div>`;
}

function eventImages(event) {
  const urls = Array.isArray(event?.imageUrls)
    ? event.imageUrls
    : (event?.imageUrl ? [event.imageUrl] : []);
  return urls.map((url) => safeUrl(url)).filter(Boolean);
}

function renderEventGallery(event) {
  const images = eventImages(event);
  if (!images.length) return '';
  return `<div class="tl__gallery" data-tl-gallery>
    ${images.map((url, i) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img class="tl__img" src="${esc(url)}" alt="${esc(event.title)} — фото ${i + 1}" loading="lazy"></a>`).join('')}
  </div>`;
}

/**
 * ЛЕНТА СОБЫТИЙ, СЛОЖЕННАЯ ПО МЕСЯЦАМ.
 *
 * ЗАЧЕМ СКЛАДЫВАТЬ. Записи копятся: захват, защита, война, слияние — за год
 * их набирается сотня. Один длинный столбец на телефоне превращается
 * в бесконечную прокрутку, где невозможно найти нужное и не видно, сколько
 * всего есть.
 *
 * ПРАВИЛО: текущий месяц открыт, всё прошлое сложено в свои месяцы. Так
 * «что происходит сейчас» видно сразу, а архив не мешает — но и не спрятан:
 * заголовок месяца говорит, сколько внутри записей, и раскрывается нажатием.
 *
 * Почему граница по месяцу, а не «последние 10 записей». Месяц — единица,
 * в которой человек думает о прошлом («это было в августе»), а «последние
 * десять» ничего не значат: их может быть три за полгода или тридцать
 * за неделю.
 *
 * ПОЧЕМУ <details>, А НЕ СВОЙ СКРИПТ. Раскрытие работает без JavaScript,
 * значит и в собранном одним файлом превью, и при поиске по странице:
 * браузер сам раскрывает <details>, когда ищет текст внутри.
 */
function renderFeed(events) {
  /*
    Текущий месяц считаем от САМОЙ СВЕЖЕЙ ЗАПИСИ, а не от сегодняшней даты.

    Разница видна в тихий месяц: если последнее событие было в августе,
    а сейчас октябрь, «текущим» по календарю оказался бы пустой октябрь —
    и лента открылась бы полностью свёрнутой. Человек увидел бы список папок
    и ни одной записи.
  */
  const freshest = events[0].date;
  const openKey = ymKey(freshest);

  /*
    Группируем, сохраняя порядок: события уже отсортированы от свежих
    к старым, и Map запоминает порядок вставки ключей.
  */
  const byMonth = new Map();
  for (const e of events) {
    const key = ymKey(e.date);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(e);
  }

  let lastYear = null;
  const blocks = [];

  for (const [key, list] of byMonth) {
    const year = Number(key.slice(0, 4));
    const monthName = MONTH_NAME[Number(key.slice(5, 7)) - 1];

    /*
      Разделитель года — перед первым месяцем этого года. Он остаётся снаружи
      месяцев: год это не папка, а отметка на оси времени.
    */
    if (year !== lastYear) {
      blocks.push(`<li class="tl__year" data-tl-year="${year}"><span>${year}</span></li>`);
      lastYear = year;
    }

    const items = list.map((e) => renderItem(e)).join('');
    const isOpen = key === openKey;

    blocks.push(`
      <li class="tl__month" data-tl-month="${esc(key)}">
        <details class="tl__group" data-tl-group data-tl-default-open="${isOpen ? '1' : '0'}" ${isOpen ? 'open' : ''}>
          <summary class="tl__group-head">
            <span class="tl__group-name">${esc(monthName)}</span>
            <span class="tl__group-count num">${list.length}</span>
            <span class="tl__group-chev" aria-hidden="true">▾</span>
          </summary>
          <ul class="tl tl--group">${items}</ul>
        </details>
      </li>`);
  }

  return `<section class="panel">
    <ul class="tl tl--months" data-tl-list>${blocks.join('')}</ul>
  </section>`;
}

/**
 * Одна запись.
 *
 * КОМПАКТНЕЕ, ЧЕМ БЫЛО. Раньше под каждой записью висела строка «Открыть
 * событие» — отдельный <details> с подписью. На ленте из тридцати записей это
 * тридцать одинаковых строк, которые ничего не сообщают: место занимают,
 * а прочитать по ним нечего.
 *
 * Теперь подробности раскрываются нажатием на саму запись, а о том, что
 * внутри что-то есть, говорит тонкий уголок в углу. Одна строка вместо двух
 * на каждой записи — на телефоне это разница между «видно четыре события»
 * и «видно шесть».
 *
 * ВИД ЗАПИСИ. Никаких рамок и бейджей: тихая цветная точка слева (по цвету
 * исхода), подпись типа и дата строкой выше названия, само название и, если
 * есть, короткое описание. Раскрывающийся хвост обозначает единственный
 * уголок. Так лента читается как спокойный список, а не как растровое поле.
 */
function renderItem(e) {
  const t = EVENT_TYPE[e.type] ?? EVENT_TYPE.other;
  const images = eventImages(e);
  const hasMore = Boolean(e.body) || images.length > 0;

  /*
    Подпись под названием — одной спокойной строкой: дата, длительность,
    фотографии через точку. Без чипов и панелек: лишние рамки в ленте
    шумят, а текст всё равно переносится по границе, если места мало.
  */
  const note = [
    fmtDateFull(e.date),
    e.durationDays ? plural(e.durationDays, 'день', 'дня', 'дней') : null,
    images.length ? `${images.length}&nbsp;фото` : null,
  ]
    .filter(Boolean)
    .join('&nbsp;· ');

  const head = `
    <span class="tl__dot" aria-hidden="true"></span>
    <span class="tl__body">
      <span class="tl__title">${esc(e.title)}</span>
      <span class="tl__meta">
        <span class="tl__type">${esc(t.label)}</span>
        <span class="tl__sep" aria-hidden="true">·</span>
        <span class="tl__meta-note">${note}</span>
      </span>
      ${e.summary ? `<span class="tl__summary">${esc(e.summary)}</span>` : ''}
    </span>
    ${hasMore ? '<span class="tl__chev" aria-hidden="true">▾</span>' : ''}`;

  const attrs = `class="tl__item tl__item--${esc(e.type)}" data-tl-type="${esc(e.type)}" data-tl-ym="${ymKey(e.date)}" data-tl-id="${esc(e.id)}"`;

  /*
    Запись без подробностей не делаем раскрывающейся: нажатие, после которого
    ничего не происходит, читается как поломка.
  */
  if (!hasMore) return `<li ${attrs}>${head}</li>`;

  return `
    <li ${attrs}>
      <details class="tl__details">
        <summary class="tl__row">
          ${head}
        </summary>
        <div class="tl__details-body">
          ${e.body ? `<p>${esc(e.body)}</p>` : ''}
          ${renderEventGallery(e)}
        </div>
      </details>
    </li>`;
}
