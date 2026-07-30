import { esc, fmtDate, plural } from '../../ui/helpers.js';
import { diffMarks, countMarks, marksFromRaw } from '../edit.js';
import { byWeekStartDesc, findCurrentWeek } from '../../data/week-order.js';

/**
 * Неделя — главный экран панели.
 *
 * Устройство подчинено одному сценарию: человек заполняет тридцать две клетки
 * с телефона, стоя в переписке с альянсом сразу после VS. Отсюда всё остальное.
 *
 * — Две отдельные кнопки П и Х, а не переключение по кругу. Перебор состояний
 *   требует помнить, сколько раз ты нажал; попадание в нужную кнопку — нет.
 * — Повторное нажатие на выбранное снимает отметку: пустая клетка означает
 *   «не внесли», и вернуться к этому состоянию должно быть так же легко.
 * — Каждое нажатие сразу уходит в черновик. Ничего не «сохраняется» отдельно,
 *   потому что забыть нажать «сохранить» — самый частый способ потерять работу.
 * — Публикация одна на всю неделю: один коммит вместо тридцати двух.
 *
 * Чего здесь НЕТ: захватов и защит. У недели одна обязанность — счёт альянсов.
 * Что делал сервер целиком, живёт в хронологии отдельными событиями, иначе один
 * и тот же захват записывался бы в двух местах.
 *
 * @param {any} view
 * @param {string | null} param Идентификатор недели из адреса, например W31.
 */
export function renderWeek(view, param) {
  const { data, raw, marks, canPush, draftSaved } = view;
  const weeks = [...data.weeks].sort(byWeekStartDesc);

  if (!weeks.length) {
    return `<section class="panel"><h2>Недели не заведены</h2>
      <p class="muted">Пока в данных нет ни одной недели, вносить результаты некуда.</p></section>`;
  }

  /*
    Неделя берётся из адреса, а если его нет — из состояния, подготовленного
    main.js. Порядок именно такой, чтобы экран остался чистой функцией: его
    вызывают напрямую и тесты, и сборщик превью, у которых состояния нет вовсе.
  */
  const selected = weeks.find((w) => w.id === param) ?? weeks.find((w) => w.id === view.weekId) ?? weeks[0];

  /*
    Черновик накладывается только на ту неделю, которую подготовил main.js.
    Для любой другой показываем то, что лежит в данных, — иначе отметки
    из черновика утекли бы на чужую неделю.
  */
  const current = selected.id === view.weekId && marks ? marks : marksFromRaw(raw, selected.id);

  // Порядок как в игре у людей в голове: сначала действующие альянсы, по тегу.
  const alliances = [...data.alliances]
    .filter((a) => a.active || current[a.id])
    .sort((a, b) => a.tag.localeCompare(b.tag, 'ru'));

  const { wins, losses } = countMarks(current);
  const filled = wins + losses;
  const total = alliances.length;
  const pct = total ? Math.round((filled / total) * 100) : 0;
  const diff = diffMarks(raw, selected.id, current);

  const picker = renderPicker(weeks, selected);

  const cells = alliances
    .map((a) => {
      const outcome = current[a.id] ?? null;
      const state = outcome ?? 'empty';
      return `<div class="adm-cell adm-cell--${state}" data-cell="${esc(a.id)}"
                   style="--tag-color:${esc(a.color || '#7a8494')}">
          <span class="adm-cell__tag">${esc(a.tag)}</span>
          <span class="adm-cell__name">${esc(a.name)}</span>
          <div class="adm-marks">
            <button type="button" class="adm-mark adm-mark--win ${outcome === 'win' ? 'is-on' : ''}"
                    data-mark="win" ${canPush ? '' : 'disabled'}
                    aria-label="${esc(a.tag)}: победа">П</button>
            <button type="button" class="adm-mark adm-mark--loss ${outcome === 'loss' ? 'is-on' : ''}"
                    data-mark="loss" ${canPush ? '' : 'disabled'}
                    aria-label="${esc(a.tag)}: поражение">Х</button>
          </div>
        </div>`;
    })
    .join('');

  return `
    <section class="adm-hero adm-hero--tight">
      <span class="eyebrow">Результаты VS</span>
      <h1 class="adm-h1">Неделя ${selected.number}</h1>
      <p class="adm-lead">
        ${esc(fmtDate(selected.startDate))} — ${esc(fmtDate(selected.endDate))}
        <span class="adm-dot">·</span>
        ${plural(wins, 'победа', 'победы', 'побед')}, ${plural(losses, 'поражение', 'поражения', 'поражений')}
      </p>
      <div class="adm-weeks">${picker}</div>
    </section>

    <section class="panel" data-week-form data-week-id="${esc(selected.id)}">
      <header class="panel__head adm-head-row">
        <h2>Внесено <span data-week-filled>${filled}</span> из ${total}</h2>
        <span class="muted"><span data-week-pct>${pct}</span>%</span>
      </header>
      <div class="adm-progress"><i data-week-bar style="width:${pct}%"></i></div>

      ${
        canPush
          ? ''
          : `<p class="adm-warn">У токена нет права на запись, поэтому клетки не нажимаются.
               Нужно право «Contents: Read and write».</p>`
      }

      <div class="adm-cells">${cells}</div>

      <div class="adm-publish" data-publish-bar>
        <div class="adm-publish__state" data-publish-state>${describe(diff, draftSaved)}</div>
        <div class="adm-publish__actions">
          <button type="button" class="adm-btn" data-preview-toggle
                  ${diff.total ? '' : 'disabled'}>Предпросмотр</button>
          <button type="button" class="adm-btn" data-draft-reset
                  ${diff.total ? '' : 'disabled'}>Сбросить</button>
          <button type="button" class="adm-btn adm-btn--primary" data-publish
                  ${diff.total && canPush ? '' : 'disabled'}>Опубликовать</button>
        </div>
      </div>

      <div class="adm-result" data-publish-result hidden></div>
      <div class="adm-preview" data-preview hidden></div>
    </section>`;
}

