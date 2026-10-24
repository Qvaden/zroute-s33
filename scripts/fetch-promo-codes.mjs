/**
 * СБОР ПРОМОКОДОВ С ОТКРЫТЫХ СТРАНИЦ.
 *
 * Запускается воркфлоу раз в сутки и обновляет promocodes.json. Страница сайта
 * читает этот файл и не ходит наружу: браузер посетителя не пустит запрос к
 * чужому сайту, а если бы и пустил — чужой текст попал бы на сайт без проверки.
 *
 * ЧТО ЧИТАЕМ И ПОЧЕМУ.
 *
 * games-instel.ru отдаёт готовые карточки: код, награды, дату добавления и
 * список устаревших кодов. zrouteguide.com отдаёт строки с отметкой Active или
 * Ended. Вместе они дают и свежие коды, и выбывшие, поэтому страница честно
 * показывает две группы, а не только «работает».
 *
 * ВКонтакте не читаем: коды там появляются в постах нерегулярно, а публичная
 * страница без входа отдаёт пустую оболочку. Разбор такой ленты ломался бы
 * молча и приносил бы больше шума, чем кодов.
 *
 * ЧЕГО НЕ ДЕЛАЕМ ПРИ СБОЕ. Если источник не ответил, его молчание не считается
 * доказательством, что коды перестали работать: список не переписывается
 * целиком, а прежние отметки остаются. Пустой файл вместо рабочего хуже
 * устаревшего: страница останется с кодами, а не с извинением.
 *
 * Запуск: node scripts/fetch-promo-codes.mjs [файл]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const GAMES_URL = 'https://games-instel.ru/codes/z-route-redemption/';
export const GUIDE_URL = 'https://zrouteguide.com/codes/';

const ACTIVE = 'active';
const INACTIVE = 'inactive';

/** Сущности в чужой разметке — часть текста награды, а не украшение. */
function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#039;/gi, "'")
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&amp;/gi, '&');
}

function plainText(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Код в списке — только заглавные латинские буквы и цифры. */
export function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Дата приводится к одному виду: и «18.10.2026», и ISO. */
export function normalizeDate(value) {
  const text = String(value ?? '').trim();
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (dotted) return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : '';
}

function firstMatch(text, re) {
  const match = re.exec(text);
  return match ? match[1] : '';
}

/**
 * Разбор games-instel.ru.
 *
 * Карточка рабочего кода и карточка устаревшего устроены по-разному, поэтому
 * это два обхода: смешивать их в одном выражении значило бы потерять причину
 * «срок истёк» и вместе с ней весь список выбывших.
 */
export function parseGamesInstel(html) {
  const active = [];
  const inactive = [];
  const marker = '<div class="promocode">';
  const chunks = String(html ?? '').split(marker).slice(1);

  for (const chunk of chunks) {
    const code = normalizeCode(firstMatch(chunk, /data-code="([^"]+)"/));
    if (!code) continue;
    const added = normalizeDate(firstMatch(chunk, /data-added="([^"]+)"/));
    const rewards = plainText(firstMatch(chunk, /<div class="promocode-description">([\s\S]*?)<\/div>/));
    const statusClass = firstMatch(chunk, /class="promocode-expires ([^"]*)"/);
    const expired = /status-(?:expired|ended|inactive)|expired/.test(statusClass);
    const entry = { code, date: added, rewards };
    (expired ? inactive : active).push(entry);
  }

  /*
    Устаревшие коды лежат отдельными карточками и без наград: у них остаётся
    только код и причина. Дату не выдумываем — её у источника здесь нет.
  */
  for (const match of String(html ?? '').matchAll(/<div class="expired-card__code">([\s\S]*?)<\/div>/g)) {
    const code = normalizeCode(plainText(match[1]));
    if (code) inactive.push({ code, date: '', rewards: '' });
  }

  return { active, inactive };
}

/**
 * Разбор zrouteguide.com.
 *
 * Основной путь — строки списка: у каждой есть код и значок Active/Ended.
 * Запасной — разметка для поисковика (JSON-LD): она перечисляет только
 * рабочие коды. Запасной нужен на случай, когда строки сверстали иначе,
 * но и без него страница не останется без ответа.
 */
