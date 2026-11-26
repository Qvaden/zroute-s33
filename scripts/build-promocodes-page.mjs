/**
 * СОБИРАЕТ СТАТИЧЕСКУЮ SEO-СТРАНИЦУ ПРОМОКОДОВ (promocodes/index.html).
 *
 * Поисковик не передаёт фрагмент #/promocodes на сервер и видит только пустую
 * оболочку. Отдельный документ promocodes/index.html отдаёт весь актуальный
 * список кодов и инструкцию сразу в разметке.
 *
 * Запуск: node scripts/build-promocodes-page.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { esc } from '../src/ui/helpers.js';
import { readPromocodes, sortPromocodes } from '../src/pages/promocodes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

function formatDate(value) {
  const text = String(value ?? '').trim().slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return parts ? `${parts[3]}.${parts[2]}.${parts[1]}` : '';
}

function renderCard(item) {
  const active = item.status === 'active';
  const statusClass = active ? 'active' : 'inactive';
  const statusText = active ? 'Активен' : 'Не работает';
  const code = esc(item.code);
  const dateLabel = formatDate(item.date);
  return `
    <article class="promocode-card promocode-card--${statusClass}">
      <div class="promocode-card__top">
        <button class="promocode-copy" type="button" data-copy="${code}" aria-label="Скопировать код ${code}" title="Скопировать код">
          <span class="promocode-code">${code}</span>
          <span class="promocode-copy__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>
            <svg class="promocode-copy__done" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>
          </span>
        </button>
        <span class="promocode-status promocode-status--${statusClass}">
          <span class="promocode-dot" aria-hidden="true"></span>${statusText}
        </span>
      </div>
      ${item.rewards ? `<p class="promocode-rewards">${esc(item.rewards)}</p>` : ''}
      <div class="promocode-meta">
        <time class="promocode-date" datetime="${esc(item.date)}">${esc(dateLabel)}</time>
      </div>
    </article>`;
}

async function readView() {
  const indexHtml = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  return {
    origin: new URL(indexHtml.match(/rel="canonical" href="([^"]+)"/)[1]).origin,
    cssLinks: [...indexHtml.matchAll(/href="\.\/(src\/[^"]+\.css(?:\?v=\d+)?)"/g)].map((m) => m[1]),
    fontCss: indexHtml.match(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]*)"/)[1],
    themeColor: indexHtml.match(/name="theme-color" content="([^"]+)"/)[1],
    ogImage: indexHtml.match(/property="og:image" content="([^"]+)"/)[1],
    siteName: indexHtml.match(/property="og:site_name" content="([^"]+)"/)[1],
  };
}

export async function buildPromocodesPage() {
  const view = await readView();
  const raw = JSON.parse(await readFile(path.join(ROOT, 'promocodes.json'), 'utf8'));
  const codes = sortPromocodes(readPromocodes(raw), 'fresh');
  const active = codes.filter((c) => c.status === 'active');
  const inactive = codes.filter((c) => c.status !== 'active');
  const dateLabel = formatDate(raw?.updated) || 'сегодня';

  const pageUrl = `${view.origin}/promocodes/`;
  const title = 'Промокоды Z Route: Redemption — актуальные рабочие коды · Z Route Hub';
  const description = `Рабочие промокоды Z Route: Redemption (${active.length} активных, обновлено ${dateLabel}). Копирование в один клик и инструкция, куда вводить код в игре.`;

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: title,
        description,
        url: pageUrl,
        inLanguage: 'ru',
        isPartOf: { '@type': 'WebSite', name: view.siteName, url: `${view.origin}/` },
      },
      {
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'Куда вводить промокод в Z Route: Redemption?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Откройте профиль через Аватар в игре, перейдите в Настройки и выберите «Подарочный код», затем вставьте скопированный промокод и подтвердите.',
            },
          },
          {
            '@type': 'Question',
            name: 'Как часто обновляются промокоды?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Список промокодов проверяется и обновляется ежедневно автоматически.',
            },
          },
        ],
      },
    ],
  };

  const navLinks = [
    { href: '../#/promocodes', label: 'Интерактивные промокоды' },
    { href: '../handbook/', label: 'Справочник игры' },
    { href: '../#/updates', label: 'Обновления игры' },
    { href: '../#/forum', label: 'Форум' },
  ].map((l) => `<a class="hb-sitenav__link" href="${esc(l.href)}">${esc(l.label)}</a>`).join('');

  const activeHtml = active.length
    ? active.map(renderCard).join('')
    : '<p class="muted">Сейчас активных промокодов нет.</p>';
  const inactiveHtml = inactive.length
    ? `<header class="panel__head" style="margin-top:var(--s-5)"><h2>Истёкшие промокоды</h2><p class="muted">Старые коды для проверки — обычно уже не работают.</p></header><div class="promocodes-list">${inactive.map(renderCard).join('')}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="ru" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${esc(view.themeColor)}">
<script>
  try {
    if (localStorage.getItem('s33-theme') === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (_) {}
</script>
<link rel="icon" type="image/svg+xml" href="../public/icons/icon-32.svg">
${view.cssLinks.map((href) => `<link rel="stylesheet" href="${esc(`../${href}`)}">`).join('\n')}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(view.fontCss)}">
<script>
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (meta && bg) meta.setAttribute('content', bg);
  } catch (_) {}
</script>
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(view.siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(view.ogImage)}">
<meta property="og:image:alt" content="${esc(view.siteName)}">
<meta property="og:locale" content="ru_RU">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
</head>
<body>
<a class="skip-link" href="#content">К содержимому</a>

<header class="site-head">
  <div class="site-head__inner">
    <a class="brand brand--head" href="../#/promocodes">
      <span class="brand__num">33</span>
      <span class="brand__text"><b>Z Route Hub</b><small>Z Route: Redemption</small></span>
    </a>
  </div>
</header>

<main class="wrap" id="content">
  <nav class="hb-sitenav" aria-label="Разделы сайта">${navLinks}</nav>
  <section class="panel promo-intro">
    <span class="eyebrow">Справка // бонусы</span>
    <h1>Промокоды Z Route: Redemption</h1>
    <p>Актуальные коды для всех серверов Z Route: Redemption. Список обновляется ежедневно автоматически: рабочие коды сверху, выбывшие — ниже.</p>
    <div class="promo-summary">
      <div class="promo-stat"><b>${codes.length}</b><span>всего кодов</span></div>
      <div class="promo-stat"><b>${active.length}</b><span>работают</span></div>
      <div class="promo-stat"><b>${esc(dateLabel)}</b><span>проверено</span></div>
    </div>
  </section>
  <section class="panel promo-panel">
    <header class="panel__head">
      <h2>Актуальные промокоды</h2>
      <p class="muted">Если код не сработал, он мог закончиться — начинайте с верхних.</p>
    </header>
    <div class="promo-how">
      <p class="promo-how__title">Как использовать</p>
      <ol class="promo-how__steps">
        <li><span>Аватар</span></li>
        <li><span>Настройки</span></li>
        <li><span>Подарочный код</span></li>
      </ol>
      <p class="promo-how__note">Скопируйте код нажатием на него и вставьте в открывшееся поле — останется подтвердить.</p>
    </div>
    <div class="promocodes-list" id="promocodes-list">
      ${activeHtml}
    </div>
    ${inactiveHtml}
  </section>
</main>

<footer class="site-foot wrap">
  <p>Неофициальная база знаний Z Route: Redemption. <a href="../#/promocodes">Открыть интерактивную версию</a>.</p>
</footer>

<script>
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const code = btn.getAttribute('data-copy') || '';
    if (!code) return;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(code);
        ok = true;
      }
    } catch (_) {}
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
    if (ok) {
      btn.classList.add('is-copied');
      setTimeout(() => btn.classList.remove('is-copied'), 1600);
    }
  });
</script>
</body>
</html>
`;

  return { file: 'promocodes/index.html', url: pageUrl, html };
}

const runAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (runAsScript) {
  const page = await buildPromocodesPage();
  const target = path.join(ROOT, ...page.file.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, page.html, 'utf8');
  console.log(`Готово: ${page.file}`);
}
