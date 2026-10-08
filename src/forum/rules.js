/**
 * ПРАВИЛА ФОРУМА — ОДИН ИСТОЧНИК ПРАВДЫ.
 *
 * Здесь лежит и текст правил, и проверки, которые их подпирают. Это сделано
 * нарочно: если правила висят картинкой в одном месте, а проверки живут
 * в другом, они расходятся на первой же правке. Тогда человек читает одно,
 * а форма отказывает по другому — и выглядит это как поломка сайта,
 * а не как правило.
 *
 * ЧТО ПРОВЕРЯЕТ КОД, А ЧТО ЧЕЛОВЕК.
 *
 * Код умеет проверять только форму: длину, пустоту, формат ника, ссылки.
 * «Уважительно ли написано» и «по теме ли это» кодом не проверяется, и здесь
 * нет списка запрещённых слов. Причина: такой список одновременно и ловит
 * невиновных (Кострома, Сукхотай, «нахимовский»), и обходится одной точкой
 * внутри слова. Он создаёт видимость модерации, не давая её.
 *
 * Поэтому смысловые правила держит человек: у каждой записи есть кнопка
 * «Пожаловаться», а у администратора — экран, где пост удаляется с причиной.
 * Правила ниже написаны так, чтобы по ним можно было принять решение, а не
 * чтобы их можно было выполнить автоматически.
 */
import { CONFIG } from '../../config.js';
import { sanitizeHtml, textOf } from './format.js';

const L = CONFIG.forum.limits;

/**
 * Правила в том виде, в котором их видит игрок.
 *
 * `id` нужен модерации: удаляя пост, администратор выбирает пункт, и человек
 * получает не «удалено», а «удалено по пункту 4». Поэтому id менять нельзя —
 * на них ссылаются уже принятые решения.
 *
 * @typedef {Object} Rule
 * @property {string} id
 * @property {string} title
 * @property {string} body
 */

/** @type {Rule[]} */
export const RULES = [
  {
    id: 'respect',
    title: 'Уважение к человеку',
    body:
      'Спорить о игре можно как угодно резко. Переходить на человека — нельзя: ' +
      'оскорбления, травля, угрозы и пожелания зла закрывают тему сразу.',
  },
  {
    id: 'hate',
    title: 'Без вражды по национальности и вере',
    body:
      'Национальность, страна, вера, возраст, пол — не аргумент в споре об игре ' +
      'и не повод для насмешки. Это правило не обсуждается и работает без предупреждений.',
  },
  {
    id: 'topic',
    title: 'По делу: 33 сервер и Z Route',
    body:
      'Форум про наш сервер и про игру. Игроки с других серверов тоже нужны: ' +
      'свой номер каждый называет в профиле, и он виден рядом с ником — спор ' +
      'из другой игры не считается чужим, пока он про Z Route. Для болтовни не ' +
      'по теме есть раздел «Флудилка», для всего остального про сообщество — ' +
      '«Разное». Реклама чужих проектов и сбор денег остаются под запретом где ' +
      'угодно, а игровые аккаунты продаются в одном месте — на доске ' +
      'объявлений с меткой «Аккаунты».',
  },
  {
    id: 'ads',
    title: 'Без рекламы; аккаунты — на доске',
    body:
      'Реклама чужих проектов, сбор денег, приглашения в сторонние боты и ' +
      '«схемы заработка» удаляются без разговора. Продажа и обмен игровых ' +
      'аккаунтов — не в ленте, а на доске: тема с меткой «Аккаунты», где ' +
      'названы состав аккаунта и цена. Разница не в разрешении, а в месте: ' +
      'в ленте такое объявление — шум без автора и без даты, а на доске у него ' +
      'есть срок, комментарии, где покупатель спрашивает то, без чего сделка ' +
      'нечестна, и модерация, которая может его снять. ' +
      'Денег сайт не берёт и гарантий не даёт: ни кнопки «купить», ни ' +
      'реквизитов в карточке нет нарочно, и договорились люди или нет — их ' +
      'дело. Телефон, почту и дискорд в текст объявления не пишите: связаться ' +
      'можно по нику или личным сообщением с карточки, а личные данные в ' +
      'карточке читает весь сервер.',
  },
  {
    id: 'privacy',
    title: 'Без личных данных',
    body:
      'Ни своих, ни чужих: настоящие имена, адреса, телефоны, переписка без согласия. ' +
      'Игровой ник — это не личные данные, всё остальное — да.',
  },
  {
    id: 'lies',
    title: 'Не выдумывать результаты',
    body:
      'Итоги VS, захваты и потери Столиц — это история сервера, и она должна ' +
      'оставаться правдой. Выдуманный результат хуже отсутствующего: он попадает ' +
      'в чужие выводы и живёт там годами.',
  },
  {
    id: 'flood',
    title: 'Одна тема — один пост',
    body:
      'Дубли, пустые сообщения ради поднятия темы и цепочки из одного слова ' +
      'убираются. Дополнить свою мысль можно комментарием.',
  },
  {
    id: 'spoiler',
    title: 'Чужие планы — не твой материал',
    body:
      'Скриншоты закрытых чатов, планы чужих альянсов и договорённости, ' +
      'к которым тебя не приглашали, публиковать нельзя.',
  },
];

/**
 * Что бывает за нарушение. Отдельно от правил, потому что это не правило,
 * а последствие, и человек должен видеть его до того, как нажмёт «Опубликовать».
 */
