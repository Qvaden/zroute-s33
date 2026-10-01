/**
 * Игровой фид: приносит из магазинов то же, что модератор вводит руками, —
 * текст обновления и события.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ. Страница посетителя не имеет права ходиться в чужие
 * сайты: браузер не пустит (same-origin), а пусти — чужой текст попал бы на
 * сайт без проверки. Поэтому читает магазины планировщик GitHub Actions, а
 * сюда приходят за разбором и за границами, которые знает база.
 *
 * РЕЖИМЫ. По умолчанию скрипт сухой: он ничего не пишет и печатает в журнал
 * всё, что нашёл, — включая кусок вёрстки вокруг нужного блока. Это не
 * аккуратность, а рабочий инструмент: первый запуск на живой странице
 * показывает, видит ли разбор то, что видит человек, и чинится по журналу, а
 * не по догадке. Писать начинает только с флагом --писать и только когда есть
 * учётные данные бота.
 *
 * КЕМ ПИШЕТ. Обычным входом по нику и паролю, как любой игрок. Служебный
 * ключ, обходящий правила доступа, в проекте не появляется: права бота ровно
 * те, которые ему выдала модерация, и отзываются тем же списком игроков.
 *
 * Запуск:
 *   node scripts/store-feed.mjs              — сухо: показать найденное
 *   node scripts/store-feed.mjs --писать     — то же и запись в базу
 *
 * Переменные окружения для записи: STORE_FEED_NICK, STORE_FEED_PASSWORD.
 */
import { CONFIG } from '../config.js';
import { nickToEmail } from '../src/forum/nick-email.js';
import {
  readPlayPage, playPageUrl, itunesLookupUrl, composeStoreNote, toStoreIso,
  htmlToText, extractEventPage, STORE_SECTION_HEADS,
} from '../src/forum/feed.js';

const APPLY = process.argv.includes('--писать') || process.argv.includes('--apply');
const NICK = process.env.STORE_FEED_NICK || '';
const PASSWORD = process.env.STORE_FEED_PASSWORD || '';
const CFG = CONFIG.supabase ?? CONFIG.forum?.supabase ?? {};
const STORE = CONFIG.forum.store || {};

/** Корень проекта: из config приходит уже с хвостом /rest/v1, его срезаем. */
const ROOT = String(CFG.url || '').replace(/\/(rest|auth|storage)\/v1\/?$/, '').replace(/\/+$/, '');

function say(...args) {
  console.log(...args);
}

/** Разделитель в журнал: отчёт сухого прогона читают глазами по диагонали. */
function head(title) {
  say(`\n── ${title} ${'─'.repeat(Math.max(0, 64 - title.length))}`);
}

