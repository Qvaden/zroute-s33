/**
 * ОДИН КЛИЕНТ SUPABASE НА ВЕСЬ ПРОЕКТ.
 *
 * Вынесено из forum/adapters/supabase.js, когда к базе появился второй
 * читатель, а потом и третий: данные сайта и админ-панель. Держать в каждом
 * свою копию обновления токена, разбора ошибок и склейки адреса — верный
 * способ получить три немного разных поведения и три места для одной правки.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ, А ЧЕГО НЕТ.
 *
 * Здесь только транспорт: адрес, ключ, сессия, повтор запроса после
 * обновления токена, перевод сообщений об ошибках. Никакой логики форума
 * или данных сайта — она у вызывающих.
 *
 * ГДЕ ЖИВЁТ БЕЗОПАСНОСТЬ. Не здесь. Публичный ключ лишь открывает дверь,
 * а что за ней разрешено — решают правила доступа в самой базе. Проверки
 * в этом файле нужны для понятных сообщений: любую можно обойти, отправив
 * запрос мимо сайта, и тогда откажет база. Так и должно быть.
 */
import { CONFIG } from '../../config.js';

/*
  Настройки читаются из двух мест намеренно. Сначала они лежали внутри
  раздела форума, потому что форум был единственным, кому нужна база.
  Теперь база общая, и правильное место — верхний уровень конфига.

  Старый путь оставлен рабочим: у людей уже заполнен config.js, и заставлять
  переносить две строки ради красоты структуры — плохая сделка.
*/
const CFG = CONFIG.supabase ?? CONFIG.forum?.supabase ?? {};

const SESSION_KEY = 'zr33.session';
/*
  Ключ сессии сменился: раньше она была «форумной». Старый читаем при первом
  запуске и переносим — иначе все, кто уже вошёл, оказались бы выброшены
  без объяснения.
*/
const LEGACY_SESSION_KEY = 'zr33.forum.session';

/*
  База отвечает секунды, а зависший запрос — навсегда. Без общего таймаута
  пропавшая сеть оставляла сайт на «Загружаем данные…» до перезагрузки:
  fetch не сдаётся сам, когда соединение молчит. Таймаут превращает молчание
  в обычную ошибку, и страница рассказывает о ней и продолжает жить.

  Загрузка фото не под таймаутом: она идёт отдельным путём (uploadFile),
  где человек сам ждёт прогресс, и спешить не нужно.
*/
const REQUEST_TIMEOUT = 12000;

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Настроен ли доступ к базе. */
export function isConfigured() {
  return Boolean(CFG.url && CFG.anonKey);
}

/** Домен для превращения ника в служебный адрес почты. */
export function nickDomain() {
  return CFG.nickDomain || 'users.zroute-s33.local';
}

/**
 * АДРЕС ПРОЕКТА, ПРИВЕДЁННЫЙ К ОДНОМУ ВИДУ.
 *
 * Нужен корень — «https://abc.supabase.co», потому что дальше от него
 * отходят три ветки: /rest/v1 к таблицам, /auth/v1 ко входу и /storage/v1
 * к файлам.
 *
 * Но в панели Supabase адрес показан в разделе Data API уже с хвостом
 * «/rest/v1/», и скопировать его целиком — самое естественное действие.
 * Получилось бы «…/rest/v1/rest/v1/…», а вход не нашёлся бы вовсе. Ошибка
 * при этом выглядит как «база не отвечает», ничего не говоря о причине.
 *
 * Поэтому хвост отрезаем молча. Спорить с человеком о том, что он скопировал
 * ровно то, что было написано, — плохая идея: написано было именно так.
 */
export function baseUrl() {
  return String(CFG.url ?? '')
    .trim()
    .replace(/\/(rest|auth|storage)\/v\d+\/?$/i, '')
    .replace(/\/+$/, '');
}

/* ── Сессия ───────────────────────────────────────────────────────────────── */

/**
 * localStorage умеет бросать: приватный режим, отключённые куки, открытие
 * файла с диска. Сайт от этого падать не должен — человек просто окажется
 * не вошедшим.
 */
function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Ключ и адрес наружу — для того, что не влезает в rest и uploadFile.
 *
 * Сейчас это удаление файла из хранилища: у него свой путь и свой вид ответа.
 * Отдавать сюда полный доступ к внутренностям не хочется, но и заводить
 * четвёртую обёртку ради одного DELETE — тоже.
 */
