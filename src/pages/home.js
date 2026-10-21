import { esc, fmtDate, deltaBadge, plural, pluralWord, formDots, standingsRowLabel } from '../ui/helpers.js';
import { byWeekStart, findCurrentWeek } from '../data/week-order.js';
import { heroImage, heroAlt } from '../ui/hero-slot.js';
import { HERO_SIZES, HERO_WITH_COPIES, avifSrcset, webpSrcset } from '../ui/responsive-images.js';
import { EVENT_TYPE, pillText, isServerEvent } from '../logic/event-types.js';
import { tagColor } from '../ui/ink.js';

/* Формы слова «день» для счёта: 1 день, 2 дня, 5 дней. */
const DAYS = ['день', 'дня', 'дней'];

/**
 * Слой картинки под содержимым героя.
 *
 * Кадр занимает верхнюю полосу героя, а не ложится фоном под буквами: высота
 * полосы задана в CSS (`--hero-art-h` в styles-v8.css), и ровно на неё растёт
 * верхний отступ героя. Поэтому файл любого формата — горизонтальный,
 * вертикальный, квадратный — обрезается (`object-fit: cover`) в одну и ту же
 * полосу, а все цифры остаются на посчитанной поверхности героя.
 *
 * Высота известна браузеру до первого байта картинки, так что при её приходе
 * ничего не сдвигается; контур ожидания резервирует полосу вместе с героем.
 *
 * `fetchpriority="high"` — потому что это самый заметный образ первого
 * экрана, а `decoding="async"` — потому что раскодирование кадра не должно
 * задерживать текст недели.
 */
/**
 * Ширина кадра, который лежит в репозитории (config.js просит длинную сторону
 * 1600 px). Нужна только чтобы вычислить ряд копий; проверка в тестах сверяет
 * это число с фактическим файлом, иначе `srcset` пообещал бы копию, которой нет.
 */
const HERO_SRC_WIDTH = 1600;

function heroMedia() {
  const src = heroImage();
  if (!src) return '';
  const copies = HERO_WITH_COPIES.has(src) ? webpSrcset(src, HERO_SRC_WIDTH) : '';
  const img = `<img class="hero__img" src="${esc(src)}" alt="${esc(heroAlt())}" fetchpriority="high" decoding="async">`;
  return `<div class="hero__media">
            ${copies ? `<picture>
              <source type="image/avif" srcset="${esc(avifSrcset(src, HERO_SRC_WIDTH))}" sizes="${HERO_SIZES}">
              <source type="image/webp" srcset="${esc(copies)}" sizes="${HERO_SIZES}">
              ${img}
            </picture>` : img}
          </div>`;
}

/**
 * Полных календарных дней от сегодня до даты. Отрицательных не бывает:
 * прошедшая дата даёт ноль, а «было вчера» текст рисует сам.
 *
 * Считаем по UTC, потому что даты недель приходят из таблицы как полночь UTC
 * (см. fmtDate). В местном поясе вечер вторника дал бы «4 дня» вместо «5».
 */
function daysUntil(date, now = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const day = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(0, Math.round((day(date) - day(now)) / 86400000));
}


/**
 * ДАННЫЕ НЕ ДОШЛИ — экран обязан сказать это, а не притворяться предсезонкой.
 *
 * Для кода два состояния выглядят одинаково: результатов нет. Для человека
 * разница принципиальная, и старое поведение её стирало: страница печатала
 * «Ни одного результата пока не внесено — и это не ошибка» и «Недели ещё не
 * заведены» ровно в тот момент, когда ошибка была, а недели давно заведены —
 * их просто не удалось прочитать.
 *
 * Здесь ничего не выдумывается и не смягчается: называется факт (цифр не
 * видно), его причина (ни база, ни снимок не ответили), что по-прежнему
 * работает (форум, чаты, календарь, справочник) и что можно сделать (повторить
 * тем же обработчиком, что и в полоске над разделом).
 */
