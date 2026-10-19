import { esc } from './helpers.js';

let uid = 0;
const nextId = () => `g${++uid}`;

/**
 * Большой график накопленных очков одного альянса, с заливкой под линией.
 *
 * Можно передать эталонную линию (например, средние очки по серверу) —
 * тогда сразу видно, идёт альянс выше или ниже общего темпа. Без такого
 * ориентира голая кривая мало о чём говорит.
 *
 * @param {number[]} series
 * @param {{number:number}[]} weeks
 * @param {string} color
 * @param {{reference?: number[], referenceLabel?: string, height?: number}} [opts]
 */
export function areaChart(series, weeks, color, opts = {}) {
  const { reference = null, referenceLabel = 'средний по серверу', height = 260 } = opts;
  if (!series || series.length < 2) return '';

  const W = 760;
  const H = height;
  const PAD = { top: 20, right: 16, bottom: 30, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const pool = reference ? series.concat(reference) : series;
  let min = Math.min(0, ...pool);
  let max = Math.max(0, ...pool);
  const pad = Math.max(1, Math.round((max - min) * 0.14));
  min -= pad;
  max += pad;
  const span = max - min || 1;

  const x = (i) => PAD.left + (i / (series.length - 1)) * plotW;
  const y = (v) => PAD.top + plotH - ((v - min) / span) * plotH;

  const step = Math.max(1, Math.round((max - min) / 4));
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);

  const grid = ticks
    .map(
      (v) => `<line x1="${PAD.left}" y1="${y(v).toFixed(1)}" x2="${PAD.left + plotW}" y2="${y(v).toFixed(1)}"
        class="ch__grid ${v === 0 ? 'ch__grid--zero' : ''}"/>
      <text x="${PAD.left - 8}" y="${(y(v) + 3.5).toFixed(1)}" class="ch__ytick">${v > 0 ? '+' : ''}${v}</text>`
    )
    .join('');

  const xLabels = weeks
    .map((w, i) => {
      const every = weeks.length > 8 ? 2 : 1;
      if (i % every !== 0 && i !== weeks.length - 1) return '';
      return `<text x="${x(i).toFixed(1)}" y="${H - 10}" class="ch__xtick">${w.number}</text>`;
    })
    .join('');

  const line = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${PAD.left},${y(min + pad).toFixed(1)} ${line} ${(PAD.left + plotW).toFixed(1)},${y(min + pad).toFixed(1)}`;
  const gid = nextId();

  const ref = reference
    ? `<polyline points="${reference.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"
         fill="none" stroke="var(--mute)" stroke-width="1.5" stroke-dasharray="4 4" opacity=".65"/>`
    : '';

  return `
    <div class="ch ch--big">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
           aria-label="Накопленные очки по неделям">
        <defs>
          <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   style="stop-color:${esc(color)}" stop-opacity=".34"/>
            <stop offset="100%" style="stop-color:${esc(color)}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${grid}
        ${xLabels}
        <polygon points="${area}" fill="url(#${gid})"/>
        ${ref}
        <polyline points="${line}" fill="none" stroke-width="2.8"
          stroke-linejoin="round" stroke-linecap="round" class="ch__line"
          style="stroke:${esc(color)}; --dash:2200; --delay:.1s"/>
      </svg>
      ${reference ? `<p class="ch__legend"><i class="ch__dash"></i> ${esc(referenceLabel)}</p>` : ''}
    </div>`;
}

/**
 * Движение по местам. Ось перевёрнута: первое место сверху,
 * потому что «подняться в таблице» должно выглядеть как движение вверх.
 *
 * @param {number[]} places
 * @param {{number:number}[]} weeks
 * @param {number} total сколько всего альянсов
 * @param {string} color
 */
export function placeChart(places, weeks, total, color) {
  if (!places || places.length < 2) return '';

  const W = 760;
  const H = 150;
  const PAD = { top: 16, right: 16, bottom: 26, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const best = Math.max(1, Math.min(...places) - 1);
  const worst = Math.min(total, Math.max(...places) + 1);
  const span = worst - best || 1;

  const x = (i) => PAD.left + (i / (places.length - 1)) * plotW;
  const y = (p) => PAD.top + ((p - best) / span) * plotH; // больше место — ниже точка

  const ticks = [...new Set([best, Math.round((best + worst) / 2), worst])];
  const grid = ticks
    .map(
      (p) => `<line x1="${PAD.left}" y1="${y(p).toFixed(1)}" x2="${PAD.left + plotW}" y2="${y(p).toFixed(1)}" class="ch__grid"/>
      <text x="${PAD.left - 8}" y="${(y(p) + 3.5).toFixed(1)}" class="ch__ytick">${p}</text>`
    )
    .join('');

  const xLabels = weeks
    .map((w, i) => {
      const every = weeks.length > 8 ? 2 : 1;
      if (i % every !== 0 && i !== weeks.length - 1) return '';
      return `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ch__xtick">${w.number}</text>`;
    })
    .join('');

  const pts = places.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const dots = places
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p).toFixed(1)}" r="2.6" style="fill:${esc(color)}" opacity=".85"/>`)
    .join('');

  return `
    <div class="ch">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
           aria-label="Место в таблице по неделям">
        ${grid}
        ${xLabels}
        <polyline points="${pts}" fill="none" stroke-width="2.2"
          stroke-linejoin="round" stroke-linecap="round" class="ch__line"
          style="stroke:${esc(color)}; --dash:2200; --delay:.25s"/>
        ${dots}
      </svg>
    </div>`;
}
