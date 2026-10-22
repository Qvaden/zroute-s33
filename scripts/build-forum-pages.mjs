/**
 * СНИМКИ ФОРУМА ОТДЕЛЬНЫМИ ФАЙЛАМИ — ЧТОБЫ ИХ ВИДЕЛИ ПОИСК И ПЕРЕСЫЛКИ.
 *
 * Форум живёт во фрагменте адреса (#/forum/<id>): сервер такой адрес не
 * получает, а робот считает его частью одной страницы. Полезный ответ про
 * событие или набор в альянс существует, но найти его в поиске нельзя, а
 * ссылка в Telegram показывает общую картинку сайта.
 *
 * Этот скрипт читает публичные темы и гайды через тот же anon-ключ, которым
 * ходит сайт, и раскладывает снимки в forum/<id>/index.html и
 * guides/<slug>/index.html. У каждой страницы свои title, description,
 * og:image и JSON-LD; внизу — ссылка на живое обсуждение, потому что снимок
 * не заменяет форум, а приводит на него.
 *
 * Снимок — копия, а не второй форум: ответы и реакции остаются в приложении,
 * а на странице написано, когда она собрана. Если тема удалена или стала
 * непубличной, следующий запуск убирает её файл.
 *
 * Запуск: node scripts/build-forum-pages.mjs
 * Проверка без записи: node scripts/build-forum-pages.mjs --check
 * Разрешить резкое сокращение числа тем: --force
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CONFIG } from '../config.js';
import { esc, fmtDateFull, plural, safeUrl } from '../src/ui/helpers.js';
import { excerpt, postBody, textOf } from '../src/forum/format.js';
import { CATEGORIES, TOPIC_TAGS, categoryLabel } from '../src/forum/rules.js';
import { roleBadge } from '../src/forum/roles.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

export const FORUM_DIR = 'forum';
export const GUIDES_DIR = 'guides';
export const MANIFEST_FILE = 'forum/_manifest.json';
export const SITEMAP_FILE = 'sitemap-forum.xml';

/** Метка, по которой уборка отличает наши снимки от чужих файлов. */
const MARKER = '<meta name="generator" content="zroute-static-community">';
const PAGE_SIZE = 500;
const COMMENT_LIMIT = 120;
const MIN_TOPIC_CHARS = 240;
const MIN_GUIDE_CHARS = 240;

const TAG_LABEL = new Map(TOPIC_TAGS.map((tag) => [tag.id, tag.label]));

const NAV = [
  { id: 'forum', label: 'Форум' },
  { id: 'guides', label: 'Гайды' },
  { id: 'handbook', label: 'Справочник' },
  { id: 'ladder', label: 'Рейтинг' },
  { id: 'calendar', label: 'Календарь' },
];

