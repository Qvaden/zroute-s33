/**
 * СОБИРАЕТ СТАТЬИ СПРАВОЧНИКА ОТДЕЛЬНЫМИ ДОКУМЕНТАМИ.
 *
 * ЗАЧЕМ. Разделы сайта живут во фрагменте адреса (#/handbook/event_volcano),
 * а фрагмент робот серверу не передаёт: для него весь справочник — один
 * документ с пустым `<main>`. Значит в выдаче существует одна страница сайта,
 * а сорок семь перенесённых правил игры — нет: человек, ищущий «засада в
 * вулкане», находит чужой разговор в чате, а не наш текст. Здесь каждый узел
 * дерева получает адрес без решётки и свой HTML-документ, в котором текст
 * лежит сразу в разметке.
 *
 * ПОЧЕМУ ФАЙЛЫ ЛЕЖАТ В РЕПОЗИТОРИИ. Сборки на хостинге нет: `buildCommand` —
 * пустой шаг, Render раздаёт корень как есть (docs/HOSTING.md). Страниц,
 * которых нет в коммите, на проде не появляется никогда. Поэтому собранное
 * коммится, а проверка `AT. Статьи отдельными страницами` пересобирает всё в
 * память и сверяет байты: коммит не может отстать от данных, и новый гайд не
 * может появиться в дереве без своей страницы.
 *
 * АДРЕСА ВНУТРИ СТРАНИЦ — ОТНОСИТЕЛЬНЫЕ. Сайт живёт и в корне домена, и в
 * подпапке зеркала на GitHub Pages (`qvaden.github.io/<проект>/`), и
 * абсолютный путь `/src/forum.css` на зеркале указал бы на чужой корень:
 * статья приехала бы без одежды. Поэтому каждый документ получает свой префикс
 * (`../../` для страницы узла, `../` для оглавления), а абсолютными остаются
 * только canonical, og:url и og:image — они обязаны называть основной домен.
 *
 * Запуск: node scripts/build-handbook-pages.mjs
 * после любой правки в src/handbook/guides.js. sitemap.xml пишется отсюда же:
 * список адресов и сами страницы обязаны рождаться одним проходом, иначе
 * робот получил бы карту сайта с адресами, под которыми ничего нет.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { esc } from '../src/ui/helpers.js';
import { HANDBOOK, HANDBOOK_ROOTS } from '../src/handbook/guides.js';
import {
  HANDBOOK_COUNT,
  handbookLead,
  handbookNode,
  handbookParent,
  isHandbookGuide,
  renderHandbook,
  renderSections,
} from '../src/pages/handbook.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/** Каталог страниц: узел — handbook/<id>/index.html, оглавление — handbook/. */
export const DIR = 'handbook';

/**
 * Два вида документов различаются только глубиной: путь до корня сайта и
 * путь до соседа по дереву. Фрагменты разметки при этом одни и те же, и
 * переписываются одной функцией — иначе «ссылка из статьи» имела бы два
 * разных смысла в двух местах сайта.
 */
const DEPTH = {
  node: { root: '../../', node: (id) => `../${id}/`, book: '../' },
  index: { root: '../', node: (id) => `${id}/`, book: './' },
};

/*
  Строка разделов вверху каждой собранной страницы.

  Полного бокового меню здесь нет нарочно: на телефоне оно прячется за
  кнопкой, а кнопка без скрипта означала бы обещание, которое страница не
  исполняет. Имена проверяются тестом по ROUTES в src/main.js — новый раздел
  сайта не должен молча оставаться без ссылки на статических страницах.
*/
const SECTION_LINKS = [
  { to: 'forum', label: 'Форум' },
  { to: 'guides', label: 'Гайды' },
  { to: 'ladder', label: 'Рейтинг' },
  { to: 'calendar', label: 'Календарь' },
  { to: 'accounts', label: 'Аккаунты' },
];