/** Запрос к нашей базе: адрес и публичный ключ берутся из config.js. */
async function rest(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${ROOT}/rest/v1${path}`, {
    method,
    headers: {
      apikey: CFG.anonKey,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Чужий сайт просим без нашего ключа в заголовках: apikey туда не обязан
 * уезжать. Язык просим русский — у описаний и дат региональная привязка есть,
 * и без заголовка магазин вправе вернуть английский.
 */
async function fetchExternal(url, wantJson = false) {
  const res = await fetch(url, {
    headers: {
      'Accept-Language': `${STORE.country || 'ru'},ru;q=0.9,en;q=0.5`,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(20000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return wantJson ? res.json() : res.text();
}

/*
  Что печатать в журнале, когда разбор не нашёл блок. Один заголовок был бы
  догадкой: страница Play отвечает 1,2 МБ вёрстки, и по одному куску человек,
  правящий разборщик, не понимает, где живёт нужное. Поэтому обходим все
  заголовки, которые на странице нашлись, и печатаем по щепотке вокруг каждого.
*/
const DEBUG_HEADS = ['Последнее обновление', 'События и предложения', 'Доступно обновление'];

/** Срез СЫРОГО ответа вокруг строки: атрибуты и JSON-вложения видны только там. */
function rawAround(html, needle, span = 700) {
  const at = String(html ?? '').indexOf(needle);
  if (at < 0) return `(«${needle}» в сыром ответе нет)`;
  return String(html).slice(Math.max(0, at - span), at + span);
}

/*
  Кусок вёрстки вокруг заголовка — по нему правятся границы раздела.

  Ищем дважды: сначала в сыром ответе, потом в вычищенном тексте. Разница между
  двумя ответами и есть диагноз: если в HTML строка есть, а в тексте её нет,
  содержимое лежит внутри `<script>` или атрибута — htmlToText его выбрасывает,
  и править надо способ извлечения, а не заголовок. Если нет нигде — страница
  пришла не та (заглушка, капча, другой язык).
*/
function around(html, needle) {
  const text = htmlToText(html);
  const inText = text.indexOf(needle);
  if (inText >= 0) return text.slice(Math.max(0, inText - 60), inText + 1600);
  const inRaw = String(html ?? '').indexOf(needle);
  if (inRaw >= 0) {
    return `(в тексте нет, в сыром ответе есть на ${inRaw} знаке — лежит внутри скрипта или атрибута)\n`
      + String(html).slice(Math.max(0, inRaw - 150), inRaw + 400);
  }
  return '(нет ни в тексте, ни в сыром ответе)';
}

/** Заголовок ответа: по нему видно, что пришло — приложение, заглушка или капча. */
function pageTitle(html) {
  const m = /<title[^>]*>([^<]{0,160})/i.exec(String(html ?? ''));
  return m ? m[1].trim() : '(заголовка нет)';
}

/*
  Какие заголовки раздела носитель страницы вообще содержит. Печатается только
  при отказе разбора и отвечает на главный вопрос журнала: магазин переписал
  вёрстку (заголовки есть, но другие), страница пришла не та (заголовков нет
  вовсе) или текст спрятан в скрипте (в HTML есть, в тексте нет).
*/
function headsAudit(html) {
  const text = htmlToText(html);
  const raw = String(html ?? '');
  const found = STORE_SECTION_HEADS.filter((h) => raw.includes(h));
  return `заголовки на странице: ${
    found.length
      ? found.map((h) => `${h} (${text.includes(`\n${h}\n`) ? 'как строка' : 'только в коде'})`).join(', ')
      : 'ни одного знакомого'
  }`;
}

/* ── Что уже опубликовано ──────────────────────────────────────────────────── */

async function knownVersions() {
  try {
    const rows = await rest('/forum_store_status?select=*');
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { android: '', ios: '', why: 'миграция 20260930-store-feed.sql ещё не прогнана' };
    return {
      android: row.android_version || '',
      ios: row.ios_version || '',
      lastRunAt: row.last_run_at || '',
      lastText: row.last_run_text || '',
    };
  } catch (e) {
    return { android: '', ios: '', why: `состояние не прочитано: ${e.message}` };
  }
}

/* ── Основной путь ─────────────────────────────────────────────────────────── */

async function main() {
  if (!ROOT || !CFG.anonKey) {
    say('В config.js нет боевого адреса Supabase — идти в магазины не за чем.');
    process.exit(1);
  }

  const play = playPageUrl(STORE);
  const lookup = itunesLookupUrl(STORE);

  /*
    Площадки читаются параллельно и независимо: отказ одной не имеет права
    отменить обход другой. Молчавшую половину пост собирает без неё — иначе
    сорванная сеть до магазина превращалась бы в заметку о том, что у нас
    сорвана сеть.
  */
  const [playRes, iosRes] = await Promise.allSettled([
    fetchExternal(play),
    fetchExternal(lookup, true),
  ]);

  const android = playRes.status === 'fulfilled'
    ? readPlayPage(playRes.value)
    : { how: 'no-page', text: '', title: '', summary: '', kind: '', gameVersion: '', at: '', sourceAt: '', dateLine: '', events: { events: [], how: 'no-page' } };
  if (android.how === 'no-page' && playRes.status === 'fulfilled') {
    android.debug = `${headsAudit(playRes.value)}\n\n`
      + DEBUG_HEADS.map((h) => `〔 ${h} 〕\n${around(playRes.value, h)}`).join('\n\n')
      + `\n\n〔 сырой HTML вокруг «События и предложения» 〕\n${rawAround(playRes.value, 'События и предложения')}`;
    android.pageTitle = pageTitle(playRes.value);
    android.bytes = playRes.value.length;
  }

  /*
    В базу едет только событие с начальной датой: столбец starts_at обязателен
    самой базой, а придумывать «сегодня» из надписи «идёт сейчас» — значит
    опубликовать событие, которое кончится вчера. Бездаточные названы в отчёте.

    Описание берём со страницы самого события: карточка на странице приложения
    только называет событие, а что в нём — пишет его собственная страница. Идём
    за ней лишь за теми карточками, которые имеем право опубликовать; название
    остаётся карточное — страница события печатает его в заголовке ответа, и
    подстановка дала бы второй пересказ одного и того же.
  */
  const dated = [];
  for (const event of (android.events?.events || []).filter((e) => e.startsAt)) {
    const filled = { ...event };
    if (event.sourceUrl) {
      try {
        filled.summary = extractEventPage(await fetchExternal(event.sourceUrl)).summary;
      } catch (e) {
        say(`Описание события «${event.title}» не пришло: ${e.message}`);
      }
    }
    dated.push(filled);
  }
  const undated = (android.events?.events || []).filter((e) => !e.startsAt);

  const iosRow = iosRes.status === 'fulfilled' ? (iosRes.value?.results || [])[0] || null : null;
  const ios = {
    version: iosRow?.version || '',
    releaseNotes: iosRow?.releaseNotes || '',
    at: String(iosRow?.currentVersionReleaseDate || '').slice(0, 10),
    error: iosRes.status === 'rejected' ? iosRes.reason.message : '',
  };

  const known = await knownVersions();
  const note = composeStoreNote({ android, ios, known });

  const wrote = APPLY ? await apply({ note, dated, android, ios }) : '';
  report({ android, ios, known, note, dated, undated, wrote });

  if (APPLY && note.fields && !wrote.includes('заметка')) process.exit(1);
}

/* ── Отчёт ─────────────────────────────────────────────────────────────────── */

function report({ android, ios, known, note, dated, undated, wrote }) {
  head('Android — страница Google Play');
  if (android.bytes) {
    say(`пришло: ${android.bytes} знаков, заголовок ответа: ${android.pageTitle}`);
  }
  say(`как нашли: ${android.how}; знаков в блоке: ${android.text.length}`);
  say(`заголовок: ${android.title || '— не найден —'}`);
  say(`версия: ${android.gameVersion || '—'}; строка даты: ${android.dateLine || '—'}; дата поля: ${android.at || '—'}`);
  say(`содержание: ${(android.summary || '—').slice(0, 400)}`);
  if (android.how === 'no-page') {
    say('⚠ страница не разобрана — вот вёрстка вокруг заголовков, по которой это чинят:');
    say(android.debug || '');
  }

  head('iOS — официальный JSON App Store');
  say(`версия: ${ios.version || '—'}; дата: ${ios.at || '—'}`);
  say(`текст релиза: ${ios.releaseNotes ? ios.releaseNotes.slice(0, 300) : '— пустой —'}`);
  if (ios.error) say(`⚠ App Store не ответил: ${ios.error}`);

  head('Что уже знает база');
  say(`опубликовано: Android ${known.android || '—'}, iOS ${known.ios || '—'}`);
  if (known.lastRunAt) say(`последний обход: ${known.lastRunAt} — ${known.lastText}`);
  else say('последнего обхода ещё не было: состояние заведено миграцией, автомат молчал');
  if (known.why) say(`оговорка: ${known.why}`);

  head('Пост на обе площадки');
  if (note.missing?.length) say(`без ответа: ${note.missing.join(', ')} — в пост эта половина не попадёт`);
  if (note.stale?.length) {
    say(`задержка магазина: ${note.stale.join(', ')} ${note.stale.length > 1 ? 'отдали' : 'отдал'} версию старше `
      + 'опубликованной — отставшая половина не попадёт в пост и не запишется в состояние');
  }
  if (note.fields) {
    say(`${APPLY ? 'публикуем' : 'опубликуем (сухой прогон)'}: [${note.fields.kind}] ${note.fields.title}`);
    say(note.fields.summary);
    say(`версия: ${note.fields.gameVersion}; дата: ${note.fields.sourceAt || '—'}`);
  } else {
    say(`не пишем: ${note.why}`);
  }

  head('События со страницы');
  say(`разобрано карточек: ${(android.events?.events || []).length} (способ: ${android.events?.how})`);
  for (const e of dated) {
    say(`· ${e.title}${e.label ? ` [${e.label}]` : ''} → с ${e.startsAt}${e.endsAt ? ` до ${e.endsAt}` : ''}`);
    say(`  ссылка: ${e.sourceUrl || '—'}; описания: ${e.summary ? `${e.summary.length} знаков` : 'нет'}`);
  }
  for (const e of undated) say(`· ${e.title} → даты нет, в базу не идёт`);
  if (wrote) say(`\nзаписано: ${wrote}`);
  if (!APPLY) say('\nРЕЖИМ СУХОЙ: в базу не написано ни строки. Флаг --писать включает запись.');
}

/* ── Запись ────────────────────────────────────────────────────────────────── */

async function apply({ note, dated, android, ios }) {
  if (!NICK || !PASSWORD) {
    say('Нет STORE_FEED_NICK или STORE_FEED_PASSWORD — в базу не пишем.');
    return '';
  }

  let token = '';
  try {
    const session = await login();
    token = session?.access_token || '';
    if (!token) throw new Error('система входа не вернула токен');
  } catch (e) {
    say(`Бот не вошёл: ${e.message}`);
    return '';
  }

  const parts = [];

  if (note.fields) {
    try {
      const id = await rest('/rpc/forum_publish_update_note', {
        method: 'POST',
        token,
        body: {
          p_kind: note.fields.kind,
          p_title: note.fields.title,
          p_summary: note.fields.summary,
          p_source_name: note.fields.sourceName,
          p_source_url: note.fields.sourceUrl,
          p_source_at: toStoreIso(note.fields.sourceAt) || new Date().toISOString(),
          p_game_version: note.fields.gameVersion,
        },
      });
      note.publishedId = typeof id === 'string' ? id : '';
      parts.push(`заметка ${note.publishedId || id}`);
    } catch (e) {
      say(`База не приняла заметку: ${e.message}`);
    }
  }

  for (const event of dated) {
    try {
      const answer = await rest('/rpc/forum_record_store_event', {
        method: 'POST',
        token,
        body: {
          p_feed_key: event.feedKey,
          p_title: event.title,
          p_summary: event.summary || '',
          p_platform: 'android',
          p_starts_at: toStoreIso(event.startsAt),
          p_ends_at: event.endsAt ? toStoreIso(event.endsAt) : null,
          p_source_url: event.sourceUrl || '',
        },
      });
      parts.push(`событие «${event.title}»: ${answer}`);
    } catch (e) {
      say(`База не приняла событие «${event.title}»: ${e.message}`);
    }
  }

  /*
    Отчёт пишется дважды — по одному разу на площадку: у каждой свой номер
    версии и своя дата, а состояние обхода одно. Порядок важнее экономии
    запроса: сначала Android, потом iOS, чтобы в состоянии последней оказалась
    фраза, которую читает страница.

    Площадка, задержавшаяся в прошлой версии, отчёту отдаёт пустую строку и
    пустую дату: база сохраняет прежнее значение, когда версия не принесена.
    Иначе состояние само скатилось бы назад, и следующий обход опубликовал бы
    тот же патч заново — именно так 30 сентября вышло три карточки вместо двух.
  */
  const lagged = note.stale || [];
  const said = (platform, version, at) => (lagged.includes(platform) ? ['', null] : [version, at]);
  const [androidRun, androidAt] = said('Android', android.gameVersion || '', toStoreIso(android.at) || null);
  const [iosRun, iosAt] = said('iOS', ios.version || '', toStoreIso(ios.at) || null);
  const runs = [
    ['android', androidRun, androidAt],
    ['ios', iosRun, iosAt],
  ];
  for (const [platform, version, at] of runs) {
    try {
      await rest('/rpc/forum_mark_store_run', {
        method: 'POST',
        token,
        body: {
          p_platform: platform,
          p_version: version,
          p_at: at,
          p_text: summarizeRun(note),
          p_note_id: note.publishedId || null,
        },
      });
    } catch (e) {
      say(`Отчёт об обходе не записан (${platform}): ${e.message}`);
    }
  }

  return parts.join('; ') || 'ничего нового';
}

async function login() {
  const res = await fetch(`${ROOT}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: CFG.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: nickToEmail(NICK, CFG.nickDomain), password: PASSWORD }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** Коротко и по-русски: что запуск принёс. Это увидит модератор на странице. */
function summarizeRun(note) {
  /*
    Молчание магазина — новость для модерации, а не для читателей: в состоянии
    обхода оно названо, чтобы через неделю не выяснилось, что «автомат молчит,
    потому что сломан».
  */
  const gone = note.missing?.length ? `; без ответа осталась ${note.missing.join(' и ')}` : '';
  /*
    Задержка магазина — часть итога запуска, а не его отказ: модератор обязан
    видеть, что половина поста не написана потому, что площадка вернулась в
    прошлую версию. Иначе через неделю «iOS молчит» выглядит как поломка
    автомата.
  */
  const lag = note.stale?.length
    ? `; ${note.stale.join(' и ')} ${note.stale.length > 1 ? 'отдали' : 'отдал'} версию старше опубликованной (задержка магазина)`
    : '';
  if (note.fields) return `опубликовано обновление ${note.fields.gameVersion}${gone}${lag}`.trim();
  return `${note.why || 'нового нет'}${gone}`;
}

main().catch((e) => {
  say(`Запуск прерван: ${e.message}`);
  process.exit(1);
});