function plain(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clip(value, max) {
  const s = plain(value);
  if (s.length <= max) return s;
  return `${s.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : '';
}

function safeId(value) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(String(value ?? ''));
}

export function safeSlug(value) {
  return /^[a-z0-9а-яё-]{2,80}$/.test(String(value ?? '')) ? String(value) : '';
}

function categoryOf(id) {
  return CATEGORIES.some((c) => c.id === id) ? id : 'offtop';
}

function tagsOf(value) {
  return Array.isArray(value) ? value.filter((tag) => TAG_LABEL.has(tag)) : [];
}

function attachmentUrl(value) {
  return safeUrl(value);
}

function shotList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({ url: attachmentUrl(item?.url) }))
    .filter((item) => item.url);
}

function ogShot(shots) {
  return shots.find((shot) => /\.(?:png|jpe?g|webp|gif|avif)(?:\?|#|$)/i.test(shot.url))?.url ?? '';
}

function postFromRow(row) {
  const createdAt = toDate(row.created_at) ?? new Date(0);
  return {
    id: row.id,
    title: plain(row.title).slice(0, 200),
    body: String(row.body ?? ''),
    bodyText: plain(textOf(row.body)),
    authorNick: plain(row.author_nick).slice(0, 80),
    authorAvatar: attachmentUrl(row.author_avatar),
    authorRole: row.author_role || 'member',
    category: categoryOf(row.category),
    tags: tagsOf(row.tags),
    createdAt,
    editedAt: toDate(row.edited_at),
    eventAt: toDate(row.event_at),
    expiresAt: toDate(row.expires_at),
    views: Number(row.views || 0),
    attachments: shotList(row.attachments),
    comments: [],
  };
}

function commentFromRow(row) {
  return {
    id: row.id,
    body: String(row.body ?? ''),
    bodyText: plain(textOf(row.body)),
    authorNick: plain(row.author_nick).slice(0, 80),
    authorAvatar: attachmentUrl(row.author_avatar),
    authorRole: row.author_role || 'member',
    createdAt: toDate(row.created_at) ?? new Date(0),
    attachments: shotList(row.attachments),
  };
}

function guideFromRow(row) {
  const createdAt = toDate(row.created_at) ?? new Date(0);
  return {
    id: row.id,
    slug: safeSlug(row.slug),
    title: plain(row.title).slice(0, 200),
    body: String(row.body ?? ''),
    bodyText: plain(textOf(row.body)),
    authorNick: plain(row.author_nick).slice(0, 80),
    category: plain(row.category) || 'strategy',
    createdAt,
    updatedAt: toDate(row.updated_at) ?? createdAt,
    attachments: [],
  };
}

function indexableTopic(topic, now = Date.now()) {
  if (topic.tags.includes('accounts')) return false;
  if (topic.category === 'flood') return false;
  if (topic.bodyText.length < MIN_TOPIC_CHARS) return false;
  if (topic.expiresAt && topic.expiresAt.getTime() < now) return false;
  return true;
}

function indexableGuide(guide) {
  return guide.bodyText.length >= MIN_GUIDE_CHARS;
}

/** Цвет темы и стили — те же, что у index.html, вместе с ?v=. */
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

function apiConfig() {
  const cfg = CONFIG.forum?.supabase ?? CONFIG.supabase ?? {};
  return {
    base: String(cfg.url ?? '').trim().replace(/\/+$/, ''),
    key: String(cfg.anonKey ?? '').trim(),
  };
}

async function apiGet(pathAndQuery) {
  const { base, key } = apiConfig();
  if (!base || !key) throw new Error('В config.js не заполнены forum.supabase.url и anonKey');
  const headers = { apikey: key, Accept: 'application/json' };
  // Опубликованный ключ нового вида (sb_publishable_…) не JWT: Authorization
  // с ним Supabase отвергает, и запрос обязан остаться на одном apikey.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchAll(table, select = '*', extra = {}) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      select,
      order: 'created_at.asc,id.asc',
      limit: String(PAGE_SIZE),
      offset: String(offset),
      ...extra,
    });
    const page = await apiGet(`${table}?${params}`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function navHtml(root, current) {
  const links = NAV.map((item) => {
    if (item.id === 'handbook') {
      return `<a href="${root}handbook/">${esc(item.label)}</a>`;
    }
    const href = item.id === current ? (current === 'forum' ? `${root}${FORUM_DIR}/` : `${root}${GUIDES_DIR}/`) : `${root}#/${item.id}`;
    return `<a href="${href}"${item.id === current ? ' aria-current="page"' : ''}>${esc(item.label)}</a>`;
  });
  return `<nav class="hb-sitenav" aria-label="Разделы сайта">${links.join('')}</nav>`;
}

function jsonLd(data) {
  return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}

/**
 * Оболочка статической страницы: без main.js и без маршрутизатора.
 *
 * Робот не исполняет модули, поэтому всё, что нужно для индексации, лежит в
 * HTML. Скрипты здесь только два — выбор темы и цвет полосы состояния; оба
 * работают до отрисовки. Кнопка «Открыть обсуждение» ведёт во фрагмент
 * приложения, и это единственный путь, где нужен JavaScript.
 */
