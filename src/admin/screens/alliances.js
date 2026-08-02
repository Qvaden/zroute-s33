import { esc, plural } from '../../ui/helpers.js';
import { alliancesFromRaw, alliancesDiff, allianceResultsCount } from '../edit.js';

/**
 * АЛЬЯНСЫ.
 *
 * Устройство экрана то же, что у «Хронологии»: одна форма сверху и список
 * снизу, форма служит и добавлению, и правке. Черновик — весь список целиком,
 * а не по одному альянсу: правят их так же пачкой (поправил тег, добавил
 * новый, деактивировал распавшийся) и публикуют разом одним коммитом.
 *
 * Единственное жёсткое правило, которое здесь защищено интерфейсом, — id.
 * В этом жанре альянсы переименовываются и сливаются постоянно; если история
 * побед привязана к названию, а не к id, она порвётся на первом же
 * переименовании. Поэтому id только показан — в заголовке формы и колонкой
 * в списке — и нигде не редактируется.
 *
 * Второе правило — не техническое, а из документации проекта: альянс
 * с результатами в истории не удаляется, а деактивируется. Без этого сайт
 * не откроется: результат продолжит ссылаться на исчезнувший id, и это ловит
 * валидатор контракта (src/data/contract.js). Поэтому кнопка «Удалить»
 * показывается только когда за альянсом нет ни одного результата — то есть
 * он либо ещё не сыграл ни одной недели, либо ещё не опубликован вовсе.
 */
export function renderAlliances(view) {
  const { raw, canPush } = view;

  // Рабочий список: черновик, если он есть, иначе то, что в данных.
  const list = view.alliances ?? alliancesFromRaw(raw);
  const form = view.allianceDraft ?? null;
  const diff = alliancesDiff(raw, list);

  // Порядок для показа человеку: действующие сначала, дальше по тегу.
  // Рабочий список при этом не трогаем — порядок в файле должен меняться
  // только на то, что действительно поменялось (см. applyAlliances).
  const rows = [...list].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.tag.localeCompare(b.tag, 'ru');
  });

  const active = rows.filter((a) => a.active).length;

  const wins = new Map();
  for (const r of view.data?.results ?? []) {
    if (r.outcome !== 'win') continue;
    wins.set(r.allianceId, (wins.get(r.allianceId) ?? 0) + 1);
  }

  const listHtml = rows
    .map((a) => row(a, canPush, wins.get(a.id) ?? 0, allianceResultsCount(raw, a.id)))
    .join('');

  return `
    <section class="adm-hero adm-hero--tight">
      <span class="eyebrow">Состав сервера</span>
      <h1 class="adm-h1">Альянсы</h1>
      <p class="adm-lead">
        ${plural(active, 'альянс в игре', 'альянса в игре', 'альянсов в игре')}
        ${rows.length !== active ? `<span class="adm-dot">·</span> ${rows.length - active} распалось` : ''}
      </p>
    </section>

    ${renderForm(form, canPush, raw)}

    <section class="panel" data-alliances-form>
      <header class="panel__head adm-head-row">
        <h2>Список</h2>
        ${canPush ? '<button type="button" class="adm-btn" data-alliance-new>Добавить альянс</button>' : ''}
      </header>

      ${
        canPush
          ? ''
          : `<p class="adm-warn">У токена нет права на запись — список можно только смотреть.
               Нужно право «Contents: Read and write».</p>`
      }

      ${
        rows.length
          ? `<ul class="adm-allies">
               <li class="adm-ally adm-ally--head">
                 <i class="adm-ally__color"></i>
                 <span class="adm-ally__tag">Тег</span>
                 <span class="adm-ally__name">Название</span>
                 <span class="adm-ally__note">Заметка</span>
                 <span class="adm-ally__wins" title="Побед за всё время">Побед</span>
                 <span class="adm-ally__id">id</span>
                 <span class="adm-ally__state">Статус</span>
               </li>
               ${listHtml}
             </ul>
             <p class="muted adm-note">
               Колонка <code class="adm-mono">id</code> — самое важное поле во всех данных.
               Он выдан один раз и не меняется никогда: к нему привязана вся история
               побед. Переименование альянса меняет тег и название, но не id.
             </p>`
          : `<p class="muted adm-note">Альянсов пока нет. Добавьте первый — без них не с кем вносить недели.</p>`
      }

      <div class="adm-publish">
        <div class="adm-publish__state">${describeAlliances(diff, view.alliancesSaved)}</div>
        <div class="adm-publish__actions">
          <button type="button" class="adm-btn" data-alliances-reset
                  ${diff.total ? '' : 'disabled'}>Сбросить</button>
          <button type="button" class="adm-btn adm-btn--primary" data-alliances-publish
                  ${diff.total && canPush ? '' : 'disabled'}>Опубликовать</button>
        </div>
      </div>

      <div class="adm-result" data-alliances-result hidden></div>
    </section>`;
}

