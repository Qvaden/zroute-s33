/**
 * ОФИЦИАЛЬНАЯ ГРУППА ВК — ЧЕТВЁРТЫЙ ГОЛОС, КОТОРЫЙ СЛЫШНО БЕЗ ЧЕЛОВЕКА.
 *
 * ЗАЧЕМ ОН НУЖЕН, ЕСЛИ ЕСТЬ ДВА МАГАЗИНА. Страница Google Play с осени 2026
 * года не отдаёт в HTML ни раздела «Что нового», ни блока событий: планировщик
 * ходит каждый час и возвращается с пустыми руками, а App Store на текущий
 * патч выдаёт строку «Исправлены ошибки.», которая короче нижнего порога
 * заметки. Единственное место, где разработчики по-прежнему печатают список
 * изменений словами, — их официальная группа: там есть и «30 сентября —
 * Обновление версии» с одиннадцатью пунктами оптимизации, и открытия
 * мероприятий. Модератор может принести этот текст руками, и форма для этого
 * есть; но постов в группе несколько в неделю, и ручным путём вкладка всегда
 * будет отставать.
 *
 * ЧИТАЕМ ТО, ЧТО ВИДИТ ЧЕЛОВЕК. Стена группы отдаётся без входа ровно тем же
 * HTML, что открывается в браузере: никакого обхода защиты, никаких чужих
 * токенов и никаких приватных записей. Берём только подписанные самой группой
 * записи со страницы «Посты сообщества» (?own=1), комментарии игроков в
 * разборе не участвуют — это не слова разработчика.
 *
 * НИЧЕГО НЕ ВЫДУМЫВАЕТСЯ. Запись становится заметкой, только если её первая
 * строка называет перемену, уже случившуюся в игре (см. таблицу ПУБЛИКУЕМОГО
 * ниже). Тизеры, розыгрыши призов за комментарии, опросы и «время острых
 * мнений» проходят мимо: завалить список announcements-ом дешевле, чем один
 * раз написать правду, а читатель открывает вкладку ради ответа «что
 * изменилось».
 *
 * ДАТА У ЗАМЕТКИ — ДАТА ПОСТА, НАСТОЛЬКО ТОЧНАЯ, НАСКОЛЬКО ЕЁ ВИДНО. Когда
 * страница приходит от самой группы, дата берётся целым числом секунд из
 * атрибута `data-exec`. Когда её принесли через читалку (см. ниже), в ответе
 * остаётся только надпись «2 d ago» — её раскладывают до дня, и в состоянии
 * обхода это честно названо: автомат знает день, а не минуту.
 */
import { CONFIG } from '../../config.js';
import { parseUpdateSource, updateSourceFromLink } from './rules.js';

const L = CONFIG.forum.limits;
const VK = CONFIG.forum.store.vk || {};

/**
 * Страница «Посты сообщества»: свои записи группы, без чужих репостов.
 *
 * Минус в номере группы — часть записи ВК (`-236547214_41747`), а в адресе
 * стены он стоит один: `wall-236547214`. Собираем адрес из голого числа, чтобы
 * не получить `wall--236547214`, по которому ВК отдаёт страницу поиска, а не
 * стену, и разбор тогда молчит про пустоту.
 */
export function vkWallUrl(cfg = VK) {
  return `https://vk.com/wall-${bareGroup(cfg)}?own=1`;
}

/** Номер группы без знака: и для адреса, и для ключа. */
function bareGroup(cfg) {
  return String(cfg.group ?? '').replace(/^-/, '');
}

/** Постоянная ссылка на одну запись — она и становится первоисточником. */
export function vkPostUrl(postId, cfg = VK) {
  const m = /_(\d+)$/.exec(String(postId ?? ''));
  return m ? `https://vk.com/wall-${bareGroup(cfg)}_${m[1]}` : '';
}