const MONTH_NAME = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/**
 * Выбор недели, сгруппированный по месяцам.
 *
 * Плоский ряд номеров работал, пока недель было двенадцать. Через год их
 * станет больше пятидесяти, и «поправить неделю в начале сентября» превратится
 * в разглядывание четырёх строк цифр. Месяц — то, чем человек эти недели
 * помнит, поэтому он и подписан.
 *
 * Два свежих месяца открыты, остальное убрано в «раньше»: в девяти случаях
 * из десяти правят последнюю неделю, и до неё не должно быть прокрутки.
 */
function renderPicker(weeks, selected) {
  /*
    Текущая неделя подписана словом, а не только цветом: редактор открывает
    панель после VS и должен видеть, какая неделя «сейчас», не сверяя даты
    в голове. Это дешевле любой инструкции.
  */
  const current = findCurrentWeek(weeks);

  const groups = [];
  for (const w of weeks) {
    const date = w.startDate;
    const key = date ? `${date.getUTCFullYear()}-${date.getUTCMonth()}` : 'нет даты';
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = {
        key,
        label: date ? `${MONTH_NAME[date.getUTCMonth()]} ${date.getUTCFullYear()}` : 'без даты',
        weeks: [],
      };
      groups.push(group);
    }
    group.weeks.push(w);
  }

  const chip = (w) => {
    const isNow = current && w.id === current.id;
    return `<a href="#/week/${encodeURIComponent(w.id)}"
       class="adm-chip ${w.id === selected.id ? 'is-on' : ''} ${isNow ? 'is-now' : ''}"
       title="${esc(fmtDate(w.startDate))} — ${esc(fmtDate(w.endDate))}">${esc(String(w.number))}${
      isNow ? '<i>сейчас</i>' : ''
    }</a>`;
  };

  const block = (g) => `<div class="adm-mon">
      <span class="adm-mon__label">${esc(g.label)}</span>
      <div class="adm-mon__row">${g.weeks.map(chip).join('')}</div>
    </div>`;

  const fresh = groups.slice(0, 2);
  const older = groups.slice(2);

  // Если выбранная неделя оказалась в «раньше», раскрываем — иначе человек
  // не увидит, где он находится.
  const selectedIsOld = older.some((g) => g.weeks.some((w) => w.id === selected.id));

  return `
    ${fresh.map(block).join('')}
    ${
      older.length
        ? `<details class="adm-older" ${selectedIsOld ? 'open' : ''}>
             <summary>Раньше · ${older.length === 1 ? 'один месяц' : `${older.length} месяцев`}</summary>
             ${older.map(block).join('')}
           </details>`
        : ''
    }`;
}

/**
 * Что именно уйдёт в коммит, словами.
 *
 * Удаление показывается отдельно и всегда: это единственное необратимое
 * действие в панели, и промахнуться по клетке легко.
 */
export function describe(diff, draftSaved) {
  if (!diff.total) {
    return '<span class="muted">Изменений нет — опубликовать нечего.</span>';
  }

  const parts = [];
  if (diff.added) parts.push(plural(diff.added, 'новая отметка', 'новые отметки', 'новых отметок'));
  if (diff.changed) parts.push(plural(diff.changed, 'исправление', 'исправления', 'исправлений'));
  if (diff.removed) {
    parts.push(
      `<b class="adm-danger">удалится ${plural(diff.removed, 'отметка', 'отметки', 'отметок')}</b>`
    );
  }

  const when = draftSaved
    ? ` <span class="muted">· черновик сохранён в браузере ${draftSaved.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      })}</span>`
    : '';

  return `К публикации: ${parts.join(', ')}${when}`;
}