function renderOutage() {
  return `
    <section class="hero hero--lead${heroImage() ? ' hero--media' : ''}">
      ${heroMedia()}
      <div class="hero__top">
        <div class="hero__ident">
          <span class="eyebrow">Цифры сейчас не видны</span>
          <h1 class="hero__week">
            <span class="hero__word">Рейтинг</span>
            <span class="hero__num num" aria-hidden="true">—</span>
          </h1>
          <div class="hero__dates">ни живая база, ни автоматический снимок не ответили</div>
          <div class="hero__actions">
            <button type="button" class="hero__cta hero__cta--primary" data-boot-retry>Запросить ещё раз</button>
            <a class="hero__cta hero__cta--ghost" href="#/forum">Форум сервера</a>
          </div>
        </div>
      </div>

      <div class="preseason">
        <p class="preseason__lead">
          Здесь пусто не потому, что результатов ещё нет, а потому, что их не
          удалось прочитать. Придумывать цифры страница не будет: пока таблица
          недоступна, на ней нет ни номера недели, ни очков, ни движения
          в рейтинге.
        </p>
        <p class="preseason__note muted">
          Работает как обычно форум, личные сообщения, календарь встреч и
          справочник гайдов. Кнопка выше повторяет тот же запрос данных,
          с которого сайт стартует при открытии.
        </p>
      </div>
    </section>`;
}

/**
 * Состояние до первого внесённого результата.
 *
 * Отсчёт истории начинается с этой недели, поэтому таблица пока пуста
 * по-настоящему, а не из-за ошибки. Задача экрана — сказать это прямо
 * и показать, что подготовка сделана: все альянсы на месте, ждём первый VS.
 */
function renderPreSeason(standings, allWeeks) {
  const alliances = (standings ?? []).map((r) => r.alliance).filter((a) => a?.active);

  // Ближайшая неделя, которая ещё не закончилась.
  const today = new Date();
  const ordered = [...(allWeeks ?? [])].sort(byWeekStart);
  const upcoming = ordered.find((w) => w.endDate >= today) ?? ordered[0];

  return `
    <section class="hero hero--lead${heroImage() ? ' hero--media' : ''}">
      ${heroMedia()}
      <div class="hero__top">
        <span class="eyebrow">Отсчёт начинается</span>
        <h1 class="hero__week">
          <span class="hero__word">Неделя</span>
          <span class="hero__num num">${upcoming ? upcoming.number : '—'}</span>
        </h1>
        <div class="hero__dates">
          ${
            upcoming
              ? `${fmtDate(upcoming.startDate)} — ${fmtDate(upcoming.endDate)} · первый VS в истории сайта`
              : 'Недели ещё не заведены'
          }
        </div>
        <div class="hero__actions">
          <a class="hero__cta hero__cta--primary" href="#/forum">Форум сервера<span aria-hidden="true"> →</span></a>
          <a class="hero__cta hero__cta--ghost" href="#/about">О проекте</a>
        </div>
      </div>

      <div class="preseason">
        <p class="preseason__lead">
          Ни одного результата пока не внесено — и это не ошибка.
          История начинается с этой недели, и дальше она будет только расти:
          каждая победа и каждое поражение останутся здесь навсегда.
        </p>
        <p class="preseason__note muted">
          Первые итоги появятся, как только закончится VS и результаты внесут в таблицу.
        </p>
      </div>

      <div class="split">
        <div class="split__col">
          <h2 class="preseason__title">
            На старте
            <span class="split__count num">${alliances.length}</span>
            <i class="split__bar"></i>
          </h2>
          <div class="tiles">
            ${alliances
              .map(
                (a) => `<span class="tile" style="--tag-color:${esc(tagColor(a.color))}">
                          <b>${esc(a.tag)}</b>${esc(a.name)}
                        </span>`
              )
              .join('')}
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Как это будет работать</span>
        <h2>Победа +1, поражение −1</h2>
      </header>
      <div class="prose prose--week">
        <ul>
          <li><strong>Каждую неделю</strong> после VS в таблицу заносится результат каждого альянса.</li>
          <li><strong>Победа даёт +1 очко, поражение −1.</strong> Третьего не бывает: в VS выходят все.</li>
          <li><strong>Через месяц</strong> станет видно, кто держит форму, а кто просел.</li>
          <li><strong>Через полгода</strong> здесь будет история сервера, которой больше нигде нет.</li>
        </ul>
      </div>
      <p class="muted">
        ${plural(alliances.length, 'альянс', 'альянса', 'альянсов')} уже
        ${pluralWord(alliances.length, 'ждёт', 'ждут', 'ждут')} первой недели.
      </p>
    </section>`;
}

