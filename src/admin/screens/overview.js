import { esc, fmtDate, plural } from '../../ui/helpers.js';

/** «12,3 КБ» — размер файла человеческими словами. */
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

/**
 * Обзор: экран, который отвечает на «всё ли в порядке» до того,
 * как человек начнёт что-то менять.
 *
 * Порядок карточек не случаен. Сначала состояние данных (не сломано ли),
 * потом кто правил последним (не разошлись ли двое редакторов), и только
 * потом цифры. Ошибку человек должен увидеть раньше, чем статистику.
 */
export function renderOverview(view) {
  const { data, problems, commit, repo, file, weeks } = view;

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
        Данные лежат в репозитории, панель читает их напрямую через GitHub.
        Ни сервера, ни базы — поэтому платить за панель нечему и отключиться
        за неоплату ей нечем.
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
        <header class="panel__head"><h2>Последняя правка</h2></header>
        ${
          commit
            ? `<div class="adm-kv">
                 <div><span>Кто</span><b>${esc(commit.authorLogin || commit.authorName || 'неизвестно')}</b></div>
                 <div><span>Когда</span><b>${esc(fmtWhen(commit.date))}</b></div>
                 <div><span>Версия</span><b class="adm-mono">${esc(commit.sha)}</b></div>
               </div>
               <p class="adm-commit">${esc(commit.message.split('\n')[0])}</p>
               <p class="muted">
                 Журнал «кто и когда внёс неделю» ведёт сам git — писать его
                 отдельно не нужно, и подделать запись нельзя.
               </p>`
            : '<p class="muted">История правок этого файла пока пуста.</p>'
        }
      </section>

      <section class="panel">
        <header class="panel__head"><h2>Файл данных</h2></header>
        <div class="adm-kv">
          <div><span>Путь</span><b class="adm-mono">${esc(file.path)}</b></div>
          <div><span>Размер</span><b>${esc(fmtSize(file.size))}</b></div>
          <div><span>Репозиторий</span><b class="adm-mono">${esc(repo.fullName)}</b></div>
          <div><span>Права токена</span><b>${repo.canPush ? 'чтение и запись' : 'только чтение'}</b></div>
        </div>
        ${
          repo.canPush
            ? `<p class="muted">Токен уже может публиковать, но панель в этой фазе умеет только читать — кнопок, которые меняют данные, здесь физически нет.</p>`
            : `<p class="adm-warn">У токена нет права на запись. Для второй фазы понадобится право «Contents: Read and write».</p>`
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