export function parseZrouteGuide(html) {
  const text = String(html ?? '');
  const active = [];
  const inactive = [];
  const seen = new Set();

  for (const match of text.matchAll(/<li class="zr-code-row">([\s\S]*?)<\/li>/g)) {
    const row = match[1];
    const code = normalizeCode(plainText(firstMatch(row, /<code[^>]*>([\s\S]*?)<\/code>/)));
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const entry = { code, date: '', rewards: '' };
    if (/zr-badge--active/.test(row)) active.push(entry);
    else inactive.push(entry);
  }

  if (!active.length && !inactive.length) {
    for (const match of text.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      let data = null;
      try {
        data = JSON.parse(match[1]);
      } catch {
        continue;
      }
      const list = data?.mainEntity?.itemListElement;
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const code = normalizeCode(item?.name);
        if (!code || seen.has(code)) continue;
        seen.add(code);
        active.push({ code, date: '', rewards: '' });
      }
    }
  }

  return { active, inactive };
}

function cleanEntry(item) {
  const code = normalizeCode(item?.code);
  if (!code) return null;
  return {
    code,
    status: item?.status === ACTIVE ? ACTIVE : INACTIVE,
    date: normalizeDate(item?.date),
    rewards: String(item?.rewards ?? '').trim(),
  };
}

/**
 * Слияние находок с прежним списком.
 *
 * Правила простые и выбраны по цене ошибки:
 *   — рабочий код сильнее выбывшего: если один источник ещё считает код
 *     рабочим, человек увидит его в верхней группе;
 *   — награды и дату не теряем: источник, который их не назвал, не стирает
 *     то, что уже было известно;
 *   — если хоть один источник не ответил, пропавшие из списка коды остаются
 *     с прежней отметкой. Иначе сбой сети за одну ночь объявил бы выбывшими
 *     все коды, которых просто не было в ответе.
 */
export function mergeCodes({ previous = [], active = [], inactive = [], sourcesOk = true, today = '' } = {}) {
  const seen = new Map();
  const remember = (entry, status) => {
    const old = seen.get(entry.code);
    seen.set(entry.code, {
      code: entry.code,
      // Рабочая отметка сильнее выбывшей, а награды и дату собираем со всех
      // источников: второй сайт часто называет только код.
      status: status === ACTIVE ? ACTIVE : old?.status ?? INACTIVE,
      date: entry.date || old?.date || '',
      rewards: entry.rewards || old?.rewards || '',
    });
  };
  for (const item of inactive) {
    const entry = cleanEntry({ ...item, status: INACTIVE });
    if (entry) remember(entry, INACTIVE);
  }
  for (const item of active) {
    const entry = cleanEntry({ ...item, status: ACTIVE });
    if (entry) remember(entry, ACTIVE);
  }

  const result = new Map();
  for (const item of previous) {
    const entry = cleanEntry(item);
    if (entry) result.set(entry.code, entry);
  }

  for (const [code, entry] of seen) {
    const old = result.get(code);
    result.set(code, {
      code,
      status: entry.status,
      date: entry.date || old?.date || today,
      rewards: entry.rewards || old?.rewards || '',
    });
  }

  if (sourcesOk) {
    for (const entry of result.values()) {
      if (!seen.has(entry.code)) entry.status = INACTIVE;
    }
  }

  return [...result.values()].sort((a, b) => (a.status === b.status
    ? a.code.localeCompare(b.code)
    : a.status === ACTIVE ? -1 : 1));
}

export function buildSnapshot(codes, updated) {
  const active = codes.filter((item) => item.status === ACTIVE).length;
  return {
    updated: updated.toISOString(),
    total: codes.length,
    active,
    inactive: codes.length - active,
    codes,
  };
}

function readPrevious(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.codes) ? data.codes : [];
  return list.map(cleanEntry).filter(Boolean);
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; zroute-s33 promo codes)',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const outFile = process.argv[2] || 'promocodes.json';
  let previous = [];
  try {
    previous = readPrevious(JSON.parse(await readFile(outFile, 'utf8')));
  } catch {
    previous = [];
  }

  const sources = [
    { name: 'games-instel.ru', parse: parseGamesInstel, url: GAMES_URL },
    { name: 'zrouteguide.com', parse: parseZrouteGuide, url: GUIDE_URL },
  ];

  const active = [];
  const inactive = [];
  const failed = [];
  for (const source of sources) {
    try {
      const parsed = source.parse(await fetchHtml(source.url));
      active.push(...parsed.active);
      inactive.push(...parsed.inactive);
    } catch (error) {
      failed.push(source.name);
      console.error(`Источник ${source.name} не ответил: ${error?.message ?? error}`);
    }
  }

  if (failed.length === sources.length) {
    console.error('Ни один источник не ответил — файл не тронут.');
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const codes = mergeCodes({
    previous,
    active,
    inactive,
    sourcesOk: failed.length === 0,
    today,
  });
  const snapshot = buildSnapshot(codes, new Date());
  await writeFile(outFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`Готово: ${snapshot.total} кодов, ${snapshot.active} рабочих, ${snapshot.inactive} выбывших.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
