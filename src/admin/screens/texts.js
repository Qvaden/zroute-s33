import { esc, plural, miniMarkdown } from '../../ui/helpers.js';

/**
 * Тексты сайта.
 *
 * Здесь лежит всё, что человек читает на сайте словами: гайд для малых
 * альянсов, ритм недели, «о сайте». Именно эта вкладка делает утверждение
 * «сайтом управляют из панели» правдой, а не преувеличением: без неё
 * любая правка текста оставалась бы работой для разработчика.
 *
 * Предпросмотр рисуется тем же `miniMarkdown`, которым текст выводится
 * на сайте, — значит редактор видит ровно то, что увидят люди.
 */
export function renderTexts(view) {
  const { data } = view;
  const texts = [...data.texts].sort((a, b) => a.key.localeCompare(b.key, 'ru'));

  if (!texts.length) {
    return `<section class="panel"><h2>Текстов нет</h2>
      <p class="muted">Разделы сайта, которые берут текст из данных, откроются пустыми.</p></section>`;
  }

  const cards = texts
    .map(
      (t) => `<details class="adm-text">
        <summary>
          <code class="adm-mono">${esc(t.key)}</code>
          <b>${esc(t.title || 'без заголовка')}</b>
          <span class="muted">${plural(t.body.length, 'символ', 'символа', 'символов')}</span>
        </summary>
        <div class="adm-text__body prose">${miniMarkdown(t.body)}</div>
      </details>`
    )
    .join('');

  return `
    <section class="adm-hero adm-hero--tight">
      <span class="eyebrow">Содержание сайта</span>
      <h1 class="adm-h1">Тексты</h1>
      <p class="adm-lead">${plural(texts.length, 'блок', 'блока', 'блоков')} — всё, что на сайте написано словами</p>
    </section>

    <section class="panel">
      ${cards}
      <p class="muted adm-note">
        Форматирование простое: <code class="adm-mono">## Заголовок</code> делает новую карточку,
        <code class="adm-mono">- пункт</code> — список, <code class="adm-mono">**жирный**</code> — выделение.
        Предпросмотр выше нарисован тем же кодом, что и сайт.
      </p>
    </section>`;
}
