import { esc, fmtDate, plural } from '../../ui/helpers.js';

/**
 * Неделя: главный экран будущего ввода.
 *
 * Уже в фазе просмотра он собран так, как будет работать на ввод: те же
 * крупные клетки под палец, тот же счётчик заполненности, тот же порядок
 * альянсов. Это сделано намеренно — когда во второй фазе клетки станут
 * нажимаемыми, привычка редактора не поменяется, а вёрстку не придётся
 * переделывать под другой размер элементов.
 *
 * @param {any} view
 * @param {string | null} param Идентификатор недели из адреса, например W31.
 */
export function renderWeek(view, param) {
  const { data } = view;
  const weeks = [...data.weeks].sort((a, b) => b.number - a.number);

  if (!weeks.length) {
    return `<section class="panel"><h2>Недели не заведены</h2>
      <p class="muted">Пока в данных нет ни одной недели, вносить результаты некуда.</p></section>`;
  }

  /*
    По умолчанию открываем не последнюю заведённую неделю, а последнюю,
    за которую есть хоть один результат: недели заводятся заранее, на месяц
    вперёд, и открывать пустую неделю из будущего было бы бесполезно.
  */
  const withData = weeks.find((w) => data.results.some((r) => r.weekId === w.id));
  const selected = weeks.find((w) => w.id === param) ?? withData ?? weeks[0];

  const byAlliance = new Map(
    data.results.filter((r) => r.weekId === selected.id).map((r) => [r.allianceId, r.outcome])
  );

  // Порядок как в игре у людей в голове: сначала действующие альянсы, по тегу.
  const alliances = [...data.alliances]
    .filter((a) => a.active || byAlliance.has(a.id))
    .sort((a, b) => a.tag.localeCompare(b.tag, 'ru'));

  const wins = [...byAlliance.values()].filter((o) => o === 'win').length;
  const losses = [...byAlliance.values()].filter((o) => o === 'loss').length;
  const filled = wins + losses;
  const total = alliances.length;
  const pct = total ? Math.round((filled / total) * 100) : 0;

  const picker = weeks
    .map(
      (w) => `<a href="#/week/${encodeURIComponent(w.id)}"
                 class="adm-chip ${w.id === selected.id ? 'is-on' : ''}">
                ${esc(String(w.number))}
              </a>`
    )
    .join('');

  const cells = alliances
    .map((a) => {
      const outcome = byAlliance.get(a.id) ?? null;
      const mark = outcome === 'win' ? 'П' : outcome === 'loss' ? 'Х' : '—';
      const state = outcome ?? 'empty';
      return `<div class="adm-cell adm-cell--${state}" style="--tag-color:${esc(a.color || '#7a8494')}">
          <span class="adm-cell__tag">${esc(a.tag)}</span>
          <span class="adm-cell__name">${esc(a.name)}</span>
          <b class="adm-cell__mark">${mark}</b>
        </div>`;
    })
    .join('');

  return `
    <section class="adm-hero adm-hero--tight">
      <span class="eyebrow">Результаты VS</span>
      <h1 class="adm-h1">Неделя ${selected.number}</h1>
      <p class="adm-lead">
        ${esc(fmtDate(selected.startDate))} — ${esc(fmtDate(selected.endDate))}
        <span class="adm-dot">·</span>
        ${plural(wins, 'победа', 'победы', 'побед')}, ${plural(losses, 'поражение', 'поражения', 'поражений')}
      </p>
      <div class="adm-weeks">${picker}</div>
    </section>

    <section class="panel">
      <header class="panel__head adm-head-row">
        <h2>Внесено ${filled} из ${total}</h2>
        <span class="muted">${pct}%</span>
      </header>
      <div class="adm-progress"><i style="width:${pct}%"></i></div>

      ${
        filled === 0
          ? `<p class="muted adm-note">
               За эту неделю результатов ещё нет. Пустая клетка означает «не внесли»,
               а не «пропустил»: в VS альянс участвует всегда, и на очки такая
               неделя не влияет никак.
             </p>`
          : ''
      }

      <div class="adm-cells">${cells}</div>
    </section>`;
}