/**
 * Неделя, чей VS ещё впереди.
 *
 * Это не «последняя неделя с результатами» (то было бы прошлое) и не
 * «последняя заведённая» (их заводят на месяц вперёд). Берём ту, что идёт
 * сейчас; если результаты в неё уже внесли — правят и в среду, — то следующую
 * заведённую без результатов. Отсюда и «сколько дней до конца недели».
 */
function liveWeek(allWeeks, results, now = new Date()) {
  const ordered = [...(allWeeks ?? [])].sort(byWeekStart);
  if (!ordered.length) return null;

  const filled = new Set((results ?? []).map((r) => r.weekId));
  const current = findCurrentWeek(ordered, now);
  if (!filled.has(current.id)) return current;

  return ordered.find((w) => w.startDate > current.startDate && !filled.has(w.id)) ?? null;
}

/**
 * «Прямо сейчас» — ответ на «а уже можно заходить смотреть?».
 *
 * Старая главная умела говорить только про прошлую неделю, и человек,
 * зашедший во вторник, узнавал про неё то же, что видел в воскресенье.
 * Здесь — две вещи, которые ещё не случилось: сколько дней до конца текущей
 * недели и на какой неделе Кварта мы находимся.
 *
 * Ни одна строка не выдумывает расписание: и дата конца недели, и сыгранные
 * недели Кварта берутся из тех же данных, из которых считается рейтинг.
 */
function renderLive({ allWeeks, results, quarter, quarterStandings }, now = new Date()) {
  const week = liveWeek(allWeeks, results, now);
  const period = quarter ?? {};
  const totalWeeks = (period.weeks ?? []).length || 4;
  const played = period.playedWeeks ?? 0;
  const leader = (Array.isArray(quarterStandings) ? quarterStandings : []).find((r) => r.alliance.active) ?? null;

  const items = [];

  if (week) {
    const left = daysUntil(week.endDate, now);
    const toStart = daysUntil(week.startDate, now);
    /*
      До начала недели считать нечего: «12 дней до конца» у недели, которая
      ещё не началась, — правда, но правда бесполезная. Человек хочет знать,
      когда выходить играть, поэтому до старта показываем обратный отсчёт
      до понедельника, а «до конца» — только идущей недели.
    */
    const upcoming = toStart > 0;
    const note = upcoming
      ? `${plural(toStart, ...DAYS)} до начала`
      : left === 0
        ? 'последний день недели'
        : `${plural(left, ...DAYS)} до конца`;
    items.push(`
      <div class="live__item">
        <span class="live__label">${upcoming ? 'Скоро неделя' : 'Идёт неделя'} <b class="num">${week.number}</b></span>
        <span class="live__value">${fmtDate(week.startDate)} — ${fmtDate(week.endDate)}</span>
        <span class="live__note">${note}</span>
      </div>`);
  } else if (played > 0) {
    /*
      Активной недели нет: либо следующую ещё не завели, либо текущая уже
      закрыта результатами, а новая не начата. Молчать нельзя — панель
      называется «Прямо сейчас», и «сейчас» как раз пауза между VS.

      Формулировка намеренно не говорит «неделя не заведена»: это было бы
      верно только для одного из двух случаев, а различить их по данным
      нельзя.
    */
    const filled = new Set((results ?? []).map((r) => r.weekId));
    const last = [...(allWeeks ?? [])].sort(byWeekStart).filter((w) => filled.has(w.id)).pop();
    if (last) {
      items.push(`
        <div class="live__item">
          <span class="live__label">Пауза между VS</span>
          <span class="live__value">Сыграна неделя <b class="num">${last.number}</b></span>
          <span class="live__note">новых результатов пока нет — следующие появятся здесь</span>
        </div>`);
    }
  }

  if (played > 0) {
    const left = daysUntil(period.endDate, now);
    /*
      Начало следующего Кварта — день после конца текущего. Пока он не
      наступил, «новый Кварт с 21 сен» обещает будущее; после — то же слово
      звучало бы как опоздание, и мы говорим, что период закрыт.
    */
    const nextStart = period.endDate ? new Date(period.endDate.getTime() + 86400000) : null;
    /*
      Идущая неделя может лежать уже за краем показанного периода: в конце
      Кварта так бывает каждую сессию. Сказать тогда «завершён 20 сен» — значит
      столкнуть две строки одной панели: вверху «идёт», внизу «завершён».
    */
    const beyond = week && period.endNumber != null && week.number > period.endNumber;
    const dots = Array.from(
      { length: totalWeeks },
      (_, i) => `<i class="live__dot${i < played ? ' is-on' : ''}"></i>`
    ).join('');
    const tail =
      played < totalWeeks
        ? left === 0
          ? 'сегодня последний день'
          : `${plural(left, ...DAYS)} до конца`
        : !nextStart
          ? 'все недели сыграны'
          : daysUntil(nextStart, now) > 0
            ? `новый Кварт с ${fmtDate(nextStart)}`
            : beyond
              ? 'новый Кварт уже идёт'
              : `завершён ${fmtDate(period.endDate)}`;

    items.push(`
      <div class="live__item">
        <span class="live__label">Кварт <b class="num">${period.number}</b> · сыграно ${played} из ${totalWeeks}</span>
        <span class="live__dots">${dots}</span>
        <span class="live__value">${
          leader
            ? `<span class="tag" style="--tag-color:${esc(tagColor(leader.alliance.color))}">${esc(leader.alliance.tag)}</span> ${esc(leader.alliance.name)} · ${leader.points > 0 ? '+' : ''}${leader.points}`
            : 'лидер ещё не определился'
        }</span>
        <span class="live__note">${tail}</span>
      </div>`);
  }

  if (!items.length) return '';

  return `
    <section class="panel live">
      <header class="panel__head">
        <span class="eyebrow">Прямо сейчас</span>
        <a class="live__more" href="#/quarter">Страница Кварта<span aria-hidden="true"> →</span></a>
      </header>
      <div class="live__row">${items.join('')}</div>
    </section>`;
}

