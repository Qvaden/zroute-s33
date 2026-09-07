import { esc } from '../../ui/helpers.js';
import { RULES } from '../../forum/rules.js';
import { roleBadge, roleLabel } from '../../forum/roles.js';

/**
 * ЭКРАН «ИГРОКИ» — учётные записи форума.
 *
 * Здесь три вещи, которых нет больше нигде: назначение модератора, сброс
 * пароля и запрет писать.
 *
 * ПОЧЕМУ СБРОС ПАРОЛЯ ВООБЩЕ НУЖЕН. Вход по нику и паролю, без почты — так
 * решено осознанно (см. config.js). Значит письма «восстановить пароль»
 * не существует, и единственный способ вернуть человеку доступ — сделать это
 * руками. Без этого экрана забытый пароль означал бы потерянный аккаунт
 * навсегда.
 *
 * ГДЕ ЖИВУТ ПРАВА. Не здесь. Роли и пароли — дело владельца, и проверяет это
 * сама база: функции forum_admin_reset_password и site_set_moderator.
 * Панель лишь показывает кнопки; отказ приходит из базы, а не отсюда.
 *
 * Экран — чистая функция от данных, как и остальные: его можно отрисовать
 * без браузера и без доступа к базе.
 */
export function renderPlayers(view) {
  const forum = view.forum ?? {};

  if (!forum.configured) {
    return `
      <section class="panel">
        <header class="panel__head">
          <span class="eyebrow">Форум</span>
          <h1 class="adm-h1">Игроки</h1>
        </header>
        <p class="adm-lead">
          Форум ещё не подключён: в <code>config.js</code> пустой раздел
          <code>forum.supabase</code>. Пока его нет, учётных записей не существует
          и сбрасывать нечего.
        </p>
        <p class="muted">Порядок подключения описан в <code>docs/FORUM.md</code>.</p>
      </section>`;
  }

  if (forum.error) {
    return `
      <section class="panel error">
        <h1 class="adm-h1">Форум не отвечает</h1>
        <p class="adm-lead">${esc(forum.error)}</p>
        <div class="adm-actions">
          <button type="button" class="adm-btn" data-forum-reload>Попробовать снова</button>
        </div>
      </section>`;
  }

  if (!forum.me) {
    return `
      <section class="panel">
        <header class="panel__head">
          <span class="eyebrow">Форум</span>
          <h1 class="adm-h1">Игроки</h1>
        </header>
        <p class="adm-lead">
          Вы не вошли на форум в этом браузере. Токен GitHub здесь не поможет:
          права на форуме — это отдельная учётная запись, и проверяет их сама база.
        </p>
        <p class="muted">
          Откройте сайт, войдите своим ником владельца и вернитесь сюда.
        </p>
        <div class="adm-actions">
          <a class="adm-btn" href="./index.html#/forum">Открыть форум</a>
          <button type="button" class="adm-btn" data-forum-reload>Проверить снова</button>
        </div>
      </section>`;
  }

  if (forum.me.role !== 'admin') {
    return `
      <section class="panel">
        <header class="panel__head">
          <span class="eyebrow">Форум</span>
          <h1 class="adm-h1">Игроки</h1>
        </header>
        <p class="adm-lead">
          Вы вошли как <b>${esc(forum.me.nick)}</b> (${esc(roleLabel(forum.me))}).
          Роли назначает и пароли сбрасывает только владелец — это единственная
          граница между вами.
        </p>
      </section>`;
  }

  if (!forum.users) {
    return '<div class="loading">Читаем список игроков…</div>';
  }

  const rows = forum.users.map((u) => renderRow(u, forum.me)).join('');

  return `
    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Форум · учётные записи</span>
        <h1 class="adm-h1">Игроки</h1>
        <p class="adm-lead">
          ${esc(String(forum.users.length))} ${esc(peopleWord(forum.users.length))} на форуме.
          Здесь назначают модераторов, сбрасывают забытый пароль, закрывают
          возможность писать и удаляют чужие аккаунты.
        </p>
      </header>

      <div class="adm-result" data-players-result hidden></div>

      <div class="adm-players">${rows}</div>

      <div class="adm-players__notes">
        <p class="muted">
          <b>Модератор</b> разбирает жалобы, удаляет чужие записи, выдаёт запреты
          и правит данные сайта. Не может одного: назначать роли и сбрасывать
          пароли — иначе он назначил бы владельцем себя, и разница между ролями
          исчезла бы.
        </p>
        <p class="muted">
          <b>Владелец один</b>, и это правило держит база, а не договорённость.
          Передача сайта другому человеку делается запросом в базу, а не нажатием:
          такое решение не должно приниматься случайно.
        </p>
        <p class="muted">
          Пароль показывается один раз и только вам — передайте его человеку сами.
          Сохранённого пароля не существует: база хранит не его, а необратимый
          отпечаток, поэтому подсмотреть старый нельзя даже владельцу.
        </p>
      </div>
    </section>

    ${renderResetModal()}
    ${renderRestrictModal()}
    ${renderDeleteModal()}`;
}

