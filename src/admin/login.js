import { esc } from '../ui/helpers.js';
import { CONFIG } from '../../config.js';

/**
 * ЭКРАН ВХОДА.
 *
 * Раньше вместо пароля здесь был токен GitHub, и экран занимали две длинные
 * инструкции: как выпустить токен владельцу и как — приглашённому редактору
 * (у GitHub там ловушка: fine-grained токен нельзя выдать на чужой
 * репозиторий, приглашённому нужен классический, а он шире по правам).
 *
 * Это работало, но означало, что редактор фактически один — владелец.
 * Объяснять человеку, что такое personal access token, ради правки счёта
 * в VS — заведомо проигрышная затея, и на практике никого не приглашали.
 *
 * Теперь вход тот же, что на форуме: ник и пароль. Права выдаются нажатием
 * в панели, у нового редактора нет ни одного лишнего шага. Инструкции
 * исчезли не потому, что их сократили, а потому что объяснять больше нечего.
 */
export function renderLogin({ error, configured = true } = {}) {
  if (!configured) {
    return `
      <div class="adm-login">
        <section class="adm-login__card">
          <span class="eyebrow">Панель · Сервер 33</span>
          <h1 class="adm-h1">База не подключена</h1>
          <p class="adm-lead">
            В <code class="adm-mono">config.js</code> не заполнен раздел
            <code class="adm-mono">supabase</code>. Пока его нет, входить некуда:
            и данные сайта, и учётные записи живут в базе.
          </p>
          <p class="muted">Порядок подключения — <code class="adm-mono">docs/FORUM.md</code>.</p>
          <p class="adm-login__foot muted">
            <span></span>
            <a href="./index.html">Вернуться на сайт</a>
          </p>
        </section>
      </div>`;
  }

  const L = CONFIG.forum.limits;

  return `
    <div class="adm-login">
      <section class="adm-login__card">
        <span class="eyebrow">Панель · Сервер 33</span>
        <h1 class="adm-h1">Вход</h1>
        <p class="adm-lead">
          Тот же ник и пароль, что на форуме. Отдельной учётной записи
          для панели нет — права различаются ролью, а не паролем.
        </p>

        ${error ? `<p class="adm-error">${esc(error)}</p>` : ''}

        <form class="adm-login__form" data-login>
          <label class="adm-field">
            <span>Ник</span>
            <input type="text" name="nick" autocomplete="username" spellcheck="false"
                   minlength="${L.nickMin}" maxlength="${L.nickMax}"
                   placeholder="как на форуме" required>
          </label>
          <label class="adm-field">
            <span>Пароль</span>
            <input type="password" name="password" autocomplete="current-password"
                   minlength="${L.passwordMin}" required>
          </label>
          <button type="submit" class="adm-btn adm-btn--primary">Войти</button>
        </form>

        <details class="adm-help">
          <summary>Нет доступа?</summary>
          <p>
            Панель открывается тем, у кого есть право редактора. Его выдаёт
            администратор форума на вкладке <b>Игроки</b> — одним нажатием,
            без GitHub и без токенов.
          </p>
          <ol>
            <li>Зарегистрируйтесь на сайте, на вкладке <b>Форум</b></li>
            <li>Скажите администратору свой ник</li>
            <li>Возвращайтесь сюда</li>
          </ol>
          <p class="muted">
            Забытый пароль сбрасывает администратор: письма «восстановить
            пароль» не существует, потому что почты у сайта нет.
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