/**
 * РЕЙКА РЕЙТИНГА: трое впереди крупно, дальше — короткий список.
 *
 * Почему это живёт на главной, а не только в «Рейтинге»: «кто сейчас первый»
 * — второй вопрос после «как прошла неделя», и раньше за ним приходилось
 * уходить на отдельную страницу. При этом вся таблица здесь не нужна:
 * восемь-десять строк — ровно та стена, от которой страница уже уходила
 * в компактные «Итоги недели».
 *
 * Поля берутся те же, что рисует общий рейтинг: место, очки, победы и
 * поражения, движение за неделю, форма последних боёв. Ни одной цифры «на
 * глаз»: сайт не знает ни рейтинга силы, ни кто сейчас в игре, поэтому таких
 * показателей на главной нет вовсе.
 *
 * Если альянсов меньше четырёх, хвоста не бывает — ряд короче, а не пустой
 * с нулями. Ссылка вниз называется только тогда, когда за рейкой кто-то
 * остался: обещать «остальных» при полном списке значило бы вести в никуда.
 *
 * @param {ReturnType<typeof import('../logic/standings.js').computeStandings>} active
 * @param {number} total активных альянсов в таблице
 */
function renderRankRail(active, total) {
  if (!active.length) return '';

  const podium = active.slice(0, 3);
  const tail = active.slice(podium.length, podium.length + 4);
  const shown = podium.length + tail.length;
  const pts = (n) => `${n > 0 ? '+' : ''}${n}`;

  const top = podium
    .map(
      (r) => `
      <li class="rank__top rank__top--${r.place}" style="--tag-color:${esc(tagColor(r.alliance.color))}">
        <a class="rank__head" href="#/alliance/${esc(r.alliance.id)}" aria-label="${esc(standingsRowLabel(r))}">
          <span class="rank__place num">${String(r.place).padStart(2, '0')}</span>
          <span class="tag">${esc(r.alliance.tag)}</span>
          <span class="rank__name">${esc(r.alliance.name)}</span>
          <span class="rank__pts num${r.points > 0 ? ' pos' : r.points < 0 ? ' neg' : ''}">${pts(r.points)}</span>
        </a>
        <div class="rank__facts">
          <span class="rank__tally">
            <span class="c-win">${plural(r.wins, 'победа', 'победы', 'побед')}</span>,
            <span class="c-loss">${plural(r.losses, 'поражение', 'поражения', 'поражений')}</span>
          </span>
          <span class="rank__form">${formDots(r.form)}</span>
          ${deltaBadge(r.delta)}
        </div>
      </li>`
    )
    .join('');

  const rest = tail.length
    ? `
      <ul class="rank__rest">
        ${tail
          .map(
            (r) => `
          <li style="--tag-color:${esc(tagColor(r.alliance.color))}">
            <a href="#/alliance/${esc(r.alliance.id)}" aria-label="${esc(standingsRowLabel(r))}">
              <span class="rank__place num">${String(r.place).padStart(2, '0')}</span>
              <span class="tag">${esc(r.alliance.tag)}</span>
              <span class="rank__name">${esc(r.alliance.name)}</span>
              ${deltaBadge(r.delta)}
              <span class="rank__pts num${r.points > 0 ? ' pos' : r.points < 0 ? ' neg' : ''}">${pts(r.points)}</span>
            </a>
          </li>`
          )
          .join('')}
      </ul>`
    : '';

  return `
    <section class="panel panel--rank" aria-label="Рейтинг альянсов">
      <header class="panel__head">
        <span class="eyebrow">Общий рейтинг</span>
        <h2>Кто ведёт сезон</h2>
      </header>
      <ol class="rank__podium">${top}</ol>
      ${rest}
      ${
        total > shown
          ? `<a class="rank__all" href="#/ladder">Ещё ${total - shown} — в общем рейтинге<span aria-hidden="true"> →</span></a>`
          : '<a class="rank__all" href="#/ladder">Открыть рейтинг целиком<span aria-hidden="true"> →</span></a>'
      }
    </section>`;
}

