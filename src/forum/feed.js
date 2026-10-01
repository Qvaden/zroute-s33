/**
 * Игровой фид: как из чужой страницы магазина получить поля нашей заметки.
 *
 * Модуль нарочно стоит отдельно от src/forum/rules.js и от планировщика: его
 * вызывают три разных места — скрипт GitHub Actions, черновая страница и
 * контрактный тест, — и все три должны видеть один и тот же разбор. Правил
 * здесь ровно два.
 *
 *   1. Ни одного обращения наружу. fetch здесь нет и появиться не может:
 *      страница посетителя не имеет права ходиться в чужие сайты, а тест
 *      «внешних запросов нет ни в базе, ни в коде страницы» это сторожит.
 *      HTML приносят параметром.
 *   2. Ничего не додумывать. Пустое поле — честный ответ «в тексте этого нет»,
 *      и планировщик тогда скажет это словами в отчёте, а не подставит
 *      «неизвестно» или вчерашнюю дату.
 *
 * Границы раздела — те же числа, что в CONFIG.forum.limits: их держит база, и
 * разминуться с ней этот разбор не вправе.
 */
import { CONFIG } from '../../config.js';
import {
  parseUpdateSource, parseUpdateDate, updateSourceFromLink, UPDATE_MONTHS,
} from './rules.js';

const L = CONFIG.forum.limits;
const STORE = CONFIG.forum.store;

/** Прямой адрес страницы приложения в Google Play для выбранной страны. */
export function playPageUrl(cfg = STORE) {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(cfg.playId)}`
    + `&hl=${encodeURIComponent(cfg.country || 'ru')}`;
}

/**
 * Официальный JSON App Store. Единственный источник из двух, который отдаёт
 * структуру, а не вёрстку: номер версии, дата и текст релиза приходят полями,
 * и ломаться при изменении дизайна им нечему.
 */
export function itunesLookupUrl(cfg = STORE) {
  return `https://itunes.apple.com/lookup?id=${encodeURIComponent(cfg.appStoreId)}`
    + `&country=${encodeURIComponent(cfg.country || 'ru')}`;
}

/*
  Заголовки разделов страницы Play. Нужны как стоп-слова: разбор берёт текст
  после заголовка «Что нового» и обязан остановиться на следующем разделе, а не
  притащить в заметку полстраницы вместе с отзывами и данными разработчика.
  Список намеренно шире, чем одна страница: у магазина заголовки гуляют от
  страны к стране и между старой и новой вёрсткой.
*/
export const STORE_SECTION_HEADS = [
  'Об этом приложении',
  'Описание',
  'Что нового',
  'Последнее обновление',
  'Обновлено',
  'Рейтинг и отзывы',
  'Отзывы',
  'Оценки и отзывы',
  'Сведения о приложении',
  'Данные разработчика',
  'Помощь',
  'Поддержка разработчика',
  'Сходные приложения',
  'Похожие игры',
  'Возможности',
  'События',
  'События и предложения',
  'Будущие события',
  'Идут сейчас',
];

/*
  Мини-разбор HTML без DOM: планировщик живёт в Node, где DOMParser'а нет, а
  браузерный путь намеренно не плодит второй копию — здесь работает одна и та же
  функция. Теги снимаются вместе с содержимым script и style: иначе в текст
  заметки попалась бы половина чужого кода.
*/
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    /* Заголовок разделителя сам по себе — тоже граница чтения. */
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/*
  Кусок текста между двумя заголовками. Ищем заголовок как отдельную строку
  уже снятого текста, а не как подстроку: «События» встречается и внутри чужого
  предложения, и тогда разбор ушёл бы не туда.
*/
function between(head, from, text) {
  let cut = text.length;
  for (const other of STORE_SECTION_HEADS) {
    if (other === head) continue;
    const at = text.indexOf(`\n${other}\n`, from);
    if (at >= 0 && at < cut) cut = at;
  }
  return text.slice(from, cut).trim();
}

/**
 * Текст «Что нового» со страницы Play.
 *
 * Возвращает и способ, которым нашёл: планировщику нужно уметь отличить «у
 * приложения нет описания обновления» от «магазин переверстал страницу, и мы
 * больше ничего не видим». Для человека эти два случая выглядят одинаково —
 * пустой блок, — а чинятся по-разному.
 */
