import { esc } from '../ui/helpers.js';
import { maskToken } from './auth.js';

/**
 * Каркас панели: шапка, меню, подвал.
 *
 * Вынесено из main.js отдельной чистой функцией по той же причине, по которой
 * страницы сайта — чистые функции: так каркас можно отрисовать без браузера.
 * Это нужно и тесту, и превью для показа — иначе единственный способ увидеть
 * панель был бы «зайти с рабочим токеном», а значит её нельзя ни проверить,
 * ни показать, не выдав доступ.
 *
 * @param {{
 *   screens: {id: string, label: string}[],
 *   activeId: string,
 *   inner: string,
 *   login?: string,
 *   token?: string,
 * }} opts
 */
export function renderShell({ screens, activeId, inner, login = '', token }) {
  return `
    <header class="adm-top">
      <a class="adm-top__brand" href="#/overview">
        <b>33</b><span>панель</span>
      </a>
      <nav class="adm-nav">
        ${screens
          .map(
            (s) => `<a href="#/${s.id}" class="adm-nav__link ${s.id === activeId ? 'is-active' : ''}">${esc(s.label)}</a>`
          )
          .join('')}
      </nav>
      <div class="adm-top__right">
        <span class="adm-badge" title="Панель этой версии не может изменить данные">только просмотр</span>
        <button type="button" class="adm-btn" data-refresh>Обновить</button>
        <span class="adm-who">
          ${login ? `<b>${esc(login)}</b>` : ''}
          <i class="adm-mono muted">${esc(maskToken(token))}</i>
        </span>
        <button type="button" class="adm-btn" data-logout>Выйти</button>
      </div>
    </header>

    <main class="adm-main">${inner}</main>

    <footer class="adm-foot">
      <span>Данные читаются напрямую из репозитория · сервера у панели нет</span>
      <a href="./index.html">Открыть сайт</a>
    </footer>`;
}