/**
 * ЛЕТОПИСЬ НА ГЛАВНОЙ — три свежие записи, а не архив.
 *
 * Отдельная страница «Хронология» остаётся как есть: там фильтры по годам,
 * стена трофеев и статистика. Здесь задача другая — одной колонкой ответить
 * на «чем сервер жил на этих днях», прежде чем человек пойдёт читать чужие
 * посты.
 *
 * Рубрика, вердикт и номер сервера не сочиняются на месте: они берутся из
 * общего словаря типов (src/logic/event-types.js), которым пользуется и
 * панель, и страница летописи. Поэтому одно событие не может называться
 * по-разному на двух экранах.
 *
 * Записей может не быть вовсе, и это не пустая рамка, а отсутствие блока:
 * выдумывать «первая запись появится» главная не имеет права — летопись
 * ведут люди, и она появится тогда, когда её напишут.
 */
function renderChronicle(events) {
  const list = (Array.isArray(events) ? events : []).filter(
    (e) => e?.date instanceof Date && !Number.isNaN(e.date.getTime())
  );
  if (!list.length) return '';

  const [lead, ...others] = list.slice(0, 3);
  const meta = (e) => EVENT_TYPE[e.type] ?? EVENT_TYPE.other;
  /** win | loss | other — краска рубрики, а не выдуманный рейтинг важности. */
  const kindOf = (e) => meta(e).kind ?? 'other';
  /*
    Плашка-вердикт есть только у четырёх серверных типов: у войны, слияния и
    прочего исход не определён, а pill у них повторяет название рубрики.
    Два одинаковых слова рядом — это шум, а не информация.
  */
  const verdict = (e) => (isServerEvent(e.type) ? pillText(e.type, e.serverNumber) : '');

  const leadText = lead.body ?? lead.summary ?? '';

  return `
    <section class="panel panel--chron" aria-label="Летопись сервера">
      <header class="panel__head">
        <span class="eyebrow">Летопись</span>
        <h2>Чем сервер жил</h2>
      </header>

      <article class="chron__lead" data-kind="${kindOf(lead)}">
        <div class="chron__meta">
          <time class="chron__when num" datetime="${lead.date.toISOString().slice(0, 10)}">${fmtDate(lead.date)}</time>
          <span class="chron__cat">${esc(meta(lead).label)}</span>
          ${verdict(lead) ? `<span class="chron__verdict">${esc(verdict(lead))}</span>` : ''}
        </div>
        <h3 class="chron__title">${esc(lead.title)}</h3>
        ${lead.summary ? `<p class="chron__summary">${esc(lead.summary)}</p>` : ''}
        ${
          leadText
            ? `<details class="chron__read">
                 <summary>Читать запись</summary>
                 <div class="chron__body">${esc(leadText)}</div>
               </details>`
            : ''
        }
      </article>

      ${
        others.length
          ? `<ul class="chron__rest">${others
              .map(
                (e) => `
            <li data-kind="${kindOf(e)}">
              <time class="chron__when num" datetime="${e.date.toISOString().slice(0, 10)}">${fmtDate(e.date)}</time>
              <span class="chron__rest-body">
                <span class="chron__rest-title">${esc(e.title)}</span>
                <span class="chron__rest-meta">
                  <span class="chron__cat">${esc(meta(e).label)}</span>
                  ${verdict(e) ? `<span class="chron__verdict">${esc(verdict(e))}</span>` : ''}
                  ${e.summary ? `<span class="chron__rest-note">${esc(e.summary)}</span>` : ''}
                </span>
              </span>
            </li>`
              )
              .join('')}</ul>`
          : ''
      }

      <a class="chron__all" href="#/timeline">Вся летопись сервера<span aria-hidden="true"> →</span></a>
    </section>`;
}

