/**
 * Игровой фид: приносит из магазинов и из официальной группы ВК то же, что
 * модератор вводит руками, — текст обновления и события.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ. Страница посетителя не имеет права ходиться в чужие
 * сайты: браузер не пустит (same-origin), а пусти — чужой текст попал бы на
 * сайт без проверки. Поэтому читает магазины планировщик GitHub Actions, а
 * сюда приходят за разбором и за границами, которые знает база.
 *
 * ПОЧЕМУ ВК НАРАВНЕ С МАГАЗИНАМИ. С осени 2026 года страница Google Play не
 * отдаёт в HTML ни раздела «Что нового», ни блока событий, а App Store на
 * свежий патч отвечает строкой «Исправлены ошибки.», которая короче нижнего
 * порога заметки. Список изменений разработчики по-прежнему печатают словами
 * только в своём сообществе, и оно читается так же открыто, как страница
 * магазина. Молчание двух магазинов при живом третьем источнике — это не
 * «разработчики ничего не сделали», а наш пропуск, и выглядит оно ровно так же
 * тихо.
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
import { pickVkNotes, vkWallUrl, decodeVkBytes } from '../src/forum/vk-feed.js';

const APPLY = process.argv.includes('--писать') || process.argv.includes('--apply');
/*
  Только зеркало: проверить запасную дверь, не дожидаясь, пока основная
  сломается. Нужна для живой проверки с машины, откуда ВК видит стену.
*/
const ONLY_MIRROR = process.argv.includes('--только-зеркало');
const NICK = process.env.STORE_FEED_NICK || '';
const PASSWORD = process.env.STORE_FEED_PASSWORD || '';
const CFG = CONFIG.supabase ?? CONFIG.forum?.supabase ?? {};
const STORE = CONFIG.forum.store || {};
const VK = STORE.vk || {};

/*
  Запасная дверь для стены группы.

  ВК не отдаёт стену серверам GitHub Actions: ответ приходит, но без единого
  поста, и автомат читает это как «разработчики молчат». Замер 05.10.2026:
  адрес `wall-236547214?own=1` отдаёт с машины в России 2,2 млн знаков и 20
  записей, а из чужого дата-центра — пустую обёртку навигации. Пока второй
  голос фида нужен, его читают через публичный ридер: он приносит тот же
  HTML, но со своей сетью на выходе.

  Порядок важнее экономии: сначала напрямую, зеркало — только когда прямой
  ответ не стена вовсе («no-page», «login») или не ответил. Стена с нулём
  постов — это настоящая тишина разработчиков, и подменять её зеркалом
  нельзя: автомат начал бы прятать отсутствие новостей за чужим адресом.

  Ридер отвечает в UTF-8, группа — в windows-1251, поэтому кодировку зеркал
  определяют по содержимому, а не по имени источника (см. `decodeVkAuto`).
*/
const VK_MIRRORS = [
  {
    name: 'ридер r.jina.ai',
    url: (target) => `https://r.jina.ai/${target}`,
    /*
      Чужой заголовок User-Agent ридеру не отдают: под браузер он отвечает
      страницей «Just a moment...» и кодом 403. Просим как есть — автомат,
      читающий одну публичную страницу раз в час.
    */
    headers: { 'X-Return-Format': 'html', 'User-Agent': 'zroute-s33-store-feed/1.0' },
  },
];

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
 *
 * Режим 'bytes' нужен одному источнику: группа ВК отвечает windows-1251, а
 * `res.text()` читает тело как UTF-8 и превращает русскую букву в две
 * латинские с диакритикой. Байты отдаются как есть, а кодировку знает тот, кто
 * её выбирал (см. `decodeVkBytes`).
 */
