/**
 * ВХОД В ПАНЕЛЬ.
 *
 * Никакой своей системы аккаунтов нет и не будет: пароль — это токен
 * GitHub, а права на запись — это права токена. Сервера, который мог бы
 * проверять логины, у проекта нет, и именно поэтому панель бесплатна.
 *
 * Токен живёт в localStorage браузера редактора и не уходит никуда, кроме
 * api.github.com. В коде, в репозитории и в логах его нет — и не должно
 * появиться: `console.log` токена приравнивается к публикации токена.
 *
 * Репозиторий публичный, секретов в нём нет, права токена — только
 * содержимое одного репозитория. Худший сценарий утечки — испорченные
 * данные, а они откатываются через историю git.
 */
const KEY = 'zr33.admin.token';

/**
 * localStorage умеет бросать: приватный режим, отключённые куки,
 * открытие файла с диска. Панель от этого падать не должна.
 * @param {() => any} fn
 */
function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** @returns {string} */
export function getToken() {
  return safe(() => localStorage.getItem(KEY) || '', '') || '';
}

/** @param {string} token */
export function setToken(token) {
  safe(() => localStorage.setItem(KEY, String(token).trim()));
}

export function clearToken() {
  safe(() => localStorage.removeItem(KEY));
}

export function hasToken() {
  return getToken().length > 0;
}

/**
 * Заголовки для любого запроса к API.
 *
 * Bearer понимают оба вида токенов — и fine-grained, и классический.
 * Это важно: fine-grained нельзя выдать на чужой репозиторий, поэтому
 * приглашённым редакторам остаётся классический. Подробности в docs/ADMIN.md.
 *
 * @param {string} [token] Если не передан — берётся сохранённый.
 */
export function authHeaders(token) {
  const t = (token ?? getToken()).trim();
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

/**
 * Показ токена в интерфейсе: только хвост, чтобы человек убедился,
 * что вошёл тем токеном, которым думал, — и при этом ничего не утекло
 * ни в скриншот, ни в демонстрацию экрана.
 */
export function maskToken(token = getToken()) {
  const t = String(token).trim();
  if (t.length < 8) return '••••';
  return `${'•'.repeat(6)}${t.slice(-4)}`;
}