const plain = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const clip = (s, max) => (s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, '')}…` : s);

/**
 * Описание страницы — та же первая строка гайда, что стоит подписью под
 * плиткой на сайте: в выдаче человек должен читать то же слово, что увидит,
 * когда придёт.
 */
function descriptionFor(node) {
  const lead = handbookLead(node);
  const title = plain(node.title);
  if (!lead) return clip(`${title} — справочник Z Route: Redemption на сервере 33.`, 158);
  return clip(`${title} — ${lead}`, 158);
}

/**
 * Ссылки вида «фрагмент» из общей разметки превращает в адреса документов.
 *
 * Разметку статьи рисует тот же рендерер, что и сайт, а он знает только про
 * #/handbook/<узел>. На собранной странице такая ссылка вела бы в пустоту
 * (документ без маршрутизатора), поэтому fragment-адресов под ссылками здесь
 * не остаётся ни под одной — за этим следит тест.
 */
function toSiteLinks(html, depth) {
  return html
    .replace(/href="#\/handbook\/([^"]+)"/g, (_m, id) => `href="${depth.node(id)}"`)
    .replace(/href="#\/guides"/g, `href="${depth.book}"`)
    .replace(/href="#\//g, (m) => `${depth.root}${m.slice(6)}`)
    .replace(/src="\.\/((?:public|src)\/)/g, (_m, tail) => `src="${depth.root}${tail}`);
}

/**
 * Машинное описание страницы.
 *
 * Даты в справочнике нет: тексты перенесены из бота игры, и дата переноса не
 * является датой публикации правила. Поэтому `datePublished` здесь намеренно
 * отсутствует: выдуманную дату поисковик прочёл бы как свежесть правила,
 * которого в игре уже может не быть.
 */
function jsonLd({ node, url, description, view }) {
  const site = { '@type': 'WebSite', name: view.siteName, url: `${view.origin}/` };
  const publisher = { '@type': 'Organization', name: view.siteName };
  const body = node
    ? {
        '@type': 'Article',
        headline: plain(node.title),
        description,
        articleSection: plain(node.section) || 'Справочник',
        image: [view.ogImage],
        url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        isPartOf: site,
        publisher,
      }
    : {
        '@type': 'CollectionPage',
        name: 'Справочник официальных гайдов Z Route: Redemption',
        description,
        url,
        isPartOf: site,
        publisher,
      };
  return JSON.stringify({ '@context': 'https://schema.org', inLanguage: 'ru', ...body }, null, 2)
    .replace(/</g, '\\u003c');
}

/**
 * Документ страницы: оболочка сайта без его модулей.
 *
 * `<script type="module" src="../src/main.js">` здесь нет нарочно:
 * маршрутизатор затёр бы `<main>` содержимым вкладки, и статья исчезла бы
 * ровно там, где её начинает читать робот, у которого модулей нет. Лёгкость
 * страницы — не экономия, а её смысл.
 */