export const SANCTIONS = [
  'Первое нарушение — пост удаляется, автор видит причину и пункт правил.',
  'Повторное — запрет писать на срок, который назначает администратор.',
  'Пункты «вражда» и «личные данные» — запрет сразу, без первого раза.',
];

/** Разделы форума. Ключи попадают в базу, поэтому переименованию не подлежат. */
export const CATEGORIES = [
  { id: 'news', label: 'Новости', hint: 'Что произошло на сервере' },
  { id: 'vs', label: 'Разбор VS', hint: 'Почему выиграли или проиграли' },
  { id: 'chronicle', label: 'Летопись', hint: 'Захваты, защиты, войны' },
  { id: 'ally', label: 'Альянсы', hint: 'Набор, слияния, объявления' },
  { id: 'help', label: 'Вопросы', hint: 'Спросить и получить ответ' },
  { id: 'offtop', label: 'Разное', hint: 'Всё остальное про сообщество' },
  { id: 'flood', label: 'Флудилка', hint: 'Болтовня не по игре' },
  { id: 'blog', label: 'Блоги', hint: 'Личные блоги игроков' },
];

/** Метки дополняют раздел, но не заменяют его: одна тема может быть и про VS,
 * и про набор в альянс, без размножения одинаковых рубрик.
 *
 * `shopOnly: true` у «Аккаунтов» — метку нельзя отметить в композере форума:
 * объявление о продаже создают на своей вкладке (#/accounts), где для него
 * есть отдельные поля. Тема с этой меткой при этом остаётся темой: лента её
 * показывает, фильтр по метке работает, ответы и жалоба — общие.
 */
export const TOPIC_TAGS = [
  { id: 'vs', label: 'VS' },
  { id: 'recruiting', label: 'Набор' },
  { id: 'sos', label: 'Срочно' },
  { id: 'diplomacy', label: 'Дипломатия' },
  { id: 'guide', label: 'Гайд' },
  { id: 'question', label: 'Вопрос' },
  { id: 'event', label: 'Событие' },
  { id: 'barter', label: 'Обмен' },
  { id: 'accounts', label: 'Аккаунты', shopOnly: true },
];
export const TOPIC_TAG_IDS = TOPIC_TAGS.map((tag) => tag.id);

/**
 * Метки, которым нужен срок действия.
 *
 * «Набор открыт», «помогите со столицей», «отдам патроны, ищу банки» и
 * «аккаунт 40 лвл, 3 млн, 1500 ₽» — это обещания, у которых срок жизни короче,
 * чем у обсуждения. Через месяц такая тема уже не приглашение и не предложение,
 * а мусор, и читатель, пришедший по
 * ней в закрытый набор или к человеку, который давно всё роздал, делает вывод,
 * что форуму верить нельзя. А по просроченному объявлению о продаже аккаунта
 * люди ещё и передают друг другу доступы. Поэтому форма обязана спросить дату, а база —
 * проверить ответ: числа лежат в CONFIG.forum.limits, а те же четыре id стоят
 * в функции forum_expiry_required (supabase/applied/20260925-announcement-expiry.sql,
 * расширена в supabase/applied/20260926-barter-board.sql и
 * supabase/applied/20261006-account-board.sql). Расхождение сторожит тест.
 */
export const EXPIRY_TAG_IDS = ['recruiting', 'sos', 'barter', 'accounts'];

/** @param {string[]} tags */
export function needsExpiry(tags) {
  return (Array.isArray(tags) ? tags : []).some((tag) => EXPIRY_TAG_IDS.includes(tag));
}

/*
  Календарь встреч. Событием тема становится по метке, а не по отдельной
  таблице (см. рассуждение в шаге 1 той же миграции), и у метки есть своё
  требование: без момента тема в календаре повисла бы как «когда-нибудь».
  Тот же id стоит в триггере forum_posts_event_at и в представлении
  forum_event_list. Расхождение сторожит тест.
*/
export const EVENT_TAG_ID = 'event';

/** @param {string[]} tags */
export function needsEventDate(tags) {
  return (Array.isArray(tags) ? tags : []).includes(EVENT_TAG_ID);
}

/**
 * Три ответа на приглашение. «Возможно» места не занимает: иначе организатор
 * забил бы свою встречу людьми, которые могут и не прийти. Слова совпадают со
 * CHECK'ом колонки status в supabase/applied/20260925-event-rsvp.sql.
 */
export const EVENT_RSVP = [
  { id: 'going', label: 'Буду', seats: true },
  { id: 'maybe', label: 'Возможно', seats: false },
  { id: 'declined', label: 'Не приду', seats: false },
];
export const EVENT_RSVP_IDS = EVENT_RSVP.map((r) => r.id);

/*
  Бартер-доска. Объявлением тема становится тоже по метке, а не по отдельной
  таблице (рассуждение — в шаге 1 миграции supabase/applied/20260926-barter-board.sql),
  и у метки своё требование: названы обе стороны, иначе «отдам патроны» без
  «ищу банки» — это реклама, и половина таких тем заканчивается вопросом «а что
  тебе нужно?». Тот же id стоит в триггере forum_posts_barter и в проверке
  меток темы. Расхождение сторожит тест.
*/
export const BARTER_TAG_ID = 'barter';

/** @param {string[]} tags */
export function needsBarterLines(tags) {
  return (Array.isArray(tags) ? tags : []).includes(BARTER_TAG_ID);
}

