import { esc, plural } from '../../ui/helpers.js';

/**
 * Альянсы.
 *
 * Единственное правило, которое здесь нужно защитить интерфейсом, — id.
 * В этом жанре альянсы переименовываются и сливаются постоянно; если история
 * привязана к названию, она порвётся на первом же переименовании, а история
 * здесь и есть весь смысл сайта.
 *
 * Поэтому во второй фазе поле id будет не «не рекомендуется менять»,
 * а физически недоступным для правки. Уже сейчас он показан отдельно
 * и подписан — чтобы это не стало новостью.
 */
export function renderAlliances(view) {
  const { data } = view;

  const rows = [...data.alliances].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.tag.localeCompare(b.tag, 'ru');
  });

  const active = rows.filter((a) => a.active).length;
  const wins = new Map();
  for (const r of data.results) {
    if (r.outcome !== 'win') continue;
    wins.set(r.allianceId, (wins.get(r.allianceId) ?? 0) + 1);
  }

  const list = rows
    .map(
      (a) => `<li class="adm-ally ${a.active ? '' : 'is-gone'}">
        <i class="adm-ally__color" style="background:${esc(a.color || '#7a8494')}"></i>
        <span class="adm-ally__tag">${esc(a.tag)}</span>
        <span class="adm-ally__name">${esc(a.name)}</span>
        ${a.note ? `<span class="adm-ally__note muted">${esc(a.note)}</span>` : ''}
        <span class="adm-ally__wins muted">${wins.get(a.id) ?? 0}</span>
        <code class="adm-mono adm-ally__id">${esc(a.id)}</code>
        <span class="adm-ally__state">${a.active ? 'в игре' : 'распался'}</span>
      </li>`
    )
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

    <section class="panel">
      <ul class="adm-allies">
        <li class="adm-ally adm-ally--head">
          <i class="adm-ally__color"></i>
          <span class="adm-ally__tag">Тег</span>
          <span class="adm-ally__name">Название</span>
          <span class="adm-ally__note">Заметка</span>
          <span class="adm-ally__wins" title="Побед за всё время">Побед</span>
          <span class="adm-ally__id">id</span>
          <span class="adm-ally__state">Статус</span>
        </li>
        ${list}
      </ul>
      <p class="muted adm-note">
        Колонка <code class="adm-mono">id</code> — самое важное поле во всех данных.
        Он выдан один раз и не меняется никогда: к нему привязана вся история
        побед. Переименование альянса меняет тег и название, но не id.
      </p>
    </section>`;
}