/**
 * СЛОТ РЯДА СООБЩЕСТВА.
 *
 * Главная рисует пустой слот заданной высоты, а содержимое приносит
 * mountHomeCommunity после кадра. Причина разделения: темы форума лежат
 * в другом источнике, чем таблица результатов, и ждать их ответа, чтобы
 * показать неделю, — значит задерживать первый экран чужой сетью.
 *
 * Высота зарезервирована не «на глаз», а числом строк, которые ряд
 * действительно печатает: четыре темы по две строки, цифра дня и ссылка.
 * Поэтому момент, когда база отвечает, не сдвигает ни ряд, ни подвал.
 *
 * Мигалки у контура нет: ряд догружается один раз за визит, и пульсирующая
 * полоса привлекла бы к себе внимание больше, чем стоит его внимания.
 */
function renderCommunitySlot() {
  const rows = Array.from({ length: 4 }, () =>
    '<li><i class="community__sk-t"></i><i class="community__sk-m"></i></li>').join('');
  return `
    <section class="panel panel--community" data-home-community>
      <header class="panel__head">
        <span class="eyebrow">Сообщество</span>
        <h2>Живые обсуждения</h2>
      </header>
      <div class="community__body" data-home-community-body>
        <ul class="community__sk" aria-hidden="true">${rows}</ul>
      </div>
    </section>`;
}

/**
 * Главная — ответ на «зашёл и понял, у кого получается».
 * Всё главное должно читаться за пять секунд: номер недели, лидер сезона
 * и счёт недели. Остальное — ниже, для тех, кому интересно.
 *
 * Про подстановку по умолчанию: недоступная таблица результатов больше
 * не закрывает сайт целиком — форум с ней не связан. Значит эта страница
 * может законно получить пустоту, и падать ей нельзя.
 *
 * Про список победителей: раньше он занимал первый экран двумя стенами
 * тайлов, и это был самый большой блок на странице про самый короткий
 * факт. Теперь счёт — две цифры, а кто именно прячется под «Кто именно»;
 * список целиком всё равно есть в рейтинге.
 *
 * Про правую панель: экран результатов живёт без подписки и без колокольчика,
 * поэтому человеку полезно знать ровно другое — насколько полны те цифры,
 * что он видит. Панель говорит это посчитанными числами и открыто называет
 * источник: живая база, снимок с часом или ничего. Никаких «онлайн»,
 * «сектор» и прочей мишуры, которую сайт не может проверить, здесь нет.
 *
 * Про порядок и ширину ниже героя. Старая главная складывала четыре панели
 * одинаковой ширины одна под другую: у блока «Гонка сезона» и у блока
 * «Движение в рейтинге» был ровно тот же вес, что у вопроса «кто ведёт»,
 * который вообще-то и привёл человека на сайт. Теперь вес задан архитектурой
 * ряда, а не содержимым:
 *
 *   ряд с двумя колонками 60/40 — рейтинг (широкая рейка) рядом с летописью;
 *   следующий ряд — живые обсуждения на всю ширину;
 *   одинокая утилитарная панель — движение за неделю, самое короткое.
 *
 * Про график, которого здесь больше нет. «Гонка сезона» отвечала на чужой
 * вопрос — как распределились пятеро, которых никто не выбирал. Настоящий
 * вопрос другой: как мой альянс выглядит на фоне соседей за весь сезон. Он
 * живёт под таблицей «Рейтинга», там же, где и места, и выбор линий
 * (src/pages/ladder.js, racePanel). На главной от него осталась одна кнопка
 * в герое, и ряд обсуждений растянут на всю ширину: делить экран пополам
 * больше не с чем.
 *
 * Про телефон. Ряды схлопываются в одну колонку и остаются в том же порядке:
 * сначала «кто ведёт», потом «чем жил сервер», потом движение за неделю.
 */
