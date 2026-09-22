import { esc, fmtDate, deltaBadge, plural, pluralWord } from '../ui/helpers.js';
import { raceChart } from '../ui/chart.js';
import { byWeekStart, findCurrentWeek } from '../data/week-order.js';

/* Формы слова «день» для счёта: 1 день, 2 дня, 5 дней. */
const DAYS = ['день', 'дня', 'дней'];

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
    <section class="hero">
      <div class="hero__top">
        <span class="eyebrow">Отсчёт начинается</span>
        <div class="hero__week">
          <span class="hero__word">Неделя</span>
          <span class="hero__num num">${upcoming ? upcoming.number : '—'}</span>
        </div>
        <div class="hero__dates">
          ${
            upcoming
              ? `${fmtDate(upcoming.startDate)} — ${fmtDate(upcoming.endDate)} · первый VS в истории сайта`
              : 'Недели ещё не заведены'
          }
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
          <h3 class="preseason__title">
            На старте
            <span class="split__count num">${alliances.length}</span>
            <i class="split__bar"></i>
          </h3>
          <div class="tiles">
            ${alliances
              .map(
                (a) => `<span class="tile" style="--tag-color:${esc(a.color || '#7a8494')}">
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
            ? `<span class="tag" style="--tag-color:${esc(leader.alliance.color || '#7a8494')}">${esc(leader.alliance.tag)}</span> ${esc(leader.alliance.name)} · ${leader.points > 0 ? '+' : ''}${leader.points}`
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
 */
export function renderHome(view = {}) {
  const { summary, standings, movers, weeks, allWeeks } = view;
  const list = Array.isArray(standings) ? standings : [];

  // Пока не внесён ни один результат, показывать нечего — но и «пусто» писать
  // нельзя: в этом состоянии сайт проживёт несколько дней после запуска,
  // и это первое, что увидят люди.
  if (!summary) return renderPreSeason(list, allWeeks ?? weeks ?? []) + renderLive(view);

  const { week, winners, losers, recorded } = summary;
  const leader = list[0];
  const total = list.filter((r) => r.alliance.active).length;

  const tiles = (items) =>
    items.length
      ? items
          .map(
            (a) => `<span class="tile" style="--tag-color:${esc(a.color || '#7a8494')}">
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
       <span class="tag" style="--tag-color:${esc(r.alliance.color || '#7a8494')}">${esc(r.alliance.tag)}</span>
       <span style="flex:1">${esc(r.alliance.name)}</span>
       ${deltaBadge(r.delta)}
       <span class="muted">${r.place} место</span>
     </li>`;

  const top5 = list.filter((r) => r.alliance.active).slice(0, 5);
  // Движение за неделю — необязательная часть: без него страница осмысленна.
  const moved = movers ?? { up: [], down: [] };

  const entered =
    recorded === total
      ? plural(recorded, 'результат внесён', 'результата внесено', 'результатов внесено')
      : `внесено ${recorded} из ${total}`;

  return `
    <section class="hero">
      <div class="hero__top">
        <div>
          <span class="eyebrow">Итоги недели</span>
          <div class="hero__week">
            <span class="hero__word">Неделя</span>
            <span class="hero__num num">${week.number}</span>
          </div>
          <div class="hero__dates">
            ${fmtDate(week.startDate)} — ${fmtDate(week.endDate)}
            <span class="hero__sep">·</span>
            ${entered}
          </div>
        </div>
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
            <h3>Победа в VS <span class="split__count num">${winners.length}</span><i class="split__bar"></i></h3>
            <div class="tiles">${tiles(winners)}</div>
          </div>
          <div class="split__col split__col--loss">
            <h3>Поражение в VS <span class="split__count num">${losers.length}</span><i class="split__bar"></i></h3>
            <div class="tiles">${tiles(losers)}</div>
          </div>
        </div>
        <a class="who__more" href="#/ladder">Вся таблица<span aria-hidden="true"> →</span></a>
      </details>
    </section>

    ${renderLive(view)}

    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Гонка сезона</span>
        <h2>Как менялись очки лидеров</h2>
        <p class="muted">Накопленные очки по неделям · показаны пятеро лучших</p>
      </header>
      ${raceChart(top5, weeks)}
    </section>

    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">За последнюю неделю</span>
        <h2>Движение в рейтинге</h2>
      </header>
      <div class="movers">
        <div>
          <h4 class="movers__title movers__title--up">Рейтинг поднялся</h4>
          <ul class="movers__list">${
            moved.up.length ? moved.up.map(moverRow).join('') : '<li class="muted">без изменений</li>'
          }</ul>
        </div>
        <div>
          <h4 class="movers__title movers__title--down">Рейтинг снизился</h4>
          <ul class="movers__list">${
            moved.down.length ? moved.down.map(moverRow).join('') : '<li class="muted">без изменений</li>'
          }</ul>
        </div>
      </div>
    </section>`;
}
