import { esc, miniMarkdown, splitSections, plural } from '../ui/helpers.js';
import { computeAllianceHistory, computeBestStreaks } from '../logic/standings.js';

/**
 * Раздел для малых альянсов.
 *
 * Из ТЗ: «наглядные плюсы нахождения в больших альянсах». Ключевое слово —
 * наглядные. Поэтому выгода здесь не описывается словами, а считается
 * из реальных результатов сервера: верхняя треть таблицы против нижней.
 * Когда цифры свои, а не абстрактные, спорить с ними трудно.
 *
 * Тексты берутся из источника данных, чтобы их правил доверенный человек,
 * а не разработчик. Заголовки «## » превращаются в карточки — верстать
 * ничего не нужно.
 */
export function renderGuide({ texts, standings, weeks, results }) {
  const byKey = Object.fromEntries(texts.map((t) => [t.key, t]));
  const intro = byKey['guide-intro'];

  return `
    ${renderProof(standings, weeks, results)}

    ${renderLeadershipRoles()}

    ${renderList(byKey['guide-benefits'], 'Что даёт крупный альянс', 'week')}

    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Практика</span>
        <h2>${esc(byKey['guide-principles']?.title ?? 'Образцовое руководство альянсом')}</h2>
        ${intro ? `<p class="guide__lead">${esc(intro.body)}</p>` : ''}
      </header>
      ${renderCards(byKey['guide-principles']?.body)}
    </section>

    <div class="grid-2">
      ${renderList(byKey['guide-week'], 'Ритм недели', 'week')}
      ${renderList(byKey['guide-donts'], 'Чего делать не стоит', 'dont')}
    </div>`;
}

function renderLeadershipRoles() {
  const roles = [
    {
      icon: '👑', title: 'Глава альянса', tone: 'gold',
      intro: 'Задаёт общее направление действий и развития альянса.',
      items: ['Переговоры с союзом сервера.', 'Вынесение решений с учётом мнений R4.', 'Назначение и контроль работы R4.'],
    },
    {
      icon: '⚜️', title: 'Дворецкий', tone: 'orange',
      intro: 'Отвечает за информирование и организацию событий альянса.',
      items: ['Засада и Осада: оповещения в чате и запуск.', 'Оповещение о регистрации на Пандору.', 'VS-информирование: ответы, контроль отстающих и помощь игрокам.'],
      assistant: true,
    },
    {
      icon: '🏛️', title: 'Богиня', tone: 'violet',
      intro: 'Отвечает за Поезд, доску объявлений и важные сообщения.',
      items: ['Поезд: списки поездок, машинисты и VIP-пассажиры.', 'Контроль актуальности доски объявлений.', 'Шаблоны объявлений и срочные новости союза или сервера.'],
      assistant: true,
    },
    {
      icon: '🛡️', title: 'Рекрутер', tone: 'cyan',
      intro: 'Отвечает за игровой состав альянса.',
      items: ['Поиск и привлечение новых игроков.', 'Анализ активности, состав и рейтинги/антирейтинги.', 'Согласование трансферов и ротация актива с академией.'],
    },
    {
      icon: '🪖', title: 'Полководец', tone: 'red',
      intro: 'Отвечает за организацию военных действий альянса.',
      items: ['Тактика и проведение Пандоры.', 'Организация рейда VS по субботам.', 'Захват и оборона Капитолия в Безумии с учётом союзников.', 'Планирование остальных военных мероприятий.'],
      assistant: true,
    },
  ];

  return `
    <section class="roles-panel panel">
      <header class="panel__head roles-panel__head">
        <span class="eyebrow">Alliance // Command</span>
        <h2>Обязанности руководства</h2>
        <p class="guide__lead">Пример распределения ролей для успешного развития альянса. Главное — чтобы работа была разделена, а не держалась на одном человеке.</p>
      </header>
      <div class="roles-grid">
        ${roles.map((role) => `
          <article class="role-card role-card--${role.tone}">
            <div class="role-card__top"><span class="role-card__icon" aria-hidden="true">${role.icon}</span><span class="role-card__tag">R4</span></div>
            <h3>${role.title}</h3>
            <p class="role-card__intro">${role.intro}</p>
            <ul>${role.items.map((item) => `<li>${item}</li>`).join('')}</ul>
            ${role.assistant ? '<span class="role-card__assistant">🤝 + помощник</span>' : ''}
          </article>`).join('')}
      </div>
    </section>
    <section class="roles-notice panel">
      <div class="roles-notice__mark">!</div>
      <div>
        <span class="eyebrow">Важно // Balance</span>
        <h3>Распределяем нагрузку, а не героизм</h3>
        <p>Часть обязанностей может передаваться от одного R4 другому — не придумываем лишнюю работу и не смотрим, как один игрок тянет всё на себе. Иначе он выгорит, и развитие альянса остановится.</p>
        <p>Помощник может поддерживать двух офицеров. По мере роста объёма работы помощников станет четыре — по одному для каждого офицера.</p>
      </div>
    </section>`;
}

/**
 * Доказательная часть: сравнение верхней и нижней трети таблицы
 * по трём показателям. Считается из тех же данных, что и рейтинг.
 */