/** Одна строка списка. */
function renderRow(user, me) {
  const isMe = user.id === me.id;
  const muted = user.mutedUntil && user.mutedUntil > new Date();
  const isOwner = user.role === 'admin';
  const isModerator = user.role === 'moderator';

  const status = user.banned
    ? '<span class="adm-badge adm-badge--stop">запрет</span>'
    : muted
      ? `<span class="adm-badge">тишина до ${esc(shortTime(user.mutedUntil))}</span>`
      : '';

  return `
    <div class="adm-player" data-player="${esc(user.id)}">
      <div class="adm-player__who">
        <b>${esc(user.nick)}${roleBadge(user, { short: true })}</b>
        <small>с ${esc(shortDate(user.createdAt))}</small>
      </div>

      <div class="adm-player__state">
        ${status}
        ${user.banned && user.banReason ? `<span class="adm-player__reason">${esc(user.banReason)}</span>` : ''}
      </div>

      <div class="adm-player__acts">
        ${
          isMe
            ? '<span class="muted">это вы</span>'
            : isOwner
              ? '<span class="muted">владелец</span>'
              : `
                ${
                  /*
                    ГЛАВНАЯ КНОПКА ЭТОГО ЭКРАНА.

                    Раньше, чтобы пустить помощника, надо было выдать ему доступ
                    к репозиторию и объяснить, что такое personal access token.
                    На практике это означало, что помощников нет.

                    Теперь одно нажатие. Роль владельца при этом не выдаётся:
                    владелец один, и передача сайта делается осознанно,
                    запросом в базу, а не нажатием рядом с обычной кнопкой.
                  */
                  ''
                }
                <button type="button" class="adm-btn ${isModerator ? '' : 'adm-btn--primary'}"
                        data-player-moderator="${esc(user.nick)}"
                        data-player-allow="${isModerator ? '' : '1'}">
                  ${isModerator ? 'Снять модератора' : 'Сделать модератором'}
                </button>
                <button type="button" class="adm-btn"
                        data-player-reset="${esc(user.id)}" data-player-nick="${esc(user.nick)}">
                  Сбросить пароль
                </button>
                <button type="button" class="adm-btn"
                        data-player-restrict="${esc(user.id)}" data-player-nick="${esc(user.nick)}"
                        data-player-banned="${user.banned ? '1' : ''}">
                  ${user.banned || muted ? 'Изменить запрет' : 'Запретить писать'}
                </button>
                <button type="button" class="adm-btn adm-btn--danger"
                        data-player-delete="${esc(user.id)}" data-player-nick="${esc(user.nick)}">
                  Удалить навсегда
                </button>`
        }
      </div>
    </div>`;
}

/**
 * Окно сброса.
 *
 * Пароль вводится, а не придумывается панелью автоматически: сгенерированный
 * пароль пришлось бы куда-то показать и откуда-то скопировать, а человеку
 * потом ещё и набрать его в игре с телефона. Кнопка «придумать» рядом есть —
 * для тех случаев, когда придумывать самому лень.
 */
function renderResetModal() {
  return `
    <div class="adm-modal" data-reset-modal hidden>
      <div class="adm-modal__box" role="dialog" aria-modal="true" aria-label="Сброс пароля">
        <h3>Новый пароль для <b data-reset-nick></b></h3>
        <p class="muted">
          Старый пароль перестанет работать сразу. Человек войдёт с новым
          и сможет поменять его сам.
        </p>
        <form data-reset-form>
          <label class="adm-field">
            <span>Новый пароль</span>
            <input type="text" name="password" required minlength="8" autocomplete="off"
                   placeholder="от 8 символов">
          </label>
          <div class="adm-actions">
            <button type="button" class="adm-btn" data-reset-suggest>Придумать за меня</button>
            <button type="submit" class="adm-btn adm-btn--primary">Сбросить</button>
            <button type="button" class="adm-btn" data-reset-cancel>Отмена</button>
          </div>
          <div class="adm-result" data-reset-error hidden></div>
        </form>
      </div>
    </div>`;
}