function pageHtml({
  view, root, pageUrl, title, description, bodyHtml, nav,
  ogType = 'article', image = view.ogImage, imageAlt = '',
  robots = 'index,follow', published = '', modified = '', author = '', structured = null,
}) {
  return `<!DOCTYPE html>
<html lang="ru" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="zroute-static-community">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${esc(view.themeColor)}">
<meta name="robots" content="${esc(robots)}">
${author ? `<meta name="author" content="${esc(author)}">` : ''}
<script>
  /*
    Тема — та же, что человек выбрал на сайте: страница лежит на том же домене
    и читает то же значение. Без этих строк светлая тема превращала бы снимок
    в чёрный прямоугольник посреди светлого браузера.
  */
  try {
    if (localStorage.getItem('s33-theme') === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (_) {}
</script>
<link rel="icon" type="image/svg+xml" href="${root}public/icons/icon-32.svg">
${view.cssLinks.map((href) => `<link rel="stylesheet" href="${esc(root + href)}">`).join('\n')}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(view.fontCss)}">
<script>
  /* Полоса состояния телефона — тот же фон, что у страницы, уже с токенами. */
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (meta && bg) meta.setAttribute('content', bg);
  } catch (_) {}
</script>
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="${esc(view.siteName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:alt" content="${esc(imageAlt || title)}">
<meta property="og:locale" content="ru_RU">
${published ? `<meta property="article:published_time" content="${esc(published)}">` : ''}
${modified ? `<meta property="article:modified_time" content="${esc(modified)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
${structured ? `<script type="application/ld+json">\n${structured}\n</script>` : ''}
</head>
<body>
<a class="skip-link" href="#article">К содержимому</a>

<header class="site-head">
  <div class="site-head__inner">
    <a class="brand brand--head" href="${root}#/forum">
      <span class="brand__num">33</span>
      <span class="brand__text"><b>Сервер 33</b><small>Z Route: Redemption</small></span>
    </a>
  </div>
</header>

<main class="wrap" id="article">
  ${nav}
${bodyHtml}
</main>

<footer class="site-foot wrap">
  <p>Неофициальный сайт сообщества 33 сервера. Снимок сделан для поиска и
    пересылки; живые ответы и реакции — <a href="${root}#/forum">на форуме</a>.</p>
</footer>
</body>
</html>
`;
}

function avatarHtml(nick, avatar, root) {
  const url = safeUrl(avatar);
  const initial = plain(nick).slice(0, 1).toUpperCase() || '?';
  const face = url
    ? `<img src="${esc(url)}" alt="" width="32" height="32" loading="lazy">`
    : `<span aria-hidden="true">${esc(initial)}</span>`;
  return `<span class="forum-snap__ava">${face}</span>`;
}

function authorHtml(account, root) {
  const nick = account.nick ?? account.authorNick;
  const avatar = account.avatar ?? account.authorAvatar;
  const role = account.role ?? account.authorRole;
  const name = plain(nick) || 'Участник';
  return `<span class="forum-snap__author">
    ${avatarHtml(name, avatar, root)}
    <a href="${root}#/user/${encodeURIComponent(name)}">${esc(name)}</a>
    ${roleBadge({ role })}
  </span>`;
}

function shotsHtml(shots, root, altPrefix) {
  if (!shots.length) return '';
  return `<div class="forum-snap__shots">${shots
    .map(
      (shot, i) => `<a href="${esc(shot.url)}" target="_blank" rel="noopener noreferrer">
        <img src="${esc(shot.url)}" alt="${esc(`${altPrefix} — снимок ${i + 1}`)}" loading="lazy">
      </a>`
    )
    .join('')}</div>`;
}

function tagsHtml(tags) {
  if (!tags.length) return '';
  return `<p class="forum-snap__tags">${tags
    .map((tag) => `<span class="forum-snap__tag">${esc(TAG_LABEL.get(tag) ?? tag)}</span>`)
    .join('')}</p>`;
}

function metaHtml(topic, root) {
  const parts = [
    `<time datetime="${esc(iso(topic.createdAt))}">${esc(fmtDateFull(topic.createdAt))}</time>`,
    esc(plural(topic.comments.length, 'ответ', 'ответа', 'ответов')),
    topic.views ? esc(plural(topic.views, 'просмотр', 'просмотра', 'просмотров')) : '',
    topic.eventAt ? `Событие: <time datetime="${esc(iso(topic.eventAt))}">${esc(fmtDateFull(topic.eventAt))}</time>` : '',
    topic.editedAt ? 'изменено' : '',
  ].filter(Boolean);
  return `<p class="forum-snap__meta">${authorHtml(topic, root)}${parts.map((part) => `<span>${part}</span>`).join('')}</p>`;
}

function commentsHtml(topic, root) {
  if (!topic.comments.length) {
    return `<section class="forum-snap__comments" aria-labelledby="answers">
      <h2 id="answers">Ответы</h2>
      <p class="muted">Ответов пока нет. Первый можно написать на форуме.</p>
    </section>`;
  }
  const shown = topic.comments.slice(0, COMMENT_LIMIT);
  const rest = topic.comments.length - shown.length;
  return `<section class="forum-snap__comments" aria-labelledby="answers">
    <h2 id="answers">Ответы · ${topic.comments.length}</h2>
    ${shown
      .map(
        (comment) => `<article class="forum-snap__comment">
          <header class="forum-snap__comment-head">
            ${authorHtml(comment, root)}
            <time datetime="${esc(iso(comment.createdAt))}">${esc(fmtDateFull(comment.createdAt))}</time>
          </header>
          ${comment.body ? `<div class="hb-text forum-snap__comment-body">${postBody(comment.body)}</div>` : ''}
          ${shotsHtml(comment.attachments, root, `Ответ ${comment.authorNick}`)}
        </article>`
      )
      .join('')}
    ${rest > 0 ? `<p class="forum-snap__note">Показаны первые ${shown.length} из ${topic.comments.length} ответов. Остальные — на форуме.</p>` : ''}
  </section>`;
}

function relatedHtml(topic, topics, root) {
  const same = topics.filter((item) => item.id !== topic.id && item.category === topic.category);
  const list = [...same, ...topics.filter((item) => item.id !== topic.id && item.category !== topic.category)]
    .filter((item) => item.indexed)
    .slice(0, 6);
  if (!list.length) return '';
  return `<nav class="forum-snap__more" aria-labelledby="more">
    <h2 id="more">Ещё темы</h2>
    <ul>${list.map((item) => `<li><a href="../${encodeURIComponent(item.id)}/">${esc(item.title)}</a></li>`).join('')}</ul>
  </nav>`;
}

function topicDescription(topic) {
  return clip(topic.bodyText || `Тема «${topic.title}» на форуме 33 сервера Z Route: Redemption.`, 160);
}

function topicStructured(topic, url, view, description) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    headline: topic.title,
    text: topic.bodyText.slice(0, 10_000),
    description,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: iso(topic.createdAt),
    dateModified: iso(topic.editedAt ?? topic.createdAt),
    inLanguage: 'ru',
    author: { '@type': 'Person', name: topic.authorNick || 'Участник' },
    isPartOf: { '@type': 'WebSite', name: view.siteName, url: `${view.origin}/` },
    publisher: { '@type': 'Organization', name: view.siteName },
  };
  if (topic.attachments.length) data.image = topic.attachments.map((shot) => shot.url);
  data.interactionStatistic = [
    {
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/CommentAction',
      userInteractionCount: topic.comments.length,
    },
  ];
  if (topic.views) {
    data.interactionStatistic.push({
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/ViewAction',
      userInteractionCount: topic.views,
    });
  }
  const comments = topic.comments.slice(0, 20).map((comment) => ({
    '@type': 'Comment',
    text: comment.bodyText.slice(0, 1_500),
    author: { '@type': 'Person', name: comment.authorNick || 'Участник' },
    dateCreated: iso(comment.createdAt),
  }));
  if (comments.length) data.comment = comments;
  return jsonLd(data);
}

function renderTopic(topic, { view, root, url, topics }) {
  const description = topicDescription(topic);
  const image = ogShot(topic.attachments) || view.ogImage;
  const bodyHtml = `<article class="panel hb-page forum-snap">
  <nav class="hb-crumbs" aria-label="Хлебные крошки">
    <a href="../">Темы форума</a><span aria-hidden="true">›</span>
    <span aria-current="page">${esc(categoryLabel(topic.category))}</span>
  </nav>
  <header class="panel__head">
    <span class="eyebrow">${esc(categoryLabel(topic.category))}</span>
    <h1>${esc(topic.title)}</h1>
    ${metaHtml(topic, root)}
    ${tagsHtml(topic.tags)}
  </header>
  ${topic.body ? `<div class="hb-text forum-snap__body">${postBody(topic.body)}</div>` : ''}
  ${shotsHtml(topic.attachments, root, topic.title)}
  <p class="forum-snap__cta"><a class="forum-btn" href="${root}#/forum/${encodeURIComponent(topic.id)}">Открыть обсуждение на форуме</a></p>
  ${commentsHtml(topic, root)}
  ${relatedHtml(topic, topics, root)}
  <p class="forum-snap__note">Снимок темы от ${esc(fmtDateFull(topic.editedAt ?? topic.createdAt))}.
    Если ответы успели уйти вперёд — они на форуме.</p>
</article>`;

  return pageHtml({
    view,
    root,
    pageUrl: url,
    title: `${topic.title} · форум Сервера 33`,
    description,
    bodyHtml,
    nav: navHtml(root, 'forum'),
    image,
    robots: topic.indexed ? 'index,follow' : 'noindex,follow',
    published: iso(topic.createdAt),
    modified: iso(topic.editedAt ?? topic.createdAt),
    author: topic.authorNick,
    structured: topic.indexed ? topicStructured(topic, url, view, description) : null,
  });
}

function catalogHtml({ topics, guides, guidesHref, root }) {
  const groups = CATEGORIES.map((category) => {
    const list = topics.filter((topic) => topic.indexed && topic.category === category.id);
    if (!list.length) return '';
    return `<section class="hb-catalog">
      <h2>${esc(category.label)}</h2>
      <div class="hb-grid">${list
        .map(
          (topic) => `<div class="hb-tile"><a href="./${encodeURIComponent(topic.id)}/">
            <span class="hb-tile__kind">${esc(fmtDateFull(topic.createdAt))} · ${esc(plural(topic.comments.length, 'ответ', 'ответа', 'ответов'))}</span>
            <b>${esc(topic.title)}</b>
            <span class="hb-tile__lead">${esc(excerpt(topic.body, 140) || 'Тема на форуме.')}</span>
          </a></div>`
        )
        .join('')}</div>
    </section>`;
  }).join('');

  const empty = !topics.some((topic) => topic.indexed);
  return `<section class="panel hb-page">
    <header class="panel__head">
      <span class="eyebrow">Форум</span>
      <h1>Темы форума Сервера 33</h1>
      <p class="muted">Обсуждения игроков: VS, альянсы, события, вопросы и блоги.
        Каждая тема открыта отдельной страницей, чтобы на неё можно было дать
        ссылку и найти её в поиске.</p>
      <p class="muted"><a href="${root}#/forum">Открыть живой форум</a>${guides.length ? ` · <a href="${guidesHref}">Гайды участников</a>` : ''}</p>
    </header>
    ${empty ? `<p class="muted">Пока нет тем, которые стоит показывать в поиске. Загляните на <a href="${root}#/forum">живой форум</a>.</p>` : groups}
  </section>`;
}

function guideDescription(guide) {
  return clip(guide.bodyText || `Гайд «${guide.title}» участника Сервера 33.`, 160);
}

function guideStructured(guide, url, view, description) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    text: guide.bodyText.slice(0, 10_000),
    description,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: iso(guide.createdAt),
    dateModified: iso(guide.updatedAt ?? guide.createdAt),
    inLanguage: 'ru',
    author: { '@type': 'Person', name: guide.authorNick || 'Участник' },
    isPartOf: { '@type': 'WebSite', name: view.siteName, url: `${view.origin}/` },
    publisher: { '@type': 'Organization', name: view.siteName },
  };
  if (guide.attachments.length) data.image = guide.attachments.map((shot) => shot.url);
  return jsonLd(data);
}

export function renderGuide(guide, { view, root, url, guides }) {
  const description = guideDescription(guide);
  const image = ogShot(guide.attachments) || view.ogImage;
  const related = guides.filter((item) => item.slug !== guide.slug && item.indexed).slice(0, 6);
  const bodyHtml = `<article class="panel hb-page forum-snap">
  <nav class="hb-crumbs" aria-label="Хлебные крошки">
    <a href="../">Гайды участников</a><span aria-hidden="true">›</span>
    <span aria-current="page">${esc(guide.category)}</span>
  </nav>
  <header class="panel__head">
    <span class="eyebrow">Гайд участника</span>
    <h1>${esc(guide.title)}</h1>
    <p class="forum-snap__meta">${authorHtml({ nick: guide.authorNick, avatar: '', role: 'member' }, root)}
      <span><time datetime="${esc(iso(guide.createdAt))}">${esc(fmtDateFull(guide.createdAt))}</time></span>
      ${guide.updatedAt && iso(guide.updatedAt) !== iso(guide.createdAt) ? '<span>обновлён</span>' : ''}
    </p>
  </header>
  <div class="hb-text forum-snap__body">${postBody(guide.body)}</div>
  ${shotsHtml(guide.attachments, root, guide.title)}
  <p class="forum-snap__cta"><a class="forum-btn" href="${root}#/guides/${encodeURIComponent(guide.slug)}">Открыть гайд на форуме</a></p>
  ${related.length ? `<nav class="forum-snap__more" aria-labelledby="more"><h2 id="more">Другие гайды</h2>
    <ul>${related.map((item) => `<li><a href="../${encodeURIComponent(item.slug)}/">${esc(item.title)}</a></li>`).join('')}</ul></nav>` : ''}
  <p class="forum-snap__note">Снимок гайда от ${esc(fmtDateFull(guide.updatedAt ?? guide.createdAt))}.</p>
</article>`;

  return pageHtml({
    view,
    root,
    pageUrl: url,
    title: `${guide.title} · гайд Сервера 33`,
    description,
    bodyHtml,
    nav: navHtml(root, 'guides'),
    image,
    robots: guide.indexed ? 'index,follow' : 'noindex,follow',
    published: iso(guide.createdAt),
    modified: iso(guide.updatedAt ?? guide.createdAt),
    author: guide.authorNick,
    structured: guide.indexed ? guideStructured(guide, url, view, description) : null,
  });
}

function guidesCatalogHtml({ guides, root }) {
  const list = guides.filter((guide) => guide.indexed);
  return `<section class="panel hb-page">
    <header class="panel__head">
      <span class="eyebrow">Гайды</span>
      <h1>Гайды участников Сервера 33</h1>
      <p class="muted">Разборы от игроков: тактика, экономика, события и наборы.
        Каждый гайд открыт отдельной страницей для ссылок и поиска.</p>
      <p class="muted"><a href="${root}#/guides">Открыть гайды на форуме</a></p>
    </header>
    ${list.length ? `<div class="hb-grid">${list
      .map(
        (guide) => `<div class="hb-tile"><a href="./${encodeURIComponent(guide.slug)}/">
          <span class="hb-tile__kind">${esc(fmtDateFull(guide.createdAt))}</span>
          <b>${esc(guide.title)}</b>
          <span class="hb-tile__lead">${esc(excerpt(guide.body, 140) || 'Гайд участника.')}</span>
        </a></div>`
      )
      .join('')}</div>` : '<p class="muted">Пока нет опубликованных гайдов.</p>'}
  </section>`;
}

function sitemapXml(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Снимки форума и гайдов для поисковиков.

  Это отдельный список, а не продолжение sitemap.xml: справочник собирается
  из неизменного дерева, а темы появляются и удаляются в базе. Разные источники
  — разные файлы, чтобы пересборка одного не затирала другой.

  Здесь только страницы с index,follow. Темы из «Флудилки», объявления об
  аккаунтах и короткие записи остаются доступными по прямой ссылке, но в
  выдачу не просятся.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url>\n    <loc>${url}</loc>\n  </url>`).join('\n')}
