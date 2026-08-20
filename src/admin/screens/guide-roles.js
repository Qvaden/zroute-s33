import { esc } from '../../ui/helpers.js';
import { parseGuideRoles, serializeGuideRoles, blankGuideRole, DEFAULT_GUIDE_CREDIT } from '../../logic/guide-roles.js';

const TONE_OPTIONS = ['gold', 'orange', 'violet', 'cyan', 'red'];

export function guideFromTexts(texts) {
  const entry = (texts ?? []).find((t) => t.key === 'guide-roles');
  return parseGuideRoles(entry?.body);
}

export function renderGuideRoles(view) {
  const data = view.guideDraft ?? guideFromTexts(view.texts);
  const canPush = Boolean(view.canPush);
  return `
    <section class="adm-hero adm-hero--tight">
      <span class="eyebrow">Малым алам // редактор</span>
      <h1 class="adm-h1">Роли руководства</h1>
      <p class="adm-lead">Редактируйте карточки обязанностей прямо здесь. Изменения сначала сохраняются как черновик, а на сайт попадут после отдельной публикации.</p>
    </section>
    <section class="panel adm-form guide-editor" data-guide-editor>
      <header class="panel__head adm-head-row"><div><h2>Структура справочника</h2><p class="muted">У каждой роли можно изменить иконку, название, цвет, описание, список обязанностей и помощника.</p></div><button type="button" class="adm-btn" data-guide-add ${canPush ? '' : 'disabled'}>+ Добавить роль</button></header>
      <label class="adm-field guide-editor__credit"><span>Сноска внизу страницы</span><input type="text" data-guide-credit value="${esc(data.credit || DEFAULT_GUIDE_CREDIT)}" ${canPush ? '' : 'disabled'}></label>
      <div class="guide-editor__roles">
        ${(data.roles ?? []).map((role, index) => renderRole(role, index, canPush)).join('')}
      </div>
      ${canPush ? '' : '<p class="adm-warn">У токена нет права на запись — редактирование и публикация недоступны.</p>'}
      <div class="adm-publish"><div class="adm-publish__state muted" data-guide-state>Изменения применятся после сохранения черновика.</div><div class="adm-publish__actions"><button type="button" class="adm-btn" data-guide-reset ${canPush ? '' : 'disabled'}>Сбросить</button><button type="button" class="adm-btn adm-btn--primary" data-guide-save ${canPush ? '' : 'disabled'}>Сохранить черновик</button><button type="button" class="adm-btn adm-btn--primary" data-texts-publish ${canPush ? '' : 'disabled'}>Опубликовать</button></div></div>
      <div class="adm-result" data-texts-result hidden></div>
    </section>`;
}

function renderRole(role, index, canPush) {
  return `<article class="guide-editor__role" data-guide-role="${index}">
    <header class="guide-editor__role-head"><span class="guide-editor__number">${index + 1}</span><h3>Роль ${index + 1}</h3><button type="button" class="adm-btn adm-btn--danger" data-guide-remove="${index}" ${canPush ? '' : 'disabled'}>Удалить</button></header>
    <div class="guide-editor__role-grid">
      <label class="adm-field"><span>Иконка</span><input data-guide-field="icon" value="${esc(role.icon)}" ${canPush ? '' : 'disabled'}></label>
      <label class="adm-field"><span>Название роли</span><input data-guide-field="title" value="${esc(role.title)}" ${canPush ? '' : 'disabled'}></label>
      <label class="adm-field"><span>Цвет</span><select data-guide-field="tone" ${canPush ? '' : 'disabled'}>${TONE_OPTIONS.map((tone) => `<option value="${tone}" ${tone === role.tone ? 'selected' : ''}>${tone}</option>`).join('')}</select></label>
    </div>
    <label class="adm-field"><span>Короткое описание</span><input data-guide-field="intro" value="${esc(role.intro)}" ${canPush ? '' : 'disabled'}></label>
    <label class="adm-field"><span>Обязанности — по одному пункту на строку</span><textarea rows="5" data-guide-items ${canPush ? '' : 'disabled'}>${esc((role.items ?? []).join('\n'))}</textarea></label>
    <label class="guide-editor__check"><input type="checkbox" data-guide-field="assistant" ${role.assistant ? 'checked' : ''} ${canPush ? '' : 'disabled'}><span>Добавить пометку «🤝 + помощник»</span></label>
  </article>`;
}
