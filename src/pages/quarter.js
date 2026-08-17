import { renderLadder } from './ladder.js';

/**
 * Рейтинг только внутри текущего фиксированного четырёхнедельного периода.
 * Каждый новый период начинается с нулевых очков.
 */
export function renderQuarter({ standings, quarter }) {
  return renderLadder({
    standings,
    eyebrow: 'Новый шанс каждые 4 недели',
    title: 'Кварт',
    description: 'Только очки текущего периода · без графика и старого хвоста',
    period: quarter,
    variant: 'quarter',
  });
}
