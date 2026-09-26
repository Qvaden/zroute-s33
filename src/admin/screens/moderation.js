import { esc, plural } from '../../ui/helpers.js';
import { RULES, categoryLabel } from '../../forum/rules.js';
import { postBody } from '../../forum/format.js';
import { CONFIG } from '../../../config.js';

/**
 * ЭКРАН «ЖАЛОБЫ» — разбор нарушений на форуме.
 *
 * ПОЧЕМУ ЭТОТ ЭКРАН ВООБЩЕ СУЩЕСТВУЕТ. В проекте нет списка запрещённых слов
 * и нет никакой автоматической проверки смысла — осознанно, см. рассуждение
 * в src/forum/rules.js. Такой список одновременно ловит невиновных и обходится
 * одной точкой внутри слова, то есть даёт видимость модерации вместо неё.
 *
 * Значит смысловые правила держит человек, и жалоба — его основной
 * инструмент. Без этого экрана правила остались бы текстом, который никто
 * не применяет.
 *
 * ЧТО ВИДНО, А ЧТО НЕТ. Кто пожаловался — видно только здесь и только
 * модерации: открытый список жалующихся сам становится инструментом травли.
 * За это отвечает политика доступа в базе, а не этот файл.
 */
export function renderModeration(view) {
  const f = view.forum ?? {};

  if (!f.configured) {
    return `
      <section class="panel">
        <header class="panel__head">
          <span class="eyebrow">Форум</span>
          <h1 class="adm-h1">Жалобы</h1>
        </header>
        <p class="adm-lead">
          Форум ещё не подключён: в <code>config.js</code> пустой раздел
          <code>forum.supabase</code>. Жаловаться пока не на что.
        </p>
      </section>`;
  }

  if (f.error) {
    return `
      <section class="panel error">
        <h1 class="adm-h1">Форум не отвечает</h1>
        <p class="adm-lead">${esc(f.error)}</p>
        <div class="adm-actions">
          <button type="button" class="adm-btn" data-forum-reload>Попробовать снова</button>
        </div>
      </section>`;
  }

  if (!f.me) {
    return `
      <section class="panel">
        <header class="panel__head">
          <span class="eyebrow">Форум</span>
          <h1 class="adm-h1">Жалобы</h1>
        </header>
        <p class="adm-lead">
          Вы не вошли на форум в этом браузере. Права на форуме — отдельная
          учётная запись, токен GitHub здесь не действует.
        </p>
        <div class="adm-actions">
          <a class="adm-btn" href="./index.html#/forum">Открыть форум</a>
          <button type="button" class="adm-btn" data-forum-reload>Проверить снова</button>
        </div>
      </section>`;
  }

  if (f.me.role !== 'admin' && f.me.role !== 'moderator') {
    return `
      <section class="panel">
        <header class="panel__head">
          <span class="eyebrow">Форум</span>
          <h1 class="adm-h1">Жалобы</h1>
        </header>
        <p class="adm-lead">
          Вы вошли как <b>${esc(f.me.nick)}</b> — участник. Жалобы разбирают
          модераторы и администратор.
        </p>
      </section>`;
  }

  if (!f.reports) {
    return '<div class="loading">Читаем жалобы…</div>';
  }

  const queue = f.moderationQueue ?? [];
  const actions = f.moderationActions ?? [];
  /*
    Очередь заявок — первым блоком и на обоих исходах ниже. Жалоба говорит
    «посмотри, там нарушили», апелляция говорит «посмотри, тут решили про
    тебя». Второе человек ждёт, поэтому оно и стоит выше.
  */
  const appeals = renderAppeals(f.appeals);
  const signals = renderSpamSignals(f.spamSignals);

  if (!f.reports.length) {
    return `
      ${appeals}
      ${signals}
      <section class="panel">
        <header class="panel__head">
          <span class="eyebrow">Форум · модерация</span>
          <h1 class="adm-h1">Разбирать нечего</h1>
        </header>
        <p class="adm-lead">Ни одной нерассмотренной жалобы. Это хорошая новость.</p>
        ${renderActionLog(actions)}
        <div class="adm-actions">
          <button type="button" class="adm-btn" data-forum-reload>Обновить</button>
        </div>
      </section>`;
  }

  return `
    ${appeals}
    ${signals}
    <section class="panel">
      <header class="panel__head">
        <span class="eyebrow">Форум · модерация</span>
        <h1 class="adm-h1">Жалобы</h1>
        <p class="adm-lead">
          ${esc(String(f.reports.length))} ${esc(reportWord(f.reports.length))} ждёт решения.
          Удаление всегда с указанием пункта: автор должен узнать причину.
        </p>
      </header>

      <div class="adm-result" data-moderation-result hidden></div>

      ${renderPriorityQueue(queue)}

      <div class="adm-reports">
        ${f.reports.map(renderReport).join('')}
      </div>

      ${renderActionLog(actions)}
    </section>`;
}

