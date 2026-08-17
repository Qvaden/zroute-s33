import { renderLadder } from './ladder.js';

/**
 * Рейтинг только внутри текущего фиксированного четырёхнедельного периода.
 * Каждый новый период начинается с нулевых очков.
 */
export function renderQuarter({ standings, quarter }) {
  return renderLadder({
    standings,
    eyebrow: 'Текущий период',
    title: 'Кватр',
    description: 'Рейтинг только за четыре недели · после каждой четвёртой недели очки обнуляются',
    period: quarter,
  });
}