export function extractWhatsNew(html) {
  const text = htmlToText(html);
  for (const head of ['Что нового', 'Об этом приложении', 'Описание']) {
    const at = text.indexOf(`\n${head}\n`);
    if (at < 0) continue;
    const body = between(head, at + head.length + 2, text);
    if (body.length >= L.updateSummaryMin) {
      return { text: body.slice(0, L.updatePasteMax), how: head };
    }
  }
  /*
    Заголовок был, а текста под ним не нашлось. Отдельная причина: страница
    могла открыться заглушкой («Сайт недоступен», капча), и тогда важно не
    опубликовать пустоту, а сказать, что магазин ответил не тем.
  */
  return { text: '', how: text.includes('Что нового') ? 'head-only' : 'no-head' };
}

/*
  Строка даты рядом с блоком обновления: «Обновлено · 25 сент. 2026 г.»,
  «Последнее обновление: 25 сент. 2026 г.». Сама дата разбирается в rules.js,
  здесь только находим строку, в которой она лежит.
*/
const PLAY_UPDATED_LINE = /^(?:Обновлено|Последнее обновление)\s*[·:—-]?\s*(.+)$/i;

/** Дата последнего обновления со страницы Play, если она там написана. */
export function extractWhatsNewDate(html) {
  const text = htmlToText(html);
  for (const line of text.split('\n')) {
    /*
      Возвращаем строку целиком, а не только дату: разбирает её rules.js, и
      ему нужна метка «Обновлено» — без неё непонятно, дата это или версия
      набора.
    */
    if (PLAY_UPDATED_LINE.test(line.trim())) return line.trim();
  }
  return '';
}

/*
  Версия и дата обновления из служебного JSON страницы. Новая вёрстка Play
  раздела «Что нового» не имеет вовсе — магазин печатает только «Последнее
  обновление» и дату. Зато в данных, которыми он наполняет карточку, лежат
  номер версии и точная метка обновления:

      [[["1.36.05"]], … , [["23 сент. 2026 г.",[1790178118,131000000]]]

  Метку берём отсюда, а не из надписи: «23 сент. 2026 г.» магазин печатает
  по-разному в разных странах, а счёт секунд от 1970 года одинаков везде.
*/
const PLAY_VERSION_BLOB = /\[\[\["(\d+\.\d+(?:\.\d+){0,2})"\]\]/;
const PLAY_UPDATED_BLOB = /\[\["([^"\n]{2,30})",\[(\d{9,10}),/;

/** Номер версии Android и дата последнего обновления со страницы Play. */
export function extractPlayMeta(html) {
  const raw = String(html ?? '');
  const updated = PLAY_UPDATED_BLOB.exec(raw);
  const epoch = Number(updated?.[2] || 0);
  return {
    version: PLAY_VERSION_BLOB.exec(raw)?.[1] || '',
    dateLine: updated ? `Последнее обновление: ${updated[1]}` : '',
    /* Метка вне разумного поля — не дата: год 2001–2096, иначе не берём. */
    at: epoch > 978307200 && epoch < 4102444800
      ? new Date(epoch * 1000).toISOString().slice(0, 10)
      : '',
  };
}

/* ── Служебная запись карточки события ─────────────────────────────────────── */

/*
  Карточка события несёт даты в атрибуте jslog:

      jslog="38003; 1:598|CCGqAnEabwgA…==; track:click,impression"

  между знаком «|» и «;». В видимом тексте страницы начала и конца события
  нет ни в старой вёрстке, ни в новой, поэтому разбор идёт по этой записи.
  Формат — бинарная protobuf-структура: читаем wire-format (номера полей и
  значения), ищем сообщение, где поле 5 — начало, поле 6 — конец, а рядом
  лежит id карточки. Номера взяты не наугад: они стояли в разобранной живой
  странице. Если магазин перепишет запись и поля уедут, событие вернётся без
  дат и планировщик назовёт его вслух в отчёте — молча не выдумав.
*/
const EVENT_JSLOG = /jslog="\d+;[^"|]*\|([A-Za-z0-9+/_=-]{24,})/;
const EVENT_LINK = /href="\/store\/apps\/eventdetails\/(\d+)"/;
const EVENT_ANCHOR = /<a[^>]+href="\/store\/apps\/eventdetails\/(\d+)"[^>]*>([\s\S]*?)<\/a>/;

