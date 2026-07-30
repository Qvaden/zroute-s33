import { esc, plural } from '../ui/helpers.js';
import { maskToken } from './auth.js';
import { draftWeekIds } from './draft.js';

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
 *   canPush?: boolean,
 *   weekIds?: string[],
 * }} opts
 */
export function renderShell({ screens, activeId, inner, login = '', token, canPush = true, weekIds }) {
  /*
    Значок незаконченного ввода виден с любого экрана. Черновик живёт
    в браузере и молча ждёт публикации — без напоминания неделя может
    просидеть в нём до следующего VS, и никто не поймёт, почему на сайте пусто.

    Показываем только черновики существующих недель. После переномерации
    недель (W31 → W1) в браузере остаются черновики со старыми ключами:
    значок вёл бы на неделю, которой больше нет. Сам черновик не удаляем —
    вдруг это чья-то незаконченная работа, а данные восстановят.
  */
  const known = weekIds ? new Set(weekIds) : null;
  const drafts = draftWeekIds().filter((id) => !known || known.has(id));

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
        ${
          canPush
            ? ''
            : '<span class="adm-badge" title="У токена нет права Contents: Read and write">только чтение</span>'
        }
        ${
          drafts.length
            ? `<a href="#/week/${encodeURIComponent(drafts[0])}" class="adm-badge adm-badge--draft"
                  title="Незаконченный ввод ждёт публикации">${
                    drafts.length === 1
                      ? 'черновик'
                      : plural(drafts.length, 'черновик', 'черновика', 'черновиков')
                  }</a>`
            : ''
        }
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