/**
 * Разбор страницы ВК начинается с правильной кодировки: группа отдаёт
 * windows-1251, и прочитанное как UTF-8 превратилось бы в кашу, где вместо
 * русской буквы — две латинские с диакритикой. Проверяем по признаку, а не по
 * молчаливому допущению: если кириллицы в ответе нет, а знак «>» есть,
 * страница пришла не в той кодировке, и разбор обязан сказать об этом, а не
 * вернуть пустой список.
 */
export const VK_ENCODING = 'windows-1251';

/** Байты ответа → строка. Отдельно, чтобы тест мог подать готовую строку. */
export function decodeVkBytes(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  return new TextDecoder(VK_ENCODING).decode(buf);
}

/**
 * Границы одного блока записи.
 *
 * Разметка ВК рисует пост так, что его данные лежат в атрибуте `data-exec`
 * одним JSON-объектом: там есть точная дата, полный текст и автор. Текст в
 * списке постов на экране рисуется из этого же объекта, поэтому читать его —
 * не привилегия, а ровно то, что видит посетитель.
 */
const POST_START = /id="post-(\d+)_(\d+)"/g;
const CONTENT_BLOB = /data-exec="(\{&quot;PostContentContainer\\\/init&quot;:[\s\S]*?\})"/;
const BLOCK_AUTHOR = /data-post-author-id="(-?\d+)"/;
const SIGNER = /data-post-signer-or-author-id="(-?\d+)"/;