/** Событие длиннее года не живёт: дольше — значит прочитали чужие числа. */
const MAX_EVENT_SPAN_DAYS = 400;

/** Байты из base64 приписки; кривое основание — null, а не исключение. */
function base64Bytes(b64) {
  const s = String(b64 ?? '').replace(/-/g, '+').replace(/_/g, '/');
  let bin;
  try {
    bin = atob(s.padEnd(Math.ceil(s.length / 4) * 4, '='));
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Миллисекунды только в честном диапазоне 2001–2096 годов. */
function isEpochMs(value) {
  return Number.isInteger(value) && value > 978307200000 && value < 4102444800000;
}

function readLE(bytes, pos, size) {
  let value = 0;
  for (let i = 0; i < size; i += 1) value += bytes[pos + i] * 2 ** (8 * i);
  return value;
}

/** Поля одной бинарной записи. Мусор снаружи — исключение, ловит родитель. */
function pbFields(bytes) {
  const out = [];
  let pos = 0;
  const varint = () => {
    let shift = 0;
    let value = 0;
    for (;;) {
      if (pos >= bytes.length || shift > 49) throw new Error('хвост записи');
      const b = bytes[pos];
      pos += 1;
      value += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return value;
      shift += 7;
    }
  };
  while (pos < bytes.length) {
    const head = varint();
    const num = Math.floor(head / 8);
    const wire = head % 8;
    if (num < 1 || num > 2000) throw new Error('не запись');
    if (wire === 0) out.push({ num, kind: 'n', value: varint() });
    else if (wire === 1) { out.push({ num, kind: 'n', value: readLE(bytes, pos, 8) }); pos += 8; }
    else if (wire === 5) { out.push({ num, kind: 'n', value: readLE(bytes, pos, 4) }); pos += 4; }
    else if (wire === 2) {
      const len = varint();
      if (pos + len > bytes.length) throw new Error('длина больше записи');
      out.push({ num, kind: 'b', bytes: bytes.subarray(pos, pos + len) });
      pos += len;
    } else throw new Error('неизвестный способ');
  }
  return out;
}

function utf8(bytes) {
  try { return new TextDecoder().decode(bytes); } catch { return ''; }
}

/** Обходит вложения и ищет сообщение с парой «начало — конец» и id внутри. */
function pbFindWindow(bytes, id, depth) {
  let fields;
  try { fields = pbFields(bytes); } catch { return null; }
  const start = fields.find((f) => f.num === 5 && f.kind === 'n')?.value;
  const end = fields.find((f) => f.num === 6 && f.kind === 'n')?.value;
  if (isEpochMs(start) && isEpochMs(end) && end >= start
    && end - start <= MAX_EVENT_SPAN_DAYS * 86400000
    && (!id || fields.some((f) => f.kind === 'b' && utf8(f.bytes).includes(id)))) {
    return { start, end };
  }
  if (depth <= 0) return null;
  for (const f of fields) {
    if (f.kind !== 'b') continue;
    const hit = pbFindWindow(f.bytes, id, depth - 1);
    if (hit) return hit;
  }
  return null;
}

/** Метка в ISO, каким её принимает база: с часами и без миллисекунд. */
function isoMs(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Начало и конец события из приписки карточки. Пустой ответ честен: дат нет,
 * и планировщик не понесёт карточку в базу, где starts_at обязателен.
 */
export function decodeEventWindow(b64, id = '') {
  const bytes = base64Bytes(b64);
  const hit = bytes ? pbFindWindow(bytes, id, 8) : null;
  return hit
    ? { startsAt: isoMs(hit.start), endsAt: isoMs(hit.end), how: 'jslog' }
    : { startsAt: '', endsAt: '', how: '' };
}

/**
 * Карточки событий со страницы Play. Разбираем участки между
 * `role="listitem"`: карточка события узнаётся по ссылке
 * `/store/apps/eventdetails/<id>`, и только она имеет право ехать в базу.
 * Название берём из самой длинной строки анкера: магазин ставит рядом короткую
 * плашку рода события («Доступно обновление»), и она идёт подписью, а не названием.
 */
function readEventCards(html) {
  const raw = String(html ?? '');
  const marks = [...raw.matchAll(/role="listitem"/g)].map((m) => m.index);
  const cards = [];
  for (let i = 0; i < marks.length; i += 1) {
    const segment = raw.slice(marks[i], marks[i + 1] ?? Math.min(raw.length, marks[i] + 30000));
    const link = EVENT_LINK.exec(segment)?.[1] || '';
    if (!link) continue;
    const anchor = EVENT_ANCHOR.exec(segment);
    const lines = anchor
      ? htmlToText(anchor[2]).split('\n').map((s) => s.trim()).filter(Boolean)
      : [];
    const title = lines.sort((a, b) => b.length - a.length)[0] || '';
    if (title.length < L.storeEventTitleMin) continue;
    const cut = title.slice(0, L.storeEventTitleMax);
    cards.push({
      title: cut,
      label: lines.filter((s) => s !== title).join(' · ').slice(0, L.storeEventSummaryMax),
      eventId: link,
      sourceUrl: `https://play.google.com/store/apps/eventdetails/${link}`,
      feedKey: storeEventKey('android', cut),
      raw: lines.join('\n'),
      ...decodeEventWindow(EVENT_JSLOG.exec(segment)?.[1] || '', link),
    });
  }
  return cards;
}

/**
 * Страница самого события: `<title>` и описание из служебной метки
 * og:description. Площадка печатает тот же текст и в теле страницы, но метка
 * переживает смену вёрстки лучше: она заполнена для поисковика и соцсетей.
 */
export function extractEventPage(html) {
  const raw = String(html ?? '');
  const title = /<title[^>]*>([^<]{1,200})/i.exec(raw)?.[1] || '';
  const meta = /<meta\b[^>]+property="og:description"[^>]+content="([^"]{1,2000})"/i.exec(raw)?.[1]
    || /<meta\b[^>]+content="([^"]{1,2000})"[^>]+property="og:description"/i.exec(raw)?.[1]
    || '';
  return {
    title: htmlToText(title).trim().slice(0, L.storeEventTitleMax),
    summary: htmlToText(meta).trim().slice(0, L.storeEventSummaryMax),
  };
}