function pageHtml({ node, depth, view, pageUrl, title, description, bodyHtml }) {
  const nav = [
    `<a href="${depth.book}" aria-current="page">Справочник</a>`,
    ...SECTION_LINKS.map((l) => `<a href="${depth.root}#/${l.to}">${esc(l.label)}</a>`),
  ].join('');
  const parent = node ? handbookParent(node.id) : null;

  return `<!DOCTYPE html>
<html lang="ru" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${esc(view.themeColor)}">
<link rel="icon" type="image/svg+xml" href="${depth.root}public/icons/icon-32.svg">
${view.cssLinks.map((href) => `<link rel="stylesheet" href="${esc(depth.root + href)}">`).join('\n')}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(view.fontCss)}">
<link rel="canonical" href="${esc(pageUrl)}">
${parent ? `<link rel="up" href="${esc(depth.node(parent.id))}">` : ''}
<meta property="og:type" content="${node ? 'article' : 'website'}">
<meta property="og:site_name" content="${esc(view.siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(view.ogImage)}">
<meta property="og:image:alt" content="${esc(view.siteName)}">
<meta property="og:locale" content="ru_RU">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
${jsonLd({ node, url: pageUrl, description, view })}
</script>
<script>
  // Тема — та, которую человек выбрал на сайте: страница лежит в том же
  // домене и читает то же значение. Без этих строк светлая тема превращала
  // бы статью в чёрный прямоугольник посреди светлого браузера.
  try {
    var saved = localStorage.getItem('s33-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch (_) {}
</script>
</head>
<body>
<a class="skip-link" href="#article">К содержимому</a>

<header class="site-head">
  <div class="site-head__inner">
    <a class="brand brand--head" href="${depth.root}#/forum">
      <span class="brand__num">33</span>
      <span class="brand__text"><b>Сервер 33</b><small>Z Route: Redemption</small></span>
    </a>
  </div>
</header>

<main class="wrap" id="article">
  <nav class="hb-sitenav" aria-label="Разделы сайта">${nav}</nav>
${bodyHtml}
</main>

<footer class="site-foot wrap">
  <p>Неофициальный сайт сообщества 33 сервера. Тексты правил перенесены из игры
    без правок${node
      ? `, а на сайте к ним приложен поиск по справочнику: <a href="${depth.root}#/handbook/${node.id}">открыть «${esc(plain(node.title))}» в приложении</a>.`
      : `: <a href="${depth.root}#/guides">вкладка «Гайды»</a>.`}</p>
</footer>
</body>
</html>
`;
}

/** Гайды поддерева списком: оглавление, в котором виден каждый адрес. */
function branchList(node) {
  const kids = node.children.map((id) => handbookNode(id)).filter(Boolean);
  return kids.map((child) => {
    const lead = isHandbookGuide(child) ? handbookLead(child) : '';
    return `<li><a href="#/handbook/${esc(child.id)}">${esc(plain(child.title))}</a>${
        lead ? ` <span class="hb-catalog__lead">${esc(lead)}</span>` : ''
      }${isHandbookGuide(child) ? '' : `<ul class="hb-catalog__branch">${branchList(child)}</ul>`}</li>`;
  }).join('\n');
}

/**
 * Оглавление справочника: плитки разделов и под каждой — все его гайды.
 *
 * Список полный, а не «три горячих темы»: страница, по которой робот обходит
 * дерево, обязана видеть все адреса, иначе гайд без ссылки снаружи остаётся
 * существующим, но недостижимым.
 */
function indexBodyHtml() {
  const groups = HANDBOOK_ROOTS.map((id) => handbookNode(id))
    .filter(Boolean)
    .map((root) => `
    <section class="panel hb-catalog">
      <h2><a href="#/handbook/${esc(root.id)}">${esc(plain(root.title))}</a></h2>
      <ul class="hb-catalog__root">${branchList(root)}</ul>
    </section>`)
    .join('\n');

  return `
    <section class="panel hb-page">
      <header class="panel__head">
        <span class="eyebrow">Справочник</span>
        <h1>Официальные гайды Z Route: Redemption</h1>
        <p class="muted">${HANDBOOK_COUNT.guides} правил и разборов игры, перенесённых из бота
          без правок, — каждый отдельной страницей, чтобы на него можно было дать ссылку
          и найти его в поиске. Разделов: ${HANDBOOK_COUNT.sections}.</p>
        <p class="muted">Гайды участников сервера, вопросы и обсуждение —
          <a href="#/guides">на вкладке «Гайды»</a>.</p>
      </header>
      ${renderSections()}
    </section>
${groups}`;
}