function renderProof(standings, weeks, results = []) {
  const active = standings.filter((r) => r.alliance.active);
  const third = Math.max(1, Math.floor(active.length / 3));
  const top = active.slice(0, third);
  const bottom = active.slice(-third);

  /*
    Доказательная часть требует данных. На старте сезона их нет, и сравнение
    выродилось бы в «0% против 0%» — это выглядит как поломка и, что хуже,
    подрывает сам аргумент. Пока цифр не набралось, честнее сказать прямо.

    Порог — одна полная неделя: меньше этого сравнивать нечего.
  */
  if (results.length < active.length) {
    return `
      <section class="hero hero--guide">
        <span class="eyebrow">Наглядно</span>
        <h2 class="tl__title">Что даёт сильный альянс</h2>
        <p class="guide__sub">
          Здесь появится сравнение верхней и нижней трети таблицы по реальным
          цифрам этого сервера: доля побед, серии, очки за сезон. Не общие слова,
          а данные — но для них нужны результаты хотя бы за одну полную неделю.
        </p>
        <p class="guide__sub muted">
          Пока их нет, ниже — то, что и без цифр работает.
        </p>
      </section>`;
  }

  const avg = (rows, fn) => (rows.length ? rows.reduce((s, r) => s + fn(r), 0) / rows.length : 0);

  // Лучшая серия побед за сезон — считается по фактическим результатам,
  // а не выводится из очков: так метрика не сломается, если правила
  // начисления однажды поменяют в config.js.
  const streakOf = (row) => {
    const history = computeAllianceHistory(row.alliance.id, weeks, results);
    return computeBestStreaks(history.map((h) => h.outcome)).bestWin;
  };
  const topStreak = avg(top, streakOf);
  const bottomStreak = avg(bottom, streakOf);

  const metrics = [
    {
      label: 'Доля побед в VS',
      top: Math.round(avg(top, (r) => r.winRate) * 100),
      bottom: Math.round(avg(bottom, (r) => r.winRate) * 100),
      suffix: '%',
      max: 100,
    },
    {
      label: 'Побед подряд',
      top: Math.round(topStreak * 10) / 10,
      bottom: Math.round(bottomStreak * 10) / 10,
      suffix: '',
      // Небольшой запас сверху, чтобы верхняя полоса не упиралась в край
      // и не выглядела упёршейся в потолок шкалы.
      max: Math.max(topStreak, bottomStreak, 1) * 1.2,
      hint: 'лучшая серия за сезон, в среднем по группе',
    },
    {
      label: 'Очков за сезон',
      top: Math.round(avg(top, (r) => r.points)),
      bottom: Math.round(avg(bottom, (r) => r.points)),
      suffix: '',
      max: null,
      signed: true,
    },
  ];

  const bars = metrics
    .map((m) => {
      /*
        Очки бывают отрицательными. Рисовать минус обычной полосой слева
        нельзя: −5 визуально почти неотличим от +6. Поэтому для таких
        показателей полоса расходится от центра — влево минус, вправо плюс.
      */
      const diverging = m.max === null;
      const span = m.max ?? Math.max(Math.abs(m.top), Math.abs(m.bottom), 1);

      const bar = (v, side) => {
        if (!diverging) {
          return `<span class="proof__bar">
            <i class="proof__fill proof__fill--${side}" style="width:${Math.max(2, (v / m.max) * 100)}%"></i>
          </span>`;
        }
        const half = Math.max(1.5, (Math.abs(v) / span) * 50);
        const edge = v < 0 ? `right:50%` : `left:50%`;
        return `<span class="proof__bar proof__bar--div">
          <i class="proof__fill proof__fill--${side} proof__fill--abs" style="${edge}; width:${half}%"></i>
        </span>`;
      };

      // Знак «+» ставим только там, где число со знаком осмысленно — у очков.
      const val = (v) => `${m.signed && v > 0 ? '+' : ''}${v}${m.suffix}`;

      return `<div class="proof">
        <div class="proof__label">
          ${esc(m.label)}
          ${m.hint ? `<span class="proof__hint">${esc(m.hint)}</span>` : ''}
        </div>
        <div class="proof__rows">
          <div class="proof__row">
            <span class="proof__who">Верхняя треть</span>
            ${bar(m.top, 'top')}
            <b class="proof__val proof__val--top num">${val(m.top)}</b>
          </div>
          <div class="proof__row">
            <span class="proof__who">Нижняя треть</span>
            ${bar(m.bottom, 'bottom')}
            <b class="proof__val proof__val--bottom num">${val(m.bottom)}</b>
          </div>
        </div>
      </div>`;
    })
    .join('');

  return `
    <section class="hero hero--guide">
      <span class="eyebrow">Наглядно</span>
      <h2 class="tl__title">Что даёт сильный альянс</h2>
      <p class="guide__sub">
        Не общие слова, а цифры этого сервера:
        ${plural(third, 'альянс', 'альянса', 'альянсов')} из верхней трети таблицы
        против ${third} из нижней.
      </p>
      <div class="proofs">${bars}</div>
    </section>`;
}

/** Секции «## » превращаются в карточки. */
function renderCards(md) {
  const sections = splitSections(md).filter((s) => s.title);
  if (!sections.length) return '<p class="muted">Текст ещё не заполнен.</p>';

  return `<div class="cards">
    ${sections
      .map(
        (s, i) => `<article class="card" style="--i:${i}">
          <span class="card__num num">${String(i + 1).padStart(2, '0')}</span>
          <h3>${esc(s.title)}</h3>
          <div class="card__body">${miniMarkdown(s.body)}</div>
        </article>`
      )
      .join('')}
  </div>`;
}

function renderList(block, fallbackTitle, kind) {
  if (!block) return '';
  return `<section class="panel">
    <header class="panel__head"><h2>${esc(block.title || fallbackTitle)}</h2></header>
    <div class="prose prose--${kind}">${miniMarkdown(block.body)}</div>
  </section>`;
}
