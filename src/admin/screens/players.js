import { esc } from '../../ui/helpers.js';
import { RULES } from '../../forum/rules.js';
import { roleBadge, roleLabel, verifiedBadge } from '../../forum/roles.js';

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
  const leaders = renderLeaders(forum.users);
  const moderators = forum.users.filter((u) => u.role === 'moderator').length;
  const verified = forum.users.filter((u) => u.isVerified).length;

  return `
    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Форум · учётные записи</span>
        <h1 class="adm-h1">Игроки</h1>
        <p class="adm-lead">
          ${esc(String(forum.users.length))} ${esc(peopleWord(forum.users.length))} на форуме.
          Здесь назначают модераторов, подтверждают ники, сбрасывают забытый
          пароль, закрывают возможность писать и удаляют чужие аккаунты.
        </p>
      </header>

      <div class="adm-result" data-players-result hidden></div>

      ${leaders}

      <div class="adm-players__toolbar">
        <label class="adm-player-search">
          <input type="search" data-player-search aria-label="Найти игрока" placeholder="Найти игрока, альянс или статус" autocomplete="off">
        </label>
        <div class="adm-players__stats" aria-label="Статистика игроков">
          <span><b>${moderators}</b> модераторов</span>
          <span><b>${verified}</b> проверенных</span>
        </div>
      </div>
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
          <b>Блогер</b> — игрок, который ведёт свой блог в разделе «Блоги».
          Отметка ставится и снимается одним нажатием, ничего не удаляет и
          не ограничивает: это только метка у постов и блок блога на странице.
        </p>
        <p class="muted">
          <b>Лидер альянса</b> — один на один альянс, и лидерство привязано
          к тегу его альянса. Он может создавать закрытые чаты (альянсовые и
          межальянсовые, до 200 человек). Не роль и не право на сайт: доверие
          своему альянсу. Чаты и их участников видно на вкладке «Чаты».
          Назначение нового лидера снимает предыдущего того же альянса.
          Назначив лидера, вы автоматически подтверждаете его ник.
        </p>
        <p class="muted">
          <b>Проверенный игрок</b> — ник подтверждён (самим фактом назначения
          лидером, или вручную здесь). Отметка видна у его ника в ленте и
          чатах, и только она открывает право создавать чаты. Непроверенный
          никогда не выдаст себя за того, чьё имя вы уже заняли. Снять отметку
          нельзя себе самому — это защита от прикола «под чужим ником».
        </p>
        <p class="muted">
          <b>Защита ников</b> работает автоматически: совпадения и похожие
          написания («Кремль», «Крeмль») блокируются базой. После переименования
          прежний ник резервируется навсегда и не может быть перехвачен.
        </p>
        <p class="muted">
          Пароль показывается один раз и только вам — передайте его человеку сами.
          Сохранённого пароля не существует: база хранит не его, а необратимый
          отпечаток, поэтому подсмотреть старый нельзя даже владельцу.
        </p>
      </div>
    </section>

    ${renderLeaderModal()}
    ${renderRenameModal()}
    ${renderResetModal()}
    ${renderRestrictModal()}
    ${renderDeleteModal()}`;
}

/**
 * Блок «Лидеры альянсов» — отдельная секция над списком, чтобы лидерство
 * одного альянса не тонуло в общем перечне игроков. Здесь сразу видно,
 * кто ведёт какой альянс, и назначение нового лидера конкурирует с этим.
 */