/** Служебные кавычки страницы → обычные символы. */
function unescapeVk(raw) {
  return String(raw ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Текст поста → строки для карточки.
 *
 * Внутри JSON текст записан HTML-разметкой: `<br>` между строками, ссылки на
 * людей вида `[id12345|Имя]` и внешние ссылки вида `[#alias|подпись|адрес]`.
 * Людей оставляем именем без скобок, адрес ссылки убираем совсем: в заметке не
 * должно быть чужой ссылки, первоисточником которой пост не является.
 */
export function vkPostToLines(html) {
  const text = unescapeVk(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[#[^\]|]+\|([^|\]]+)\|https?:\/\/[^\]]+\]/g, '$1')
    .replace(/\[[^\]|[]*\|([^\]]+)\]/g, '$1')
    /*
      Группа иногда печатает заголовок и первый абзац одной строкой, без
      переноса. Тогда заголовок карточки — это начало строки, обрезанное по
      верхнему пределу посреди второго предложения, и выглядит сломанно.
      Восстанавливаем перенос по единственному признаку новой фразы, который не
      требует чтения смысла: «!» или «?» перед новым предложением с большой
      буквы или с кавычки.
    */
    .replace(/([!?])\s+(?=[«А-ЯЁA-Z])/g, '$1\n')
    .replace(/&#(\d+);/g, (whole, code) => {
      const n = Number(code);
      return n >= 32 && n < 1114112 ? String.fromCodePoint(n) : '';
    })
    .replace(/[\u00A0\u2007\u202F\uFEFF]/g, ' ')
    /*
      Модификаторы варианта (U+FE0F и соседи) — половинки эмодзи. На живой
      странице эмодзи приходит цельным символом и этот хвост безвреден, а
      перерисованную страницу ВК отдаёт картинкой, оставляя от знака один
      невидимый модификатор: висячий «хвостик» в конце строки был бы в
      карточке мусором.
    */
    .replace(/[\uFE00-\uFE0F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[-—–*=._]{3,}$/.test(line));
}

/**
 * Что из стены группы заслуживает заметки.
 *
 * Порядок списков важен: имя версии проверяется раньше событийного слова,
 * потому что пост об обновлении почти всегда упоминает ещё и мероприятие.
 *
 * «Патч» — про то, что в игре уже поменялось. «Объявление» — про то, что
 * разработчики назвали и обязательно сделают: скин, который «появится в
 * событии», игроку полезен ровно так же, как уже вышедший патч, но назвать его
 * изменением было бы врутём.
 */
const PATCH_WORDS = /(обновление версии|основные изменения|что нового|патч\s*\d|изменения этого обновления)/i;
const OPEN_WORDS = /(официально открыт|полностью открыт|открыт[а-яё]*!|стартовал|запущен|дебютировала|уже в игре|начал[а-яё]?сь)/i;
const NOTICE_WORDS = /(появится|будет доступен|ожидает[а-яё]*|выйдет|выйдёт|готовьтесь)/i;

/**
 * Чего в заметках быть не должно, даже если пост написан словами о будущем.
 *
 * Розыгрыш и опрос обращены к комментациям под постом, а не к игре: они
 * кончаются через неделю и оставляют в списке мусор, который невозможно
 * отличить от перемены. Тизер («узнайте тему», «на подходе») не называет
 * ничего, и publish-функция базы отвергла бы такое содержание короче порога,
 * поэтому он отсекается здесь — до запроса, а не после отказа.
 *
 * Слово «розыгрыш» стоит в списке не голым: им группа называет и свои выдачи
 * призов за комментарии, и игровой автомат внутри события. Розыгрыш призов
 * узнаётся по тому, к кому он обращён (подарочный код в личные сообщения,
 * бот выбирает победителей), а не по одному слову — иначе пост, назвавший
 * открывшийся боевой пропуск с билетами «розыгрыша по руководству», молчал бы
 * как конкурс, хотя в нём напечатана настоящая перемена игры.
 */
const SILENT_WORDS = /(розыгрыш призов|разыгрываем|подарочный код|общий сбор|опрос|сбор отзывов|видеокампания|октоберфест|время острых мнений|самый популярный герой|угада[йя]те|на подходе|приближается|подпищик|нас уже \d|в личные сообщения|пишите в лс|бот выберет победителей)/i;

/** Тип будущей заметки по тексту записи; пустая строка — запись не публикуем. */
export function vkPostKind(lines) {
  const text = (Array.isArray(lines) ? lines : []).join('\n');
  if (!text) return '';
  if (SILENT_WORDS.test(text)) return '';
  if (PATCH_WORDS.test(text)) return 'patch';
  if (OPEN_WORDS.test(text)) return 'patch';
  if (NOTICE_WORDS.test(text)) return 'notice';
  return '';
}

/**
 * Поля заметки из одной записи стены.
 *
 * Заголовок и содержание разбирает `parseUpdateSource` — тот же код, что
 * раскладывает вставку модератора в форме: два пути к одной карточке обязаны
 * давать одинаковые границы, иначе одна и та же правка вышла бы в список то
 * целой, то обрезанной строкой.
 *
 * Тип и дата берутся из разбора страницы, а не из текста: у записи есть
 * настоящая секундная метка, и ставить заметке «сегодня» значило бы врать про
 * первоисточник. Дата из тела поста (например «30 сентября» в заголовке)
 * никогда не перетягивает метку страницы.
 */
export function vkNoteFromPost(post, cfg = VK) {
  if (!post || !Array.isArray(post.lines) || !post.lines.length) return null;
  const kind = vkPostKind(post.lines);
  if (!kind) return null;

  const parsed = parseUpdateSource(post.lines.join('\n'), post.url || '', post.atMs);
  /*
    Пустое поле у разбора означает «в тексте нечего показать», а не «разборщик
    не справился, подставим первую строку». У второй половины записей первой
    строкой идёт дата или номер версии, и такая подставка наполнила бы список
    карточками без содержания.
  */
  if (!parsed.title || !parsed.summary) return null;

  return {
    feedKey: `vk:${post.id}`,
    fields: {
      kind,
      title: parsed.title,
      summary: parsed.summary,
      sourceName: (cfg.sourceName || 'Официальная группа ВК').slice(0, L.updateSourceNameMax),
      sourceUrl: post.url || '',
      sourceAt: new Date(post.atMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      gameVersion: parsed.gameVersion || '',
    },
  };
}

/**
 * Все подписанные группой записи со страницы стены.
 *
 * `how` отвечает на вопрос, почему список пуст: «no-page» — пришла не стена
 * (форма входа, заглушка, капча), «no-posts» — стена есть, но ни одна запись не
 * принадлежит группе. Молчание автомата и отсутствие постов — два разных
 * диагноза, и путать их нельзя: первый чиним мы, второй означает просто
 * «разработчики сегодня ничего не писали».
 *
 * `now` нужен перерисованной странице: у неё даты — надписи «3 d ago»
 * относительно момента обхода, и окном свежести должен править тот же час,
 * а не два разных.
 */
export function readVkWall(html, cfg = VK, now = Date.now()) {
  const source = String(html ?? '');
  const owner = String(cfg.group ?? '');
  const starts = [];
  POST_START.lastIndex = 0;
  let match = POST_START.exec(source);
  while (match) {
    /*
      Номер в разметке напечатан без минуса (`post-236547214_41747`), а
      настоящий id записи ВК — с минусом, и именно он становится ключом
      публикации. Возвращаем знаку его место сразу здесь: позже по этому списку
      ничего не восстановить, если брать только число.
    */
    starts.push({ id: `${owner}_${match[2]}`, at: match.index });
    match = POST_START.exec(source);
  }
  if (!starts.length) {
    return { posts: [], how: isVkLoginPage(source) ? 'login' : 'no-page' };
  }

  const posts = [];
  for (let i = 0; i < starts.length; i += 1) {
    const block = source.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : source.length);
    const author = BLOCK_AUTHOR.exec(block) || [];
    const signer = SIGNER.exec(block) || [];
    /* Подпись «от имени группы» — тоже её голос; соавторство игрока — нет. */
    if (author[1] !== owner && signer[1] !== owner) continue;
    const blob = CONTENT_BLOB.exec(block);
    const item = readVkItem(blob);
    if (!item) continue;
    posts.push({
      id: starts[i].id,
      atMs: item.date * 1000,
      url: vkPostUrl(starts[i].id, cfg),
      lines: vkPostToLines(item.text),
      hasPoll: !!item.hasPoll,
    });
  }
  posts.sort((a, b) => b.atMs - a.atMs);
  if (posts.length) return { posts, how: 'ok' };

  /*
    Ни одной секундной метки на странице нет — пробуем прочесть её так, как
    видит человек: перерисованный ответ. Если это живая страница группы, посты
    найдутся и там, только дата будет с точностью до дня.
  */
  const drawn = readVkWallRendered(source, cfg, now);
  if (drawn.posts.length) return drawn;
  /* До этой строки блок стены всегда найден, иначе вышли бы выше как «не стена». */
  return { posts: [], how: 'no-posts' };
}

/** JSON одной записи из атрибута; кривой или отсутствующий объект — null. */
function readVkItem(blob) {
  if (!blob) return null;
  let parsed;
  try {
    parsed = JSON.parse(unescapeVk(blob[1]));
  } catch {
    return null;
  }
  const item = parsed && parsed['PostContentContainer/init'];
  const post = item && item.item;
  if (!post || !Number.isFinite(post.date)) return null;
  return {
    date: post.date,
    text: String(post.text ?? ''),
    fromId: String(post.from_id ?? ''),
    hasPoll: Array.isArray(post.attachments) && post.attachments.some((a) => a && a.type === 'poll'),
  };
}

/**
 * Страница, которую открыл браузер за нас.
 *
 * ЗАЧЕМ ОНА НУЖНА. ВК отдаёт стену только тем, кому доверяет как человеку, и
 * запрос с адреса дата-центра — а именно оттуда идёт обход GitHub — не
 * пускает. Доходит стена до нас через читалку, которая открывает её настоящим
 * браузером. Такая страница уже прошла через руки ВК: его React выбрасывает
 * атрибут `data-exec`, где лежали секундные метки и целые тексты, а дату
 * оставляет надписью «2 d ago».
 *
 * ЧЕМ ЗА ЭТО ПЛАТЯТ, ИЗМЕРЕНО НА ЖИВОЙ СТРАНИЦЕ ИЗ 20 ЗАПИСЕЙ: секундных
 * меток в перерисованном ответе нет ни у одной, эмодзи превращены в картинки
 * и пропадают, к тексту изредка примешаны подписи интерфейса. Остальное —
 * номер записи, подпись автора и полный текст — на месте. Согласились на это
 * сознательно: две молчаливые площадки и недельная тишина в списке стоят
 * дороже точности до минуты.
 */
const DRAWN_POST = /<div id="post-(\d+)_(\d+)" class="[^"]*_post post[^"]*"/g;
const DRAWN_TEXT = /<div class="[^"]*wall_post_text_wrapper[^"]*"[^>]*>/;
const DRAWN_DATE = /data-testid="post_date_block_preview"[^>]*>([^<]*)</;

/** Месяц по английскому имени: читалка открывает страницу под en-US. */
const DRAWN_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

const DAY = 86400000;

/**
 * Надпись с датой → метка времени.
 *
 * Держимся того, что измерено: браузер читалки считает дни по UTC, а не по
 * московскому времени (запись трёхдневной давности, открытая в 21:12 UTC,
 * названа «3 d ago»), и целые сутки считает вниз, а не по календарю. Поэтому
 * «N d ago» — это сутки, отнятые от момента обхода, а не календарный сдвиг.
 *
 * Точность надписи известна, и её не прячем: «минуты назад» и «10:23 pm»
 * дают минуту, «N d ago», «вчера» и «27 Sep» дают только день. Для дня берём
 * полдень — единственная минута суток, которая показывает тот же календарный
 * день и игроку в Москве, и игроку за океаном.
 *
 * Год в надписи «27 Sep» стоит невидимый: берём тот, у которого эта дата
 * уже прошла, — пост из будущего фиду не нужен ни при каком раскладе.
 */
export function drawnDateToMs(label, now = Date.now()) {
  const text = String(label ?? '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text) return null;

  const clock = /(?:^|\s)(\d{1,2}):(\d{2}) ?([ap])m?(?:\s|$)/.exec(text);
  let hour = 12;
  let minute = 0;
  if (clock) {
    hour = Number(clock[1]) % 12 + (clock[3] === 'p' ? 12 : 0);
    minute = Number(clock[2]);
  }
  const noonUtc = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), clock ? hour : 12, clock ? minute : 0);

  if (/^just now|^только что/.test(text)) return { atMs: now, exact: true };
  const min = /(\d+)\s*min/.exec(text);
  if (min) return { atMs: now - Number(min[1]) * 60000, exact: true };
  const hours = /(\d+)\s*(?:h\b|hour)/.exec(text);
  if (hours) return { atMs: now - Number(hours[1]) * 3600000, exact: false };

  const days = /(\d+)\s*(?:d\b|day)/.exec(text);
  if (days) return { atMs: noonUtc(new Date(now - Number(days[1]) * DAY)), exact: false };
  if (/yesterday|вчера/.test(text)) return { atMs: noonUtc(new Date(now - DAY)), exact: false };

  const dated = /(\d{1,2})\s*([a-z]{3,})/.exec(text);
  const month = dated ? DRAWN_MONTHS[dated[2].slice(0, 3)] : undefined;
  if (dated && month !== undefined) {
    const day = Number(dated[1]);
    const thisYear = new Date(now).getUTCFullYear();
    const at = (year) => Date.UTC(year, month, day, clock ? hour : 12, clock ? minute : 0);
    return { atMs: at(at(thisYear) > now ? thisYear - 1 : thisYear), exact: false };
  }

  if (clock) return { atMs: noonUtc(new Date(now)), exact: true };
  return null;
}

/** Текст поста на перерисованной странице: содержимое блока текста целиком. */
function drawnText(block) {
  const open = DRAWN_TEXT.exec(block);
  if (!open) return '';
  /*
    Границу ищем подсчётом вложенных div, а не «до следующего закрывающего
    тега»: внутри текста вложенных блоков несколько, и первый </div> обрезал бы
    пост на первой же строке.
  */
  const tags = /<div\b[^>]*>|<\/div>/gi;
  tags.lastIndex = open.index;
  let depth = 0;
  let found = tags.exec(block);
  while (found) {
    if (found[0][1] === '/') depth -= 1;
    else depth += 1;
    if (depth === 0) return block.slice(open.index + open[0].length, found.index);
    found = tags.exec(block);
  }
  return block.slice(open.index + open[0].length);
}

/**
 * Все подписанные группой записи с перерисованной страницы стены.
 *
 * Те же поля, что отдаёт `readVkWall`, и тот же ответ про пустоту, чтобы
 * публикация ничего не заметила: у перерисованной страницы общие границы
 * раздела — верхний блок записи с классом `_post`, комментарии игроков в
 * список не попадают, а автор берётся теми же атрибутами, что и на живой
 * странице.
 */
export function readVkWallRendered(html, cfg = VK, now = Date.now()) {
  const source = String(html ?? '');
  const owner = String(cfg.group ?? '');
  DRAWN_POST.lastIndex = 0;
  const starts = [];
  let match = DRAWN_POST.exec(source);
  while (match) {
    starts.push({ num: match[2], at: match.index });
    match = DRAWN_POST.exec(source);
  }
  if (!starts.length) return { posts: [], how: 'no-page', drawn: false };

  const posts = [];
  for (let i = 0; i < starts.length; i += 1) {
    const block = source.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : source.length);
    const author = BLOCK_AUTHOR.exec(block) || [];
    const signer = SIGNER.exec(block) || [];
    if (author[1] !== owner && signer[1] !== owner) continue;
    const label = DRAWN_DATE.exec(block);
    const at = label ? drawnDateToMs(label[1], now) : null;
    if (!at) continue;
    const lines = vkPostToLines(drawnText(block));
    if (!lines.length) continue;
    const id = `${owner}_${starts[i].num}`;
    posts.push({ id, atMs: at.atMs, atExact: at.exact, url: vkPostUrl(id, cfg), lines });
  }
  posts.sort((a, b) => b.atMs - a.atMs);
  return { posts, how: posts.length ? 'ok' : 'no-posts', drawn: posts.length > 0 };
}

/**
 * запрос из дата-центра, и когда группа закрылась: оба случая — не «постов
 * нет», а «нам сюда нельзя», и назвать это молчанием значит соврать.
 */
function isVkLoginPage(html) {
  const s = String(html ?? '');
  return /name="email"/.test(s) && /Войти|Зарегистрироваться|Authorize|Log in/i.test(s);
}

/**
 * Заметки со стены, которые стоит публиковать этим запуском.
 *
 * Отсекаются три слоя: записи старше окна (группа живёт годами, а список
 * обязан отвечать на вопрос «что недавно изменилось»), уже опубликованные ключи
 * — их название приходит из базы и переживает удаление заметки — и те, что не
 * прошли таблицу публикуемого. Верх `perRun` стоит здесь нарочно: первый
 * настоящий запуск видит окно целиком, и без него в список хлынуло бы
 * пятнадцать постов за один вечер, а почасовой автомат сделал бы из этого
 * стену.
 */
export function pickVkNotes(html, { known = [], now = Date.now(), cfg = VK } = {}) {
  const page = readVkWall(html, cfg, now);
  const seen = new Set((Array.isArray(known) ? known : []).map(String));
  const windowFrom = now - (cfg.freshDays || 40) * 86400000;
  const skipped = { tooOld: 0, published: 0, silent: 0 };
  const notes = [];

  for (const post of page.posts) {
    if (post.atMs < windowFrom) { skipped.tooOld += 1; continue; }
    if (seen.has(`vk:${post.id}`)) { skipped.published += 1; continue; }
    const note = vkNoteFromPost(post, cfg);
    if (!note) { skipped.silent += 1; continue; }
    notes.push(note);
    if (notes.length >= (cfg.perRun || 5)) break;
  }
  return {
    notes,
    how: page.how,
    total: page.posts.length,
    skipped,
    /* Заметки пришли с перерисованной страницы: даты в них — день, а не минута. */
    drawn: page.drawn === true,
  };
}

/** Название источника — из той же таблицы доменов, что и у формы модерации. */
export function vkSourceName(link) {
  return updateSourceFromLink(link) || (VK.sourceName || 'Официальная группа ВК');
}