/* ── Оспаривание запрета писать и тишины ─────────────────────────────────────
 *
 * Заявка — это вопрос «правильно ли вы решили про меня», и отвечать на неё
 * обязан живой человек. Ответа без текста не бывает: база не примет короткое
 * «отклонено», и кнопки ниже держат то же правило, что и проверка в
 * supabase/20260925-sanction-appeal.sql.
 */

/** Как мера называется в очереди: «ban» и «mute» игроку ничего не скажут. */
const APPEAL_KIND = { ban: 'запрет писем', mute: 'тишина до даты' };

function renderAppeals(appeals) {
  if (!Array.isArray(appeals)) {
    return `
      <section class="panel adm-appeals">
        <header class="panel__head">
          <span class="eyebrow">Форум · модерация</span>
          <h1 class="adm-h1">Апелляции</h1>
        </header>
        <p class="adm-lead">
          Очередь заявок недоступна: в базе ещё нет таблицы
          <code>forum_appeals</code>. Выполните
          <code>supabase/20260925-sanction-appeal.sql</code> — без неё игроки
          не могут оспорить запрет, и жаловаться им некуда.
        </p>
      </section>`;
  }

  const open = appeals.filter((a) => a.status === 'open');
  const decided = appeals.filter((a) => a.status !== 'open').slice(0, 5);

  return `
    <section class="panel adm-appeals">
      <header class="panel__head">
        <span class="eyebrow">Форум · модерация</span>
        <h1 class="adm-h1">Апелляции</h1>
        <p class="adm-lead">
          Игрок не согласен с мерой, которая не даёт ему писать. Разбирает
          модерация; «удовлетворить» снимает ровно оспоренную меру и ничего
          больше. Ответ уходит игроку в уведомления и без него не остаётся.
        </p>
      </header>

      <div class="adm-result" data-appeals-result hidden></div>

      ${open.length
        ? open.map(renderAppealCard).join('')
        : '<p class="adm-appeals__empty">Открытых апелляций нет.</p>'}

      ${decided.length ? `
        <details class="adm-appeals__done">
          <summary>Разобрано недавно: ${esc(String(decided.length))}</summary>
          ${decided.map(renderAppealCard).join('')}
        </details>` : ''}
    </section>`;
}

function renderAppealCard(a) {
  const isOpen = a.status === 'open';
  const L = CONFIG.forum.limits;

  return `
    <article class="adm-appeal" data-appeal-card="${esc(a.id)}">
      <header class="adm-appeal__head">
        <b>${esc(a.userNick || 'игрок')}</b>
        <span class="adm-appeal__kind">оспаривает: ${esc(APPEAL_KIND[a.kind] ?? a.kind)}</span>
        <time>${esc(shortTime(a.createdAt))}</time>
      </header>

      <p class="adm-appeal__sanction">Мера на момент заявки: «${esc(a.sanction || 'причина не указана')}»</p>
      <p class="adm-appeal__message">${esc(a.message)}</p>

      ${isOpen ? `
        <label class="adm-field">
          <span>Ответ игроку (${L.appealAnswerMin}–${L.appealAnswerMax} символов)</span>
          <textarea name="answer" rows="2" data-appeal-answer="${esc(a.id)}"
                    minlength="${L.appealAnswerMin}" maxlength="${L.appealAnswerMax}"
                    placeholder="что именно вы увидели и почему решение остаётся (или что исправили)"></textarea>
        </label>
        <div class="adm-actions">
          <button type="button" class="adm-btn adm-btn--primary"
                  data-appeal-review="${esc(a.id)}:upheld">Удовлетворить</button>
          <button type="button" class="adm-btn"
                  data-appeal-review="${esc(a.id)}:rejected">Отклонить</button>
        </div>
      ` : `
        <p class="adm-appeal__answer">
          ${a.status === 'upheld' ? 'Удовлетворено' : 'Отклонено'}: «${esc(a.answer)}»
          ${a.decidedByNick ? `<span class="muted">— ${esc(a.decidedByNick)}, ${esc(shortTime(a.decidedAt))}</span>` : ''}
        </p>
      `}
    </article>`;
}

/* ── Сигналы о спаме ──────────────────────────────────────────────────────────
 *
 * Список считает база на каждый запрос (supabase/20260926-spam-signals.sql), и
 * здесь он просто напечатан. Поэтому у блока нет ни кнопок, ни форм: строчка
 * означает «посмотри», а не «наказано». Решение модератор принимает обычными
 * действиями этой панели — тишиной по разделу или запретом во вкладке
 * «Игроки» — и каждое из них попадает в журнал решений, а сигнальный список
 * через сутки забудет про этого человека сам.
 *
 * Игрок не видит, что он здесь. Публичный рейтинг подозрений превратился бы
 * в игру: держаться ровно на одну тему ниже предела, чтобы не засветиться.
 */

