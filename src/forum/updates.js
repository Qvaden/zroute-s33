/**
 * ПУЛЬС ОБНОВЛЕНИЙ ИГРЫ — поведение.
 *
 * Состояние в одном объекте, разметку возвращает строкой pages/updates.js.
 * Живое: читает список, показывает форму модерации, публикует и убирает.
 *
 * Прав здесь этот файл не держит: публикацию и архив разрешает база своей
 * функцией, и её отказ страница отдаёт как есть. Роль вошедшего смотрим только
 * затем, чтобы не показывать форму человеку, который её не нажмёт.
 */
import { forum } from './index.js';
import { esc } from '../ui/helpers.js';
import { renderUpdates } from '../pages/updates.js';

const state = {
  ready: false,
  shared: false,
  me: null,
  /** Есть ли у вошедшего роль модерации — признак видимости формы. */
  canManage: false,
  /** Строки ForumUpdateNote: опубликованные, а модерации — ещё и архив. */
  notes: [],
  loading: true,
  error: '',
  composing: false,
};

let host = null;
let wired = false;
/** Поколение монтирования — тот же приём, что у форума: поздний ответ базы не
 *  должен нарисовать этот список поверх другой страницы. */
let mountToken = 0;

function canManageAs(me) {
  return Boolean(me) && (me.role === 'admin' || me.role === 'moderator');
}

function paint() {
  if (!host) return;
  /*
    Форма переживает перерисовку целиком. Список обновляется после чужого
    нажатия «убрать в архив», а человек в этот момент мог печатать заметку —
    потерять семь полей из-за одного клика значит больше, чем потерять саму
    страницу. Курсор возвращаем тому же полю.
  */
  const draft = state.composing ? readForm() : null;
  const focused = state.composing
    ? document.activeElement?.getAttribute?.('name') || ''
    : '';

  host.innerHTML = renderUpdates(state);

  if (draft) {
    const form = host.querySelector('[data-upd-form]');
    if (form) {
      for (const [name, value] of Object.entries(draft)) {
        if (form.elements[name] && value) form.elements[name].value = value;
      }
      if (focused && form.elements[focused]) form.elements[focused].focus({ preventScroll: true });
    }
  }
}

function readForm() {
  const form = host?.querySelector('[data-upd-form]');
  if (!form) return null;
  const out = {};
  for (const name of ['kind', 'title', 'summary', 'sourceName', 'gameVersion', 'sourceUrl', 'sourceAt']) {
    const el = form.elements[name];
    if (el) out[name] = el.value;
  }
  return out;
}

async function load() {
  const token = mountToken;
  try {
    state.ready = await forum.isReady();
  } catch (err) {
    state.ready = false;
    state.error = String(err?.message ?? err);
    state.loading = false;
    paint();
    return;
  }
  state.shared = forum.capabilities.isShared;

  try {
    state.me = await forum.currentUser();
  } catch {
    state.me = null;
  }
  state.canManage = canManageAs(state.me);

  if (!state.ready) {
    state.loading = false;
    paint();
    return;
  }

  try {
    /*
      Ошибку не глушим: представление forum_update_note_list появилось последней
      миграцией, и по его тексту страница называет файл, которого не хватает.
      Пустой список вместо ошибки выглядел бы как «обновлений нет», и человек
      ждал бы чуда.
    */
    state.notes = (await forum.listUpdateNotes()) || [];
    state.error = '';
  } catch (err) {
    state.notes = [];
    state.error = String(err?.message ?? err);
  }

  if (token !== mountToken) return;
  state.loading = false;
  paint();
}

/** После своего действия берём свежий список, а не додумываем строку на глаз. */
async function reload() {
  try {
    state.notes = (await forum.listUpdateNotes()) || [];
    state.error = '';
  } catch (err) {
    state.notes = [];
    state.error = String(err?.message ?? err);
  }
  paint();
}

function showFormError(message) {
  const box = host?.querySelector('[data-upd-error]');
  if (box) {
    box.textContent = message;
    box.hidden = false;
  }
}

function hideFormError() {
  const box = host?.querySelector('[data-upd-error]');
  if (box) {
    box.textContent = '';
    box.hidden = true;
  }
}

/**
 * Одно действие над одной заметкой. Отказ показываем в карточке, а не над
 * всем списком: «эта заметка уже в архиве» относится ровно к одной строке, и
 * вешать его на страницу значило бы намекать, что сломался весь пульс.
 */
async function runNoteAction(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    await fn();
    await reload();
  } catch (err) {
    const card = btn?.closest('.upd-card');
    if (card) {
      card.insertAdjacentHTML('beforeend', `<p class="upd-card__error">${esc(String(err?.message ?? err))}</p>`);
    }
    if (btn) btn.disabled = false;
  }
}

function wire() {
  if (wired) return;
  wired = true;

  document.addEventListener('click', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const t = e.target;

    if (t.closest('[data-upd-new]')) {
      state.composing = true;
      paint();
      host.querySelector('[data-upd-form] [name="title"]')?.focus({ preventScroll: true });
      return;
    }

    if (t.closest('[data-upd-cancel]')) {
      state.composing = false;
      paint();
      return;
    }

    const archive = t.closest('[data-upd-archive]');
    if (archive && forum.setUpdateNoteArchived) {
      await runNoteAction(archive, () => forum.setUpdateNoteArchived(archive.dataset.updArchive, true));
      return;
    }

    const restore = t.closest('[data-upd-restore]');
    if (restore && forum.setUpdateNoteArchived) {
      await runNoteAction(restore, () => forum.setUpdateNoteArchived(restore.dataset.updRestore, false));
    }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-upd-form]');
    if (!form || !host?.contains(form)) return;
    e.preventDefault();
    hideFormError();

    const values = readForm();
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await forum.publishUpdateNote({
        kind: values.kind || '',
        title: values.title || '',
        summary: values.summary || '',
        sourceName: values.sourceName || '',
        sourceUrl: values.sourceUrl || '',
        /*
          Поле datetime-local отдаёт строку без часового пояса, и new Date
          трактует её локальными часами — ровно так же, как это делает база для
          timestamptz. Уходит ISO-строка с смещением, чтобы ни у кого по пути
          час не потерялся.
        */
        sourceAt: values.sourceAt ? new Date(values.sourceAt).toISOString() : '',
        gameVersion: values.gameVersion || '',
      });
      state.composing = false;
      await reload();
    } catch (err) {
      showFormError(String(err?.message ?? err));
      if (btn) btn.disabled = false;
    }
  });
}

export async function mountUpdates(container) {
  host = container;
  mountToken++;
  state.loading = true;
  state.composing = false;
  paint();
  wire();
  await load();
}

export function unmountUpdates() {
  host = null;
  mountToken++;
  state.notes = [];
  state.error = '';
  state.composing = false;
  state.canManage = false;
  state.me = null;
}