/*
  Доска аккаунтов. Устроена один в один как обменная — объявлением делает тему
  метка, а не отдельная таблица (рассуждение и плата за это — в шаге 1 миграции
  supabase/applied/20261006-account-board.sql), — но требует другое: названный состав
  аккаунта и цену словами. «Продаю аккаунт» без того и другого — это не
  объявление, а вопрос, и отвечать на него приходится в комментариях вечер.
  Тот же id стоит в триггере forum_posts_accounts и в проверке меток темы.
  Расхождение сторожит тест.

  Денег и контактов у объявления нет нарочно: сайт не принимает платежи и не
  отвечает за то, что произошло после перевода, а поле под телефон или дискорд
  светил бы личные данные тому, кто их вписал.
*/
export const ACCOUNT_TAG_ID = 'accounts';

/** @param {string[]} tags */
export function needsAccountLines(tags) {
  return (Array.isArray(tags) ? tags : []).includes(ACCOUNT_TAG_ID);
}

/**
 * Пульс обновлений игры. Три слова вместо свободного названия типа: список,
 * где каждый называет перемену как хочет, через месяц читается как свалка
 * синонимов, и отфильтровать его нельзя. Те же три значения перечислены в
 * проверке колонки kind (supabase/applied/20260926-update-pulse.sql), и расхождение
 * сторожит тест.
 *
 * `hint` — не украшение: форма модерации показывает его под выбором, потому
 * что «Объявление» и «Патч» на глаз неотличимы, а различить их нужно до того,
 * как заметка легла в список.
 */
export const UPDATE_KINDS = [
  {
    id: 'patch',
    label: 'Патч',
    hint: 'в игре что-то изменили: баланс, карта, экономика',
  },
  {
    id: 'notice',
    label: 'Объявление',
    hint: 'разработчики сказали что-то, ещё не изменив',
  },
  {
    id: 'issue',
    label: 'Известная проблема',
    hint: 'сломано и признано: ждём починки, не надо об этом тем',
  },
];
export const UPDATE_KIND_IDS = UPDATE_KINDS.map((k) => k.id);

/** @param {string} id */
export function updateKindLabel(id) {
  const kind = UPDATE_KINDS.find((k) => k.id === id);
  return kind ? kind.label : id;
}

/* ── Подсказка модерации: разбор вставленного «Что нового» ──────────────────
 *
 * ЭТОТ ПУТЬ НЕ ХОДИТ В ЧУЖИЕ САЙТЫ, И ЭТО НЕ ЛЕНЬ. Из браузера ход и не
 * возможен: страницу Google Play браузер чужому сайту не отдаёт
 * (same-origin). Автомат, который читает магазины, есть, но он живёт вне
 * браузера — в `scripts/store-feed.mjs`, и отвечает за две площадки с прямой
 * ссылкой. Здесь же ручной путь для того, что выходит раньше магазина: пост ВК
 * модератор приносит сам, а код разбирает его на поля.
 *
 * Поэтому и там и там автоматизирована ровно механическая половина работы:
 * текст приносит человек либо планировщик, а решение публиковать остаётся за
 * дверью от имени модератора. Скопировал со страницы магазина — там же, где
 * человек сам читает патч.
 *
 * НИЧЕГО НЕ ДОДУМЫВАЕТСЯ. Поле, для которого в тексте нет опоры, остаётся
 * пустым и попадает в `missing`: тип заметки выбирает человек, дату он
 * ставит сам, если разработчик её не написал. Подсказка, которая угадывает,
 * — это второй источник выдуманных изменений, а ровно их раздел и боится.
 *
 * Разбор ничего не сохраняет и никуда не ходит: получил строку, вернул
 * набор полей. Поэтому он живёт здесь, рядом с правилами формы, и те же числа
 * лимитов.
 */

/** Месяцы по-русски и по-английски — страницы магазинов бывают на двух. */
export const UPDATE_MONTHS = {
  янв: 0, фев: 1, мар: 2, апр: 3, май: 4, мая: 4, июн: 5, июл: 6,
  авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7,
  sep: 8, oct: 9, nov: 10, dec: 11,
};

