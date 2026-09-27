/**
 * СПРАВОЧНИК ОФИЦИАЛЬНЫХ ГАЙДОВ ИГРЫ — разметка.
 *
 * Чистые функции: получили состояние, вернули строку. Данных у раздела нет ни
 * в базе, ни в сети: всё дерево лежит в src/handbook/guides.js, поэтому раздел
 * не «живой» и монтируется обычной строкой, как страницы итогов.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ РАЗДЕЛ, А НЕ ГАЙДЫ НА ФОРУМЕ.
 *   — гайды на форуме пишут игроки, их проверяет модерация, у них есть срок
 *     действия и обсуждение под текстом. Справочник — текст самой игры: его не
 *     обсуждают, его читают, и устаревает он иначе (когда игру меняет
 *     обновление, а не когда с ним не согласен читатель);
 *   — перенесён один в один из Telegram-бота игры, с картинками. Смешать его с
 *     авторскими советами в одном списке значило бы сделать неразличимыми
 *     «так написано в игре» и «так делает наш альянс».
 *
 * ПОИСК здесь свой, а не форумный: он ищет по телу гайда и отдаёт фрагмент с
 * найденным словом — человеку нужно место в правиле, а не карточка. Поведение
 * поля — в src/ui/handbook-controls.js, а разметка результатов вынесена в
 * renderResults(), чтобы и при заходе по ссылке с запросом, и при наборе
 * рисовался один и тот же код.
 */
import { esc } from '../ui/helpers.js';
import { postBody } from '../forum/format.js';
import { HANDBOOK, HANDBOOK_ROOTS } from '../handbook/guides.js';

const byId = new Map(HANDBOOK.map((g) => [g.id, g]));
const ROOTS = HANDBOOK_ROOTS.filter((id) => byId.has(id));

/** Родитель каждого узла: найден обходом детей, отдельного поля в данных нет. */
const parentId = new Map();
for (const g of HANDBOOK) {
  for (const child of g.children) {
    if (!parentId.has(child)) parentId.set(child, g.id);
  }
}

/** Гайд, а не раздел: узел без детей — это и есть текст с картинками. */
export const isHandbookGuide = (node) => Boolean(node) && node.children.length === 0;

export const handbookNode = (id) => byId.get(id) || null;

/*
  Адрес человек мог и напечатать: «%D0» в середине ломает decodeURIComponent
  исключением, а падать из-за него должна не страница и не весь сайт. Для
  настоящих ссылок кодировки в id нет — они из латиницы, цифр и подчёркивания.
*/
function safeDecode(id) {
  try {
    return decodeURIComponent(id);
  } catch (_) {
    return id;
  }
}

/** Число гайдов в поддереве: раздел показывает, сколько под ним на самом деле. */
function guideCount(node, seen = new Set()) {
  if (seen.has(node.id)) return 0; // страховка от цикла в данных
  seen.add(node.id);
  if (!node.children.length) return 1;
  return node.children.reduce((sum, id) => sum + (byId.has(id) ? guideCount(byId.get(id), seen) : 0), 0);
}

const TOTAL_GUIDES = ROOTS.reduce((sum, id) => sum + guideCount(byId.get(id)), 0);

/* ── Поиск ─────────────────────────────────────────────────────────────── */

const stripTags = (s) => String(s).replace(/<[^>]*>/g, ' ');
/** Плоский текст с исходным регистром — из него же рождается фрагмент. */
const flatten = (s) => stripTags(s).replace(/\s+/g, ' ').trim();
/*
  Сверка без регистра и с «ё» равной «е»: игроку всё равно, как набрано, а
  ё он почти никогда не печатает. Обе замены сохраняют длину строки, поэтому
  позиция из сложенного текста годится для вырезки фрагмента из исходного.
*/
const fold = (s) => s.toLowerCase().replace(/ё/g, 'е');

/*
  Индекс строится один раз при загрузке модуля: 44 гайда — это около 54 тысяч
  знаков, пересчитывать их на каждую нажатую клавишу незачем.
*/
const INDEX = HANDBOOK.filter(isHandbookGuide).map((g) => {
  const rawBody = flatten(g.blocks.map((b) => (b.image ? b.caption || '' : b.text || '')).join(' '));
  const rawTitle = flatten(g.title);
  return {
    node: g,
    title: rawTitle,
    titleFolded: fold(rawTitle),
    /* Раздел и путь: по одному слову «вулкан» ищут целый раздел, а не текст
       внутри него. */
    trailFolded: fold(flatten([g.section, ...g.path].join(' '))),
    body: rawBody,
    bodyFolded: fold(rawBody),
    /* Подписи картинок часто содержательнее текста («так выглядит карта
       событий») — ищут по тому, что видели. */
    captionsFolded: fold(flatten(g.blocks.map((b) => b.caption || '').join(' '))),
  };
});

