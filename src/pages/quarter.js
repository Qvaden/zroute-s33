import { esc, formDots, plural } from '../ui/helpers.js?v=2';

/**
 * Самостоятельная страница Кварта.
 * Она намеренно не переиспользует визуальную таблицу сезонного рейтинга:
 * Кварт — это экран нового шанса, а не второй список с тем же видом.
 */
export function renderQuarter({ standings, quarter }) {
  const active = standings.filter((r) => r.alliance.active).length;
  const rows = standings.map(quartRow).join('');
  const periodLabel = quarter.startNumber == null
    ? 'Период ещё не начат'
    : `Недели ${quarter.startNumber}–${quarter.endNumber}`;
  const periodNumber = quarter.number ? String(quarter.number).padStart(2, '0') : '—';
  const progress = quarter.weeks.length;

  return `
    <section class="quart-page">
      <header class="quart-hero">
        <div class="quart-hero__glow"></div>
        <div class="quart-hero__top">
          <div class="quart-hero__copy">
            <span class="quart-kicker"><i></i> COME BACK CYCLE</span>
            <h2>Кварт</h2>
            <p>Новый шанс каждые четыре недели. Старый рейтинг остаётся в прошлом.</p>
          </div>
          <div class="quart-dial" aria-label="Текущий период">
            <span>ПЕРИОД</span>
            <b>${periodNumber}</b>
            <small>${periodLabel.replace('Недели ', '')}</small>
          </div>
        </div>
        <div class="quart-hero__bottom">
          <span><b>${progress}</b> из 4 недель периода</span>
          <span class="quart-hero__legend"><i class="quart-led quart-led--on"></i><i class="quart-led"></i><i class="quart-led"></i><i class="quart-led"></i></span>
        </div>
      </header>

      <section class="quart-board">
        <header class="quart-board__head">
          <div>
            <span class="quart-section-label">LIVE RESET BOARD</span>
            <h3>Кто забирает этот Кварт?</h3>
          </div>
          <p>Только очки текущего периода</p>
        </header>

        <div class="quart-controls">
          <label class="search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>
            </svg>
            <input type="search" placeholder="Найти альянс или тег…" data-ladder-search autocomplete="off" spellcheck="false">
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

        <div class="quart-list" data-ladder-list>${rows}</div>
        <p class="quart-empty" data-ladder-empty hidden>Пока никого не нашли. Попробуйте другой тег.</p>
        <p class="quart-count" data-ladder-count>${plural(active, 'активный альянс', 'активных альянса', 'активных альянсов')} в гонке</p>
      </section>
    </section>`;
}

function quartRow(r) {
  const a = r.alliance;
  const color = a.color || '#7a8494';
  const formScore = r.form.filter((o) => o === 'win').length;
  const streak = r.streak && r.streak.length > 1
    ? `<span class="quart-streak quart-streak--${r.streak.type}">${r.streak.type === 'win' ? '🔥' : '💀'}${r.streak.length}</span>`
    : '';
  const score = `${r.points > 0 ? '+' : ''}${r.points}`;
  const medal = r.place <= 3 ? ` quart-row--m${r.place}` : '';

  return `
    <a class="quart-row${medal}${a.active ? '' : ' quart-row--off'}"
       href="#/alliance/${esc(a.id)}" data-go="alliance-${esc(a.id)}"
       style="--tag-color:${esc(color)}"
       data-name="${esc(a.name.toLowerCase())}"
       data-tag="${esc(a.tag.toLowerCase())}"
       data-points="${r.points}"
       data-wins="${r.wins}"
       data-form="${formScore}"
       data-place="${r.place}"
       data-active="${a.active ? 1 : 0}">
      <span class="quart-rank">${String(r.place).padStart(2, '0')}</span>
      <span class="quart-team">
        <span class="quart-team__name"><span class="tag">${esc(a.tag)}</span><b>${esc(a.name)}</b>${streak}</span>
        <span class="quart-team__form">${formDots(r.form)}</span>
      </span>
      <span class="quart-score"><small>ОЧКИ</small><b>${score}</b></span>
    </a>`;
}