/** Роль человеком: «moderator» в списке модерации читается как код. */
const SIGNAL_ROLE = { admin: 'администратор', moderator: 'модератор' };

function renderSpamSignals(signals) {
  const L = CONFIG.forum.limits;
  const head = `
    <header class="panel__head">
      <span class="eyebrow">Форум · модерация</span>
      <h1 class="adm-h1">Сигналы о спаме</h1>
    </header>`;

  if (!Array.isArray(signals)) {
    return `
      <section class="panel adm-signals">
        ${head}
        <p class="adm-lead">
          Список недоступен: в базе ещё нет функции <code>forum_spam_signals()</code>.
          Выполните <code>supabase/20260926-spam-signals.sql</code> — она ничего не
          хранит и ничего не меняет в таблицах, только показывает модерации тех,
          кто сидит на пределе выдержки.
        </p>
      </section>`;
  }

  if (!signals.length) {
    return `
      <section class="panel adm-signals">
        ${head}
        <p class="adm-lead">
          Сейчас никто не упрётся в выдержку и ни у кого нет двух открытых жалоб.
          Пусто — не значит «чисто»: список показывает живое окно
          (${plural(L.postHoldMinutes, 'минута', 'минуты', 'минут')} для тем и
          ${plural(L.commentHoldMinutes, 'минута', 'минуты', 'минут')} для ответов),
          а не историю за неделю.
        </p>
      </section>`;
  }

  return `
    <section class="panel adm-signals">
      ${head}
      <p class="adm-lead">
        ${plural(signals.length, 'человек', 'человека', 'человек')}
        видно по данным форума: предел выдержки рядом, открытые жалобы на его
        материалах или скрытое после пяти жалоб. Ни одно действие отсюда не
        следует автоматически, и сам человек про себя ничего не узнаёт.
      </p>
      <ul class="adm-signal-list">${signals.map((row) => renderSignalRow(row, L)).join('')}</ul>
      <p class="adm-signals__foot muted">
        Пределом считается ${plural(L.postHoldMax, 'тема', 'темы', 'тем')}
        за ${plural(L.postHoldMinutes, 'минута', 'минуты', 'минут')} и
        ${plural(L.commentHoldMax, 'ответ', 'ответа', 'ответов')}
        за ${plural(L.commentHoldMinutes, 'минута', 'минуты', 'минут')};
        модерации разрешено втрое больше, и для неё это не сигнал. Жалобы и скрытые
        материалы смотрятся за ${plural(L.spamSignalWindowDays, 'день', 'дня', 'дней')}.
      </p>
    </section>`;
}

function renderSignalRow(row, L) {
  const staff = row.role === 'admin' || row.role === 'moderator';
  const postsAllowed = L.postHoldMax * (staff ? 3 : 1);
  const commentsAllowed = L.commentHoldMax * (staff ? 3 : 1);
  const muted = row.mutedUntil instanceof Date && row.mutedUntil > new Date();

  return `
    <li class="adm-signal">
      <div class="adm-signal__who">
        <b>${esc(row.nick || 'игрок')}</b>
        ${SIGNAL_ROLE[row.role] ? `<span class="adm-signal__role">${esc(SIGNAL_ROLE[row.role])}</span>` : ''}
        ${row.banned ? '<span class="adm-signal__mark">запрет писем</span>' : ''}
        ${muted ? `<span class="adm-signal__mark">тишина до ${esc(shortTime(row.mutedUntil))}</span>` : ''}
        ${row.sectionMutes ? `<span class="adm-signal__mark">тишина в разделах: ${esc(String(row.sectionMutes))}</span>` : ''}
      </div>

      <ul class="adm-signal__reasons">
        ${row.signals.map((r) => `<li>${esc(r)}</li>`).join('')}
      </ul>

      <div class="adm-signal__nums">
        <span>темы за ${L.postHoldMinutes} мин: <b>${esc(String(row.posts20m))} из ${esc(String(postsAllowed))}</b></span>
        <span>ответы за ${L.commentHoldMinutes} мин: <b>${esc(String(row.comments2m))} из ${esc(String(commentsAllowed))}</b></span>
        <span>за сутки: <b>${plural(row.posts24h, 'тема', 'темы', 'тем')}, ${plural(row.comments24h, 'ответ', 'ответа', 'ответов')}</b></span>
        <span>открытых жалоб: <b>${esc(String(row.openReports))}</b></span>
        ${row.autoHidden ? `<span>скрыто после жалоб: <b>${esc(String(row.autoHidden))}</b></span>` : ''}
      </div>

      <time class="muted">активность: ${esc(shortTime(row.lastActivity))}</time>
    </li>`;
}

