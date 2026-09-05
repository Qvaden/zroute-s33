import { esc, fmtDate, plural } from '../../ui/helpers.js';

/** «12,3 КБ» — объём данных человеческими словами. */
function fmtSize(bytes) {
  const kb = (Number(bytes) || 0) / 1024;
  return `${kb.toFixed(1).replace('.', ',')} КБ`;
}

/** «29 июля, 21:40» по местному времени читателя. */
function fmtWhen(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'неизвестно когда';
  const d = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const t = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${d}, ${t}`;
}

/** Название таблицы человеческим словом — для журнала правок. */
const ENTITY_LABEL = {
  site_alliances: 'альянсы',
  site_weeks: 'недели',
  site_results: 'результаты',
  site_events: 'хронология',
  site_texts: 'тексты',
  forum_users: 'права',
};

/** Что именно сделали. */
const ACTION_LABEL = {
  insert: 'добавлено',
  update: 'изменено',
  delete: 'удалено',
  grant_moderator: 'назначен модератор',
  revoke_moderator: 'снят модератор',
};

/**
 * Обзор: экран, который отвечает на «всё ли в порядке» до того,
 * как человек начнёт что-то менять.
 *
 * Порядок карточек не случаен. Сначала состояние данных (не сломано ли),
 * потом кто правил последним (не разошлись ли двое редакторов), и только
 * потом цифры. Ошибку человек должен увидеть раньше, чем статистику.
 *
 * ПОЧЕМУ ЭКРАН БЫЛ СЛОМАН И ЧТО ИЗ ЭТОГО СЛЕДУЕТ.
 *
 * До переезда в базу он показывал данные репозитория: путь к файлу, его
 * размер, права токена GitHub, последний коммит. После переезда ничего этого
 * не стало — но экран продолжал читать view.repo.fullName, и падал на первой
 * же строке. Молча: панель просто не открывала вкладку.
 *
 * Тесты этого не поймали, потому что подсовывали экрану выдуманный объект
 * с полем repo — то есть проверяли не то, что собирает панель. Теперь они
 * берут состояние из самой панели, и такое расхождение станет видно сразу.
 *
 * Отсюда правило для этого файла: он читает ТОЛЬКО те поля, которые кладёт
 * load() в main.js. Ничего «на всякий случай».
 */
export function renderOverview(view) {
  const { data, problems, changes, file, weeks, account } = view;

  const active = data.alliances.filter((a) => a.active).length;

  // Ближайшая неделя, которая ещё не закончилась — та, что «сейчас в игре».
  const today = new Date();
  const ordered = [...weeks].sort((a, b) => a.number - b.number);
  const current = ordered.find((w) => w.endDate && w.endDate >= today) ?? ordered[ordered.length - 1];
  const filled = current ? data.results.filter((r) => r.weekId === current.id).length : 0;

  const health = problems.length
    ? `<div class="adm-health adm-health--bad">
         <b>${plural(problems.length, 'проблема', 'проблемы', 'проблем')} в данных</b>
         <ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
         <p class="muted">Это тот же самый валидатор, которым проверяется сайт. Пока список не пуст, публиковать нельзя.</p>
       </div>`
    : `<div class="adm-health adm-health--ok">
         <b>Проблем не найдено</b>
         <p class="muted">Данные соответствуют доменной модели: id на месте, недели и альянсы связаны, исходов ровно два.</p>
       </div>`;

  const stats = [
    { value: active, label: 'альянсов в игре', extra: `всего в базе ${data.alliances.length}` },
    { value: data.weeks.length, label: 'недель заведено' },
    { value: data.results.length, label: 'результатов внесено' },
    { value: data.events.length, label: 'событий в хронологии' },
    { value: data.texts.length, label: 'текстовых блоков' },
  ];

  return `
    <section class="adm-hero">
      <span class="eyebrow">Панель управления</span>
      <h1 class="adm-h1">Сервер 33</h1>
      <p class="adm-lead">
        Данные лежат в базе, панель читает и пишет их напрямую. Вход тот же,
        что на форуме — ни токенов, ни доступа к репозиторию. Правки видны
        на сайте сразу.
      </p>
    </section>

    <div class="adm-stats">
      ${stats
        .map(
          (s) => `<div class="adm-stat">
            <b class="num">${s.value}</b>
            <span>${esc(s.label)}</span>
            ${s.extra ? `<i class="muted">${esc(s.extra)}</i>` : ''}
          </div>`
        )
        .join('')}
    </div>

    <div class="adm-grid">
      <section class="panel">
        <header class="panel__head"><h2>Проверка данных</h2></header>
        ${health}
      </section>

      <section class="panel">
        <header class="panel__head"><h2>Последние правки</h2></header>
        ${renderChanges(changes)}
      </section>

      <section class="panel">
        <header class="panel__head"><h2>Где лежат данные</h2></header>
        <div class="adm-kv">
          <div><span>Источник</span><b>${esc(file.path)}</b></div>
          <div><span>Объём</span><b>${esc(fmtSize(file.size))}</b></div>
          <div><span>Вы вошли как</span><b>${esc(account?.nick ?? '—')}</b></div>
          <div><span>Ваши права</span><b>${view.canPush ? 'правка данных сайта' : 'только чтение'}</b></div>
        </div>
        ${
          view.canPush
            ? `<p class="muted">
                 Правки уходят в базу по одной, а не файлом целиком — поэтому
                 двое редакторов, вносящих разные недели в один вечер,
                 не затирают работу друг друга.
               </p>
               <p class="muted">
                 Резервная копия попадает в репозиторий раз в сутки: историю
                 сервера нельзя терять, а база живёт на одном аккаунте.
               </p>`
            : `<p class="adm-warn">
                 Права на правку нет — только смотреть. Роль выдаёт владелец
                 на вкладке «Игроки».
               </p>`
        }
      </section>

      <section class="panel">
        <header class="panel__head"><h2>Неделя в игре</h2></header>
        ${
          current
            ? `<div class="adm-week-now">
                 <div class="adm-week-now__num num">${current.number}</div>
                 <div>
                   <b>${esc(fmtDate(current.startDate))} — ${esc(fmtDate(current.endDate))}</b>
                   <p class="muted">${
                     filled
                       ? `${plural(filled, 'результат внесён', 'результата внесено', 'результатов внесено')} из ${active}`
                       : 'результаты за эту неделю ещё не внесены'
                   }</p>
                 </div>
               </div>`
            : '<p class="muted">Недели ещё не заведены.</p>'
        }
      </section>
    </div>`;
}

/**
 * Журнал правок.
 *
 * Заменил карточку «последний коммит»: в репозитории журнал вёл сам git,
 * в базе его пишут триггеры (см. site_audit в supabase/site-data.sql).
 *
 * Показываем несколько последних, а не одну: одна запись отвечала на вопрос
 * «кто трогал файл», а тут правки идут по одной, и последняя из них — это
 * часто одна клетка. Список отвечает на настоящий вопрос: «что здесь
 * происходило».
 */
function renderChanges(changes) {
  if (!changes?.length) {
    return `<p class="muted">
      Правок пока не было. Журнал ведут триггеры в базе, поэтому запись
      появится и в том случае, если данные поменяют не через панель.
    </p>`;
  }

  return `
    <ul class="adm-changes">
      ${changes
        .slice(0, 8)
        .map(
          (c) => `<li>
            <b>${esc(ENTITY_LABEL[c.entity] ?? c.entity)}</b>
            <span class="adm-changes__what">${esc(ACTION_LABEL[c.action] ?? c.action)}</span>
            ${c.entityId ? `<i class="adm-mono muted">${esc(c.entityId)}</i>` : ''}
            <span class="adm-changes__who muted">${esc(c.actorNick || 'неизвестно кто')} · ${esc(fmtWhen(c.at))}</span>
          </li>`
        )
        .join('')}
    </ul>
    <p class="muted">
      Журнал пишут триггеры в базе, а не панель: правка из другого места всё
      равно попадёт сюда. Панель могла бы «забыть» записать — и именно тогда
      журнал нужнее всего.
    </p>`;
}
