import { esc } from '../../ui/helpers.js';
import { parseGuidePage, serializeGuidePage, blankGuideRole, DEFAULT_GUIDE_PAGE } from '../../logic/guide-roles.js';

const COLOR_PRESETS = ['#d8ff3e', '#ff8a3d', '#b78cff', '#63f5e5', '#ff5364', '#4da3ff', '#f5d06f', '#ffffff', '#151b2a'];
const LEGACY_COLORS = { gold: '#d8ff3e', orange: '#ff8a3d', violet: '#b78cff', cyan: '#63f5e5', red: '#ff5364' };

function colorValue(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : LEGACY_COLORS[raw] ?? '#63f5e5';
}

export function guideFromTexts(texts) {
  const byKey = Object.fromEntries((texts ?? []).map((t) => [t.key, t]));
  return parseGuidePage(byKey['guide-page'], {
    roles: parseGuidePage(byKey['guide-roles']).roles,
    principles: byKey['guide-principles'], week: byKey['guide-week'],
    donts: byKey['guide-donts'], benefits: byKey['guide-benefits'],
  });
}

export function renderGuideRoles(view) {
  const page = view.guideDraft ?? guideFromTexts(view.texts);
  const disabled = view.canPush ? '' : 'disabled';
  return `
    <section class="adm-hero adm-hero--tight"><span class="eyebrow">Полное содержание страницы</span><h1 class="adm-h1">Малым алам</h1><p class="adm-lead">Здесь редактируется вся вкладка сайта целиком. Никаких отдельных текстовых ключей: меняйте поля, сохраняйте черновик и публикуйте одной кнопкой.</p></section>
    <section class="panel guide-editor" data-guide-editor>
      <header class="panel__head adm-head-row"><div><h2>Верхняя часть и аналитика</h2><p class="muted">Заголовок блока сравнения и пояснение к нему.</p></div></header>
      ${field('Заголовок сравнения', 'proofTitle', page.proofTitle, disabled)}
      ${field('Подзаголовок сравнения', 'proofSubtitle', page.proofSubtitle, disabled)}
      <header class="panel__head guide-editor__section-head"><h2>Роли руководства</h2><button type="button" class="adm-btn" data-guide-add ${disabled}>+ Добавить роль</button></header>
      ${field('Заголовок раздела ролей', 'rolesTitle', page.rolesTitle, disabled)}
      ${textarea('Описание раздела ролей', 'rolesSubtitle', page.rolesSubtitle, disabled, 3)}
      <div class="guide-editor__roles">${page.roles.map((role, index) => renderRole(role, index, disabled)).join('')}</div>
      <header class="panel__head guide-editor__section-head"><div><h2>Новые информационные блоки</h2><p class="muted">Добавляйте свои разделы: FAQ, правила, памятки или объявления.</p></div><button type="button" class="adm-btn" data-guide-extra-add ${disabled}>+ Новый блок</button></header>
      <div class="guide-editor__extras">${(page.extraBlocks ?? []).map((block, index) => renderExtraBlock(block, index, disabled)).join('')}</div>
      <header class="panel__head guide-editor__section-head"><h2>Важное правило</h2></header>
      ${field('Заголовок важного блока', 'noticeTitle', page.noticeTitle, disabled)}
      ${textarea('Текст важного блока', 'noticeBody', page.noticeBody, disabled, 6)}
      <header class="panel__head guide-editor__section-head"><h2>Остальные разделы</h2></header>
      ${field('Заголовок «Образцовое руководство»', 'principlesTitle', page.principlesTitle, disabled)}
      ${textarea('Текст «Образцовое руководство»', 'principlesBody', page.principlesBody, disabled, 12)}
      ${field('Заголовок «Ритм недели»', 'weekTitle', page.weekTitle, disabled)}
      ${textarea('Текст «Ритм недели»', 'weekBody', page.weekBody, disabled, 8)}
      ${field('Заголовок «Чего делать не стоит»', 'dontsTitle', page.dontsTitle, disabled)}
      ${textarea('Текст «Чего делать не стоит»', 'dontsBody', page.dontsBody, disabled, 8)}
      ${field('Заголовок «Что даёт крупный альянс»', 'benefitsTitle', page.benefitsTitle, disabled)}
      ${textarea('Текст «Что даёт крупный альянс»', 'benefitsBody', page.benefitsBody, disabled, 8)}
      <header class="panel__head guide-editor__section-head"><h2>Финальная сноска</h2></header>
      ${field('Маленькая благодарность внизу страницы', 'credit', page.credit, disabled)}
      ${view.canPush ? '' : '<p class="adm-warn">У токена нет права на запись — редактирование и публикация недоступны.</p>'}
      <div class="adm-publish"><div class="adm-publish__state muted" data-guide-state>Изменения сохраняются в черновик браузера.</div><div class="adm-publish__actions"><button type="button" class="adm-btn" data-guide-reset ${disabled}>Сбросить</button><button type="button" class="adm-btn adm-btn--primary" data-guide-save ${disabled}>Сохранить черновик</button><button type="button" class="adm-btn adm-btn--primary" data-texts-publish ${disabled}>Опубликовать всю страницу</button></div></div><div class="adm-result" data-texts-result hidden></div>
      ${renderColorModal()}
    </section>`;
}