/**
 * Окно ограничений.
 *
 * Причина обязательна и пункт правил выбирается из того же списка, что
 * показан игрокам: «запрещено» без причины выглядит произволом и ничему
 * не учит. Тишина на срок стоит впереди вечного запрета намеренно —
 * так первая мера оказывается соразмерной.
 */
function renderRestrictModal() {
  const DURATIONS = [
    { id: '1', label: 'сутки' },
    { id: '3', label: '3 дня' },
    { id: '7', label: 'неделя' },
    { id: '30', label: 'месяц' },
  ];

  return `
    <div class="adm-modal" data-restrict-modal hidden>
      <div class="adm-modal__box" role="dialog" aria-modal="true" aria-label="Запрет писать">
        <h3>Ограничить <b data-restrict-nick></b></h3>
        <form data-restrict-form>
          <label class="adm-field">
            <span>Пункт правил</span>
            <!--
              Обязателен, только когда мера что-то ограничивает (тишина, запрет).
              «Снять все ограничения» пункт не требует: к нарушению на этом шаге
              никто не обращается.
            -->
            <select name="ruleId">
              ${RULES.map(
                (r, i) => `<option value="${esc(r.id)}">${i + 1}. ${esc(r.title)}</option>`
              ).join('')}
            </select>
          </label>

          <label class="adm-field">
            <span>Мера</span>
            <select name="duration">
              ${DURATIONS.map((d) => `<option value="${esc(d.id)}">Тишина: ${esc(d.label)}</option>`).join('')}
              <option value="ban">Запрет без срока</option>
              <option value="none">Снять все ограничения</option>
            </select>
          </label>

          <label class="adm-field">
            <span>Пояснение (увидит игрок)</span>
            <input type="text" name="note" maxlength="200" autocomplete="off">
          </label>

          <div class="adm-actions">
            <button type="submit" class="adm-btn adm-btn--primary">Применить</button>
            <button type="button" class="adm-btn" data-restrict-cancel>Отмена</button>
          </div>
          <div class="adm-result" data-restrict-error hidden></div>
        </form>

        <!--
          Разница между тишиной и запретом объяснена здесь, а не в документации:
          выбирают её в этом окне, и человек, который сомневается, до документации
          не пойдёт.
        -->
        <p class="muted adm-modal__note">
          <b>Тишина</b> — не может писать посты, комментарии и ставить реакции,
          но остаётся на форуме и видит причину. Снимается сама по истечении срока.
          <br>
          <b>Запрет</b> — то же самое, но без срока: снимать только вручную.
        </p>
      </div>
    </div>`;
}

/**
 * Окно удаления аккаунта.
 *
 * В единственной операции форума, которая необратима, ник вводится руками:
 * случайное нажатие не должно стирать человека. Пароль и запрет — поправимые
 * действия, удаление — нет, и это единственное окно, где подтверждение
 * обязано быть осознанным.
 *
 * Посты и комментарии при этом остаются: ник лежит копией в самой записи,
 * и удаление аккаунта рвёт только связь с автором.
 */
function renderDeleteModal() {
  return `
    <div class="adm-modal" data-delete-modal hidden>
      <div class="adm-modal__box" role="dialog" aria-modal="true" aria-label="Удаление аккаунта">
        <h3>Удалить аккаунт <b data-delete-nick></b></h3>
        <p class="muted">
          Навсегда и без возврата: вход, страница участника, его реакции,
          голоса и поданные им жалобы исчезнут. Посты и комментарии
          <b>останутся</b> на форуме — ник в них сохранён копией.
        </p>
        <form data-delete-player-form>
          <label class="adm-field">
            <span>Введите ник игрока для подтверждения</span>
            <input type="text" name="confirm" autocomplete="off"
                   placeholder="Отмена, если сомневаетесь">
          </label>
          <div class="adm-actions">
            <button type="submit" class="adm-btn adm-btn--danger">Удалить навсегда</button>
            <button type="button" class="adm-btn" data-delete-player-cancel>Отмена</button>
          </div>
          <div class="adm-result" data-delete-error hidden></div>
        </form>
      </div>
    </div>`;
}

function peopleWord(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'человек';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'человека';
  return 'человек';
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function shortDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function shortTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}