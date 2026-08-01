/**
 * ДОСТУП К РЕПОЗИТОРИЮ ЧЕРЕЗ API GITHUB.
 *
 * Это и есть весь «бэкенд» панели. Базы нет, сервера нет, хостинга нет —
 * есть репозиторий, который у проекта уже был, и его история как журнал
 * правок. Платить нечему, поэтому и умереть от неоплаты нечему.
 *
 * Чтение и запись. Записи ровно одна функция — `writeDataFile`, и она всегда
 * требует `sha` прочитанного файла: без сверки версии два редактора,
 * заполняющие неделю в один вечер, затрут работу друг друга и оба об этом
 * не узнают.
 */
import { CONFIG } from '../../config.js';
import { authHeaders } from './auth.js';

const API = 'https://api.github.com';

/** Адрес репозитория из конфига, безопасно склеенный. */
function repoBase() {
  const { owner, repo } = CONFIG.github;
  if (!owner || !repo) {
    throw new Error('В config.js не заполнен блок github — панель не знает, какой репозиторий читать.');
  }
  return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/**
 * Конфликт версии: файл изменился между чтением и записью.
 *
 * Текст живёт отдельной константой, потому что это единственная ошибка,
 * после которой у человека есть понятное действие, а не «позовите
 * разработчика». Черновик при этом цел, поэтому и говорим про «Обновить»,
 * а не про «начните сначала».
 */
export const CONFLICT_MESSAGE =
  'Файл успели изменить, пока вы заполняли неделю. Черновик сохранён в браузере — ' +
  'нажмите «Обновить», и он применится к свежим данным.';

/**
 * Человеческое объяснение вместо кода ответа.
 *
 * Панель ведут не программисты, и «404» им ничего не говорит. Хуже того,
 * GitHub отвечает 404 и когда репозитория нет, и когда токен не имеет
 * к нему доступа, — специально, чтобы нельзя было выяснять существование
 * приватных репозиториев. Поэтому объяснять приходится оба случая сразу.
 *
 * @param {Response} res
 * @param {any} body
 * @param {string} method
 * @returns {{message: string, conflict: boolean}}
 */
function explain(res, body, method) {
  const detail = body && typeof body.message === 'string' ? body.message : '';
  const { owner, repo } = CONFIG.github;
  const plain = (message) => ({ message, conflict: false });

  if (res.status === 401) {
    return plain('Токен не принят. Скорее всего он скопирован не полностью, уже отозван или истёк срок годности. Нужно выйти и вставить новый.');
  }
  if (res.status === 403) {
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      return plain('Слишком много запросов к GitHub. Лимит восстанавливается автоматически в течение часа.');
    }
    return plain(`GitHub отказал в доступе. Проверьте, что у токена есть право «Contents» на запись. ${detail}`.trim());
  }
  if (res.status === 404) {
    return plain(`Не найдено: ${owner}/${repo}. Либо в config.js опечатка, либо у токена нет доступа именно к этому репозиторию — GitHub в обоих случаях отвечает одинаково.`);
  }

  /*
    409 у GitHub означает разное в зависимости от запроса: при записи это
    расхождение версий, при чтении — пустой репозиторий без коммитов.
    Различаем по методу, иначе редкий случай пустого репозитория показал бы
    сообщение про чужую правку и отправил человека искать несуществующий конфликт.
  */
  const versionClash =
    (res.status === 409 && method !== 'GET') ||
    (res.status === 422 && /sha|does not match|fast.?forward/i.test(detail));

  if (versionClash) return { message: CONFLICT_MESSAGE, conflict: true };
  if (res.status === 409) return plain('Репозиторий пуст — в нём ещё нет ни одного коммита.');

  return plain(`GitHub ответил ошибкой ${res.status}. ${detail}`.trim());
}

/**
 * Один запрос к API. Единственное место, где панель выходит в сеть.
 *
 * @param {string} url
 * @param {{method?: string, body?: any, token?: string}} [opts]
 */
async function request(url, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...authHeaders(token),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    /*
      Сетевая ошибка, а не ответ сервера. Для российской аудитории это
      реальный сценарий, а не теоретический, поэтому и подсказка конкретная.
    */
    throw new Error('Не удалось связаться с api.github.com. Проверьте интернет: у части провайдеров GitHub открывается через VPN.');
  }

  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* тело не обязано быть JSON — объясним по одному коду */
    }
    const { message, conflict } = explain(res, payload, method);
    const error = new Error(message);
    if (conflict) error.conflict = true;
    throw error;
  }

  return res.json();
}

/** @param {string} url @param {string} [token] */
function get(url, token) {
  return request(url, { token });
}

/**
 * base64 → текст с кириллицей.
 *
 * `atob` отдаёт байты как строку latin1, и наивный вариант превращает
 * «Сталкеры» в мусор. Поэтому байты собираются явно и декодируются как UTF-8.
 *
 * @param {string} b64
 */
export function decodeBase64Utf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * текст → base64 с кириллицей.
 *
 * Обратная сторона декодера, и с той же ловушкой: `btoa` принимает только
 * байты, поэтому текст сначала кодируется в UTF-8. Байты в строку собираем
 * куском по 8 килобайт, а не одним `String.fromCharCode(...bytes)`: спред
 * массива на сотню тысяч элементов кладёт стек, и сломалось бы это не сразу,
 * а через год, когда данных накопится достаточно.
 *
 * @param {string} text
 */
