/**
 * ТУРНИРЫ — генератор VS-матчапов между двумя альянсами.
 *
 * Чистый рендер от состояния: список турниров, форма выбора/случайного
 * жеребья и счёт раундов. Поведение — в src/forum/tournaments.js.
 */
import { esc, plural } from '../ui/helpers.js';
import { nickColor, nickInitial } from '../forum/format.js';

function tagMark(tag) {
  const t = String(tag || '?').trim();
  const initial = (t[0] || '?').toUpperCase();
  return `<span class="tour-mark" style="--ava:${esc(nickColor(t))}" aria-hidden="true">${esc(initial)}</span>`;
}

export function renderTournaments(s) {
  const alliances = Array.isArray(s.alliances) ? s.alliances.filter((a) => a.active) : [];
  const nameOf = (id) => {
    const a = alliances.find((x) => x.id === id);
    return a ? a.name : id;
  };
  const tagOf = (id) => {
    const a = alliances.find((x) => x.id === id);
    return a ? a.tag : '?';
  };

  const list = (s.tournaments || []).length
    ? s.tournaments.map((t) => {
      const winA = t.winner === t.allyA;
      const winB = t.winner === t.allyB;
      return `
        <li class="tour-card${t.status === 'finished' ? ' is-finished' : ''}">
          <div class="tour-card__head">
            <b>${esc(t.title || `${tagOf(t.allyA)} — ${tagOf(t.allyB)}`)}</b>
            <span class="tour-card__status">${t.status === 'finished' ? 'завершён' : 'идёт'}</span>
          </div>
          <div class="tour-score">
            <span class="tour-side${winA ? ' is-win' : ''}">${tagMark(tagOf(t.allyA))}<b>${t.winsA}</b><small>${esc(nameOf(t.allyA))}</small></span>
            <span class="tour-vs">:</span>
            <span class="tour-side${winB ? ' is-win' : ''}">${tagMark(tagOf(t.allyB))}<b>${t.winsB}</b><small>${esc(nameOf(t.allyB))}</small></span>
          </div>
          ${t.draws ? `<p class="muted">${plural(t.draws, 'ничья', 'ничьи', 'ничьих')}</p>` : ''}
          ${t.status === 'active' && s.me
            ? `<div class="tour-rounds">
                 <button type="button" class="forum-btn forum-btn--sm" data-tour-round="${esc(t.id)}:${esc(t.allyA)}">Победа ${esc(tagOf(t.allyA))}</button>
                 <button type="button" class="forum-btn forum-btn--sm" data-tour-round="${esc(t.id)}:${esc(t.allyB)}">Победа ${esc(tagOf(t.allyB))}</button>
                 <button type="button" class="forum-btn forum-btn--sm forum-btn--ghost" data-tour-round="${esc(t.id)}:">Ничья</button>
               </div>`
            : ''}
        </li>`;
    }).join('')
    : '<p class="muted">Турниров пока нет — сгенерируйте первый ниже.</p>';

  const opts = alliances
    .map((a) => `<option value="${esc(a.id)}">${esc(a.tag)} — ${esc(a.name)}</option>`)
    .join('');

  const genForm = s.me && alliances.length >= 2
    ? `
      <form class="tour-gen" data-tour-create>
        <span class="eyebrow">Новый матч</span>
        <div class="tour-gen__row">
          <select name="allyA" aria-label="Первый альянс">${opts}</select>
          <button type="button" class="forum-btn forum-btn--sm" data-tour-random title="Случайный жребий">🎲</button>
          <select name="allyB" aria-label="Второй альянс">${opts}</select>
        </div>
        <input name="title" maxlength="60" placeholder="Название (необязательно)" autocomplete="off">
        <button type="submit" class="forum-btn forum-btn--primary">Создать турнир</button>
        <p class="forum-error" data-tour-error hidden></p>
      </form>`
    : '';

  return `
    <section class="panel tour-page">
      <header class="panel__head">
        <span class="eyebrow">VS-матчапы</span>
        <h1>Турниры альянсов</h1>
        <p class="muted">Два альянса, счёт по победам в VS. Засчитывайте раунды — победитель определится автоматически.</p>
      </header>
      ${genForm}
      <ul class="tour-list">${list}</ul>
    </section>`;
}