export function renderHome(view = {}) {
  const { summary, standings, movers, weeks, allWeeks, results, events, dataMeta, loadError } = view;
  const list = Array.isArray(standings) ? standings : [];

  // Пустая таблица бывает двух видов, и человек обязан понять, какого именно.
  // Авария — не предсезонка: в ней нельзя писать «это не ошибка».
  if (loadError && !summary) return renderOutage();

  // Пока не внесён ни один результат, показывать нечего — но и «пусто» писать
  // нельзя: в этом состоянии сайт проживёт несколько дней после запуска,
  // и это первое, что увидят люди.
  if (!summary) return renderPreSeason(list, allWeeks ?? weeks ?? []) + renderLive(view);

  const { week, winners, losers, recorded } = summary;
  const leader = list[0];
  const active = list.filter((r) => r.alliance.active);
  const total = active.length;

  /*
    HUD считает только то, что действительно лежит в наборе. Ни одной
    выдуманной цифры здесь быть не может по построению: каждое значение —
    число, посчитанное из standings, results и отметки, которую положил в
    view main.js. Если соперников в таблице меньше двух, отрыва не бывает —
    и на экране так и написано словами, а не нулём.
  */
  const rows = Array.isArray(results) ? results : [];
  const playedWeeks = new Set(rows.map((r) => r.weekId)).size;
  const records = active.reduce((n, r) => n + (r.played || 0), 0);
  const gap = active.length > 1 ? active[0].points - active[1].points : null;
  const meta = dataMeta ?? { source: '', stamp: '' };
  const sourceLabel = meta.source === 'снимок'
    ? `снимок${meta.stamp ? ` от ${meta.stamp}` : ''}`
    : meta.source === '' ? 'данные не пришли' : 'только что из базы';
  const hudStat = (label, value, word = false) =>
    `<div class="hud__stat"><dt>${label}</dt><dd class="num${word ? ' is-word' : ''}">${value}</dd></div>`;
  const gapWord = gap === null || gap === 0;
  const gapText = gap === null ? 'нет второго' : gap === 0 ? 'вровень' : `+${gap}`;

  const tiles = (items) =>
    items.length
      ? items
          .map(
            (a) => `<span class="tile" style="--tag-color:${esc(tagColor(a.color))}">
                      <b>${esc(a.tag)}</b>${esc(a.name)}
                    </span>`
          )
          .join('')
      : '<span class="muted">никого</span>';

  // Серия у лидера может быть и проигрышной: победа в ней не обязательна.
  const STREAK_WORDS = {
    win: ['победа', 'победы', 'побед'],
    loss: ['поражение', 'поражения', 'поражений'],
  };
  const leaderStreakWords = leader?.streak ? STREAK_WORDS[leader.streak.type] : null;
  const leaderStreak =
    leaderStreakWords && leader?.streak.length > 1
      ? ` · серия ${plural(leader.streak.length, ...leaderStreakWords)}`
      : '';

  const moverRow = (r) =>
    `<li>
       <span class="tag" style="--tag-color:${esc(tagColor(r.alliance.color))}">${esc(r.alliance.tag)}</span>
       <span style="flex:1">${esc(r.alliance.name)}</span>
       ${deltaBadge(r.delta)}
       <span class="muted">${r.place} место</span>
     </li>`;

  // Движение за неделю — необязательная часть: без него страница осмысленна.
  const moved = movers ?? { up: [], down: [] };

  const entered =
    recorded === total
      ? plural(recorded, 'результат внесён', 'результата внесено', 'результатов внесено')
      : `внесено ${recorded} из ${total}`;

  return `
    <section class="hero hero--ops hero--lead${heroImage() ? ' hero--media' : ''}">
      ${heroMedia()}
      <div class="hero__top">
        <div class="hero__ident">
          <span class="hero__brandline">
            <b>Сервер 33</b>
            <i aria-hidden="true">·</i>
            <span>Z Route : Redemption</span>
          </span>
          <h1 class="hero__week">
            <span class="hero__word">Неделя</span>
            <span class="hero__num num">${week.number}</span>
          </h1>
          <div class="hero__dates">
            ${fmtDate(week.startDate)} — ${fmtDate(week.endDate)}
            <span class="hero__sep">·</span>
            ${entered}
          </div>
          <p class="hero__lead">
            Портал сообщества 33 сервера: рейтинг альянсов по итогам VS, летопись
            захватов, форум игроков и справочник гайдов — в одном месте и по
            одним и тем же данным.
          </p>
          <div class="hero__actions">
            <a class="hero__cta hero__cta--primary" href="#/ladder">Весь рейтинг<span aria-hidden="true"> →</span></a>
            <a class="hero__cta hero__cta--ghost" href="#/ladder?race=1">График сезона</a>
            <a class="hero__cta hero__cta--ghost" href="#/forum">Форум сервера</a>
          </div>
        </div>

        <aside class="hud" aria-label="Откуда на экране цифры">
          <p class="hud__source">
            <span class="hud__source-label">Источник</span>
            <span class="hud__source-value">${esc(sourceLabel)}</span>
          </p>
          <dl class="hud__stats">
            ${hudStat('альянсов в игре', total)}
            ${hudStat('недель с VS', playedWeeks)}
            ${hudStat('записей за сезон', records)}
            ${hudStat('отрыв лидера', gapText, gapWord)}
          </dl>
        </aside>
      </div>

      ${
        leader
          ? `<div class="leader">
               <span class="leader__crown">👑</span>
               <div class="leader__body">
                 <div class="leader__label">Лидер сезона</div>
                 <div class="leader__name">${esc(leader.alliance.name)}</div>
                 <div class="leader__meta">
                   ${plural(leader.wins, 'победа', 'победы', 'побед')} ·
                   ${plural(leader.losses, 'поражение', 'поражения', 'поражений')}${leaderStreak}
                 </div>
               </div>
               <div class="leader__pts num">${leader.points > 0 ? '+' : ''}${leader.points}</div>
             </div>`
          : ''
      }

      <div class="weekscore">
        <div class="weekscore__cell winscore">
          <b class="num">${winners.length}</b>
          <span>${pluralWord(winners.length, 'победитель', 'победителя', 'победителей')}</span>
        </div>
        <div class="weekscore__cell losscore">
          <b class="num">${losers.length}</b>
          <span>${pluralWord(losers.length, 'проигравший', 'проигравших', 'проигравших')}</span>
        </div>
      </div>

      <details class="who">
        <summary class="who__summary">
          Кто именно<span class="who__hint muted">VS ${fmtDate(week.endDate)}</span>
        </summary>
        <div class="split">
          <div class="split__col split__col--win">
            <h2 class="split__title">Победа в VS <span class="split__count num">${winners.length}</span><i class="split__bar"></i></h2>
            <div class="tiles">${tiles(winners)}</div>
          </div>
          <div class="split__col split__col--loss">
            <h2 class="split__title">Поражение в VS <span class="split__count num">${losers.length}</span><i class="split__bar"></i></h2>
            <div class="tiles">${tiles(losers)}</div>
          </div>
        </div>
        <a class="who__more" href="#/ladder">Вся таблица<span aria-hidden="true"> →</span></a>
      </details>
    </section>

    ${renderLive(view)}

    <div class="home__row home__row--lead">
      ${renderRankRail(active, total)}
      ${renderChronicle(events)}
    </div>

    <div class="home__row">
      ${renderCommunitySlot()}
    </div>

    <section class="panel panel--utility">
      <header class="panel__head">
        <span class="eyebrow">За последнюю неделю</span>
        <h2>Движение в рейтинге</h2>
      </header>
      <div class="movers">
        <div>
          <h3 class="movers__title movers__title--up">Рейтинг поднялся</h3>
          <ul class="movers__list">${
            moved.up.length ? moved.up.map(moverRow).join('') : '<li class="muted">без изменений</li>'
          }</ul>
        </div>
        <div>
          <h3 class="movers__title movers__title--down">Рейтинг снизился</h3>
          <ul class="movers__list">${
            moved.down.length ? moved.down.map(moverRow).join('') : '<li class="muted">без изменений</li>'
          }</ul>
        </div>
      </div>
    </section>`;
}