function renderPriorityQueue(queue) {
  const urgent = queue.filter((item) => item.priority !== 'normal');
  if (!urgent.length) return '';
  return `<section class="adm-mod-queue" aria-label="Срочные жалобы">
    <h2>Сначала проверить</h2>
    <p class="muted">Три жалобы на один материал помечаются срочными, пять — критическими. Решение всё равно принимает модератор.</p>
    <div class="adm-mod-queue__items">${urgent.map((item) => `
      <span class="adm-mod-priority adm-mod-priority--${esc(item.priority)}">
        ${item.priority === 'critical' ? 'Критично' : 'Срочно'} · ${esc(String(item.reportCount))} жал.
        на ${esc(item.targetType === 'post' ? 'пост' : 'комментарий')}
      </span>`).join('')}</div>
  </section>`;
}

function renderActionLog(actions) {
  if (!actions.length) return '';
  return `<section class="adm-mod-log">
    <h2>Последние решения</h2>
    <ul>${actions.map((item) => `
      <li><b>${esc(item.actorNick || 'Модератор')}</b> — ${esc(actionLabel(item))}
        <time>${esc(shortTime(item.createdAt))}</time></li>`).join('')}</ul>
  </section>`;
}

/*
  Формулировка вида «разобрал жалобу» остаётся последней ветвью: у неизвестного
  действия не должно быть красивой фразы, иначе журнал начнёт врать о том, чего
  не понимает. Частные тишины подписаны явно — иначе «закрыл раздел» и «снял
  запрет» читались бы одним и тем же «изменил ограничение».
*/
function actionLabel(item) {
  if (item.action === 'content_removed') return `удалил ${item.targetType === 'post' ? 'пост' : 'комментарий'} ${item.targetNick ? `игрока ${item.targetNick}` : ''}`;
  if (item.action === 'restriction_changed') return `изменил ограничение для ${item.targetNick || 'игрока'}`;
  if (item.action === 'section_mute') return `закрыл раздел «${categoryLabel(item.details?.category)}» игроку ${item.targetNick || ''} на ${plural(Number(item.details?.days) || 0, 'день', 'дня', 'дней')}`;
  if (item.action === 'section_mute_removed') return `открыл раздел «${categoryLabel(item.details?.category)}» для ${item.targetNick || 'игрока'}`;
  return 'разобрал жалобу';
}

function renderReport(r) {
  const index = RULES.findIndex((x) => x.id === r.ruleId);
  const rule = RULES[index];

  return `
    <article class="adm-report" data-report="${esc(r.id)}">
      <header class="adm-report__head">
        <span class="adm-report__rule">
          ${rule ? `${index + 1}. ${esc(rule.title)}` : 'Пункт не указан'}
        </span>
        <span class="adm-report__meta">
          на ${esc(r.targetType === 'post' ? 'пост' : 'комментарий')}
          · пожаловался ${esc(r.reporterNick)}
          · ${esc(shortTime(r.createdAt))}
        </span>
      </header>

      ${r.note ? `<p class="adm-report__note">«${esc(r.note)}»</p>` : ''}

      <div class="adm-report__target">
          <div class="adm-report__author">${esc(r.targetAuthorNick || 'автор неизвестен')}</div>
          ${r.targetTitle ? `<b class="adm-report__title">${esc(r.targetTitle)}</b>` : ''}
          <div class="adm-report__body">${r.targetBody ? postBody(r.targetBody) : esc('(текст недоступен)')}</div>
        </div>

      <div class="adm-actions adm-report__acts">
        <a class="adm-btn" href="./index.html#/forum/${esc(r.targetPostId || r.targetId)}"
           target="_blank" rel="noopener"
           title="${r.targetPostId ? 'Открыть пост, в котором сидит нарушение' : 'Открыть пост'}">Открыть на сайте</a>
        <button type="button" class="adm-btn adm-btn--primary"
                data-report-delete="${esc(r.id)}"
                data-report-target="${esc(r.targetType)}:${esc(r.targetId)}"
                data-report-rule="${esc(r.ruleId)}">
          Удалить по пункту
        </button>
        <button type="button" class="adm-btn" data-report-dismiss="${esc(r.id)}">
          Оставить как есть
        </button>
        ${r.targetAutoHidden ? `<button type="button" class="adm-btn" data-report-restore="${esc(r.targetType)}:${esc(r.targetId)}">Восстановить материал</button>` : ''}
      </div>
    </article>`;
}

function reportWord(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'жалоба';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'жалобы';
  return 'жалоб';
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function shortTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