export function apiKey() {
  return CFG.anonKey;
}

export function readSession() {
  const raw = safe(() => localStorage.getItem(SESSION_KEY), null);
  if (raw) return safe(() => JSON.parse(raw), null);

  const legacy = safe(() => localStorage.getItem(LEGACY_SESSION_KEY), null);
  if (!legacy) return null;

  const parsed = safe(() => JSON.parse(legacy), null);
  if (parsed) {
    writeSession(parsed);
    safe(() => localStorage.removeItem(LEGACY_SESSION_KEY));
  }
  return parsed;
}

export function writeSession(session) {
  if (!session) {
    safe(() => localStorage.removeItem(SESSION_KEY));
    safe(() => localStorage.removeItem(LEGACY_SESSION_KEY));
    return;
  }
  safe(() => localStorage.setItem(SESSION_KEY, JSON.stringify(session)));
}

export function hasSession() {
  return Boolean(readSession()?.access_token);
}

/**
 * Идентификатор вошедшего — из токена, а не из запроса к таблице.
 *
 * Токен это JWT: три части через точку, средняя содержит данные открытым
 * текстом. Подпись мы не проверяем и не должны — её проверяет база при каждом
 * запросе. Здесь нужно только узнать, за кого нас считает сервер, и подделка
 * этого поля в своём же браузере ничего не даёт.
 *
 * Раньше «кто я» выяснялось первой строкой из таблицы профилей, с расчётом
 * на то, что права и так отдадут только свою. Для участника верно, а для
 * администратора нет: ему видны все, и он видел на сайте чужой ник.
 */
export function currentUserId() {
  const token = readSession()?.access_token;
  if (!token) return null;

  const part = String(token).split('.')[1];
  if (!part) return null;

  try {
    // JWT использует base64url: вместо «+/» стоят «-_», выравнивание отброшено.
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(atob(padded))?.sub ?? null;
  } catch {
    return null;
  }
}

/* ── Ключи и заголовки ────────────────────────────────────────────────────── */

/**
 * У Supabase два поколения публичных ключей, и ведут они себя по-разному:
 *
 *   старое  — длинный JWT, начинается с «eyJ». Называется anon.
 *   новое   — короткая строка «sb_publishable_…».
 *
 * Разница не косметическая. Старый ключ сам JWT, и его можно положить
 * в Authorization. Новый не JWT: попытка проверить его как JWT кончается
 * отказом, поэтому он передаётся только в apikey. Отсюда и берётся
 * «Invalid API key» у нового ключа, если слепо отправить оба заголовка.
 */
function isJwtKey(key) {
  return String(key).startsWith('eyJ');
}

/**
 * ЗАЩИТА ОТ САМОЙ ДОРОГОЙ ОШИБКИ.
 *
 * В настройках Supabase рядом лежат два ключа, и перепутать их легко:
 * названия похожи, оба длинные, копируются одной кнопкой. Разница в том,
 * что второй служебный: он даёт полный доступ ко всей базе В ОБХОД всех
 * правил. В файле, который лежит в публичном репозитории, это означает,
 * что база чужая.
 *
 * Молча работать с таким ключом нельзя: всё бы даже заработало, и ошибка
 * осталась бы незамеченной ровно до того дня, когда её заметит кто-то другой.
 */
export function requireConfig() {
  if (!CFG.url || !CFG.anonKey) {
    throw new Error(
      'База не настроена: в config.js пустые supabase.url и anonKey. ' +
        'Порядок подключения описан в docs/FORUM.md.'
    );
  }

  const key = String(CFG.anonKey);

  if (key.startsWith('sb_secret_')) {
    throw new Error(
      'В config.js попал СЛУЖЕБНЫЙ ключ (sb_secret_…). Он даёт полный доступ ' +
        'ко всей базе, и в публичном файле ему нельзя быть ни секунды. ' +
        'Удалите его, создайте новый вместо утёкшего и вставьте сюда ключ ' +
        'publishable (sb_publishable_…).'
    );
  }

  /*
    Старый служебный ключ — тоже JWT, поэтому по началу строки его от anon
    не отличить. Но роль лежит внутри него открытым текстом: JWT не шифрует
    содержимое, а только подписывает.
  */
  if (isJwtKey(key) && key.includes('.')) {
    let role = null;
    try {
      const part = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      role = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')))?.role ?? null;
    } catch {
      // Не разобрался как JWT — пусть решает сервер.
    }
    if (role === 'service_role') {
      throw new Error(
        'В config.js попал СЛУЖЕБНЫЙ ключ (service_role). Он даёт полный ' +
          'доступ ко всей базе в обход всех правил, и в публичном файле ему ' +
          'не место. Замените его на ключ anon (public).'
      );
    }
  }
}