/*
  Строки-подписи интерфейса магазина. Человек копирует страницу целиком, и
  вместе с текстом патча в форму прилетает «Что нового», «Рейтинг»,
  «Скриншоты» и «Показать всё». Это не содержательные строки, и заголовок
  заметки по первой из них был бы всегда одним и тем же словом.
*/
const UPDATE_INTERFACE_LINE = /^(?:что нового|what'?s new|об этом приложении|описание|показать (?:все|всё)|подробнее|see more|read more|отзывы|оценки(?: и отзывы)?|рейтинг|скриншоты|версия|обновлено|размер|возраст|язык|издание|разработчик|дата выхода|скачать|установить|app ?store|google play)\s*[:\-—·]?\s*$/i;

/** Строка из одних украшений: буллеты, звёзды рейтинга, тире-разделители. */
const UPDATE_DECORATION = /^[\s•·*\-–—=_….,!★☆]+$/;

/*
  Строка, в которой только адрес. Ссылка у заметки есть в отдельном поле, и
  повторять её в содержании незачем. Опаснее другое: адрес из адресной строки
  обычно приклеивается первой строкой вставки, и без этого фильтра он становился
  заголовком каждой заметки — человек получал «https://play.google.com/...»
  там, где должно быть написано, что изменилось.
*/
const UPDATE_URL_LINE = /^[»"«'`•·*\s]*https?:\/\/\S+?[,;:.\s]*$/i;

/*
  Строка-метка магазина: подпись и значение в одной строке — «Версия 2.14.0»,
  «Обновлено 5 сент. 2026 г.», «Размер 128 МБ». Это не текст патча: версия и
  дата у заметки есть отдельные поля, и печатать их ещё и в содержании —
  значит умножать то, что может разойтись.

  Разбор по формам, а не одна широкая регилка, потому что широкая съедает
  настоящие строки: «Возраст игроков в чате пересмотрен» начинается с того же
  слова, что служебная метка «Возраст 12+». Значит, после подписи обязано
  стоять значение понятного вида — число, версия, дата, — и ничего больше.
*/
const UPDATE_META_PATTERNS = [
  /^(?:версия|version|ver\.?)\s*[:\-—·]?\s*v?\d+(?:\.\d+){1,3}\b\s*(?:\(\d+\))?\s*$/i,
  /^(?:обновлено|опубликовано|вышло|updated|released|release date|дата выхода)\s*[:\-—·]?\s*(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s+[a-zа-яё]{3,10}\.?\s+\d{4}\s*г?\.?)\s*$/i,
  /^(?:размер|size)\s*[:\-—·]?\s*[\d.,]+\s*(?:КБ|МБ|ГБ|KB|MB|GB)?\s*$/i,
  /^(?:возраст|age)\s*[:\-—·]?\s*\d{1,2}\s*\+?\s*$/i,
  /^(?:язык|language)\s*[:\-—·]?\s*[a-zа-яё\s]{1,20}$/i,
];

/** Служебная ли это строка страницы магазина, а не текст обновления. */
function isStoreMetaLine(line) {
  return UPDATE_META_PATTERNS.some((re) => re.test(line));
}

/** Номер версии: ищет явные упоминания, а не первую точку в тексте. */
const UPDATE_VERSION_EXPLICIT = /(?:верси(?:и|я|ю)|version|ver\.?|обновление)\s*[vV]?\s*(\d+(?:\.\d+){1,3})/i;
/** Строка, состоящая только из номера версии: так оформляют заголовок патча. */
const UPDATE_VERSION_LINE = /^v?\s*(\d+(?:\.\d+){1,3})\b[)\s\-(]*.{0,40}$/;

const UPDATE_DATE_LABEL = /(?:обновлено|опубликовано|дата выхода|вышло|updated|released)\s*[:\-—·]?\s*(\d{1,2})\s+([a-zа-яё]{3,10})\.?\s*(\d{4})/i;
const UPDATE_DATE_ISO = /(?:обновлено|опубликовано|вышло|updated|released)\s*[:\-—·]?\s*(\d{4})-(\d{2})-(\d{2})/i;

/** Тип по словам разработчика. Сначала проблема: её нельзя спутать с патчем. */
const UPDATE_ISSUE_WORDS = /(известн\w+ проблем|не работает|возникает|возникло|сбои|баг[а-я]*|принос\w+ извинен|работаем над (?:исправл|устран)|временно (?:отключ|недоступ))/i;
const UPDATE_NOTICE_WORDS = /(скоро|в ближайш\w+ обновлени|планируем|ожидает|появится в|мы готовим|следующем обновлении)/i;

/**
 * Откуда текст — только по домену ссылки. Пустая строка значит, что источник
 * модератор обязан назвать сам: угадать его по тексту патча нельзя.
 * @param {string} link
 */
export function updateSourceFromLink(link) {
  const s = String(link ?? '').trim().toLowerCase();
  if (/^https:\/\/play\.google\.[a-z.]{2,}/.test(s)) return 'Google Play';
  if (/^https:\/\/(www\.|apps\.)?apple\.[a-z.]{2,}/.test(s) || /^https:\/\/apps\.apple\.com/.test(s)) return 'App Store';
  return '';
}

/** https-ссылка без пробелов — ровно та, которую примет и база, и карточка. */
function cleanUpdateUrl(raw) {
  const s = String(raw ?? '').trim();
  return /^https:\/\/\S+$/i.test(s) ? s : '';
}

/**
 * Ссылка на страницу магазина, прилиплившая к вставленному тексту.
 *
 * Страницу копиют целиком, и адрес иногда приезжает вместе с ним. Берём только
 * тот, что ведёт в Google Play или App Store: первая попавшаяся ссылка из
 * чужого текста не имеет права становиться первоисточником заметки.
 */
export function updateStoreLinkFromText(text) {
  for (const match of String(text ?? '').matchAll(/https:\/\/\S+/g)) {
    const url = cleanUpdateUrl(match[0].replace(/[),.;!»"'`]+$/, ''));
    if (url && updateSourceFromLink(url)) return url;
  }
  return '';
}

/** Дата из текста в формате поля datetime-local; пустая строка — даты нет. */
export function parseUpdateDate(text, now) {
  const iso = text.match(UPDATE_DATE_ISO);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])];
    return formatDateField(y, m, d, now);
  }
  const m = text.match(UPDATE_DATE_LABEL);
  if (!m) return '';
  const month = UPDATE_MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (month === undefined) return '';
  return formatDateField(Number(m[3]), month, Number(m[1]), now);
}

