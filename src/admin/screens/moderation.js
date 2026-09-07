import { esc } from '../../ui/helpers.js';
import { RULES } from '../../forum/rules.js';

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

  if (!f.reports.length) {
    return `
      <section class="panel">
        <header class="panel__head">
          <span class="eyebrow">Форум · модерация</span>
          <h1 class="adm-h1">Разбирать нечего</h1>
        </header>
        <p class="adm-lead">Ни одной нерассмотренной жалобы. Это хорошая новость.</p>
        <div class="adm-actions">
          <button type="button" class="adm-btn" data-forum-reload>Обновить</button>
        </div>
      </section>`;
  }

  return `
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

      <div class="adm-reports">
        ${f.reports.map(renderReport).join('')}
      </div>
    </section>`;
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
        <p class="adm-report__body">${esc(r.targetBody || '(текст недоступен)')}</p>
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
