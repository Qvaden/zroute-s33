import { esc } from '../../ui/helpers.js';
import { normalizePresidentBoard } from '../../logic/president-board.js';

export function renderPresident(view) {
  const board = normalizePresidentBoard(view.presidentDraft);
  return `
    <section class="panel adm-president-editor" data-president-editor>
      <header class="panel__head">
        <span class="eyebrow">Общая информационная доска</span>
        <h1 class="adm-h1">Президент сервера</h1>
        <p class="adm-lead">Эта карточка отображается сверху на всех вкладках сайта. Заполняйте её вручную, когда меняется президент или альянс.</p>
      </header>
      <div class="adm-president-preview">
        <span class="president-board__signal" aria-hidden="true"></span>
        <div><small>ПРЕДПРОСМОТР ДОСКИ</small><strong data-president-preview-name>${esc(board.name)}</strong></div>
        <b data-president-preview-alliance>${esc(board.alliance)}</b>
      </div>
      <div class="adm-president-grid">
        <label class="adm-field adm-field--wide"><span>Метка</span><input data-president-field="label" value="${esc(board.label)}" placeholder="ПРЕЗИДЕНТ СЕРВЕРА"></label>
        <label class="adm-field"><span>Имя президента</span><input data-president-field="name" value="${esc(board.name)}" placeholder="Например: Игрок123"></label>
        <label class="adm-field"><span>Альянс</span><input data-president-field="alliance" value="${esc(board.alliance)}" placeholder="Например: KOP"></label>
        <label class="adm-field adm-field--wide"><span>Небольшая подпись</span><input data-president-field="note" value="${esc(board.note)}" placeholder="Данные обновляются вручную"></label>
        <label class="adm-check adm-president-toggle"><input type="checkbox" data-president-field="enabled" ${board.enabled ? 'checked' : ''}><span>Показывать доску на сайте</span></label>
      </div>
      <div class="adm-publish__state" data-president-state>Изменения сохраняются в черновике браузера автоматически.</div>
      <div class="adm-result" data-texts-result hidden></div>
      <div class="adm-actions">
        <button type="button" class="adm-btn" data-president-reset>Сбросить</button>
        <button type="button" class="adm-btn adm-btn--primary" data-president-save>Сохранить черновик</button>
        <button type="button" class="adm-btn adm-btn--primary" data-president-publish data-texts-publish>Опубликовать доску</button>
      </div>
    </section>`;
}