/*
  Полдень, а не полночь: у магазина дата без часов, и заметка о вчерашнем
  патче не должна оказываться «из будущего» из-за разницы часов. Границы те
  же, что у формы и у базы, — подсказка не имеет права предложить то, что
  потом отвергнет publish.
*/
function formatDateField(year, month, day, now) {
  if (!(year >= 2000) || !(month >= 0 && month <= 11) || !(day >= 1 && day <= 31)) return '';
  const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
  if (Number.isNaN(d.getTime())) return '';
  const reference = now instanceof Date ? now : new Date(now ?? Date.now());
  if (d.getTime() > reference.getTime() + L.updateFutureGraceMinutes * 60 * 1000) return '';
  if (year < L.updateSourceYearFloor) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}T12:00`;
}

/** Обрезка по границе слова: подсказка не оставляет в заголовке полслова. */
function cutWords(text, max) {
  const s = String(text ?? '').trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const at = head.lastIndexOf(' ');
  return (at > max * 0.6 ? head.slice(0, at) : head).trimEnd().replace(/[,;:.\s]+$/, '');
}

/**
 * Разобрать вставленный текст обновления в поля заметки.
 *
 * Ни одно поле не заполняется тем, чего в тексте не было. Пустое значение
 * означает «смотри сам», и оно же попадает в `missing` — форма показывает
 * список по-русски, чтобы модератор не искал глазами, чего не хватает.
 *
 * @param {string} raw текст «Что нового» из магазина
 * @param {string} link ссылка на страницу магазина (необязательная)
 * @param {Date|number} now текущий момент — для проверки даты из будущего
 * @returns {{title: string, summary: string, kind: string, sourceName: string,
 *            sourceUrl: string, sourceAt: string, gameVersion: string,
 *            missing: string[]}}
 */
export function parseUpdateSource(raw, link = '', now = Date.now()) {
  const text = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u2007\u202F\uFEFF]/g, ' ');

  const url = cleanUpdateUrl(link) || updateStoreLinkFromText(text);
  const sourceName = updateSourceFromLink(url);
  const sourceAt = parseUpdateDate(text, now);

  const versionMatch = text.match(UPDATE_VERSION_EXPLICIT);
  const gameVersion = versionMatch ? versionMatch[1].slice(0, L.updateVersionMax) : '';

  /*
    Мусор вырезается до разбора, а не после: «Версия» и «Обновлено» — строки
    интерфейса магазина, и первая из них иначе стала бы заголовком каждой
    второй заметки.
  */
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line
      && !UPDATE_INTERFACE_LINE.test(line)
      && !isStoreMetaLine(line)
      && !UPDATE_URL_LINE.test(line)
      && !UPDATE_DECORATION.test(line));

  /*
    Заголовок — первая настоящая строка: не номер версии (он встанет в своё
    поле) и не маркер списка. Буллет в карточке смотрится мусором, а в
    содержании он нужен: список правок читается построчно.
  */
  const firstLine = lines.find((line) => !UPDATE_VERSION_LINE.test(line)) || '';
  const title = cutWords(
    firstLine
      .replace(/^[»"«'`•·*\s]+/, '')
      .replace(/^(?:патч|обновление|update|версия)\s*\d+(?:\.\d+)*\s*[:\-—]\s*/i, '')
      .replace(/[:;.\s]+$/, ''),
    L.updateTitleMax,
  );

  /* Содержание — весь разобранный текст, построчно: карточка держит
     pre-line, и список правок читается списком, а не абзацем. */
  let summary = lines.join('\n').trim();
  if (summary.length > L.updateSummaryMax) {
    /*
      Обрезка обязана оставить целую строку или целое слово: подсказка,
      кончившая фразу на полуслове, выглядит так, будто она её и придумала.
      Сначала пробуем границу строки, потом — слова, и только если в отрезке
      нет ни того, ни другого, режем жёстко.
    */
    const head = summary.slice(0, L.updateSummaryMax);
    const line = head.lastIndexOf('\n');
    const word = head.lastIndexOf(' ');
    const at = line > L.updateSummaryMax * 0.5 ? line : (word > L.updateSummaryMax * 0.6 ? word : head.length);
    summary = head.slice(0, at).trimEnd();
  }

  const kind = UPDATE_ISSUE_WORDS.test(text)
    ? 'issue'
    : UPDATE_NOTICE_WORDS.test(text)
      ? 'notice'
      : lines.length >= 2
        ? 'patch'
        : '';

  const fields = {
    title: title.length >= L.updateTitleMin ? title : '',
    summary: summary.length >= L.updateSummaryMin ? summary : '',
    kind,
    sourceName,
    sourceUrl: url,
    sourceAt,
  };

  return {
    ...fields,
    /* Номер версии полем не считается: он ищется в тексте, но его отсутствие
       ни о чём не говорит — игра часто не называет его вовсе. */
    gameVersion,
    missing: Object.keys(UPDATE_FIELD_LABELS)
      .filter((key) => !fields[key])
      .map((key) => UPDATE_FIELD_LABELS[key]),
  };
}

/**
 * Подписи полей для одного и того же списка в двух местах: в отказе подсказки
 * и в подсчёте, чего не хватает. Названия совпадают с подписями формы, чтобы
 * человек искал глазами по форме, а не переводил смысл.
 */
const UPDATE_FIELD_LABELS = {
  title: 'заголовок',
  summary: 'что изменилось',
  kind: 'тип заметки',
  sourceName: 'название источника',
  sourceUrl: 'ссылка на первоисточник',
  sourceAt: 'дата у первоисточника',
};