</urlset>
`;
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(path.join(ROOT, MANIFEST_FILE), 'utf8'));
  } catch {
    return null;
  }
}

async function collect() {
  const view = await readView();
  const [postRows, commentRows, guideRows, guideShotRows] = await Promise.all([
    fetchAll('forum_post_list', '*', { deleted: 'eq.false' }),
    fetchAll('forum_comment_list', '*', { deleted: 'eq.false' }),
    fetchAll('forum_guides', '*', { status: 'eq.published' }),
    fetchAll('forum_attachments', 'id,url,target_id,target_type', { target_type: 'eq.guide' }),
  ]);

  const byPost = new Map();
  for (const row of commentRows) {
    const comment = commentFromRow(row);
    if (!byPost.has(row.post_id)) byPost.set(row.post_id, []);
    byPost.get(row.post_id).push(comment);
  }

  const byGuide = new Map();
  for (const row of guideShotRows) {
    if (!byGuide.has(row.target_id)) byGuide.set(row.target_id, []);
    byGuide.get(row.target_id).push({ url: attachmentUrl(row.url) });
  }

  const now = Date.now();
  const topics = postRows
    .map(postFromRow)
    .filter((topic) => safeId(topic.id) && topic.title)
    .map((topic) => ({
      ...topic,
      comments: (byPost.get(topic.id) ?? []).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    }))
    .map((topic) => ({ ...topic, indexed: indexableTopic(topic, now) }))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  const guides = guideRows
    .map(guideFromRow)
    .filter((guide) => guide.slug && guide.title)
    .map((guide) => ({
      ...guide,
      attachments: (byGuide.get(guide.id) ?? []).filter((shot) => shot.url),
    }))
    .map((guide) => ({ ...guide, indexed: indexableGuide(guide) }))
    .sort((a, b) => b.createdAt - a.createdAt || a.slug.localeCompare(b.slug));

  return { view, topics, guides };
}

export async function buildAll() {
  const { view, topics, guides } = await collect();
  const files = [];
  const manifest = {
    version: 1,
    origin: view.origin,
    topics: [],
    guides: [],
  };

  for (const topic of topics) {
    const url = `${view.origin}/${FORUM_DIR}/${encodeURIComponent(topic.id)}/`;
    files.push({
      file: `${FORUM_DIR}/${topic.id}/index.html`,
      html: renderTopic(topic, { view, root: '../../', url, topics }),
    });
    manifest.topics.push({
      id: topic.id,
      title: topic.title,
      category: topic.category,
      url,
      indexed: topic.indexed,
      createdAt: iso(topic.createdAt),
      modifiedAt: iso(topic.editedAt ?? topic.createdAt),
      comments: topic.comments.length,
    });
  }

  for (const guide of guides) {
    const url = `${view.origin}/${GUIDES_DIR}/${encodeURIComponent(guide.slug)}/`;
    files.push({
      file: `${GUIDES_DIR}/${guide.slug}/index.html`,
      html: renderGuide(guide, { view, root: '../../', url, guides }),
    });
    manifest.guides.push({
      id: guide.id,
      slug: guide.slug,
      title: guide.title,
      url,
      indexed: guide.indexed,
      createdAt: iso(guide.createdAt),
      modifiedAt: iso(guide.updatedAt),
    });
  }

  const forumUrl = `${view.origin}/${FORUM_DIR}/`;
  files.push({
    file: `${FORUM_DIR}/index.html`,
    html: pageHtml({
      view,
      root: '../',
      pageUrl: forumUrl,
      title: 'Темы форума · Сервер 33 Z Route: Redemption',
      description: 'Обсуждения игроков 33 сервера: VS, альянсы, события, вопросы и блоги. Каждая тема — отдельной страницей.',
      bodyHtml: catalogHtml({
        topics,
        guides,
        guidesHref: `../${GUIDES_DIR}/`,
        root: '../',
      }),
      nav: navHtml('../', 'forum'),
      ogType: 'website',
      structured: jsonLd({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Темы форума Сервера 33',
        url: forumUrl,
        inLanguage: 'ru',
        isPartOf: { '@type': 'WebSite', name: view.siteName, url: `${view.origin}/` },
      }),
    }),
  });

  if (guides.length) {
    const guidesUrl = `${view.origin}/${GUIDES_DIR}/`;
    files.push({
      file: `${GUIDES_DIR}/index.html`,
      html: pageHtml({
        view,
        root: '../',
        pageUrl: guidesUrl,
        title: 'Гайды участников · Сервер 33 Z Route: Redemption',
        description: 'Гайды игроков 33 сервера: тактика, экономика, события и наборы. Каждый гайд — отдельной страницей.',
        bodyHtml: guidesCatalogHtml({ guides, root: '../' }),
        nav: navHtml('../', 'guides'),
        ogType: 'website',
        structured: jsonLd({
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Гайды участников Сервера 33',
          url: guidesUrl,
          inLanguage: 'ru',
          isPartOf: { '@type': 'WebSite', name: view.siteName, url: `${view.origin}/` },
        }),
      }),
    });
  }

  const sitemapUrls = [forumUrl];
  sitemapUrls.push(...topics.filter((topic) => topic.indexed).map((topic) => `${view.origin}/${FORUM_DIR}/${encodeURIComponent(topic.id)}/`));
  if (guides.length) {
    sitemapUrls.push(`${view.origin}/${GUIDES_DIR}/`);
    sitemapUrls.push(...guides.filter((guide) => guide.indexed).map((guide) => `${view.origin}/${GUIDES_DIR}/${encodeURIComponent(guide.slug)}/`));
  }

  files.push({ file: MANIFEST_FILE, html: `${JSON.stringify(manifest, null, 2)}\n` });
  files.push({ file: SITEMAP_FILE, html: sitemapXml(sitemapUrls) });

  return { files, manifest, view };
}

function guardCounts(previous, manifest, force) {
  if (!previous || force) return;
  const before = Array.isArray(previous.topics) ? previous.topics.length : 0;
  const after = manifest.topics.length;
  if (before > 0 && after < before * 0.5) {
    throw new Error(
      `Тем было ${before}, стало ${after}. Похоже на сбой базы, а не на модерацию. ` +
        'Если темы правда удалены — запустите с --force.'
    );
  }
  const guidesBefore = Array.isArray(previous.guides) ? previous.guides.length : 0;
  if (guidesBefore > 0 && manifest.guides.length === 0) {
    throw new Error('Гайды были, а теперь ноль. Если это не сбой — запустите с --force.');
  }
}

async function writePages(files) {
  let changed = 0;
  for (const item of files) {
    const target = path.join(ROOT, ...item.file.split('/'));
    let old = null;
    try {
      old = await readFile(target, 'utf8');
    } catch {
      // Новый файл — это тоже изменение.
    }
    if (old === item.html) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, item.html, 'utf8');
    changed += 1;
  }
  return changed;
}

async function generatedHtmlFiles(dir) {
  const found = [];
  let entries = [];
  try {
    entries = await readdir(path.join(ROOT, dir), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await generatedHtmlFiles(rel)));
    } else if (entry.name === 'index.html') {
      try {
        const html = await readFile(path.join(ROOT, ...rel.split('/')), 'utf8');
        if (html.includes(MARKER)) found.push(rel);
      } catch {
        // Нечитаемый файл не наш; уборка его не касается.
      }
    }
  }
  return found;
}

async function prune(files) {
  const expected = new Set(files.map((item) => item.file));
  const removed = [];
  for (const dir of [FORUM_DIR, GUIDES_DIR]) {
    for (const file of await generatedHtmlFiles(dir)) {
      if (expected.has(file)) continue;
      const target = path.join(ROOT, ...file.split('/'));
      await rm(path.dirname(target), { recursive: true, force: true });
      removed.push(file);
    }
  }
  return removed;
}

async function checkPages(files) {
  const stale = [];
  for (const item of files) {
    const target = path.join(ROOT, ...item.file.split('/'));
    let old = null;
    try {
      old = await readFile(target, 'utf8');
    } catch {
      stale.push(`${item.file} — файла нет`);
      continue;
    }
    if (old.replace(/\r\n/g, '\n') !== item.html.replace(/\r\n/g, '\n')) {
      stale.push(`${item.file} — расходится с базой`);
    }
  }
  const expected = new Set(files.map((item) => item.file));
  for (const dir of [FORUM_DIR, GUIDES_DIR]) {
    for (const file of await generatedHtmlFiles(dir)) {
      if (!expected.has(file)) stale.push(`${file} — лишний снимок`);
    }
  }
  return stale;
}

const runAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (runAsScript) {
  const check = process.argv.includes('--check');
  const force = process.argv.includes('--force');
  try {
    const previous = await readManifest();
    const { files, manifest } = await buildAll();
    guardCounts(previous, manifest, force);

    if (check) {
      const stale = await checkPages(files);
      if (stale.length) {
        console.error(`Снимки устарели (${stale.length}):\n${stale.slice(0, 20).join('\n')}`);
        process.exit(1);
      }
      console.log(`Снимки актуальны: тем ${manifest.topics.length}, гайдов ${manifest.guides.length}.`);
    } else {
      const changed = await writePages(files);
      const removed = await prune(files);
      console.log(
        `Готово: тем ${manifest.topics.length} (в поиске ${manifest.topics.filter((t) => t.indexed).length}), ` +
          `гайдов ${manifest.guides.length}, файлов изменено ${changed}, удалено ${removed.length}.`
      );
    }
  } catch (error) {
    console.error(`Снимки форума не собраны: ${error?.message ?? error}`);
    process.exit(1);
  }
}