/**
 * `apikey` говорит, ЧТО обращается к базе, и нужен всегда.
 * `Authorization` говорит, КТО обращается, и появляется только когда есть
 * токен вошедшего — либо когда ключ сам JWT, как у старого поколения.
 */
function keyHeaders(token) {
  const headers = { apikey: CFG.anonKey };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (isJwtKey(CFG.anonKey)) headers.Authorization = `Bearer ${CFG.anonKey}`;
  return headers;
}

/* ── Вход ─────────────────────────────────────────────────────────────────── */

/**
 * Обращение к системе входа. Отдельно от `rest` ниже: другой базовый путь
 * и другие правила с токеном.
 */
export async function auth(path, { method = 'POST', body, token } = {}) {
  requireConfig();

  let res;
  try {
    res = await fetchWithTimeout(`${baseUrl()}/auth/v1${path}`, {
      method,
      headers: { ...keyHeaders(token), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      err?.name === 'AbortError'
        ? 'База не отвечает. Проверьте интернет и попробуйте ещё раз.'
        : 'Не удалось связаться с базой. Проверьте интернет.'
    );
  }

  const text = await res.text();
  const data = text ? safe(() => JSON.parse(text), null) : null;

  if (!res.ok) throw new Error(explainAuth(res, data));
  return data;
}

/**
 * Сообщения Supabase приходят по-английски и мимо человека: «Invalid login
 * credentials» ничего не говорит игроку, который просто опечатался в нике.
 * Переводим то, что встречается на самом деле, остальное отдаём как есть —
 * выдуманный перевод хуже непонятного, но настоящего текста.
 */
function explainAuth(res, data) {
  const raw = data?.error_description || data?.msg || data?.message || `ошибка ${res.status}`;

  /*
    Отказ по формату адреса человек видеть не должен: он вводил ник и про
    адрес ничего не знает, для него это «сайт сломался». Такое сообщение
    возможно только если превращение ника в адрес выпустило наружу что-то
    кроме ASCII — то есть это наша ошибка, а не его.
  */
  if (/validate email|invalid format/i.test(raw)) {
    return 'Не удалось создать учётную запись из этого ника. Это наша ошибка, ' +
      'не ваша: сообщите её администратору. Пока попробуйте ник без необычных символов.';
  }
  if (/forum_users_nick_key|duplicate key/i.test(raw)) return 'Этот ник уже занят';

  const KNOWN = {
    'Invalid login credentials': 'Неверный ник или пароль',
    'User already registered': 'Этот ник уже занят',
    'Password should be at least 6 characters': 'Пароль слишком короткий',
    'Signups not allowed for this instance': 'Регистрация в базе выключена',
  };
  return KNOWN[raw] || raw;
}

async function refreshToken() {
  const session = readSession();
  if (!session?.refresh_token) return false;
  try {
    writeSession(await auth('/token?grant_type=refresh_token', {
      body: { refresh_token: session.refresh_token },
    }));
    return true;
  } catch {
    writeSession(null);
    return false;
  }
}

/* ── Таблицы ──────────────────────────────────────────────────────────────── */

/**
 * Запрос к таблице или к функции базы. PostgREST: фильтры и сортировка
 * передаются строкой запроса.
 *
 * `Prefer: return=representation` просит вернуть записанную строку — иначе
 * после создания записи пришлось бы делать второй запрос, чтобы узнать,
 * что получилось.
 *
 * @param {string} path
 * @param {{method?: string, body?: any, prefer?: string, headers?: object, retry?: boolean, retryOnAbort?: boolean}} [opts]
 */
export async function rest(path, { method = 'GET', body, prefer, headers = {}, retry = true, retryOnAbort = false } = {}) {
  requireConfig();
  const token = readSession()?.access_token;

  let res;
  try {
    res = await fetchWithTimeout(`${baseUrl()}/rest/v1${path}`, {
      method,
      headers: {
        ...keyHeaders(token),
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch (err) {
    /*
      УСНУВШАЯ БАЗА. Пока бесплатный проект молчит неделю, Supabase его
      усыпляет, и ПЕРВЫЙ же запрос часто не укладывается в общий таймаут:
      база просыпается дольше, чем живёт fetch. Из-за этого лента «не
      грузилась с первого раза»: второй заход уже работал, а первый падал
      с таймаутом.

      Один повтор после короткой паузы переживает пробуждение. Флаг отдельный
      (retryOnAbort) потому, что молчать вдвое дольше при настоящей пропаже
      сети — пытка: включён он только там, где повтор реально лечит, — чтение
      ленты, поста и комментариев.
    */
    if (retryOnAbort && err?.name === 'AbortError') {
      await new Promise((r) => setTimeout(r, 750));
      return rest(path, { method, body, prefer, headers, retry, retryOnAbort: false });
    }
    throw new Error(
      err?.name === 'AbortError'
        ? 'База не отвечает. Проверьте интернет и попробуйте ещё раз.'
        : 'Не удалось связаться с базой. Проверьте интернет.'
    );
  }

  const text = await res.text();
  const data = text ? safe(() => JSON.parse(text), null) : null;

  /*
    Токен живёт около часа. Молчаливый выход из аккаунта посреди набора
    поста — худшее, что может случиться с написанным текстом, поэтому
    один раз пробуем обновить токен и повторить запрос.
  */
  if (res.status === 401 && token && retry) {
    if (await refreshToken()) {
      return rest(path, { method, body, prefer, headers, retry: false });
    }
  }

  if (!res.ok) {
    const raw = data?.message || data?.hint || `ошибка ${res.status}`;
    // Отказ правила доступа выглядит как ошибка строки — объясняем по-русски.
    if (/row-level security|permission denied/i.test(raw)) {
      throw new Error('База отказала: недостаточно прав для этого действия');
    }
    throw new Error(raw);
  }
  return data;
}

/* ── Файлы ────────────────────────────────────────────────────────────────── */

/**
 * Загрузка файла в хранилище.
 *
 * Отдельно от `rest`: тело здесь бинарное, а не JSON, и заголовок
 * Content-Type должен описывать сам файл.
 *
 * @param {{bucket: string, path: string, bytes: ArrayBuffer|Blob, contentType?: string}} opts
 * @returns {Promise<string>} публичная ссылка на файл
 */
export async function uploadFile({ bucket, path, bytes, contentType = 'application/octet-stream' }) {
  requireConfig();
  const token = readSession()?.access_token;
  const clean = String(path).replace(/^\/+/, '');

  let res;
  try {
    res = await fetch(`${baseUrl()}/storage/v1/object/${bucket}/${clean}`, {
      method: 'POST',
      headers: {
        ...keyHeaders(token),
        'Content-Type': contentType,
        // Перезапись запрещаем: путь уникальный, совпадение означает ошибку.
        'x-upsert': 'false',
      },
      body: bytes,
    });
  } catch {
    throw new Error('Не удалось загрузить файл. Проверьте интернет.');
  }

  if (!res.ok) {
    const text = await res.text();
    const data = text ? safe(() => JSON.parse(text), null) : null;
    const raw = data?.message || data?.error || `ошибка ${res.status}`;

    if (/Bucket not found/i.test(raw)) {
      throw new Error(
        `В базе нет хранилища «${bucket}». Его создаёт supabase/site-data.sql — ` +
          'запустите его заново.'
      );
    }
    if (/row-level security|Unauthorized|new row violates/i.test(raw)) {
      throw new Error('База отказала в загрузке: у вас нет права редактора');
    }
    throw new Error(raw);
  }

  return publicFileUrl(bucket, clean);
}

/** Публичная ссылка на файл в хранилище. */
export function publicFileUrl(bucket, path) {
  return `${baseUrl()}/storage/v1/object/public/${bucket}/${String(path).replace(/^\/+/, '')}`;
}