/**
 * Что подсказка смогла, а чего не придумала — одной строкой для формы.
 *
 * Про пустое поле сказано прямо: подсказка, которая молча оставила дату
 * пустой, выглядит сломанной, а не честной. И названо именно «не нашёл в
 * тексте», а не «вы забыли»: чего не написал разработчик, того код знать не
 * может и придумывать не вправе.
 */
export function updateParseNotice(parsed) {
  if (!parsed) return '';
  const keys = Object.keys(UPDATE_FIELD_LABELS);
  const filled = keys.filter((key) => parsed[key]).map((key) => UPDATE_FIELD_LABELS[key]);
  const left = (parsed.missing || []).slice();
  if (!filled.length) {
    return 'В этом тексте я не нашёл ничего, что переносится в поля: заполняйте сами.';
  }
  const head = `Перенёс в форму: ${filled.join(', ')}.`;
  return left.length
    ? `${head} Не нашёл в тексте и оставил вам: ${left.join(', ')}.`
    : `${head} Всё нужное было в тексте — проверьте и публикуйте.`;
}

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/**
 * Порядок ленты. Ключи, как и разделы, попадают в адрес страницы
 * (`#/forum?sort=top`), поэтому переименованию не подлежат: старая ссылка
 * на «Лучшее» обязана открываться и через год.
 */
export const SORTS = [
  { id: 'fresh', label: 'Свежее' },
  { id: 'top', label: 'Лучшее' },
  { id: 'talked', label: 'Обсуждаемое' },
];
export const SORT_IDS = SORTS.map((s) => s.id);

/** @param {string} id */
export function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? 'Разное';
}

/**
 * НАБОР РЕАКЦИЙ.
 *
 * Реакция у человека одна на запись, и лайк с дизлайком лежат в этом же
 * наборе. Так сделано, чтобы нельзя было поставить и то и другое разом:
 * это не мнение, а способ накрутить оба счётчика.
 *
 * `weight` считает «за» и «против» — по нему сортируется лента. Смайлики
 * веса не имеют: «смешно» это не согласие и не возражение.
 */
export const REACTIONS = [
  { id: 'like', glyph: '👍', label: 'Согласен', weight: 1 },
  { id: 'dislike', glyph: '👎', label: 'Не согласен', weight: -1 },
  { id: 'fire', glyph: '🔥', label: 'Сильно', weight: 0 },
  { id: 'laugh', glyph: '😂', label: 'Смешно', weight: 0 },
  { id: 'wow', glyph: '😮', label: 'Неожиданно', weight: 0 },
  { id: 'sad', glyph: '😢', label: 'Печально', weight: 0 },
  { id: 'salute', glyph: '🫡', label: 'Уважение', weight: 0 },
];

export const REACTION_IDS = REACTIONS.map((r) => r.id);

/** @param {string} id */
export function reactionMeta(id) {
  return REACTIONS.find((r) => r.id === id) ?? null;
}

/* ── Первые шаги новичка ────────────────────────────────────────────────────
 *
 * Пять действий, которые человек обычно не замечает в первый вечер. Список
 * держится здесь, а сделан шаг или нет — в базе: `forum_starter_checklist()`
 * (supabase/applied/20260926-starter-checklist.sql) отвечает только «сделан ли шаг с
 * таким ключом», потому что база умеет считать строки, а слов у неё нет.
 *
 * Порядок этот же, что в базе, и он косметический: страница ищет шаг по ключу.
 *
 * Ни один шаг здесь не отмечается галочкой и не награждается очками: закрыт он
 * ровно тогда, когда в соответствующей таблице стоит строка, а награда за
 * обычное пользование форумом обесценила бы репутацию, которая растёт из
 * написанного.
 */
export const STARTER_STEPS = [
  {
    id: 'profile',
    title: 'Расскажите, с кем говорят',
    hint: 'аватарка, строка о себе или тег альянса — любое из трёх',
  },
  {
    id: 'reply',
    title: 'Ответьте кому-нибудь',
    hint: 'ответ стоит меньше темы, но именно он начинает разговор',
  },
  {
    id: 'thanks',
    title: 'Поблагодарите автора',
    hint: 'спасибо за конкретный разбор: его не снять и себе не поставить',
  },
  {
    id: 'save',
    title: 'Сохраните тему',
    hint: 'закладки видите только вы — длинный разбор можно отложить до вечера',
  },
  {
    id: 'ally',
    title: 'Подпишитесь на альянс',
    hint: 'от подписки приходят перемены в таблице сил',
  },
];

/**
 * Куда вести человека за незакрытым шагом. Ссылки живут здесь, а не в списке
 * выше, потому что это разметка: адрес своей страницы знает только тот, у кого
 * есть ник.
 *
 * Шаги без ссылки тоже есть, и это не забывчивость: поблагодарить и ответить
 * человек может под любой записью в этой же ленте, а ссылка «в ленту» из блока,
 * который стоит над лентой, ничего бы не объяснила.
 *
 * @param {string} nick Ник вошедшего — для ссылки на свою страницу.
 */
export function starterStepHref(id, nick) {
  if (id === 'profile') return `#/user/${encodeURIComponent(nick)}`;
  if (id === 'save') return '#/forum?saved=1';
  return '';
}

/* ── Проверки формы ───────────────────────────────────────────────────────── */