const MAX_RESULTS = 24;

/**
 * @param {string} query
 * @returns {{total: number, items: Array<{node: any, snippet: string}>}}
 */
export function searchHandbook(query) {
  const tokens = fold(flatten(query)).split(' ').filter(Boolean);
  if (!tokens.length) return { total: 0, items: [] };

  const scored = [];
  for (const row of INDEX) {
    let score = 0;
    let hit = -1;
    for (const t of tokens) {
      const inTitle = row.titleFolded.indexOf(t);
      const inTrail = row.trailFolded.indexOf(t);
      const inBody = row.bodyFolded.indexOf(t);
      const inCaption = row.captionsFolded.indexOf(t);
      /* Каждое слово запроса должно встретиться хотя бы где-то: «засада
         альянс» не найдёт гайд, где есть только «засада». */
      if (inTitle < 0 && inTrail < 0 && inBody < 0 && inCaption < 0) {
        score = 0;
        break;
      }
      score += (inTitle >= 0 ? 12 : 0) + (inTrail >= 0 ? 4 : 0) + (inBody >= 0 ? 3 : 0) + (inCaption >= 0 ? 2 : 0);
      if (hit < 0 && inBody >= 0) hit = inBody;
    }
    if (!score) continue;
    scored.push({ node: row.node, score, snippet: hit >= 0 ? snippetAt(row.body, hit, tokens) : '' });
  }

  scored.sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title, 'ru'));
  return { total: scored.length, items: scored.slice(0, MAX_RESULTS) };
}

/**
 * Фрагмент вокруг первого попадания: ровно то, ради чего человек набрал
 * слово, а не начало гайда, где этого слова может не оказаться.
 */
function snippetAt(text, at, tokens) {
  const radius = 90;
  const from = Math.max(0, at - radius);
  const to = Math.min(text.length, at + radius);
  const wordStart = (i) => (i > 0 ? Math.max(i, text.lastIndexOf(' ', i) + 1) : i);
  const wordEnd = (i) => (i < text.length ? (text.indexOf(' ', i) < 0 ? text.length : text.indexOf(' ', i)) : i);
  const head = (from > 0 ? '…' : '') + text.slice(wordStart(from), wordEnd(to)) + (to < text.length ? '…' : '');
  return highlight(head, tokens);
}

