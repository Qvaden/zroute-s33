import { esc, miniMarkdown } from '../ui/helpers.js';

/**
 * Раздел для малых альянсов.
 * Текст берётся из источника данных, а не зашит в код, — чтобы
 * доверенный человек мог править его без разработчика.
 */
export function renderGuide({ texts, standings }) {
  const block = texts.find((t) => t.key === 'small-alliances');

  // Наглядная выгода крупного альянса — считается из реальных данных,
  // а не пишется словами: верхняя треть таблицы против нижней.
  const active = standings.filter((r) => r.alliance.active);
  const third = Math.max(1, Math.floor(active.length / 3));
  const top = active.slice(0, third);
  const bottom = active.slice(-third);

  const avgWinRate = (rows) =>
    rows.length ? Math.round((rows.reduce((s, r) => s + r.winRate, 0) / rows.length) * 100) : 0;

  return `
    <section class="panel">
      <header class="panel__head">
        <h2>${esc(block?.title ?? 'Малым альянсам')}</h2>
      </header>

      <div class="compare">
        <div class="compare__side compare__side--top">
          <span class="compare__label">Верхняя треть таблицы</span>
          <span class="compare__value">${avgWinRate(top)}%</span>
          <span class="muted">побед в VS</span>
        </div>
        <div class="compare__vs">против</div>
        <div class="compare__side compare__side--bottom">
          <span class="compare__label">Нижняя треть</span>
          <span class="compare__value">${avgWinRate(bottom)}%</span>
          <span class="muted">побед в VS</span>
        </div>
      </div>

      <div class="prose">
        ${block ? miniMarkdown(block.body) : '<p class="muted">Текст ещё не заполнен.</p>'}
      </div>
    </section>`;
}
