import { esc, deltaBadge, formDots, sparkline, plural } from '../ui/helpers.js';

/**
 * Общий рейтинг — главная ценность сайта.
 *
 * Сделано не таблицей, а строками на grid. Причина в телефоне: семь колонок
 * в <table> на экране 375px превращаются в горизонтальный скролл, а на grid
 * ту же строку можно перестроить в два яруса и ничего не потерять.
 */
export function renderLadder({ standings }) {
  const rows = standings.map((r) => rowHtml(r)).join('');
  const active = standings.filter((r) => r.alliance.active).length;

  return `
    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Сезон целиком</span>
        <h2>Рейтинг альянсов</h2>
        <p class="muted">Победа +1 · Поражение −1 · Пропуск недели 0</p>
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
          <button type="button" class="seg__btn is-on" data-ladder-filter="active">Активные</button>
          <button type="button" class="seg__btn" data-ladder-filter="all">Все</button>
        </div>

        <div class="seg" role="group" aria-label="Сортировка">
          <button type="button" class="seg__btn is-on" data-ladder-sort="points">Очки</button>
          <button type="button" class="seg__btn" data-ladder-sort="wins">Победы</button>
          <button type="button" class="seg__btn" data-ladder-sort="form">Форма</button>
          <button type="button" class="seg__btn" data-ladder-sort="name">А–Я</button>
        </div>
      </div>

      <div class="lad__head" aria-hidden="true">
        <span>#</span><span>Альянс</span><span>Форма</span><span>П / Пр</span>
        <span class="ta-r">Очки</span><span>Динамика</span>
      </div>

      <div class="lad" data-ladder-list>${rows}</div>

      <p class="lad__empty" data-ladder-empty hidden>Ничего не нашлось. Проверьте написание.</p>
      <p class="lad__count muted" data-ladder-count>
        ${plural(active, 'активный альянс', 'активных альянса', 'активных альянсов')} из ${standings.length}
      </p>
    </section>`;
}

function rowHtml(r) {
  const a = r.alliance;
  const color = a.color || '#7a8494';

  // Свежая форма: сколько побед в последних пяти. Нужна для сортировки «по форме».
  const formScore = r.form.filter((o) => o === 'win').length;

  const streak =
    r.streak && r.streak.length > 1
      ? `<span class="streak streak--${r.streak.type}">${r.streak.type === 'win' ? '🔥' : '💀'}${r.streak.length}</span>`
      : '';

  const medal = r.place <= 3 ? ` lad__row--m${r.place}` : '';

  return `
  <div class="lad__row${medal}${a.active ? '' : ' lad__row--off'}"
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
      ${streak}
      ${a.active ? '' : '<em class="lad__off">распался</em>'}
    </span>

    <span class="lad__form">${formDots(r.form)}</span>

    <span class="lad__wl num">
      <b class="c-win">${r.wins}</b><i>/</i><b class="c-loss">${r.losses}</b>
    </span>

    <span class="lad__pts num ${r.points > 0 ? 'pos' : r.points < 0 ? 'neg' : ''}">
      ${r.points > 0 ? '+' : ''}${r.points}
    </span>

    <span class="lad__spark">${sparkline(r.series, color, 92, 26)}</span>
  </div>`;
}