/**
 * События на странице Play. Основной путь — карточки с припиской jslog: только
 * в ней лежат настоящие начало и конец. Запасной путь — строки текста после
 * заголовка «События»: старая вёрстка и случай, когда магазин отдаст карточки
 * без служебной записи.
 *
 * Даты у события обязательны: без начала строка не имеет права ехать в базу, а
 * выдумывать «сегодня» из надписи «идёт сейчас» — значит опубликовать событие,
 * которое кончится вчера. Поэтому карточка без читаемой даты возвращается без
 * неё, и планировщик называет такие случаи вслух в отчёте.
 */
export function extractStoreEvents(html, now = Date.now()) {
  const cards = readEventCards(html);
  if (cards.length) return { events: cards.slice(0, L.storeEventListMax), how: 'cards' };

  const text = htmlToText(html);
  const at = text.search(/\n(?:События|Будущие события|Идут сейчас)\n/);
  if (at < 0) return { events: [], how: 'no-head' };
  const head = (text.slice(at + 1).split('\n')[0] || '').trim();
  const body = between(head, at + head.length + 2, text);
  const lines = body.split('\n').map((s) => s.trim()).filter(Boolean);
  const events = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (EVENT_BUTTON.test(line) || line.length < L.storeEventTitleMin) continue;
    /*
      Дата стоит не в строке названия, а в соседних — одна-две строки ниже,
      пока не начнётся следующая карточка. Берём окно из трёх строк: больше —
      и начнём захватывать чужое событие.
    */
    const raw = [line, lines[i + 1] || '', lines[i + 2] || ''].join('\n');
    if (EVENT_TIME_ONLY.test(line) || isDateLine(line)) continue;
    const title = line.slice(0, L.storeEventTitleMax);
    events.push({
      title,
      /*
        Ключ считает та же функция, что и страница при разборе ответа базы:
        один текст — один ключ, иначе планировщик на следующем обходе заведёт
        второе событие вместо того же.
      */
      feedKey: storeEventKey('android', title),
      raw,
      ...parseEventWindow(raw, now),
    });
  }
  return { events: events.slice(0, L.storeEventListMax), how: 'lines' };
}

const EVENT_BUTTON = /^(?:Подробнее|Показать всё|Ещё|Смотреть все|Learn more)$/i;
const EVENT_TIME_ONLY = /^(?:ид[её]т|завершится|начн[её]тся|до |с \d|до \d|через )/i;

