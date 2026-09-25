import { esc } from '../../ui/helpers.js';
import { CATEGORIES, RULES, categoryLabel } from '../../forum/rules.js';
import { roleBadge, roleLabel, verifiedBadge } from '../../forum/roles.js';
import { formatHoldLeft } from '../../forum/recovery.js';
import { CONFIG } from '../../../config.js';

/** Те же 12 часов, что держит база: панель обещает срок, а не выдумывает его. */
const HOLD_HOURS = CONFIG.forum.limits.recoveryHoldHours;

/* Границы награды очками — те же числа, что проверяет forum_grant_reputation. */
const REP = CONFIG.forum.limits;

/**
 * ЭКРАН «ИГРОКИ» — учётные записи форума.
 *
 * Здесь три вещи, которых нет больше нигде: назначение модератора, решение
 * по заявке на восстановление доступа и запрет писать.
 *
 * ПОЧЕМУ ВООБЩЕ НУЖНЫ ЗАЯВКИ. Вход по нику и паролю, без почты — так решено
 * осознанно (см. config.js). Значит письма «восстановить пароль» не существует,
 * и единственным доказательством остаётся ключ, который игрок записал, когда
 * заводил заявку.
 *
 * РАНИЕШНИЙ ПОРЯДОК БЫЛ ХУЖЕ, ЧЕМ КАЖЕТСЯ. Владелец набирал новый пароль сам и
 * передавал его игроку — то есть каждый игрок жил с паролем, который знает
 * владелец, и сменить его самому было негде. Теперь пароль придумывает сам
 * игрок в своём браузере, а заявка принимает его по прошествии 12 часов — без
 * единого нажатия. Зачем тогда очередь: это единственные 12 часов, когда
 * владелец ещё может возразить. Его право не пускает игрока, но по-прежнему
 * решает исход, а знание чужого пароля не появляется нигде.
 *
 * ГДЕ ЖИВУТ ПРАВА. Не здесь. Роли решает база (site_set_moderator), заявки
 * подтверждает forum_review_recovery — она же проверяет, что вызвавший владелец.
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
          и возвращать доступ не к чему.
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
          Роли назначает и заявки на восстановление доступа подтверждает только
          владелец — это единственная граница между вами.
        </p>
      </section>`;
  }

  if (!forum.users) {
    return '<div class="loading">Читаем список игроков…</div>';
  }

  const rows = forum.users.map((u) => renderRow(u, forum.me)).join('');
  const leaders = renderLeaders(forum.users);
  const recoveries = renderRecoveries(forum.recoveries);
  const moderators = forum.users.filter((u) => u.role === 'moderator').length;
  const verified = forum.users.filter((u) => u.isVerified).length;

  return `
    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Форум · учётные записи</span>
        <h1 class="adm-h1">Игроки</h1>
        <p class="adm-lead">
          ${esc(String(forum.users.length))} ${esc(peopleWord(forum.users.length))} на форуме.
          Здесь назначают модераторов, подтверждают ники, выдают награды
          репутацией, решают заявки на восстановление доступа, закрывают
          возможность писать и удаляют чужие аккаунты.
        </p>
      </header>

      <div class="adm-result" data-players-result hidden></div>

      ${recoveries}
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
          и правит данные сайта. Не может одного: назначать роли и подтверждать
          заявки на доступ — иначе он назначил бы владельцем себя, и разница
          между ролями исчезла бы.
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
          <b>Репутация</b> — очки за признанную пользу, а не за количество
          сообщений. Их приносят проверенный модерацией разбор и ваша награда,
          и только они: благодарность игрока очок не стоит, иначе репутация
          оказалась бы счётчиком симпатий, который перекупается за вечер.
          Уровень человека при этом считается отдельно и по своему — награда
          его не меняет. Снять очки задним числом нельзя: история растёт
          обратной записью, и игрок видит в ней и причину, и дату.
        </p>
        <p class="muted">
          <b>Паролей вы не видите ни у кого</b> — и это не вежливость, а
          устройство входа: база держит необратимый отпечаток, и новый пароль
          игрок придумывает сам, в своём браузере. Через ${HOLD_HOURS} ч заявка
          примет его без вас, так что из панели заметно только то, кто просит
          вернуть доступ и сколько времени осталось до самоприёма.
        </p>
      </div>
    </section>

    ${renderLeaderModal()}
    ${renderRenameModal()}
    ${renderRepModal()}
    ${renderRestrictModal()}
    ${renderDeleteModal()}`;
}

/**
 * Очередь заявок на восстановление доступа.
 *
 * Стоит выше списка игроков, а не в нём внутри: заявка — это дело, у которого
 * есть срок, а игроков просмотрели и забыли. Неразобранная живёт неделю,
 * досрочно впущенная — сутки после решения, и показывать это надо часами,
 * а не датой создания: «создано 3 дня назад» не говорит владельцу, что он уже
 * опоздал.
 *
 * ГЛАВНОЕ ЧИСЛО В СТРОКЕ — сколько осталось до самоприёма. Именно оно
 * превращает список в дело: «возразить за 4 часа» и «когда-нибудь разбери» —
 * разные по смыслу приглашения, и второе не работает никогда.
 *
 * null — источник не ответил (черновой режим без паролей или база без
 * миграции). Пустой список при этом выглядит точно так же, поэтому отдельная
 * строка с объяснением нужнее галочки «всё чисто».
 */