/*
  Подсветка найденного. Экранирование здесь, а не снаружи, и одним проходом:
  если сначала вставить <mark> в уже экранированный текст, второе слово может
  попасть внутрь собственного тега или внутрь сущности («&amp;»), и разметка
  сломается. Если экранировать после вставки — сдохнет сам тег. Поэтому куски
  текста экранируются по отдельности и только между ними встаёт свой тег.
*/
function highlight(raw, tokens) {
  const re = new RegExp(tokens.map(tokenPattern).join('|'), 'gi');
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(re)) {
    out += esc(raw.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  return out + esc(raw.slice(last));
}

/**
 * Слово запроса как часть регулярки. «е» заменяется на «[её]», потому что
 * позиции мы сверяли по сложенному тексту, а показываем исходный: игрок
 * печатает «ещ», а в правиле написано «ещё».
 */
function tokenPattern(token) {
  return token.replace(/е/g, '[её]').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ── Куски разметки ────────────────────────────────────────────────────── */

/** Хлебные крошки: путь от корня до открытого узла, каждое звено — ссылка. */
function breadcrumbs(node) {
  const chain = [];
  let cur = node;
  while (cur && !chain.includes(cur)) {
    chain.unshift(cur);
    cur = parentId.has(cur.id) ? byId.get(parentId.get(cur.id)) : null;
  }
  const crumbs = chain.map((n, i) =>
    i === chain.length - 1
      ? `<span aria-current="page">${esc(n.title)}</span>`
      : `<a href="#/handbook/${esc(n.id)}">${esc(n.title)}</a>`
  );
  return `<nav class="hb-crumbs" aria-label="Путь по разделам">${crumbs.join('<span aria-hidden="true">/</span>')}</nav>`;
}

/** Плитки подразделов и гайдов внутри раздела. */
function childTiles(node) {
  if (!node.children.length) return '';
  return `<ul class="hb-grid">${node.children
    .filter((id) => byId.has(id))
    .map((id) => {
      const child = byId.get(id);
      const kind = isHandbookGuide(child) ? 'гайд' : `раздел · ${guideCount(child)} гайдов`;
      const lead = leadOf(child);
      return `<li class="hb-tile"><a href="#/handbook/${esc(child.id)}">
        <b>${esc(child.title)}</b>
        <span class="hb-tile__kind">${esc(kind)}</span>
        ${lead ? `<span class="hb-tile__lead">${esc(lead)}</span>` : ''}
      </a></li>`;
    })
    .join('')}</ul>`;
}

/** Первая строка текста без разметки — подпись под плиткой. */
function leadOf(node) {
  const first = node.blocks.find((b) => b.text) || node.blocks.find((b) => b.caption);
  if (!first) return '';
  const flat = flatten(first.text || first.caption || '');
  return flat.length > 120 ? `${flat.slice(0, 120).trimEnd()}…` : flat;
}

function blockHtml(block) {
  if (block.image) {
    return `
      <figure class="hb-fig">
        <img src="${esc(block.image)}" alt="${esc(block.alt)}" width="${block.w}" height="${block.h}"
             loading="lazy" decoding="async">
        ${block.caption ? `<figcaption>${postBody(block.caption)}</figcaption>` : ''}
      </figure>`;
  }
  return `<div class="hb-text">${postBody(block.text)}</div>`;
}

/**
 * Результаты поиска. Отдельный экспорт и одна функция на два случая: человек
 * может прийти по ссылке с запросом (#/handbook?q=засада) или набрать его уже
 * на странице — список обязан выглядеть одинаково.
 */
export function renderResults(query) {
  const q = String(query ?? '').trim();
  const { total, items } = searchHandbook(q);
  if (!total) {
    return `<p class="hb-none">По запросу «${esc(q)}» в справочнике ничего нет.
      Попробуйте одно слово: поиск смотрит и в тексте гайда, и в подписях к картинкам.</p>`;
  }
  const rows = items
    .map(({ node, snippet }) => `
      <li class="hb-hit">
        <a href="#/handbook/${esc(node.id)}">
          <b>${esc(node.title)}</b>
          <span class="hb-hit__where">${esc(node.path.length ? node.path.join(' → ') : 'Справочник')}</span>
        </a>
        ${snippet ? `<p class="hb-hit__snippet">${snippet}</p>` : ''}
      </li>`)
    .join('');
  return `
    <p class="hb-hits__count muted">Найдено гайдов: ${total}${total > items.length ? `, показаны первые ${items.length}` : ''}.</p>
    <ul class="hb-hits">${rows}</ul>`;
}

function searchField(query) {
  return `
    <label class="hb-search">
      <span class="sr-only">Поиск по справочнику</span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>
      </svg>
      <input type="search" placeholder="Поиск по официальным гайдам…" autocomplete="off" spellcheck="false"
             aria-controls="hb-results" data-hb-query value="${esc(query ?? '')}">
    </label>
    ${resultsSlot(query)}`;
}

/**
 * Единый контейнер для «нашёл» и «не ищут»: список разделов и результаты
 * поиска занимают одно место страницы, и поле только переключает их. Так набор
 * слова не съедает и не возвращает половину экрана.
 */
export function resultsSlot(query) {
  const q = String(query ?? '');
  return `<div id="hb-results" class="hb-results" data-hb-results>${q ? renderResults(q) : renderSections()}</div>`;
}

/** Список разделов — то, что видно, пока человек не начал искать. */
export function renderSections() {
  return ROOTS
    .map((id) => {
      const root = byId.get(id);
      const intro = root.blocks.filter((b) => b.text).map((b) => blockHtml(b)).join('');
      return `
        <section class="hb-section">
          <header class="hb-section__head">
            <h2>${esc(root.title)}</h2>
            <span class="hb-section__count muted">${guideCount(root)} гайдов</span>
          </header>
          ${intro}
          ${childTiles(root)}
        </section>`;
    })
    .join('');
}

/* ── Страница ──────────────────────────────────────────────────────────── */

/**
 * Мостик со страницы «Гайды».
 *
 * Он под списком авторских гайдов, а не над ним: на «Гайды» приходят смотреть,
 * что написали свои, и первой должна идти именно она. Но путь к тексту игры
 * обязан быть заметным — игроку, который ищет «как это работает», нужен
 * справочник, а не чужой совет.
 *
 * Функция живёт здесь, а не в guides.js, потому что знает число гайдов и
 * названия разделов: чужие данные не должны копироваться в чужую разметку.
 */
export function renderHandbookTeaser() {
  return `
    <section class="guide-official">
      <header class="panel__head">
        <span class="eyebrow">Справочник</span>
        <h2>Официальные гайды игры</h2>
        <p class="muted">
          ${TOTAL_GUIDES} правил и механик так, как их описывает сама игра: картинки из игры,
          ничего не пересказано и не сокращено. Отметок «проверен / устарел» здесь нет
          намеренно — это текст разработчиков, а не совет участника.
        </p>
      </header>
      <p class="guide-official__acts">
        <a class="forum-btn forum-btn--primary" href="#/handbook">Открыть справочник</a>
        <span class="guide-official__hint muted">Поиск по слову — прямо на его первой странице.</span>
      </p>
      <ul class="guide-official__cats">${ROOTS
    .map((id) => {
      const root = byId.get(id);
      return `<li><a href="#/handbook/${esc(root.id)}">${esc(root.title)}</a>
        <span class="muted">${guideCount(root)}</span></li>`;
    })
    .join('')}</ul>
    </section>`;
}

/**
 * @param {{guideId?: string|null, query?: string}} state
 */
export function renderHandbook(state = {}) {
  const query = String(state.query ?? '');
  const id = state.guideId ? safeDecode(state.guideId) : null;
  const node = id ? handbookNode(id) : null;

  if (id && !node) {
    return `
      <section class="panel hb-page">
        <header class="panel__head">
          <span class="eyebrow">Справочник</span>
          <h1>Такого гайда нет</h1>
          <p class="muted">Раздел <code>${esc(id)}</code> в справочнике не найдён: ссылку
            могли прислать до переноса, когда раздел назывался иначе.</p>
          <p><a class="back" href="#/handbook">← К списку разделов</a></p>
        </header>
        ${searchField('')}
      </section>`;
  }

  if (!node) {
    return `
      <section class="panel hb-page">
        <header class="panel__head">
          <span class="eyebrow">Справочник</span>
          <h1>Официальные гайды игры</h1>
          <p class="muted">
            Правила, механики и цифры так, как их описывает сама игра: ${TOTAL_GUIDES} гайдов
            в ${ROOTS.length} разделах, с картинками из игры и без пересказов.
            Советы участников — <a href="#/guides">в гайдах на форуме</a>.
          </p>
        </header>
        ${searchField(query)}
        <footer class="hb-page__foot">
          <p class="muted">
            Перенесено один в один из Telegram-бота игры. Искать нужное по слову
            удобнее здесь, а обсуждать — на форуме: справочник показывает только то,
            что написано в игре.
          </p>
        </footer>
      </section>`;
  }

  const parent = parentId.has(node.id) ? byId.get(parentId.get(node.id)) : null;
  const siblings = (parent ? parent.children : []).filter((sid) => sid !== node.id && byId.has(sid));

  return `
    <section class="panel hb-page hb-page--node">
      ${breadcrumbs(node)}
      <header class="panel__head">
        <span class="eyebrow">${node.children.length ? 'Раздел справочника' : 'Официальный гайд'}</span>
        <h1>${esc(node.title)}</h1>
      </header>

      ${childTiles(node)}
      ${node.blocks.length ? `<div class="hb-guide">${node.blocks.map((b) => blockHtml(b)).join('')}</div>` : ''}

      ${siblings.length
        ? `<nav class="hb-siblings" aria-label="Другие гайды раздела">
             <h2 class="hb-siblings__head">Рядом в этом разделе</h2>
             <ul>${siblings.map((sid) => `<li><a href="#/handbook/${esc(sid)}">${esc(byId.get(sid).title)}</a></li>`).join('')}</ul>
           </nav>`
        : ''}

      <footer class="hb-page__foot">
        <p class="muted">
          <a href="#/handbook">← Все разделы справочника</a> ·
          текст игры, перенесён без правок. Нашли расхождение с тем, что сейчас
          в игре, — скажите об этом <a href="#/forum">на форуме</a>.
        </p>
      </footer>
    </section>`;
}