export function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Байты (например картинка) → base64.
 *
 * В отличие от encodeBase64Utf8, вход уже бинарный, а не текст: пропускать
 * его через UTF-8 значило бы интерпретировать байты как символы и испортить
 * их. Здесь байты берутся как есть, тем же приёмом с чанками по 8 килобайт —
 * по той же причине, что и у текстового варианта: спред на большом массиве
 * кладёт стек.
 *
 * @param {ArrayBuffer} buffer
 */
export function encodeBase64Bytes(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * ЗАГРУЗКА КАРТИНКИ — коммитит один файл по новому пути.
 *
 * В отличие от writeDataFile, версия (sha) не нужна и не передаётся: путь
 * всегда новый и уникальный (см. uploadPath в image.js), поэтому конфликтовать
 * в нём не с чем — это не общий файл, который правят все разом, а отдельный
 * файл на каждую картинку.
 *
 * @param {{path: string, bytes: ArrayBuffer, message: string}} opts
 * @returns {Promise<string>} прямая ссылка на файл, рабочая сразу после коммита
 */
export async function uploadImageFile({ path, bytes, message }) {
  const { owner, repo, branch } = CONFIG.github;
  const url = `${repoBase()}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  await request(url, {
    method: 'PUT',
    body: { message, content: encodeBase64Bytes(bytes), branch },
  });

  /*
    raw.githubusercontent.com отдаёт файл сразу после коммита. Адрес самого
    сайта (github.io) для этого не подходит: GitHub Pages пересобирает
    страницы до минуты, и всё это время картинка была бы битой ссылкой.
  */
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

/**
 * ЗАПИСЬ ФАЙЛА ДАННЫХ — единственное место в панели, которое меняет данные.
 *
 * `sha` обязателен и передаётся всегда: это версия файла, которую человек
 * видел, когда начинал заполнять. Если в репозитории лежит уже другая,
 * GitHub откажет, и мы покажем понятное объяснение вместо того, чтобы
 * тихо затереть чужую работу. Именно поэтому параметр не имеет значения
 * по умолчанию — забыть его нельзя.
 *
 * @param {{text: string, sha: string, message: string}} opts
 */
export async function writeDataFile({ text, sha, message }) {
  if (!sha) throw new Error('Внутренняя ошибка: публикация без версии файла запрещена.');

  const { branch, dataPath } = CONFIG.github;
  const url = `${repoBase()}/contents/${dataPath.split('/').map(encodeURIComponent).join('/')}`;

  const res = await request(url, {
    method: 'PUT',
    body: {
      message,
      content: encodeBase64Utf8(text),
      sha,
      branch,
    },
  });

  return {
    sha: res.content?.sha ?? '',
    commitSha: String(res.commit?.sha ?? '').slice(0, 7),
    commitUrl: res.commit?.html_url ?? '',
  };
}

/**
 * Кто вошёл. Работает с любым видом токена и не требует особых прав.
 * @param {string} [token]
 */
export async function whoAmI(token) {
  const u = await get(`${API}/user`, token);
  return { login: u.login ?? '', name: u.name ?? '', avatar: u.avatar_url ?? '' };
}

/**
 * Что токен может в этом репозитории.
 * `permissions.push` — то самое право, без которого вторая фаза не поедет.
 * @param {string} [token]
 */
export async function repoInfo(token) {
  const r = await get(repoBase(), token);
  return {
    fullName: r.full_name ?? '',
    isPrivate: Boolean(r.private),
    defaultBranch: r.default_branch ?? 'main',
    canPush: Boolean(r.permissions?.push),
  };
}

/**
 * Чтение файла данных вместе с его версией.
 *
 * `sha` возвращается наружу не «на всякий случай»: во второй фазе именно
 * по нему проверяется, не изменил ли файл кто-то другой, пока редактор
 * заполнял неделю.
 */
export async function readDataFile() {
  const { branch, dataPath } = CONFIG.github;
  const url = `${repoBase()}/contents/${dataPath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
  const file = await get(url);

  let text;
  if (file.encoding === 'base64' && file.content) {
    text = decodeBase64Utf8(file.content);
  } else {
    /*
      Файлы больше мегабайта contents-эндпоинт отдаёт без содержимого.
      Сейчас до этого далеко, но данные копятся годами: 32 альянса
      на 52 недели — это полторы тысячи строк в год. Пусть панель
      не сломается молча в тот день, когда порог перейдён.
    */
    const blob = await get(`${repoBase()}/git/blobs/${encodeURIComponent(file.sha)}`);
    text = decodeBase64Utf8(blob.content);
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Файл ${dataPath} не разбирается как JSON. Похоже, его сломала ручная правка — откатите последний коммит в истории репозитория.`);
  }

  return { raw, sha: file.sha, size: file.size ?? text.length, path: dataPath };
}

/**
 * Последняя правка файла данных: кто и когда.
 *
 * Ради этого одного запроса панель получает журнал «кто внёс неделю»
 * бесплатно — писать его самим не нужно, git уже всё записал.
 */
export async function lastCommit() {
  const { branch, dataPath } = CONFIG.github;
  const url =
    `${repoBase()}/commits?path=${encodeURIComponent(dataPath)}` +
    `&sha=${encodeURIComponent(branch)}&per_page=1`;

  const list = await get(url);
  const c = Array.isArray(list) ? list[0] : null;
  if (!c) return null;

  return {
    sha: String(c.sha ?? '').slice(0, 7),
    message: c.commit?.message ?? '',
    date: c.commit?.author?.date ? new Date(c.commit.author.date) : null,
    /*
      author бывает пустым: коммиты бота выглядят иначе, чем коммиты людей.
      Поэтому подпись берём из коммита, а логин — из связанного аккаунта,
      если он есть.
    */
    authorName: c.commit?.author?.name ?? '',
    authorLogin: c.author?.login ?? '',
  };
}
