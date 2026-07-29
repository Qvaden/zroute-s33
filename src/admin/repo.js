/**
 * ДОСТУП К РЕПОЗИТОРИЮ ЧЕРЕЗ API GITHUB.
 *
 * Это и есть весь «бэкенд» панели. Базы нет, сервера нет, хостинга нет —
 * есть репозиторий, который у проекта уже был, и его история как журнал
 * правок. Платить нечему, поэтому и умереть от неоплаты нечему.
 *
 * В первой фазе здесь только чтение. Запись (`publish`) добавится второй
 * фазой, и уже сейчас видно, за что она зацепится: `sha` файла возвращается
 * наружу, потому что без сверки версии два редактора затрут друг друга.
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
 * Человеческое объяснение вместо кода ответа.
 *
 * Панель ведут не программисты, и «404» им ничего не говорит. Хуже того,
 * GitHub отвечает 404 и когда репозитория нет, и когда токен не имеет
 * к нему доступа, — специально, чтобы нельзя было выяснять существование
 * приватных репозиториев. Поэтому объяснять приходится оба случая сразу.
 *
 * @param {Response} res
 * @param {any} body
 */
function explain(res, body) {
  const detail = body && typeof body.message === 'string' ? body.message : '';
  const { owner, repo } = CONFIG.github;

  if (res.status === 401) {
    return 'Токен не принят. Скорее всего он скопирован не полностью, уже отозван или истёк срок годности. Нужно выйти и вставить новый.';
  }
  if (res.status === 403) {
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      return 'Слишком много запросов к GitHub. Лимит восстанавливается автоматически в течение часа.';
    }
    return `GitHub отказал в доступе. Проверьте, что у токена есть право «Contents» на запись. ${detail}`.trim();
  }
  if (res.status === 404) {
    return `Не найдено: ${owner}/${repo}. Либо в config.js опечатка, либо у токена нет доступа именно к этому репозиторию — GitHub в обоих случаях отвечает одинаково.`;
  }
  if (res.status === 409) {
    return 'Репозиторий пуст — в нём ещё нет ни одного коммита.';
  }
  return `GitHub ответил ошибкой ${res.status}. ${detail}`.trim();
}

/**
 * @param {string} url
 * @param {string} [token] Токен для проверки при входе, до сохранения.
 */
async function get(url, token) {
  let res;
  try {
    res = await fetch(url, { headers: authHeaders(token), cache: 'no-store' });
  } catch {
    /*
      Сетевая ошибка, а не ответ сервера. Для российской аудитории это
      реальный сценарий, а не теоретический, поэтому и подсказка конкретная.
    */
    throw new Error('Не удалось связаться с api.github.com. Проверьте интернет: у части провайдеров GitHub открывается через VPN.');
  }

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* тело не обязано быть JSON — объясним по одному коду */
    }
    throw new Error(explain(res, body));
  }

  return res.json();
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