/**
 * Ник.
 *
 * Разрешены буквы (русские и латинские), цифры, дефис, подчёркивание
 * и пробел внутри. Пробел разрешён потому, что игровые ники бывают из двух
 * слов, а запрещать это — значит заставлять человека придумывать второй ник
 * специально для сайта.
 *
 * Чего нельзя: невидимые символы и подделка чужого ника похожими буквами
 * проверяется не здесь, а сравнением в базе — там ник приводится к нижнему
 * регистру и обязан быть уникальным.
 *
 * @param {string} raw
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export function validateNick(raw) {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');

  if (!value) return { ok: false, error: 'Ник не может быть пустым' };
  if (value.length < L.nickMin) {
    return { ok: false, error: `Ник короче ${L.nickMin} символов` };
  }
  if (value.length > L.nickMax) {
    return { ok: false, error: `Ник длиннее ${L.nickMax} символов` };
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*[\p{L}\p{N}]$/u.test(value)) {
    return {
      ok: false,
      error: 'В нике только буквы, цифры, дефис и подчёркивание; начинаться и заканчиваться — буквой или цифрой',
    };
  }
  return { ok: true, value };
}

/**
 * Пароль.
 *
 * Требуется только длина. Обязательные «одна заглавная, одна цифра, один
 * символ» на практике дают «Password1!» — пароль, который выглядит сложным
 * и стоит в каждом втором аккаунте. Длина честнее.
 *
 * @param {string} raw
 */
export function validatePassword(raw) {
  const value = String(raw ?? '');
  if (value.length < L.passwordMin) {
    return { ok: false, error: `Пароль короче ${L.passwordMin} символов` };
  }
  if (value.length > 200) return { ok: false, error: 'Пароль неправдоподобно длинный' };
  if (value.trim() !== value) {
    return { ok: false, error: 'Пробел в начале или в конце пароля — почти всегда опечатка' };
  }
  return { ok: true, value };
}

/**
 * Черновик поста.
 *
 * Заголовок обрезается по краям, но внутри не трогается: перенос строки —
 * это часть текста, который писал человек. Текст же — это уже HTML редактора,
 * поэтому он СНАЧАЛА проходит через белый список sanitize.js и только потом
 * сверяется с правилами. Длина — по видимому тексту: теги не должны уметь
 * «накручивать» объём, а человек должен видеть в предупреждении честное
 * количество символов, а не сырой HTML.
 *
 * @param {{title?: string, body?: string, category?: string}} draft
 */
export function validatePost(draft) {
  const title = String(draft?.title ?? '').trim().replace(/\s+/g, ' ');
  const category = String(draft?.category ?? '');
  const body = sanitizeHtml(String(draft?.body ?? '').replace(/\r\n/g, '\n'));

  const visible = textOf(body);
  if (title.length < L.titleMin) {
    return { ok: false, error: `Заголовок короче ${L.titleMin} символов` };
  }
  if (title.length > L.titleMax) {
    return { ok: false, error: `Заголовок длиннее ${L.titleMax} символов` };
  }
  if (visible.length < L.bodyMin) return { ok: false, error: 'Текст поста пустой' };
  if (visible.length > L.bodyMax) {
    return { ok: false, error: `Текст длиннее ${L.bodyMax} символов` };
  }
  if (!CATEGORY_IDS.includes(category)) {
    return { ok: false, error: 'Не выбран раздел' };
  }
  /*
    Заголовок капсом — не нарушение правил, а неудобство для читающих.
    Поэтому не отказываем, а приводим к обычному виду: человек не должен
    угадывать, каким регистром сайт согласен принять его мысль.
  */
  const tidyTitle = title === title.toUpperCase() && title.length > 12
    ? title.charAt(0) + title.slice(1).toLowerCase()
    : title;

  return { ok: true, value: { title: tidyTitle, body, category } };
}

/** @param {string} raw */
export function validateComment(raw) {
  const value = sanitizeHtml(String(raw ?? '').replace(/\r\n/g, '\n'));
  const visible = textOf(value);
  if (visible.length === 0) return { ok: false, error: 'Комментарий пустой' };
  if (visible.length > L.commentMax) {
    return { ok: false, error: `Комментарий длиннее ${L.commentMax} символов` };
  }
  return { ok: true, value };
}

/**
 * Причина удаления, которую видит автор.
 * @param {string} ruleId
 * @param {string} [note]
 */
export function deletionReason(ruleId, note = '') {
  const rule = RULES.find((r) => r.id === ruleId);
  const index = RULES.findIndex((r) => r.id === ruleId);
  const head = rule ? `Пункт ${index + 1}: ${rule.title}` : 'Нарушение правил форума';
  return note.trim() ? `${head} — ${note.trim()}` : head;
}

/* ── Гайд участника: адрес, длина и отказ ────────────────────────────────── */

/*
  И адрес, и длину гайда считает база (supabase/applied/20260929-player-guides.sql):
  функции здесь — не вторая проверка, а единственный способ для формы и
  чернового режима сказать те же слова, что скажет Postgres. Мера длины та же,
  что в триггере: разметка снимается, пробелы схлопываются. Иначе форма
  приняла бы «гайд» из трёх пустых <div>, а база бы его отвергла — и человек
  увидел бы отказ там, где его уже не ждали.
*/

