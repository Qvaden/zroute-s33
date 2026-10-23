import { esc } from './ui/helpers.js';

// Заглушка для списка промокодов
const promocodes = [
  {
    code: 'ZROUTE2023',
    status: 'active',
    source: 'Официальный сайт',
    date: '2023-10-15'
  },
  {
    code: 'OLDCODE123',
    status: 'inactive',
    source: 'Старый источник',
    date: '2023-05-20'
  },
  {
    code: 'NEWDEAL456',
    status: 'active',
    source: 'Партнёрская программа',
    date: '2023-11-01'
  }
];

function renderPromocodes() {
  const container = document.getElementById('promocodes-list');
  if (!container) return;

  container.innerHTML = promocodes.map(promocode => {
    const statusClass = promocode.status === 'active' ? 'active' : 'inactive';
    return `
      <div class="promocode-card">
        <div class="promocode-code">${esc(promocode.code)}</div>
        <div class="promocode-status">
          <span class="status-dot" style="background: ${promocode.status === 'active' ? 'var(--win)' : 'var(--loss)'}"></span>
          <span>${promocode.status === 'active' ? 'Активен' : 'Не работает'}</span>
        </div>
        <div class="promocode-source">Источник: ${esc(promocode.source)}</div>
        <div class="promocode-date">Дата проверки: ${esc(promocode.date)}</div>
      </div>
    `;
  }).join('');
}

// Загрузить промокоды при загрузке страницы
document.addEventListener('DOMContentLoaded', renderPromocodes);