async function fetchExternal(url, want = 'text', extraHeaders = null) {
  const res = await fetch(url, {
    headers: {
      'Accept-Language': `${STORE.country || 'ru'},ru;q=0.9,en;q=0.5`,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      ...(extraHeaders || {}),
    },
    signal: AbortSignal.timeout(20000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  if (want === 'json') return res.json();
  if (want === 'bytes') return new Uint8Array(await res.arrayBuffer());
  return res.text();
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

/*
  Ключи заметок, которые автомат уже приносил. Спрашиваются у таблицы отметок,
  а не у списка заметок: у записей ВК номера версии нет, опознать их больше нечем,
  и главное — удалённая заметка уносит с собой свою строку, а отметка остаётся.
  Иначе «убрано насовсем» означало бы «вернётся через час».

  Пустой список при отказе — не пустота: без отметок каждый обход заново
  нёс бы все посты окна. Поэтому отказ называется и попадает в отчёт запуска,
  а публикации за этот раз не будет.
*/
async function knownNoteKeys() {
  try {
    const rows = await rest('/forum_feed_marks?select=feed_key&what=eq.note');
    const keys = (Array.isArray(rows) ? rows : []).map((r) => r.feed_key);
    return { keys, count: keys.length, why: '' };
  } catch (e) {
    return { keys: [], count: 0, why: `отметки фида не прочитаны: ${e.message}` };
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
    Источники читаются параллельно и независимо: отказ одного не имеет права
    отменить обход другого. Молчавшую половину пост собирает без неё — иначе
    сорванная сеть до магазина превращалась бы в заметку о том, что у нас
    сорвана сеть.
  */
  const [playRes, iosRes, vkRes] = await Promise.allSettled([
    fetchExternal(play),
    fetchExternal(lookup, 'json'),
    VK.group && !ONLY_MIRROR
      ? fetchExternal(vkWallUrl(VK), 'bytes')
      : Promise.reject(new Error(ONLY_MIRROR ? 'прямой запрос к ВК пропущен флагом' : 'в config.js нет номера группы')),
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

  /*
    Группа читается после того, как получены отметки: без списка «что уже
    приносили» разбор не имеет права называть пост новым. Отказ чтения отметок
    не останавливает обход — он останавливает публикацию, и в отчёте это две
    разные фразы.
  */
  const [known, marks] = await Promise.all([knownVersions(), knownNoteKeys()]);
  const vk = await readVk(vkRes, marks.keys);
  const note = composeStoreNote({ android, ios, known });

  const wrote = APPLY ? await apply({ note, dated, android, ios, vk }) : '';
  report({ android, ios, known, marks, note, dated, undated, vk, wrote });

  /*
    Успехом запуска считается не «пост написан», а «разборщик жив». Отсюда два
    разных выхода: заметка собрана, но база её не приняла, — провал; стена не
    прочитана ни одним источником — тоже провал, и громкий, потому что
    молчание ВК при молчаливых магазинах означает, что у фида не осталось ни
    одного голоса, а выглядит это как «разработчики две недели ничего не
    делали». Провал наступает после всех источников: `readVk` сам перебирает
    зеркала, и красный прогон значит теперь, что не дал ни один из них — или
    дал такое, из чего нельзя ничего собрать.
  */
  if (APPLY && note.fields && !wrote.includes('заметка')) process.exit(1);
  if (!vkReadable(vk)) process.exit(1);
}

/*
  Что дала стена группы: список заметок и диагноз, если списка нет. «no-page»
  и «login» — поломка на нашей стороне или закрытая группа; «no-posts» — стена
  живая, но записей сообщества на ней нет; «ok» — разбор увидел посты, и
  сколько из них годится в заметки, видно по skipped.

  Чтение идёт по списку источников: сначала сама группа, потом зеркала, и
  результат каждой попытки описывает одним и тем же словом `via`, чтобы в
  отчёте обхода было видно, чей именно ответ лёг в список.
*/

/**
  Кодировка по содержимому, а не по имени источника.

  Группа отвечает в windows-1251, ридер пересобирает страницу в UTF-8, и
  ошибиться здесь дорого: русский текст превращается в латиницу с
  диакритикой, таблицу публикуемого ни один пост не проходит, а в списке
  висит фраза «разработчики молчат». Признак дешёвый и точный: настоящие
  UTF-8-байты читаются как UTF-8, а windows-1251 с кириллицей — нет.
*/
function decodeVkAuto(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return decodeVkBytes(bytes);
  }
}

/**
 * Стена прочитана, если разбор видит её целиком: пустая страница — не тишина.
 *
 * Для зеркала правило строже, чем для самой группы. Живой ВК отвечает по
 * атрибутам, и «блоков стены полно, а подписанных группой среди них нет» —
 * это настоящая тишина разработчиков. Перерисованный ответ с нулём постов так
 * сказать не может: там пустота одинаково значит и «группа молчала неделю», и
 * «читалка вернула огрызок». Выдавать огрызок за тишину значило бы замолчать
 * насовсем, поэтому зеркало принимается только с хотя бы одной записью.
 */
function vkReadable(vk) {
  if (vk.how === 'ok') return true;
  return vk.via === 'vk.com' && vk.how === 'no-posts';
}

function vkNoPageDebug(address, html) {
  return `адрес: ${address}\n`
    + `первые 400 знаков ответа: ${html.slice(0, 400)}\n`
    + `разметка постов: ${/id="post-\d+_\d+"/.test(html) ? 'есть' : 'нет'};`
    + ` кириллица в ответе: ${/[а-яёА-ЯЁ]/.test(html) ? 'есть' : 'нет — похоже на сбой кодировки'}`;
}

/** Ответ уже начатого прямого запроса — в той же форме, что и попытка зеркала. */
function vkFromResponse(res, knownKeys) {
  if (res.status === 'rejected') {
    return {
      notes: [], written: [], how: 'no-page', total: 0, skipped: {},
      error: res.reason.message, via: 'vk.com',
    };
  }
  const html = decodeVkBytes(res.value);
  const picked = pickVkNotes(html, { known: knownKeys, cfg: VK });
  const vk = { ...picked, written: [], bytes: html.length, pageTitle: pageTitle(html), via: 'vk.com' };
  if (picked.how === 'no-page') vk.debug = vkNoPageDebug(vkWallUrl(VK), html);
  return vk;
}

async function vkFromMirror(mirror, knownKeys) {
  const address = mirror.url(vkWallUrl(VK));
  let html = '';
  try {
    html = decodeVkAuto(await fetchExternal(address, 'bytes', mirror.headers));
  } catch (e) {
    return {
      notes: [], written: [], how: 'no-page', total: 0, skipped: {},
      error: `${mirror.name}: ${e.message}`, via: mirror.name,
    };
  }
  const picked = pickVkNotes(html, { known: knownKeys, cfg: VK });
  const vk = { ...picked, written: [], bytes: html.length, pageTitle: pageTitle(html), via: mirror.name };
  if (picked.how === 'no-page') vk.debug = vkNoPageDebug(address, html);
  return vk;
}

async function readVk(res, knownKeys) {
  const attempts = [];
  if (!ONLY_MIRROR) attempts.push(() => Promise.resolve(vkFromResponse(res, knownKeys)));
  for (const mirror of VK_MIRRORS) {
    attempts.push(() => vkFromMirror(mirror, knownKeys));
  }

  let last = null;
  for (const attempt of attempts) {
    last = await attempt();
    if (vkReadable(last)) {
      if (last.via !== 'vk.com') say(`Стена получена через ${last.via}: напрямую ВК отдал не стену.`);
      return last;
    }
    if (attempts.length > 1) say(`Через ${last.via} стены нет (${last.error || last.how}) — пробуем следующий источник.`);
  }
  return last;
}

/* ── Отчёт ─────────────────────────────────────────────────────────────────── */

function report({ android, ios, known, marks, note, dated, undated, vk, wrote }) {
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

  /*
    Раздел группы идёт третьим и печатается всегда, включая случай «постов нет»:
    две молчаливые площадки и необъяснённая пустая страница — это уже не ответ
    на вопрос «что нового», а симптом.
  */
  head('ВК — официальная группа');
  if (vk.bytes) say(`пришло: ${vk.bytes} знаков, заголовок ответа: ${vk.pageTitle}`);
  if (vk.error) say(`⚠ страница не пришла: ${vk.error}`);
  say(`как нашли: ${vk.how}${vk.via && vk.via !== 'vk.com' ? ` через ${vk.via}` : ''}; постов группы на странице: ${vk.total}`);
  if (vk.drawn) {
    say('страницу перерисовала читалка: у заметок дата — день вместо минуты, эмодзи в заголовке теряются');
  }
  if (vk.how === 'no-page' || vk.how === 'login') {
    say(`⚠ ${vk.how === 'login' ? 'вместо стены — страница входа: группа закрылась или ВК требует аккаунт' : 'стена не разобрана — по этим строкам это и чинят'}`);
    if (vk.debug) say(vk.debug);
  } else if (!vkReadable(vk)) {
    say('⚠ читалка вернула стену без единой подписанной группой записи — это не ответ «разработчики молчат», а пустой её ответ; следующий обход попробует снова');
  }
  if (vk.skipped && (vk.skipped.published || vk.skipped.silent || vk.skipped.tooOld)) {
    say(`пропущено: уже опубликовано ${vk.skipped.published}, не про перемену ${vk.skipped.silent}, старше окна ${vk.skipped.tooOld}`);
  }
  for (const n of vk.notes) {
    say(`· [${n.fields.kind}] ${n.fields.title}`);
    say(`  ${n.feedKey} | ${n.fields.sourceAt} | ${n.fields.sourceUrl}`);
    say(`  ${n.fields.summary.slice(0, 240).replace(/\n/g, ' / ')}`);
  }
  if (!vk.notes.length && vk.how === 'ok') say('новых заметок этот обход не принёс.');

  head('Что уже знает база');
  say(`опубликовано: Android ${known.android || '—'}, iOS ${known.ios || '—'}`);
  say(`отметок фида: ${marks.count}${marks.why ? ` — ⚠ ${marks.why}` : ''}`);
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
  if (vk.notes.length) {
    say(`заметок из группы: ${vk.notes.length} — ${APPLY ? 'пишем' : 'в сухом прогоне не писали'}`);
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

async function apply({ note, dated, android, ios, vk }) {
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

  for (const item of vk.notes) {
    try {
      await rest('/rpc/forum_publish_update_note', {
        method: 'POST',
        token,
        body: {
          p_kind: item.fields.kind,
          p_title: item.fields.title,
          p_summary: item.fields.summary,
          p_source_name: item.fields.sourceName,
          p_source_url: item.fields.sourceUrl,
          p_source_at: toStoreIso(item.fields.sourceAt),
          p_game_version: item.fields.gameVersion,
          /*
            Ключ едет в саму публикацию, а не отдельным «запомни» после неё:
            между двумя запросами есть обрыв, а обрыв планировщик читает как
            успех. Отметка, заведённая в одной операции со строкой, и есть то,
            что делает удаление заметки окончательным.
          */
          p_feed_key: item.feedKey,
        },
      });
      vk.written.push(item.fields.title);
    } catch (e) {
      say(`База не приняла заметку из группы «${item.fields.title}»: ${e.message}`);
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
          p_text: summarizeRun(note, vk),
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
function summarizeRun(note, vk) {
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
  /*
    Группа отвечает тремя разными пустотами, и путать их нельзя: «постов нет»
    значит, что разработчики молчат, а «стена не разобрана» значит, что молчим
    мы. По этой строке за неделю видно, какой из двух ремонтов нужен.
  */
  const vkWord = vk.written.length
    ? `; из группы «${vk.written[0]}»${vk.written.length > 1 ? ` и ещё ${vk.written.length - 1}` : ''}`
    : vk.how === 'login' ? '; группа закрылась за страницей входа'
      : vk.error ? '; страница группы не ответила'
        : vk.how === 'no-page' ? '; стена группы не разобрана'
          : vk.how === 'no-posts' && !vkReadable(vk) ? '; читалка вернула стену без единой записи группы — это не тишина разработчиков' : '';
  /*
    Чем читалась стена, модератор обязан видеть: если список собран через
    зеркало, а зеркало однажды перестанет отвечать, молчание фида надо
    объяснять сменой источника, а не «разработчики пропали».
  */
  const via = vk.via && vk.via !== 'vk.com' && vkReadable(vk)
    ? `; стена через ${vk.via}${vk.drawn ? ' (дата заметок — с точностью до дня)' : ''}`
    : '';
  if (note.fields) return `опубликовано обновление ${note.fields.gameVersion}${gone}${lag}${vkWord}${via}`.trim();
  return `${note.why || 'нового нет'}${gone}${vkWord}${via}`;
}

main().catch((e) => {
  say(`Запуск прерван: ${e.message}`);
  process.exit(1);
});
