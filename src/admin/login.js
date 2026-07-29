import { esc } from '../ui/helpers.js';
import { CONFIG } from '../../config.js';

/**
 * Экран входа.
 *
 * Своей системы аккаунтов нет: пароль — это токен GitHub. Экран обязан
 * объяснить это так, чтобы человек не программист понял, что делает,
 * и не испугался слова «токен».
 *
 * Инструкция здесь же, а не только в docs/ADMIN.md: человек, который
 * не может войти, до документации не доберётся.
 */
export function renderLogin({ error } = {}) {
  const { owner, repo } = CONFIG.github;

  return `
    <div class="adm-login">
      <section class="adm-login__card">
        <span class="eyebrow">Панель · Сервер 33</span>
        <h1 class="adm-h1">Вход</h1>
        <p class="adm-lead">
          Пароля у панели нет. Вместо него — токен GitHub: он же и определяет,
          что вам разрешено. Токен остаётся в этом браузере и уходит только
          на api.github.com.
        </p>

        ${error ? `<p class="adm-error">${esc(error)}</p>` : ''}

        <form class="adm-login__form" data-login>
          <label class="adm-field">
            <span>Токен</span>
            <input type="password" name="token" autocomplete="off" spellcheck="false"
                   placeholder="github_pat_… или ghp_…" required>
          </label>
          <button type="submit" class="adm-btn adm-btn--primary">Войти</button>
        </form>

        <details class="adm-help">
          <summary>Как получить токен — для владельца репозитория</summary>
          <ol>
            <li>GitHub → аватар → <b>Settings</b></li>
            <li>Внизу слева <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b></li>
            <li><b>Generate new token</b></li>
            <li>Repository access → <b>Only select repositories</b> → <code class="adm-mono">${esc(owner)}/${esc(repo)}</code></li>
            <li>Permissions → Repository permissions → <b>Contents: Read and write</b></li>
            <li>Срок годности — год, максимум разрешённый GitHub</li>
            <li><b>Generate token</b>, скопировать и вставить сюда</li>
          </ol>
          <p class="muted">Токен показывается один раз. Потерялся — выпускается новый, старый отзывается.</p>
        </details>

        <details class="adm-help">
          <summary>Как получить токен — для приглашённого редактора</summary>
          <p>
            Здесь у GitHub есть ловушка: <b>fine-grained токен нельзя выдать
            на чужой репозиторий.</b> Он видит только то, что принадлежит своему
            владельцу. Поэтому приглашённому редактору нужен классический токен:
          </p>
          <ol>
            <li>Владелец добавляет человека: репозиторий → Settings → Collaborators</li>
            <li>Редактор: Settings → Developer settings → <b>Tokens (classic)</b></li>
            <li><b>Generate new token (classic)</b>, право — только <code class="adm-mono">public_repo</code></li>
          </ol>
          <p class="muted">
            Классический токен шире по правам, чем хотелось бы: он действует
            на все публичные репозитории человека. Если это однажды станет
            неприемлемо — репозиторий переносится в бесплатную организацию,
            и тогда fine-grained заработает и для приглашённых.
          </p>
        </details>

        <!--
          Обе половины подвала обёрнуты в span намеренно: в flex-контейнере
          голый текст становится отдельным элементом, и «Подробнее — в»,
          путь и точка разъезжаются по строке в разные стороны.
        -->
        <p class="adm-login__foot muted">
          <span>Подробнее — в <code class="adm-mono">docs/ADMIN.md</code></span>
          <a href="./index.html">Вернуться на сайт</a>
        </p>
      </section>
    </div>`;
}