function renderExtraBlock(block, index, disabled) {
  return `<article class="guide-editor__extra" data-guide-extra="${index}"><header class="guide-editor__role-head"><span class="guide-editor__number">＋</span><h3>Дополнительный блок ${index + 1}</h3><button type="button" class="adm-btn adm-btn--danger" data-guide-extra-remove="${index}" ${disabled}>Удалить</button></header>${field('Заголовок блока', 'title', block.title, disabled, 'data-guide-extra-field')}${colorPicker('Цвет блока', 'tone', block.tone, disabled, 'data-guide-extra-field')}${textarea('Текст блока', 'body', block.body, disabled, 8, 'data-guide-extra-field')}</article>`;
}

function renderRole(role, index, disabled) {
  return `<article class="guide-editor__role" data-guide-role="${index}"><header class="guide-editor__role-head"><span class="guide-editor__number">${index + 1}</span><h3>Роль ${index + 1}</h3><button type="button" class="adm-btn adm-btn--danger" data-guide-remove="${index}" ${disabled}>Удалить</button></header><div class="guide-editor__role-grid">${field('Иконка', 'icon', role.icon, disabled)}${field('Название роли', 'title', role.title, disabled)}${colorPicker('Цвет роли', 'tone', role.tone, disabled)}</div>${field('Короткое описание', 'intro', role.intro, disabled)}${textarea('Обязанности — по одному пункту на строку', 'items', (role.items ?? []).join('\n'), disabled, 5)}<label class="guide-editor__check"><input type="checkbox" data-guide-field="assistant" ${role.assistant ? 'checked' : ''} ${disabled}><span>Показывать «🤝 + помощник»</span></label></article>`;
}
function field(label, key, value, disabled = '', attr = '') { return `<label class="adm-field"><span>${label}</span><input type="text" ${attr} data-guide-field="${key}" value="${esc(value ?? '')}" ${disabled}></label>`; }
function textarea(label, key, value, disabled = '', rows = 5, attr = '') { return `<label class="adm-field"><span>${label}</span><textarea rows="${rows}" ${attr} data-guide-field="${key}" ${disabled}>${esc(value ?? '')}</textarea></label>`; }
function colorPicker(label, key, value, disabled = '', attr = '') {
  const color = colorValue(value);
  return `<div class="guide-color-picker" data-guide-color-picker><div class="guide-color-picker__head"><span>${label}</span><output data-guide-color-output style="--picker-color:${color}">${color}</output></div><button type="button" class="guide-color-trigger" style="--picker-color:${color}" data-guide-color-open="${key}" data-guide-color-value="${color}" ${disabled} aria-label="Открыть палитру цвета"><span class="guide-color-trigger__dot"></span><b>Открыть палитру</b><span class="guide-color-trigger__value">${color}</span><span class="guide-color-trigger__arrow">↗</span></button><small class="guide-color-picker__hint">Любой оттенок · готовые цвета · HEX</small></div>`;
}

function renderColorModal() {
  return `<div class="guide-color-modal" data-guide-color-modal hidden><button type="button" class="guide-color-modal__backdrop" data-guide-color-close aria-label="Закрыть палитру"></button><section class="guide-color-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="guide-color-title"><header class="guide-color-modal__head"><div><span class="eyebrow">Custom // Palette</span><h2 id="guide-color-title">Цвет карточки</h2></div><button type="button" class="guide-color-modal__close" data-guide-color-close aria-label="Закрыть">×</button></header><div class="guide-color-modal__preview"><span data-guide-color-modal-orb></span><div><b data-guide-color-modal-hex>#63F5E5</b><small>Предпросмотр выбранного оттенка</small></div></div><div class="guide-color-modal__swatches">${COLOR_PRESETS.map((preset) => `<button type="button" class="guide-color-modal__swatch" style="--swatch:${preset}" data-guide-modal-color="${preset}" aria-label="Выбрать ${preset}"><span></span><b>${preset}</b></button>`).join('')}</div><label class="guide-color-modal__hex"><span>Свой цвет в HEX</span><input type="text" inputmode="text" maxlength="7" spellcheck="false" data-guide-color-hex value="#63F5E5" placeholder="#63F5E5"></label><p class="guide-color-modal__error" data-guide-color-error hidden>Введите цвет в формате #RRGGBB.</p><footer class="guide-color-modal__actions"><button type="button" class="adm-btn" data-guide-color-close>Отмена</button><button type="button" class="adm-btn adm-btn--primary" data-guide-color-apply>Применить цвет</button></footer></section></div>`;
}