function renderRecoveries(recoveries) {
  if (recoveries === null || recoveries === undefined) {
    return `
      <div class="adm-recoveries adm-recoveries--off">
        <p class="muted">Заявки на восстановление недоступны: этот режим входа
        паролей не имеет, а на боевой базе блок появится после применения
        <code>supabase/20260925-self-recovery.sql</code>.</p>
      </div>`;
  }

  const open = recoveries.filter((r) => r.status === 'pending');
  const held = recoveries.filter((r) => r.status === 'approved');

  if (!open.length && !held.length) {
    return `
      <div class="adm-recoveries adm-recoveries--empty">
        <p class="muted"><b>Заявок нет.</b> Восстановление доступа никому не
        требуется, или игроки ещё не знают, что теперь его делают сами —
        об этом пишет страница «О проекте».</p>
      </div>`;
  }

  const card = (r) => `
    <div class="adm-recovery" data-recovery="${esc(r.id)}">
      <b class="adm-recovery__nick">${esc(r.nick)}</b>
      <span class="adm-recovery__when muted">заявка ${esc(shortTime(r.createdAt))}</span>
      <span class="adm-recovery__deadline muted">${esc(holdLine(r))}</span>
      <div class="adm-recovery__acts">
        <button type="button" class="adm-btn adm-btn--primary"
                data-recovery-review="${esc(r.id)}" data-recovery-approve="1"
                data-recovery-nick="${esc(r.nick)}">Впустить сейчас</button>
        <button type="button" class="adm-btn"
                data-recovery-review="${esc(r.id)}" data-recovery-approve="0"
                data-recovery-nick="${esc(r.nick)}">Отклонить</button>
      </div>
    </div>`;

  return `
    <div class="adm-recoveries">
      <h2>Заявки на восстановление доступа</h2>
      <p class="muted">
        Игрок сам придумал ключ и сам придумает пароль, а через
        ${HOLD_HOURS} ч это откроется без вас. Работы здесь ровно
        одна: успеть отклонить чужую заявку. Своя — откроется сама, спрашивать
        у вас никто не будет. «Впустить сейчас» нужно лишь тогда, когда игрок
        напомнил о себе в игре и ждать ему незачем; «Отклонить» — единственное,
        что остаётся силы навсегда.
      </p>
      ${open.map((r) => card(r)).join('')}
      ${
        held.length
          ? `<p class="adm-recoveries__held muted">
               Впущены досрочно и ждут, пока игрок поставит пароль:
               ${esc(held.map((r) => `${r.nick} — ${remaining(r.expiresAt)}`).join(', '))}
             </p>`
          : ''
      }
    </div>`;
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
                    и опасное (переименование, запрет, удаление) убрано
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
                            data-player-rename="${esc(user.id)}" data-player-nick="${esc(user.nick)}">Переименовать</button>
                    <button type="button" class="adm-menu__item"
                            data-player-rep="${esc(user.id)}" data-player-nick="${esc(user.nick)}">Награда репутацией</button>
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
 * Окно награды репутацией.
 *
 * ПОЧЕМУ НЕ В ЧИПЕ НАСТРОЕНИЯ («Модератор», «Блогер»). Те четыре отметки
 * обратны одним нажатием того же места, и в этом их смысл: ошибся — снял.
 * Награда очками не снимается тем же нажатием, потому что её не пересчитывают,
 * а дополняют обратной записью, и причина у записи обязательна. Значит
 * здесь всегда два поля и окно, а не кнопка.
 *
 * ИСТОРИЯ ГРУЗИТСЯ ПРИ ОТКРЫТИИ, а не печатается в разметку: экран
 * перерисовывается целиком, и список, записанный в строку, устарел бы после
 * первой же выдачи — тот же порядок, что у истории переименований и частных
 * тишин.
 *
 * ГДЕ ГРАНИЦЫ. Число и длины полей держит база (forum_grant_reputation и
 * проверки таблицы forum_rep_grants); сюда они взяты из config.js только
 * затем, чтобы поле не предлагало то, что база отвергнет. Ограничение «только
 * владелец» с этой формы не снимается: панель показывает кнопку, а решает
 * функция, и отказ придёт из базы тем же текстом и для модератора.
 */
function renderRepModal() {
  return `
    <div class="adm-modal" data-rep-modal hidden>
      <div class="adm-modal__box" role="dialog" aria-modal="true" aria-label="Награда репутацией">
        <h3>Награда для <b data-rep-nick></b></h3>
        <p class="muted">
          Репутация — не активность и не уровень: её не нарабатывают текстами,
          её выдают за то, что сочли полезным. Запись остаётся в истории
          навсегда и видна самому игроку, поэтому пояснение обязательно.
          Отнять очки можно только обратной записью с той же причиной.
        </p>
        <form data-rep-form>
          <label class="adm-field">
            <span>Очки (от −${REP.repGrantMax} до ${REP.repGrantMax}, ноль не принимается)</span>
            <input type="number" name="delta" inputmode="numeric"
                   min="${-REP.repGrantMax}" max="${REP.repGrantMax}" step="1" required
                   placeholder="Например: 20" autocomplete="off">
          </label>
          <label class="adm-field">
            <span>Пояснение (от ${REP.repReasonMin} символов, увидит игрок)</span>
            <input type="text" name="reason" minlength="${REP.repReasonMin}" maxlength="${REP.repReasonMax}" required autocomplete="off"
                   placeholder="За что именно: офлайн-дело, а не «молодец»">
          </label>
          <div class="adm-actions">
            <button type="submit" class="adm-btn adm-btn--primary">Выдать награду</button>
            <button type="button" class="adm-btn" data-rep-cancel>Отмена</button>
          </div>
          <div class="adm-result" data-rep-error hidden></div>
        </form>
        <div class="adm-rep-history">
          <h4 class="muted">Что уже выдано этому игроку</h4>
          <ul data-rep-history class="adm-reserved__list"><li class="muted">Загружаем…</li></ul>
        </div>
      </div>
    </div>`;
}

/**
 * Строки истории наград — как renderSectionMuteRows: список рисует экран,
 * данные приносит вызов, а «пусто» и «не прочиталось» остаются разными
 * сообщениями, потому что для владельца это разные новости.
 *
 * Кто выдал, говорит база (grantedByNick), а не панель: владелец мог
 * переехать в другой аккаунт, и «владелец ушёл» честнее выдуманного ника.
 */
export function renderRepGrantRows(grants) {
  const rows = grants || [];
  if (!rows.length) {
    return '<li class="muted">Наград этому игроку ещё не выдавали.</li>';
  }
  return rows
    .map((g) => {
      const when = g.createdAt instanceof Date ? g.createdAt : new Date(g.createdAt);
      const points = Number(g.delta) > 0 ? `+${Number(g.delta)}` : String(Number(g.delta));
      return `<li class="adm-reserved__item">
        <b class="adm-rep__delta${Number(g.delta) < 0 ? ' adm-rep__delta--minus' : ''}">${esc(points)}</b>
        <span class="muted">${esc(shortTime(when))} · ${esc(g.grantedByNick || 'владелец ушёл')}</span>
        <span class="adm-rep__reason">${esc(g.reason || '')}</span>
      </li>`;
    })
    .join('');
}

/**
 * Окно ограничений.
 *
 * Причина обязательна и пункт правил выбирается из того же списка, что
 * показан игрокам: «запрещено» без причины выглядит произволом и ничему
 * не учит. Тишина на срок стоит впереди вечного запрета намеренно —
 * так первая мера оказывается соразмерной.
 *
 * РЯДОМ ЖИВЁТ ЧАСТНАЯ МЕРА — тишина в одном разделе. Общая мера и частная
 * отвечают за разное, поэтому у них две разные формы и две кнопки: одно
 * нажатие не должно решать и то и другое. Формы нельзя гнездить, так что
 * вторая стоит не внутри первой, а следующим блоком того же окна.
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

        ${renderSectionMuteBlock(DURATIONS)}
      </div>
    </div>`;
}

/*
  Тишина в одном разделе: закрывает один раздел, остальной форум остаётся
  открытым. Мера живёт рядом с общей, потому что выбирается в тот же момент —
  когда модератор уже смотрит на нарушителя и решает, насколько он нарушил.

  Срок здесь не свободный, а из четырёх готовых: те же сутки-неделя-месяц, что
  у общей тишины. Число 1–30 проверяет база, и панель его не дублирует —
  она даёт выбрать, а не позволяет написать что угодно.

  Список действующих тишин грузится при открытии окна (см. loadSectionMutes в
  main.js), а не печатается здесь: экран перерисовывается целиком, и срок,
  записанный в разметку, устарел бы при первом же снятии.
*/
function renderSectionMuteBlock(durations) {
  return `
    <details class="adm-section-mute" data-section-mute-panel>
      <summary>Тишина в одном разделе</summary>

      <p class="muted">
        Закрывает игроку один раздел, остальной форум остаётся открытым. Снимается
        сама по истечении срока. Последний открытый раздел не закрывается: сумма
        частных тишин стала бы общим запретом, а общий запрет игрок может оспорить,
        и у молчания по разделам такой двери нет.
      </p>

      <ul class="adm-reserved__list" data-section-mutes><li class="muted">Загружаем…</li></ul>

      <form data-section-mute-form>
        <label class="adm-field">
          <span>Раздел</span>
          <select name="category">
            ${CATEGORIES.map((c) => `<option value="${esc(c.id)}">${esc(c.label)} — ${esc(c.hint)}</option>`).join('')}
          </select>
        </label>

        <label class="adm-field">
          <span>Срок</span>
          <select name="days">
            ${durations.map((d) => `<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('')}
          </select>
        </label>

        <label class="adm-field">
          <span>Пояснение (увидит игрок)</span>
          <input type="text" name="reason" minlength="5" maxlength="200" required autocomplete="off"
                 placeholder="За что раздел закрыт именно ему">
        </label>

        <div class="adm-actions">
          <button type="submit" class="adm-btn adm-btn--primary">Закрыть раздел</button>
        </div>
        <div class="adm-result" data-section-mute-error hidden></div>
      </form>
    </details>`;
}

/**
 * Действующие тишины игрока — строками того же списка, что и история
 * переименований.
 *
 * Истёкшие строки здесь отбрасываются, хотя читались целиком: предложение
 * «снять» с той, что уже снялась сама, было бы обманом — модератор нажал бы
 * и получил запись в журнале про меру, которой нет.
 *
 * Пустой список и отказ — разные ответы, и панель их не смешивает: «ни один
 * раздел не закрыт» говорит база, а не панель на глаз, поэтому молча подменять
 * одно другим нельзя (отказ показывается своим сообщением в main.js).
 */
export function renderSectionMuteRows(mutes) {
  const now = Date.now();
  const live = (mutes || []).filter((m) => new Date(m.mutedUntil) > now);
  if (!live.length) {
    return '<li class="muted">Ни один раздел этому игроку не закрыт.</li>';
  }
  return live
    .map((m) => {
      const until = new Date(m.mutedUntil);
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${pad(until.getDate())}.${pad(until.getMonth() + 1)}.${until.getFullYear()} ${pad(until.getHours())}:${pad(until.getMinutes())}`;
      return `<li class="adm-reserved__item">
        <b>${esc(categoryLabel(m.category))}</b>
        <span class="muted">до ${esc(stamp)} · ${esc(m.reason || 'без пояснения')}</span>
        <button type="button" class="adm-btn"
                data-section-mute-clear="${esc(m.category)}">Снять</button>
      </li>`;
    })
    .join('');
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