function renderLeaders(users) {
  const leaders = users
    .filter((u) => u.isLeader || (u.leaderOf ?? ''))
    .sort((a, b) => (a.leaderOf || '').localeCompare(b.leaderOf || '', 'ru'));
  if (!leaders.length) return '';

  const cards = leaders
    .map((u) => `
      <div class="adm-leader" data-player="${esc(u.id)}">
        <span class="adm-leader__tag">${esc((u.leaderOf || '').toUpperCase())}</span>
        <b class="adm-leader__nick">${esc(u.nick)}</b>
        <span class="adm-leader__meta muted">с ${esc(shortDate(u.createdAt))}</span>
        <div class="adm-leader__acts">
          <button type="button" class="adm-btn" data-player-leader="${esc(u.id)}"
                  data-player-nick="${esc(u.nick)}"
                  data-player-lead="1">
            Снять лидера
          </button>
        </div>
      </div>`)
    .join('');

  return `
    <div class="adm-leaders">
      <h2 class="adm-leaders__title">Лидеры альянсов</h2>
      <div class="adm-leaders__grid">${cards}</div>
    </div>`;
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

  const modTitle = isModerator ? 'Снять модератора' : 'Сделать модератором';
  const blogTitle = user.isBlogger ? 'Снять блогера' : 'Сделать блогером';
  const leaderTitle = user.isLeader
    ? `Снять лидера${(user.leaderOf || '') ? ` (${(user.leaderOf || '').toUpperCase()})` : ''}`
    : `Сделать лидером${(user.allianceTag || '') ? ` (${user.allianceTag.toUpperCase()})` : ''}`;
  const verTitle = user.isVerified ? 'Снять проверку' : 'Проверить ник';
  return `
    <div class="adm-player" data-player="${esc(user.id)}" data-player-search-text="${esc(`${user.nick} ${user.allianceTag || ''} ${user.role} ${user.isLeader ? 'лидер' : ''} ${user.isVerified ? 'проверен' : ''}`.toLowerCase())}">
      <div class="adm-player__who">
        <div class="adm-player__name">
          <b>${esc(user.nick)}</b>${roleBadge(user, { short: true })}${verifiedBadge(user.isVerified)}
          ${isMe ? '<span class="adm-player__self">вы</span>' : ''}
        </div>
        <small>На форуме с ${esc(shortDate(user.createdAt))}${user.allianceTag ? ` · ${esc(user.allianceTag.toUpperCase())}` : ''}</small>
      </div>

      <div class="adm-player__state">
        ${user.isLeader ? `<span class="adm-badge adm-badge--leader">лидер ${esc((user.leaderOf || '').toUpperCase())}</span>` : ''}
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
                    ПУЛЬТ ИГРОКА — одна строка.

                    Восемь кнопок на игрока занимали треть карточки: ряд уезжал
                    за край, а на телефоне карточка вытягивалась лестницей.
                    Частые действия стали компактными чипами прямо в строке
                    игрока — чип показывает состояние (модератор, блогер, лидер,
                    проверен), а не действие, поэтому видно, кто есть кто, не
                    читая подпись, а само действие подсказывает тултип. Редкое
                    и опасное (пароль, переименование, запрет, удаление) убрано
                    под «⋯», чтобы не стояло под рукой.
                  */
                  ''
                }
                <div class="adm-player__roles" role="group" aria-label="Роль и статус игрока">
                  <button type="button" class="adm-btn adm-pill adm-toggle${isModerator ? ' is-on' : ''}"
                          data-player-moderator="${esc(user.nick)}"
                          data-player-allow="${isModerator ? '' : '1'}"
                          title="${esc(modTitle)}">Модератор</button>
                  <button type="button" class="adm-btn adm-pill adm-toggle${user.isBlogger ? ' is-on' : ''}"
                          data-player-blogger="${esc(user.id)}"
                          data-player-nick="${esc(user.nick)}"
                          data-player-blog="${user.isBlogger ? '1' : ''}"
                          title="${esc(blogTitle)}">Блогер</button>
                  <button type="button" class="adm-btn adm-pill adm-toggle${user.isLeader ? ' is-on' : ''}"
                          data-player-leader="${esc(user.id)}"
                          data-player-nick="${esc(user.nick)}"
                          data-player-alliance="${esc(user.allianceTag || '')}"
                          data-player-lead="${user.isLeader ? '1' : ''}"
                          title="${esc(leaderTitle)}">Лидер</button>
                  <button type="button" class="adm-btn adm-pill adm-toggle${user.isVerified ? ' is-on' : ''}"
                          data-player-verify="${esc(user.id)}"
                          data-player-nick="${esc(user.nick)}"
                          data-player-ver="${user.isVerified ? '1' : ''}"
                          title="${esc(verTitle)}">Проверен</button>
                </div>
                <details class="adm-menu" data-player-menu name="player-menu">
                  <summary class="adm-menu__btn" title="Ещё действия" aria-label="Ещё действия">⋯</summary>
                  <div class="adm-menu__list">
                    <button type="button" class="adm-menu__item"
                            data-player-reset="${esc(user.id)}" data-player-nick="${esc(user.nick)}">Сбросить пароль</button>
                    <button type="button" class="adm-menu__item"
                            data-player-rename="${esc(user.id)}" data-player-nick="${esc(user.nick)}">Переименовать</button>
                    <button type="button" class="adm-menu__item"
                            data-player-restrict="${esc(user.id)}" data-player-nick="${esc(user.nick)}">${user.banned || muted ? 'Изменить запрет' : 'Запретить писать'}</button>
                    <button type="button" class="adm-menu__item adm-menu__item--danger"
                            data-player-delete="${esc(user.id)}" data-player-nick="${esc(user.nick)}">Удалить навсегда</button>
                  </div>
                </details>`
        }
      </div>
    </div>`;
}

/**
 * Окно назначения лидера.
 *
 * Лидерство привязано к альянсу: лидер ведёт конкретный тег. Альянс по
 * умолчанию подставляется из alliance_tag игрока (его же видно в списке),
 * но здесь его можно поправить, а для игрока без альянса — указать впервые.
 *
 * Если тег уже ведёт другой игрок, база снимает его при назначении —
 * об этом предупреждаем заранее, чтобы назначение не выглядело сюрпризом.
 */
function renderLeaderModal() {
  return `
    <div class="adm-modal" data-leader-modal hidden>
      <div class="adm-modal__box" role="dialog" aria-modal="true" aria-label="Назначить лидера">
        <h3>Сделать лидером <b data-leader-nick></b></h3>
        <p class="muted" data-leader-warning hidden></p>
        <form data-leader-form>
          <label class="adm-field">
            <span>Альянс (тег) — лидером какого альянса назначаем</span>
            <input type="text" name="leaderOf" maxlength="12" required
                   placeholder="Например: KR33"
                   autocomplete="off">
          </label>
          <div class="adm-actions">
            <button type="submit" class="adm-btn adm-btn--primary">Назначить</button>
            <button type="button" class="adm-btn" data-leader-cancel>Отмена</button>
          </div>
          <div class="adm-result" data-leader-error hidden></div>
        </form>
      </div>
    </div>`;
}

/**
 * Окно переименования игрока.
 *
 * Переименовывает владелец — например, когда тролль занял чужой ник или
 * переименовался в него. Причина обязательна и остаётся в журнале; рядом
 * показана вся история смен этого игрока. После смены можно подтвердить
 * или снять проверку ника той же панелью.
 */
function renderRenameModal() {
  return `
    <div class="adm-modal" data-rename-modal hidden>
      <div class="adm-modal__box" role="dialog" aria-modal="true" aria-label="Переименовать игрока">
        <h3>Переименовать <b data-rename-nick></b></h3>
        <p class="muted">
          Старые посты, комментарии и сообщения переподпишутся новым ником,
          а смена останется в журнале внизу.
        </p>
        <form data-rename-form>
          <label class="adm-field">
            <span>Новый ник</span>
            <input type="text" name="newNick" maxlength="40" required autocomplete="off">
          </label>
          <label class="adm-field">
            <span>Причина (останется в журнале)</span>
            <input type="text" name="reason" maxlength="500" required autocomplete="off"
                   placeholder="Например: вернулся к старому нику">
          </label>
          <div class="adm-actions">
            <button type="submit" class="adm-btn adm-btn--primary">Переименовать</button>
            <button type="button" class="adm-btn" data-rename-cancel>Отмена</button>
          </div>
          <div class="adm-result" data-rename-error hidden></div>
        </form>
        <div class="adm-rename-history">
          <h4 class="muted">История переименований</h4>
          <ul data-nick-history class="adm-reserved__list"><li class="muted">Загружаем…</li></ul>
        </div>
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
          <div class="adm-restrict-presets" aria-label="Готовые меры">
            <button type="button" class="adm-btn" data-restrict-preset="respect:1">Оскорбления · 1 день</button>
            <button type="button" class="adm-btn" data-restrict-preset="ads:7">Реклама · неделя</button>
            <button type="button" class="adm-btn" data-restrict-preset="hate:ban">Вражда · запрет</button>
          </div>
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