/**
 * Строка, из которой после дат ничего не остаётся: «3 окт. — 12 окт. 2026».
 * Без этой проверки запасной путь рождал бы второе событие с названием из
 * собственной даты, а такое событие не описывает ничего.
 */
function isDateLine(line) {
  const dateless = line
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(EVENT_DATE_TEXT, ' ')
    .replace(/[^\p{L}]/gu, '');
  return dateless.length < L.storeEventTitleMin;
}

/*
  Дата в строке вида «3 окт.», «12 октября 2026», «2026-10-12». Год может не
  называться: тогда берём текущий. Дальше чем на год вперёд дата не уезжает —
  если магазин написал «1 нояб.», а сегодня декабрь, это ноябрь наступившего
  года, а не прошлого.
*/
const EVENT_DATE_ISO = /(\d{4})-(\d{2})-(\d{2})/g;
const EVENT_DATE_TEXT = /(\d{1,2})\s+([a-zа-яё]{3,10})\.?(?:\s*(\d{4}))?/gi;

/** Начало и конец события из текста карточки; пустая строка — даты нет. */
export function parseEventWindow(raw, now = Date.now()) {
  const text = String(raw ?? '');
  const found = [];
  for (const m of text.matchAll(EVENT_DATE_ISO)) {
    found.push({ y: +m[1], m: +m[2] - 1, d: +m[3], at: m.index });
  }
  for (const m of text.matchAll(EVENT_DATE_TEXT)) {
    const month = UPDATE_MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month === undefined) continue;
    found.push({ y: m[3] ? +m[3] : null, m: month, d: +m[1], at: m.index });
  }
  if (!found.length) return { startsAt: '', endsAt: '' };

  found.sort((a, b) => a.at - b.at);
  const ref = new Date(now);
  const thisYear = ref.getUTCFullYear();
  const build = (f) => {
    const year = f.y ?? thisYear;
    const pad = (n) => String(n).padStart(2, '0');
    return `${year}-${pad(f.m + 1)}-${pad(f.d)}T12:00`;
  };
  let start = build(found[0]);
  if (found[0].y === undefined || found[0].y === null) {
    /*
      Год не назван, а дата уже прошла — значит карточка про следующий год:
      событие «с 15 янв.», напечатанное в декабре, январское.
    */
    if (Date.parse(start) < ref.getTime() - 45 * 86400000) {
      start = build({ ...found[0], y: thisYear + 1 });
    }
  }
  const end = found.length > 1 ? build(found[found.length - 1]) : '';
  if (end && Date.parse(end) <= Date.parse(start)) return { startsAt: start, endsAt: '' };
  return { startsAt: start, endsAt: end };
}

/**
 * Полное ISO-время из поля вида YYYY-MM-DDT12:00 или YYYY-MM-DD. Планировщик
 * отдаёт базе timestamptz, а база не принимает недоразумение «2026-09-25:00Z».
 */