/** Строка списка. Правка и деактивация или удаление — рядом, потому что ищут их вместе. */
function row(a, canPush, winsCount, resultsCount) {
  const canDelete = resultsCount === 0;

  return `<li class="adm-ally ${a.active ? '' : 'is-gone'}" data-alliance-row="${esc(a.id)}">
    <i class="adm-ally__color" style="background:${esc(a.color || '#7a8494')}"></i>
    <span class="adm-ally__tag">${esc(a.tag)}</span>
    <span class="adm-ally__name">${esc(a.name)}</span>
    <span class="adm-ally__note muted">${esc(a.note || '')}</span>
    <span class="adm-ally__wins muted">${winsCount}</span>
    <code class="adm-mono adm-ally__id">${esc(a.id)}</code>
    <span class="adm-ally__state">${a.active ? 'в игре' : 'распался'}</span>
    ${
      canPush
        ? `<div class="adm-ally__acts">
             <button type="button" class="adm-btn" data-alliance-edit="${esc(a.id)}">Правка</button>
             <button type="button" class="adm-btn" data-alliance-toggle="${esc(a.id)}">${
               a.active ? 'Деактивировать' : 'Активировать'
             }</button>
             ${
               canDelete
                 ? `<button type="button" class="adm-btn" data-alliance-delete="${esc(a.id)}">Удалить</button>`
                 : ''
             }
           </div>`
        : ''
    }
  </li>`;
}

/**
 * Форма добавления и правки.
 *
 * Появляется только когда что-то правят, как и в хронологии: пустая форма,
 * висящая всё время, заставляет искать список глазами под ней.
 */
function renderForm(form, canPush, raw) {
  if (!form || !canPush) return '';

  const isNew = !form.id;
  const resultsCount = isNew ? 0 : allianceResultsCount(raw, form.id);

  return `
    <section class="panel adm-form" data-alliance-form>
      <header class="panel__head adm-head-row">
        <h2>${isNew ? 'Новый альянс' : `Правка альянса ${esc(form.id)}`}</h2>
        <button type="button" class="adm-btn" data-alliance-cancel>Отмена</button>
      </header>

      <div class="adm-grid2">
        <label class="adm-field">
          <span>Тег</span>
          <input type="text" data-alliance-field="tag" value="${esc(form.tag)}" placeholder="Например, STG">
        </label>
        <label class="adm-field">
          <span>Цвет</span>
          <input type="color" data-alliance-field="color" value="${esc(form.color || '#7a8494')}">
        </label>
      </div>

      <label class="adm-field">
        <span>Название</span>
        <input type="text" data-alliance-field="name" value="${esc(form.name)}" placeholder="Например, Сталкеры">
      </label>

      <label class="adm-field"><span>Статус</span></label>
      <div class="adm-weeks adm-types">
        <button type="button" class="adm-chip ${form.active ? 'is-on' : ''}"
                data-alliance-active-choice="true">В игре</button>
        <button type="button" class="adm-chip ${!form.active ? 'is-on' : ''}"
                data-alliance-active-choice="false">Распался</button>
      </div>

      <label class="adm-field">
        <span>Заметка</span>
        <input type="text" data-alliance-field="note" value="${esc(form.note)}" placeholder="Необязательно">
      </label>

      <p class="adm-form__hint muted">
        ${
          isNew
            ? 'Id присвоится автоматически при сохранении и больше не изменится.'
            : resultsCount
              ? `В истории ${plural(resultsCount, 'результат', 'результата', 'результатов')} этого альянса —
                 удалить нельзя, только деактивировать. Id ${esc(form.id)} не меняется никогда.`
              : `У альянса пока нет результатов в истории — можно удалить из списка.
                 Id ${esc(form.id)} не меняется никогда.`
        }
      </p>

      <div class="adm-result adm-result--bad" data-alliance-problems hidden></div>

      <div class="adm-publish">
        <div class="adm-publish__state muted">
          Альянс добавится в список. На сайт он попадёт после «Опубликовать».
        </div>
        <div class="adm-publish__actions">
          <button type="button" class="adm-btn adm-btn--primary" data-alliance-save>
            ${isNew ? 'Добавить в список' : 'Сохранить в списке'}
          </button>
        </div>
      </div>
    </section>`;
}

/** Что именно уйдёт в коммит, словами. Удаление — всегда вслух. */
export function describeAlliances(diff, savedAt) {
  if (!diff.total) return '<span class="muted">Изменений нет — опубликовать нечего.</span>';

  const parts = [];
  if (diff.added) parts.push(plural(diff.added, 'новый альянс', 'новых альянса', 'новых альянсов'));
  if (diff.changed) parts.push(plural(diff.changed, 'правка', 'правки', 'правок'));
  if (diff.removed) {
    parts.push(`<b class="adm-danger">удалится ${plural(diff.removed, 'альянс', 'альянса', 'альянсов')}</b>`);
  }

  const when = savedAt
    ? ` <span class="muted">· черновик сохранён в браузере ${savedAt.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      })}</span>`
    : '';

  return `К публикации: ${parts.join(', ')}${when}`;
}