/** Разбор index.html: откуда брать домен, стили и шрифт. */
async function readView() {
  const indexHtml = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  return {
    origin: new URL(indexHtml.match(/rel="canonical" href="([^"]+)"/)[1]).origin,
    /*
      Стили — те, что грузит страница, вместе с их номерами ?v=, а не зашитый
      список файлов (то же правило, что у превью в scripts/build-preview.mjs):
      переименование слоя или подъём версии не должны оставлять собранные
      страницы одетыми в прошлое.
    */
    cssLinks: [...indexHtml.matchAll(/href="\.\/(src\/[^"]+\.css(?:\?v=\d+)?)"/g)].map((m) => m[1]),
    fontCss: indexHtml.match(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]*)"/)[1],
    themeColor: indexHtml.match(/name="theme-color" content="([^"]+)"/)[1],
    ogImage: indexHtml.match(/property="og:image" content="([^"]+)"/)[1],
    siteName: indexHtml.match(/property="og:site_name" content="([^"]+)"/)[1],
  };
}

/** Все документы захода: оглавление плюс страница на каждый узел дерева. */
export async function buildAll() {
  const view = await readView();
  const pages = [];

  const indexUrl = `${view.origin}/${DIR}/`;
  const indexDescription = `${HANDBOOK_COUNT.guides} правил и разборов игры по разделам: события, `
    + 'исследования, альянсы, тактика. Каждый гайд — отдельной страницей.';
  pages.push({
    file: `${DIR}/index.html`,
    url: indexUrl,
    html: pageHtml({
      node: null,
      depth: DEPTH.index,
      view,
      pageUrl: indexUrl,
      title: 'Справочник официальных гайдов Z Route: Redemption · Сервер 33',
      description: indexDescription,
      // Одна перепись на всё тело страницы: и плитки разделов, и каталог
      // ссылаются фрагментами, как их рисует общий рендерер.
      bodyHtml: toSiteLinks(indexBodyHtml(), DEPTH.index),
    }),
  });

  for (const node of HANDBOOK) {
    const url = `${view.origin}/${DIR}/${node.id}/`;
    pages.push({
      file: `${DIR}/${node.id}/index.html`,
      url,
      html: pageHtml({
        node,
        depth: DEPTH.node,
        view,
        pageUrl: url,
        title: `${plain(node.title)} · справочник Z Route: Redemption`,
        description: descriptionFor(node),
        bodyHtml: toSiteLinks(renderHandbook({ guideId: node.id }), DEPTH.node),
      }),
    });
  }

  return { pages, origin: view.origin };
}

const SITEMAP_HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Список страниц для поисковиков.

  Разделы сайта живут во фрагменте адреса (#/forum, #/ladder), а фрагмент
  робот не передаёт серверу и считает частью одного и того же документа.
  Поэтому настоящей страницей раздела он видит один документ-оболочку.

  Справочник — исключение: каждый его гайд собирается отдельным файлом
  (scripts/build-handbook-pages.mjs), и эти адреса перечислены ниже. Пока
  правила жили только во фрагменте, в выдаче существовал один адрес на все
  тексты игры.

  Зеркало на GitHub Pages в списке нет намеренно — это копия того же
  содержимого, в выдаче ему делать нечего.

  Дат обновления здесь тоже нет: у перенесённых правил игры даты публикации
  нет, а дата сборки была бы выдана поисковиком за свежесть текста.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

export function sitemapXml(pages, origin) {
  const rows = [`${origin}/`, ...pages.map((p) => p.url)];
  return `${SITEMAP_HEAD}
${rows.map((u) => `  <url>\n    <loc>${u}</loc>\n  </url>`).join('\n')}
</urlset>
`;
}

const runAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (runAsScript) {
  const { pages, origin } = await buildAll();
  for (const p of pages) {
    const target = path.join(ROOT, ...p.file.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, p.html, 'utf8');
  }
  await writeFile(path.join(ROOT, 'sitemap.xml'), sitemapXml(pages, origin), 'utf8');
  console.log(`Готово: страниц ${pages.length}, адресов в sitemap ${pages.length + 1}.`);
}
