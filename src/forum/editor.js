/**
 * ОБОГАЩЁННЫЙ РЕДАКТОР — ОБЩАЯ ЛОГИКА.
 *
 * Один и тот же редактор живёт в форме поста форума и в форме гайда: панель
 * форматирования, лимит без maxlength, вставка только текстом, состояние
 * кнопок. Раньше всё это было зашито в mount.js и привязано к хосту форума;
 * гайдам пришлось бы копировать — копия расходится с оригиналом при первой
 * же правке, поэтому общий файл.
 *
 * Хост передают функцией-геттером: слушатели висят на document, а проверка
 * «это наш редактор» должна видеть актуальный контейнер, а не тот, что был
 * при навешивании.
 */
import { textOf } from './sanitize.js';

/** Редактор, в котором сейчас курсор. */
export function activeEditor() {
  const a = document.activeElement;
  return a && a.matches?.('[contenteditable]') ? a : null;
}

/** Редактор той формы, где стоит кнопка. */
export function editorFor(btn) {
  return btn.closest('form')?.querySelector('[data-editor]') ?? null;
}

/**
 * Пустой редактор подписывают заглушкой через CSS :empty — но браузер
 * оставляет в div служебные <br> и <span>, и «пусто» перестаёт быть пустым.
 * Класс is-empty считаем по видимому тексту.
 */
export function syncEditorEmpty(editor) {
  editor.classList.toggle('is-empty', textOf(editor.innerHTML).length === 0);
}

/**
 * Применить команду форматирования.
 *
 * Сначала фокус в редактируемый блок: без него браузер применит команду
 * неизвестно куда или не применит совсем. Кнопки панели не забирают фокус
 * (mousedown на них гасится), поэтому выделение к моменту клика на месте.
 *
 * @param {HTMLElement} editor
 * @param {string} cmd имя команды без 'execCommand'
 * @param {string} [value]
 */
export function applyFormat(editor, cmd, value) {
  if (!editor || typeof document.execCommand !== 'function') return;
  editor.focus({ preventScroll: true });

  if (cmd === 'color') {
    // Сброс через 'inherit': санитайзер такую обёртку выбросит на сохранении.
    document.execCommand('foreColor', false, value || 'inherit');
    return;
  }
  if (cmd === 'code') {
    wrapInline(editor, 'code');
    return;
  }
  if (cmd === 'formatBlock') {
    // Некоторые браузеры принимают тег только в угловых скобках.
    const name = value || 'h3';
    document.execCommand('formatBlock', false, name.startsWith('<') ? name : `<${name}>`);
    return;
  }
  document.execCommand(cmd, false, null);
}

/**
 * Обернуть выделение в инлайн-тег (code), а если выделения нет — вставить
 * образец и поставить курсор внутрь. Текст подставляется текстовым узлом:
 * символы '<' из выделения не могут стать разметкой.
 */
export function wrapInline(editor, tag) {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !editor.contains(sel.anchorNode)) {
    if (typeof document.execCommand === 'function') {
      document.execCommand('insertHTML', false, textSample(tag));
    }
    return;
  }

  const range = sel.getRangeAt(0);
  const text = range.toString() || 'текст';
  range.deleteContents();

  const node = range.startContainer.ownerDocument.createElement(tag);
  node.textContent = text;
  range.insertNode(node);

  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function textSample(tag) {
  return `<${tag}>текст</${tag}>`;
}

/**
 * Поведение редакторов внутри хоста: лимит, чистая вставка, кнопки панели.
 * Вызывается один раз на модуль-владелец формы (forum mount, guides mount).
 * @param {() => HTMLElement | null} getHost
 */
export function wireRichEditor(getHost) {
  /*
    Лимит редактора держим сами: у contenteditable нет maxlength. Печатать
    дальше предела не даём (beforeinput успевает перехватить), а вставка
    идёт только текстом без формата — иначе человек случайно притащит
    в пост чужую вёрстку с картинками.
  */
  document.addEventListener('beforeinput', (e) => {
    const host = getHost();
    if (!host || !host.contains(e.target)) return;
    const editor = e.target.closest?.('[data-editor]');
    if (!editor || (e.inputType !== 'insertText' && e.inputType !== 'insertCompositionText')) return;

    const limit = Number(editor.dataset.limit);
    if (!limit) return;
    const extra = (e.data ?? '').length;
    if (!extra) return;
    if (textOf(editor.innerHTML).length + extra > limit) e.preventDefault();
  });

  document.addEventListener('input', (e) => {
    const host = getHost();
    if (!host || !host.contains(e.target)) return;
    const editor = e.target.closest?.('[data-editor]');
    if (editor) syncEditorEmpty(editor);
  });

  document.addEventListener('paste', (e) => {
    const host = getHost();
    const editor = e.target.closest?.('[data-editor]');
    if (!editor || !host?.contains(editor) || !e.clipboardData) return;
    e.preventDefault();

    const text = e.clipboardData.getData('text/plain') ?? '';
    if (!text) return;

    const limit = Number(editor.dataset.limit) || Infinity;
    const room = Math.max(0, limit - textOf(editor.innerHTML).length);
    const part = room ? text.slice(0, room) : '';
    if (part && typeof document.execCommand === 'function') {
      document.execCommand('insertText', false, part);
    }
    syncEditorEmpty(editor);
  });

  /*
    Кнопки панели не должны забирать фокус из редактора: иначе выделение
    исчезнет и команда применится впустую.
  */
  document.addEventListener('mousedown', (e) => {
    const host = getHost();
    if (!host || !host.contains(e.target)) return;
    if (e.target.closest?.('[data-editor-cmd], [data-editor-color]')) e.preventDefault();
  });

  /*
    Кнопки «Жирный» и прочие держатся нажатыми, пока стиль действует: человек
    видит состояние без переключения.
  */
  document.addEventListener('selectionchange', () => {
    const host = getHost();
    if (!host || typeof document.queryCommandState !== 'function') return;
    const editor = activeEditor();
    if (!editor || !host.contains(editor)) return;
    for (const btn of host.querySelectorAll('[data-editor-cmd]')) {
      if (!host.contains(btn)) continue;
      if (!['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript'].includes(btn.dataset.editorCmd)) continue;
      let on = false;
      try { on = document.queryCommandState(btn.dataset.editorCmd); } catch { /* старый браузер */ }
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  });
}