/**
 * Сколько заявке осталось жить.
 *
 * Дата окончания тут не полезна: «до 26 сен, 04:10» не отвечает на единственный
 * вопрос владельца — решать сейчас или игрок уже не придёт. Поэтому часы и дни,
 * а не секунды: досрочный пропуск живёт сутки, заявка — неделю.
 */
function remaining(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'срок неизвестен';
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return 'срок вышел';
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return `осталось ${Math.max(1, Math.floor(ms / 60000))} мин`;
  if (hours < 24) return `осталось ${hours} ч`;
  const days = Math.floor(hours / 24);
  return `осталось ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}`;
}

/**
 * Что будет с заявкой, если владелец не тронет её.
 *
 * Два исхода, и оба нужно видеть разными словами: «откроется через 4 ч» —
 * время возразить ещё есть; «открыта» — игрок уже может ставить пароль, и
 * отклонение здесь в последний раз что-то меняет. Досрочно впущенные в эту
 * строку не попадают: для них счёт идёт от решения, и им хватает отдельной
 * строки ниже.
 *
 * Без readyAt строка не «0 ч», а «срок неизвестен»: такое бывает, когда база
 * ещё не перестроена под новый порядок, и выдать это за открытую дверь значило
 * бы соврать владельцу в самую ответственную сторону.
 */
function holdLine(r) {
  if (!(r.readyAt instanceof Date) || Number.isNaN(r.readyAt.getTime())) return 'срок неизвестен';
  const left = formatHoldLeft(r.readyAt);
  return left ? `откроется через ${left}` : 'открыта — ждёт пароль';
}