/** Текст гайда без разметки — ровно той же меркой, что и триггер базы. */
export function guideText(body) {
  return String(body ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Адрес гайда. Присланный руками остаётся как есть (модерация вправе задать
 * адрес словом); пустой строится из заголовка.
 * @param {string} raw
 * @param {string} title
 * @returns {string}
 */
export function guideSlug(raw, title) {
  const given = String(raw ?? '').toLowerCase().trim();
  if (given) return given.slice(0, 80);
  const built = String(title ?? '').toLowerCase()
    .replace(/[^a-z0-9а-яё]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return built.slice(0, 80).replace(/^-+|-+$/g, '');
}

/** Те же фразы, что поднимает триггер `forum_guide_author_guard`. */
export const GUIDE_BODY_SHORT = 'Гайд короче двухсот символов — это заметка, а не гайд';
export const GUIDE_BODY_LONG = 'Гайд длиннее двадцати тысяч символов — разбей его на два';
export const GUIDE_DAILY_LIMIT = 'Сегодня ты уже опубликовал два гайда — больше двух в сутки';

/**
 * Единственная проверка тела гайда, которую знает форма.
 *
 * Слова написаны буквами и повторяют отказы триггера дословно: человек
 * должен получить одну и ту же фразу и в черновом режиме, и на живой базе,
 * а числа при этом стоят в обоих местах отдельно — их сходство сторожит
 * тест, а не текст сообщения.
 *
 * @param {string} body HTML из редактора
 * @returns {string} пустая строка — всё в порядке
 */
export function guideBodyProblem(body) {
  const len = guideText(body).length;
  if (len < L.guideBodyMin) return GUIDE_BODY_SHORT;
  if (len > L.guideBodyMax) return GUIDE_BODY_LONG;
  return '';
}

/* ── Сервер игрока: номер, ожидание между сменами ──────────────────────────

   Сервер у человека, а не у ленты: он называет номер сам, и тот виден рядом
   с его ником. Проверяется только форма (целое в границах и срок с прошлой
   смены), а не «правду ли сказал» — проверить это кодом невозможно, и правка
   всегда открыта модерации.

   Границы и срок держит база (supabase/applied/20261005-player-server.sql: проверка
   `between 1 and 999` и интервал `interval '30 days'` в триггере
   `forum_users_server_guard`), а здесь те же числа нужны, чтобы форма
   отказывала тем же словом, что и база: игрок обязан получить одинальную
   фразу и в черновом режиме, и на живой схеме.
────────────────────────────────────────────────────────────────────────── */

/** Тем же словом, что поднимает триггер. */
export const SERVER_RANGE = `Номер сервера — целое от ${L.serverIdMin} до ${L.serverIdMax}`;

/**
 * Дата в том же виде, что печатает отказ базы: `to_char(..., 'DD.MM.YYYY')`
 * считает по UTC, поэтому и здесь дни, месяц и год берутся из UTC — иначе
 * игрок видел бы «после 04.11» в форме и «после 03.11» в отказе базы.
 */
export function serverDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/**
 * Введённый номер. Пусто — «не указан»: это разрешённое состояние, значка у
 * ника просто нет.
 *
 * @param {string|number|null|undefined} raw
 * @returns {{ok: true, value: number|null} | {ok: false, error: string}}
 */
export function validateServerId(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: true, value: null };
  if (!/^\d+$/.test(text)) return { ok: false, error: SERVER_RANGE };
  const value = Number(text);
  if (value < L.serverIdMin || value > L.serverIdMax) return { ok: false, error: SERVER_RANGE };
  return { ok: true, value };
}

/**
 * Когда станет можно следующий выбор номера. Срок живёт в одном месте: отсюда
 * его берут и отказ (serverChangeProblem), и подсказка под полем
 * (serverChangeHint) — иначе форма могла бы обещать дату, которую база не
 * соблюдает.
 *
 * @param {Date|string|null} setAt
 * @returns {Date|null}  Null, если дату менять не с чего: номера ещё нет.
 */
export function serverChangeAllowedAt(setAt) {
  const since = setAt ? new Date(setAt) : null;
  if (!since || Number.isNaN(since.getTime())) return null;
  return new Date(since.getTime() + L.serverChangeDays * 86400000);
}

/**
 * Нельзя ли сейчас ставить другой номер. Пустой ответ — менять можно.
 *
 * Снятие номера считается сменой: иначе лимит обходился бы двумя правками
 * («снять сегодня, поставить новый завтра»). Первый номер ожиданием не держится:
 * у того, кто его ещё не выбирал, отнимать право нельзя.
 *
 * @param {number|null} current  Номер в профиле сейчас.
 * @param {Date|string|null} setAt  Когда его выбирали в последний раз.
 * @param {number|null} desired  Что ставят.
 * @param {Date} [now]
 */
export function serverChangeProblem(current, setAt, desired, now = new Date()) {
  if (desired === (current ?? null)) return '';
  if (current == null) return '';
  const allowedAt = serverChangeAllowedAt(setAt);
  if (allowedAt && allowedAt > now) {
    return `Сервер можно менять раз в ${L.serverChangeDays} дней. Следующая смена — после ${serverDate(allowedAt)}`;
  }
  return '';
}

/**
 * Подсказка под полем выбора — та же граница, что в отказе, но сказанная
 * до нажатия кнопки: человек видит срок, пока ещё ничего не сломалось.
 *
 * @param {Date|string|null} setAt
 * @param {Date} [now]
 */
export function serverChangeHint(setAt, now = new Date()) {
  const period = `Менять номер можно раз в ${L.serverChangeDays} дней`;
  const allowedAt = serverChangeAllowedAt(setAt);
  if (!allowedAt || allowedAt <= now) return `${period}.`;
  return `${period}. Следующая смена — после ${serverDate(allowedAt)}.`;
}