export function toStoreIso(field) {
  const s = String(field ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s}:00Z`;
  return s;
}

/**
 * Ключ события: по нему планировщик между обходами узнаёт одну и ту же
 * строку. Считается из названия и площадки — даты в ключе нарочно нет:
 * магазин нередко правит конец события на ходу, а событие от этого новым не
 * становится.
 */
export function storeEventKey(platform, title) {
  const base = `${platform}:${String(title ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
  const cut = base.slice(0, L.storeEventKeyMax);
  /*
    Короткое имя события дало бы ключ короче нижнего порога базы (8 символов),
    и функция отвергла бы строку текстом про ключ. Это не вина данных, поэтому
    недобор закрываем стабильным хвостом, а не выдуманным словом.
  */
  if (cut.length >= L.storeEventKeyMin) return cut;
  let salt = 0;
  for (let i = 0; i < base.length; i += 1) salt = (salt * 31 + base.charCodeAt(i)) % 100000;
  return `${cut}-${String(salt).padStart(5, '0')}`.slice(0, L.storeEventKeyMax);
}

/**
 * Весь разбор страницы Play одним вызовом — так его использует планировщик, и
 * так же его проверяет тест. Возвращает и найденное поле, и способ нахождения:
 * «empty» после найденного заголовка означает, что магазин переписал вёрстку,
 * а «no-head» — что страница вообще не та (заглушка, капча, редирект).
 */
export function readPlayPage(html, now = Date.now()) {
  const found = extractWhatsNew(html);
  const meta = extractPlayMeta(html);
  const parsed = parseUpdateSource(found.text, playPageUrl(), now);
  const dateLine = extractWhatsNewDate(html) || meta.dateLine;
  const gameVersion = parsed.gameVersion || meta.version;
  return {
    ...parsed,
    gameVersion,
    text: found.text,
    /*
      «meta» — не поломка, а новый порядок: раздела с описанием у страницы нет,
      но версия и дата обновления прочитаны из её служебных данных. Планировщик
      печатает диагностику только при «no-page».
    */
    how: found.text
      ? 'ok'
      : (gameVersion || meta.at ? 'meta' : (found.how === 'head-only' ? 'empty' : 'no-page')),
    dateLine,
    at: parseUpdateDate(dateLine, now) || meta.at || parsed.sourceAt,
    events: extractStoreEvents(html, now),
  };
}

/**
 * Поля заметки из двух магазинов — то, что планировщик кладёт в
 * forum_publish_update_note.
 *
 * Один пост на оба, как договорились: читателю важно «что изменилось в игре»,
 * а не какой именно магазин ответил первым.
 *
 * Чего в посте не бывает, так это нашего сбоя. Площадка, которая не назвала ни
 * версии, ни текста, из поста исключается совсем, а её отсутствие уходит в
 * отчёт об обходе, который читает модерация. Строка «страница Play не ответила
 * за этот обход» — правда про нас, но игрок узнает из неё только то, что у
 * сайта что-то сломалось, и будет прав: чинить должны мы, а не оправдываться
 * перед ним текстом заметки.
 *
 * Тем же правилом отсекается площадка, вернувшаяся к старой версии: её половина
 * в пост не попадает, и описано это ниже у переменной androidLag.
 */
export function composeStoreNote({ android = null, ios = null, known = {} } = {}, now = Date.now()) {
  const playUrl = playPageUrl();
  const parsed = android?.text
    ? parseUpdateSource(android.text, playUrl, now)
    : { title: '', summary: '', kind: '', gameVersion: '', sourceAt: '', sourceName: '' };

  const androidVersion = android?.gameVersion || parsed.gameVersion || '';
  const iosVersion = ios?.version || '';
  const iosText = cleanIosNotes(ios?.releaseNotes);
  const androidSays = !!androidVersion || !!parsed.summary;
  const iosSays = !!iosVersion || !!iosText;

  /*
    ПЛОЩАДКА ВЕРНУЛАСЬ В ПРОШЛОЕ — ЭТО НЕ НОВОЕ ОБНОВЛЕНИЕ.

    30 сентября App Store отдал на одном обходе версию 1.37.01, на следующем —
    1.36.05, а ещё через пять часов — снова 1.37.01. Так отвечает его кэш:
    запросы планировщика попадают на разные края, и один держит вчерашний
    снимок. Автомат, который сверял версии равенством, увидел в этом выход
    нового патча, напечатал пост о версии, которая на сайте уже стояла, и
    записал старую версию в своё состояние — после чего следующий обход был
    обязан повторить то же самое. Три карточки одного патча вместо двух —
    ровно эта цепочка.

    Поэтому сверка стала порядковой: площадка, назвавшая версию старше
    опубликованной, ничего нового не принесла. Её половина в пост не попадает,
    её версия в состояние не пишется, и задержка называется словами в отчёте
    обхода. Откат игры на старую версию здесь не лечится: выглядит он точно
    так же, а молчать об откате дешевле, чем дважды будить игроков одним и тем
    же патчем.
  */
  const androidLag = isVersionOlder(androidVersion, known.android);
  const iosLag = isVersionOlder(iosVersion, known.ios);
  const androidKnown = sameVersion(androidVersion, known.android);
  const iosKnown = sameVersion(iosVersion, known.ios);
  const androidState = platformState({ says: androidSays, knownEqual: androidKnown, lag: androidLag });
  const iosState = platformState({ says: iosSays, knownEqual: iosKnown, lag: iosLag });

  const missing = [];
  if (!androidSays) missing.push('Android');
  if (!iosSays) missing.push('iOS');
  const stale = [];
  if (androidLag) stale.push('Android');
  if (iosLag) stale.push('iOS');

  if (androidState !== 'fresh' && iosState !== 'fresh') {
    return { fields: null, why: settledWhy(androidState, iosState), stale };
  }

  const lines = [];
  if (androidSays && !androidLag) {
    /*
      Текста может и не быть: в новой вёрстке Play раздела с описанием нет
      вовсе. Тогда половина поста — версия и день обновления, и это честный
      ответ, а не пустая строка.
    */
    const androidDate = shortRuDate(android?.at);
    lines.push(`Android${androidVersion ? ` ${androidVersion}` : ''}${androidDate ? `, ${androidDate}` : ''}: ${
      parsed.summary || 'описания изменений магазин не печатает.'}`);
  }
  if (iosSays && !iosLag) {
    const iosDate = shortRuDate(ios?.at);
    lines.push(`iOS${iosVersion ? ` ${iosVersion}` : ''}${iosDate ? `, ${iosDate}` : ''}: ${
      iosText || 'описания изменений магазин не печатает.'}`);
  }

  const summary = lines.join('\n\n').slice(0, L.updateSummaryMax);
  if (summary.length < L.updateSummaryMin) return { fields: null, why: 'Содержание вышло короче 20 знаков.', stale };

  /*
    Площадка, задержавшаяся в прошлой версии, не участвует ни в заголовке, ни
    в бейдже поста: «Android 1.37.01 · iOS 1.36.05» — это слово про кэш
    магазина, а игроку такие номера говорят, что патч вышел заново.
  */
  const tagAndroid = androidLag ? '' : androidVersion;
  const tagIos = iosLag ? '' : iosVersion;

  const title = (parsed.title || `Обновление ${tagAndroid || tagIos}`)
    .slice(0, L.updateTitleMax);
  if (title.length < L.updateTitleMin) return { fields: null, why: 'Заголовок вышел короче 6 знаков.', stale };

  /*
    Дату берём сперва из уже разобранного текста (parseUpdateDate прогоняет её
    через те же границы «не из будущего» и «не раньше 2020», что и база), а
    строка обхода — только запасной путь, когда в тексте даты нет.
  */
  const at = pickLatestDate(
    androidLag ? '' : (android?.at || parsed.sourceAt),
    iosLag ? '' : ios?.at,
    now,
  );
  const versionTag = [tagAndroid && `Android ${tagAndroid}`, tagIos && `iOS ${tagIos}`]
    .filter(Boolean).join(' · ');

  return {
    fields: {
      kind: parsed.kind || 'patch',
      title,
      summary,
      sourceName: 'Google Play и App Store',
      sourceUrl: playUrl,
      sourceAt: at,
      /* База не примет больше 40 знаков; если обе версии не влезли — та, что
         двигает пост, то есть android. */
      gameVersion: versionTag.length <= L.updateVersionMax
        ? versionTag
        : (tagAndroid || tagIos).slice(0, L.updateVersionMax),
    },
    missing,
    stale,
    why: '',
  };
}

/** Номер версии — тот же, что уже опубликован? Регистр буквы не аргумент. */
function sameVersion(candidate, published) {
  const a = String(candidate ?? '').trim();
  const b = String(published ?? '').trim();
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * Порядок двух номеров версии: -1 — принесённая старше, 0 — одинаковые,
 * 1 — новее, NaN — сравнивать нечего.
 *
 * Числа берутся частями, а не строкой: «1.10» рядом с «1.9» по алфавиту
 * оказывается старше, и пост о настоящем обновлении пропал бы молча.
 */
export function versionOrder(candidate, published) {
  const a = versionParts(candidate);
  const b = versionParts(published);
  if (!a || !b) return NaN;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function versionParts(value) {
  const nums = String(value ?? '').match(/\d+/g);
  return nums ? nums.slice(0, 8).map(Number) : null;
}

/** Версия, которую принёс магазин, старше уже опубликованной? */
export function isVersionOlder(candidate, published) {
  return versionOrder(candidate, published) === -1;
}

/** Чем для площадки кончился обход: новым, знакомым, молчанием или задержкой. */
function platformState({ says, knownEqual, lag }) {
  if (lag) return 'lag';
  if (knownEqual) return 'known';
  if (!says) return 'silent';
  return 'fresh';
}

const SETTLED_WORDS = {
  Android: { silent: 'Android молчит', known: 'Android не менялся', lag: 'Android отдал версию старше опубликованной' },
  iOS: { silent: 'iOS ничего не принёс', known: 'iOS не менялся', lag: 'iOS отдал версию старше опубликованной' },
};

/** Почему поста нет — словами, которые читают журнал планировщика и модератор. */
function settledWhy(androidState, iosState) {
  if (androidState === 'silent' && iosState === 'silent') return 'Ни один магазин не ответил за этот обход.';
  if (androidState === 'known' && iosState === 'known') return 'Обе площадки стоят на уже опубликованных версиях.';
  if (androidState === 'lag' && iosState === 'lag') {
    return 'Обе площадки отдали версии старше опубликованных: так отвечает кэш магазинов, поста нет.';
  }
  return `${SETTLED_WORDS.Android[androidState]}, ${SETTLED_WORDS.iOS[iosState]}.`;
}

/*
  Релизные заметки iOS. App Store отдаёт их полем releaseNotes, и у этой игры
  оно почти всегда «Обновление версии» — то есть ничего. Такое поле не надо
  тащить в пост как содержание: страница честно скажет, что текста нет.
*/
export function cleanIosNotes(raw) {
  const text = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  if (text.length < L.updateSummaryMin) return '';
  if (/^(?:обновление версии|версия приложения|version update|app update)[.!?\s]*$/i.test(text)) return '';
  return text.slice(0, L.updateSummaryMax);
}

/**
 * Дата для читателя: «23 сент. 2026 г.» вместо служебного «2026-09-23». В пост
 * она попадает потому, что описания изменений Play в новой вёрстке не печатает,
 * и единственным полезным фактом от Android остаётся день обновления.
 */
export function shortRuDate(field) {
  const s = String(field ?? '').trim();
  if (!s) return '';
  const time = Date.parse(s.length === 10 ? `${s}T12:00` : s);
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(time));
}

/** Более свежая из двух дат; обе строки вида YYYY-MM-DDT12:00 или пустые. */
export function pickLatestDate(a, b, now = Date.now()) {
  const toTime = (s) => (s ? Date.parse(`${s.length === 10 ? `${s}T12:00` : s}`) : NaN);
  const ta = toTime(a);
  const tb = toTime(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) {
    /* Даты нет ни у одной площадки: брать «сейчас» нельзя — заметка с
       сегодняшним днём соврала бы про первоисточник. */
    return '';
  }
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return ta >= tb ? a : b;
}

/**
 * Стадия события относительно «сейчас»: страница по ней расставляет подписи
 * «идёт», «начнётся» и убирает пережитое. Возвращает дни — знаками, а не
 * словами, чтобы разметка выбирала подпись, а не пересказывала арифметику.
 *
 * Дата сюда приходит и строкой из планировщика, и объектом Date из адаптера,
 * поэтому приведение одно на оба случая: Date.parse чужой строке не доверяет,
 * а молча вернул бы NaN, и событие стало бы «unknown» на пустом месте.
 */
export function storeEventPhase(event, now = Date.now()) {
  const start = atTime(event?.startsAt);
  const end = atTime(event?.endsAt);
  if (Number.isNaN(start)) return { phase: 'unknown', days: null };
  if (!Number.isNaN(end) && end < now) {
    return { phase: 'ended', days: Math.round((now - end) / 86400000) };
  }
  if (start > now) return { phase: 'soon', days: Math.round((start - now) / 86400000) };
  return { phase: 'live', days: !Number.isNaN(end) ? Math.round((end - now) / 86400000) : null };
}

/** Миллисекунды из Date, числа или строки; у пустоты — NaN. */
function atTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const s = String(value ?? '').trim();
  if (!s) return NaN;
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t;
}

/*
  Что показать в блоке: живые и будущие события, а пережившие — только те, что
  закончились меньше storeEventHideAfterDays назад (модератору виден архив, и
  игроку полезно сутки видеть, что событие только что кончилось).
*/
export function pickStoreEvents(events, now = Date.now()) {
  const list = Array.isArray(events) ? events : [];
  return list
    .map((e) => ({ ...e, ...storeEventPhase(e, now) }))
    .filter((e) => !(e.phase === 'ended' && e.days > L.storeEventHideAfterDays))
    .sort((a, b) => atTime(a.startsAt) - atTime(b.startsAt))
    .slice(0, L.storeEventListMax);
}

/** Название первоисточника по той же таблице доменов, что и у формы. */
export function storeSourceName(link) {
  return updateSourceFromLink(link);
}
