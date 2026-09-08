/**
 * ЖИВОЕ ПОВЕДЕНИЕ ФОРУМА.
 *
 * Страницы сайта — чистые функции: получили данные, вернули строку. Форум
 * так не умеет, и вот почему: остальные вкладки только показывают уже
 * загруженное, а форум ждёт ответа базы, принимает ввод и меняется от нажатий.
 * Поэтому разметка осталась чистой функцией (pages/forum.js), а всё, что
 * происходит во времени, собрано здесь.
 *
 * КАК ЭТО РАБОТАЕТ. Внутри страницы живёт своё маленькое состояние: кто вошёл,
 * какой раздел выбран, какие посты загружены. Меняется состояние — страница
 * перерисовывается целиком. Точечных правок DOM нет намеренно: они дают
 * рассинхрон, когда счётчик реакции обновился, а подсветка кнопки нет.
 * Перерисовка целиком на сорока постах незаметна, а поводов для расхождения
 * не оставляет.
 *
 * ПОЧЕМУ ОБРАБОТЧИКИ ВЕШАЮТСЯ ОДИН РАЗ НА document. Разметка пересобирается
 * из строк, то есть все узлы каждый раз новые. Обработчик, повешенный на
 * кнопку, после первой перерисовки указывает на выброшенный узел. Делегирование
 * от document этой проблемы не знает — тот же приём, что в ui/*-controls.js.
 */
import { forum } from './index.js';
import { renderForum, renderReportDialog, renderDeleteDialog } from '../pages/forum.js';
import { renderUserPage } from '../pages/user.js';
import { validateNick, validatePassword, validatePost, validateComment, deletionReason } from './rules.js';
import { getProfile, getUserPosts, saveProfile, uploadAvatar, clearAvatar, attachImage } from './profile.js';
import { textOf } from './format.js';
import { esc } from '../ui/helpers.js';
import { CONFIG } from '../../config.js';

/** Состояние страницы. Живёт между перерисовками, сбрасывается при уходе. */
const state = {
  ready: false,
  shared: false,
  sourceName: forum.name,
  me: null,
  posts: [],
  total: 0,
  category: 'all',
  sort: 'fresh',
  loading: true,
  error: '',
  openPostId: null,
  comments: [],
  query: '',
  /** Какой пост сейчас в режиме правки; null — правки нет. */
  editingPostId: null,
  /** Что удаляем или на что жалуемся, пока открыто окно. */
  pending: null,
  /** «Самое обсуждаемое» — три темы для блока горячих. */
  hot: [],
};

/**
 * Состояние страницы участника.
 *
 * Отдельно от ленты: это другая страница с другой жизнью. Смешать их в одном
 * объекте значило бы, что уход с профиля в ленту оставляет за собой чужие
 * поля — и лента однажды отрисуется с профилем внутри.
 */
const profileState = {
  nick: '',
  profile: null,
  posts: [],
  editing: false,
  loading: false,
  error: '',
};

/**
 * ВЫБРАННЫЕ, НО ЕЩЁ НЕ ОТПРАВЛЕННЫЕ КАРТИНКИ.
 *
 * Ключ — «new» для нового поста или id поста для комментария. Держатся вне
 * общего состояния, потому что это не данные, а промежуточный ввод: Blob
 * не переживает перерисовку в виде строки и не должен попадать ни в разметку,
 * ни в localStorage.
 *
 * Загружаются они ПОСЛЕ публикации: вложение ссылается на запись, значит
 * запись должна существовать. Загрузка заранее оставляла бы в хранилище файлы,
 * на которые никто не ссылается, если человек закрыл форму.
 */
const pendingShots = new Map();

/** Данные сайта нужны для полосы хроники сверху. */
let siteView = null;
/** Куда рисуем. null — форум не на экране. */
let host = null;
let wired = false;
/** Что показываем: ленту или страницу участника. */
let mode = 'feed';

/* ── Отрисовка ────────────────────────────────────────────────────────────── */

/*
  ЧТО ОБЯЗАНО ПЕРЕЖИТЬ ПЕРЕРИСОВКУ.

  Страница пересобирается из строк целиком — так проще и не бывает рассинхрона
  между счётчиком и подсветкой кнопки. Но у полной перерисовки есть цена,
  и первая версия её не заплатила: НАБРАННЫЙ ТЕКСТ ПРОПАДАЛ.

  Случай, который случится с каждым: человек пишет длинный комментарий,
  по ходу ставит лайк соседнему посту — счётчик обновляется, страница
  перерисовывается, текст исчезает. Никакой ошибки при этом не показано,
  и понять, что произошло, нельзя.

  То же с раскрытыми разделами: правила и форма поста складывались обратно
  на каждое нажатие.

  Поэтому перед перерисовкой снимаем состояние ввода, а после — возвращаем.
  Собираем по имени поля и по адресу записи, а не по порядку: разметка
  меняется, и «третий textarea» после перерисовки может оказаться другим.
*/
function captureInput() {
  if (!host) return null;

  const forms = {};
  host.querySelectorAll('textarea, input:not([type="radio"]):not([type="password"]), select, [data-editor]').forEach((el) => {
    const key = fieldKey(el);
    if (key) forms[key] = el.matches('[contenteditable]') ? el.innerHTML : el.value;
  });

  // Раскрытые <details>: правила, форма поста.
  const open = [];
  host.querySelectorAll('details[open]').forEach((d) => {
    const key = d.dataset.forumRules ? 'rules' : d.dataset.forumComposer ? 'composer' : null;
    if (key) open.push(key);
  });

  /*
    Пароль не сохраняем осознанно: держать его в памяти между перерисовками
    незачем, а форма входа после успешного входа исчезает целиком.
  */
  return {
    forms,
    open,
    focus: fieldKey(document.activeElement),
    scroll: window.scrollY,
  };
}

function restoreInput(snapshot) {
  if (!snapshot || !host) return;

  for (const [key, value] of Object.entries(snapshot.forms)) {
    if (!value) continue;
    const el = findByKey(key);
    if (el) setFieldValue(el, value);
  }

  for (const key of snapshot.open) {
    const el = key === 'rules'
      ? host.querySelector('[data-forum-rules]')
      : host.querySelector('[data-forum-composer]');
    if (el) el.open = true;
  }

  /*
    Возвращаем и место в тексте: без этого курсор прыгает в начало, и человек
    продолжает печатать не туда, где остановился.
  */
  if (snapshot.focus) {
    const el = findByKey(snapshot.focus);
    if (el) {
      el.focus({ preventScroll: true });
      if (typeof el.setSelectionRange === 'function' && el.value) {
        const end = el.value.length;
        try { el.setSelectionRange(end, end); } catch { /* select не умеет */ }
      }
    }
  }

  // Прокрутку возвращаем после отрисовки, иначе браузер её же и сбросит.
  if (snapshot.scroll > 0) window.scrollTo(0, snapshot.scroll);
}

/**
 * Имя поля, устойчивое к перерисовке: имя внутри формы плюс адрес записи,
 * к которой форма относится. Порядок элементов для этого не годится —
 * разметка между перерисовками меняется.
 */
function fieldKey(el) {
  if (!el || !host || !host.contains(el) || !el.name) return null;

  // Поиск по ленте живёт вне форм, но терять набранное при перерисовке нельзя.
  if (el.matches('[data-forum-search]')) return 'search';

  const commentForm = el.closest('[data-forum-comment-form]');
  if (commentForm) return `comment:${commentForm.dataset.forumCommentForm}:${el.name}`;

  const newPost = el.closest('[data-forum-new]');
  if (newPost) return `new:${el.name}`;

  const auth = el.closest('[data-forum-auth]');
  if (auth) return `auth:${el.name}`;

  const report = el.closest('[data-forum-report-form]');
  if (report) return `report:${el.name}`;

  const editForm = el.closest('[data-forum-edit-form]');
  if (editForm) return `edit:${editForm.dataset.forumEditForm}:${el.name}`;

  return null;
}

function findByKey(key) {
  if (!host) return null;

  if (key === 'search') return host.querySelector('[data-forum-search]');

  const [kind, a, b] = key.split(':');

  if (kind === 'comment') {
    return host.querySelector(`[data-forum-comment-form="${cssEscape(a)}"] [name="${b}"]`);
  }
  if (kind === 'edit') {
    return host.querySelector(`[data-forum-edit-form="${cssEscape(a)}"] [name="${b}"]`);
  }
  const form = host.querySelector(`[data-forum-${kind === 'new' ? 'new' : kind === 'auth' ? 'auth' : 'report-form'}]`);
  return form?.querySelector(`[name="${a}"]`) ?? null;
}

/**
 * Вернуть полю сохранённое значение после перерисовки. Поле обычного ввода
 * пишется через .value, редактор — внутренней разметкой (это уже очищенная
 * строка, editorHtml); класс пустоты обновляется, чтобы плейсхолдер не вис.
 */
function setFieldValue(el, value) {
  if (!el) return;
  if (el.matches('[contenteditable]')) {
    el.innerHTML = value;
    syncEditorEmpty(el);
  } else {
    el.value = value;
  }
}

/** Редактор пуст, когда в нём не осталось видимого текста. */
function syncEditorEmpty(editor) {
  editor.classList.toggle('is-empty', textOf(editor.innerHTML).length === 0);
}

/** Текст формы: HTML из редактора, если он есть, иначе значение поля. */
function formBody(form) {
  const editor = form.querySelector('[data-editor]');
  if (editor) return editor.innerHTML;
  return form.body?.value ?? '';
}

/**
 * Полный сброс формы: стандартный reset сбрасывает только настоящие поля
 * ввода, пустой редактор ему не виден. После публикации обе части остаются
 * чистыми — иначе второй пост получил бы текст первого.
 */
function resetForm(form) {
  form.reset();
  form.querySelectorAll('[data-editor]').forEach((el) => {
    el.innerHTML = '';
    syncEditorEmpty(el);
  });
}

function paint() {
  if (!host) return;
  const snapshot = captureInput();

  /*
    Страница участника рисуется тем же механизмом, что лента: одно место
    отрисовки на весь форум. Два разных пути привели бы к двум наборам
    обработчиков и двум способам потерять набранный текст.
  */
  host.innerHTML = mode === 'user'
    ? renderUserPage({ ...profileState, me: state.me })
    : renderForum(siteView, state) + renderReportDialog() + renderDeleteDialog();

  restoreInput(snapshot);
  paintPendingShots();
}

/**
 * Превью выбранных картинок.
 *
 * Дорисовывается после перерисовки, а не собирается в строку разметки: ссылки
 * на Blob живут в памяти браузера и в строку не превращаются. Заодно так они
 * не попадают в localStorage при сохранении черновика.
 */
function paintPendingShots() {
  if (!host) return;

  for (const [scope, files] of pendingShots) {
    const list = host.querySelector(`[data-attach-list="${cssEscape(scope)}"]`);
    if (!list) continue;

    list.innerHTML = files
      .map(
        (f, i) => `<div class="forum-attach__item">
          <img src="${f.preview}" alt="">
          <button type="button" class="forum-attach__drop"
                  data-attach-drop="${cssEscape(scope)}:${i}" title="Убрать">✕</button>
        </div>`
      )
      .join('');
  }
}

/**
 * Показать ошибку рядом с тем действием, которое её вызвало.
 *
 * Общая полоса ошибок вверху страницы на телефоне оказывается за экраном:
 * человек нажимает «Войти», ничего не происходит, и он нажимает снова.
 */
function showError(selector, message) {
  const box = host?.querySelector(selector);
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

function clearError(selector) {
  const box = host?.querySelector(selector);
  if (box) box.hidden = true;
}

/* ── Защита от двойных нажатий ────────────────────────────────────────────── */

/*
  ДВА НАЖАТИЯ — ДВА ПОСТА.

  Запрос к базе идёт не мгновенно, а кнопка всё это время выглядит рабочей.
  На телефоне при неспешной сети человек нажимает «Опубликовать» второй раз —
  и получает две одинаковые записи, которые потом ещё и удалять надо.

  Поэтому кнопка на время запроса выключается и говорит, чем занята. Это
  не украшение: выключенная кнопка — единственное честное сообщение о том,
  что нажатие принято, а ответа пока нет.
*/
async function withBusy(button, label, action) {
  const original = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = label;
  }
  try {
    return await action();
  } finally {
    /*
      Кнопку возвращаем в исходное состояние даже при ошибке: иначе после
      первой же неудачи форма остаётся мёртвой, и человеку остаётся только
      перезагрузить страницу — вместе с набранным текстом.

      Проверяем, что узел ещё на месте: перерисовка могла его выбросить.
    */
    if (button && button.isConnected) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

/* ── Загрузка ─────────────────────────────────────────────────────────────── */

async function loadFeed({ append = false } = {}) {
  state.loading = !append;
  state.error = '';
  // Любое движение по ленте закрывает открытую правку: форма живёт в карточке.
  if (!append) state.editingPostId = null;
  if (!append) paint();

  try {
    const { posts, total } = await forum.listPosts({
      category: state.category,
      sort: state.sort,
      q: state.query,
      limit: CONFIG.forum.pageSize,
      offset: append ? state.posts.length : 0,
    });
    state.posts = append ? [...state.posts, ...posts] : posts;
    state.total = total;

    /*
      «Самое обсуждаемое» тянем вместе со свежей лентой, а не отдельно: это
      та же лента, отсортированная по ответам. Неудача здесь не роняет страницу —
      блок просто остаётся с прошлыми темами, а не пропадает.
    */
    if (!append) {
      try {
        const hot = await forum.listPosts({ sort: 'talked', limit: 3 });
        state.hot = (hot.posts ?? []).filter((p) => !p.deleted && p.commentCount > 0);
      } catch {
        state.hot = state.hot;
      }
    }
  } catch (err) {
    state.error = String(err?.message ?? err);
  } finally {
    state.loading = false;
    paint();
  }
}

async function loadThread(postId) {
  state.openPostId = postId;
  state.comments = [];
  state.editingPostId = null;
  state.loading = false;
  paint();

  try {
    /*
      Пост запрашиваем заново, а не берём из ленты: между открытием ленты
      и переходом в тему его могли отредактировать или удалить, и показать
      старую копию значит соврать.
    */
    const [post, comments] = await Promise.all([forum.getPost(postId), forum.listComments(postId)]);
    if (post) {
      const i = state.posts.findIndex((p) => p.id === postId);
      if (i >= 0) state.posts[i] = post;
      else state.posts = [post, ...state.posts];
    }
    state.comments = comments;
  } catch (err) {
    state.error = String(err?.message ?? err);
  }
  state.loading = false;
  paint();
}

function findPoll(state, pollId) {
  for (const p of state.posts) {
    if (p.poll && p.poll.id === pollId) return p.poll;
  }
  return null;
}

function pollPostId(state, pollId) {
  for (const p of state.posts) {
    if (p.poll && p.poll.id === pollId) return p.id;
  }
  return null;
}

/** Обновить одну запись после реакции — без перезагрузки всей ленты. */
async function refreshOne(targetType, targetId) {
  try {
    if (targetType === 'post') {
      const fresh = await forum.getPost(targetId);
      const i = state.posts.findIndex((p) => p.id === targetId);
      if (fresh && i >= 0) state.posts[i] = fresh;
    } else if (state.openPostId) {
      state.comments = await forum.listComments(state.openPostId);
    }
  } catch {
    // Счётчик не обновился — не повод ронять страницу. Он подтянется
    // при следующей загрузке ленты.
  }
  paint();
}

/* ── Вход ─────────────────────────────────────────────────────────────────── */

async function handleAuth(form, mode, submitter) {
  clearError('[data-forum-auth-error]');

  const nick = validateNick(form.nick.value);
  if (!nick.ok) return showError('[data-forum-auth-error]', nick.error);

  const password = validatePassword(form.password.value);
  if (!password.ok) return showError('[data-forum-auth-error]', password.error);

  /*
    Пока запрос идёт, гасим ОБЕ кнопки формы. Выключенной становится только
    нажатая — вторая остаётся живой, и при неспешной сети человек жмёт
    «Зарегистрироваться» следом за «Войти». Это два аккаунта, которые потом
    ещё и разбирать.
  */
  const buttons = [...form.querySelectorAll('button')];
  const original = new Map(buttons.map((b) => [b, b.textContent]));
  for (const b of buttons) b.disabled = true;
  if (submitter) submitter.textContent = mode === 'signup' ? 'Создаём…' : 'Входим…';

  try {
    state.me = mode === 'signup'
      ? await forum.signUp(nick.value, password.value)
      : await forum.signIn(nick.value, password.value);
    await loadFeed();
  } catch (err) {
    showError('[data-forum-auth-error]', String(err?.message ?? err));
  } finally {
    // После успешного входа форма перерисована и кнопок в ней уже нет —
    // трогаем только то, что осталось живым.
    if (host?.querySelector('[data-forum-auth]') === form) {
      for (const b of buttons) {
        if (!b.isConnected) continue;
        b.disabled = false;
        b.textContent = original.get(b);
      }
    }
  }
}

/* ── Картинки в форме ─────────────────────────────────────────────────────── */

/*
  Предел вложений задан одним числом в config.js и повторён триггером базы
  (supabase/profiles.sql). Здесь человек узнаёт о пределе ДО того, как напишет
  пост и нажмёт «Опубликовать», а база охраняет от запросов мимо сайта.
*/
const MAX_SHOTS = CONFIG.forum.limits.attachmentsMax;

/**
 * Добавить выбранные файлы к форме.
 *
 * @param {string} scope    'new', id поста или 'edit:<id>'.
 * @param {FileList|File[]} files
 * @param {number} [existing] Сколько картинок уже у записи (для правки).
 */
function addShots(scope, files, existing = 0) {
  const current = pendingShots.get(scope) ?? [];
  const room = MAX_SHOTS - existing - current.length;

  if (room <= 0) {
    showError(`[data-attach-error="${cssEscape(scope)}"]`,
      `К записи можно приложить не больше ${MAX_SHOTS} картинок`);
    return;
  }

  const taken = [...files].slice(0, room);
  const skipped = files.length - taken.length;

  for (const file of taken) {
    if (!String(file.type).startsWith('image/')) {
      showError(`[data-attach-error="${cssEscape(scope)}"]`, `«${file.name}» не картинка`);
      continue;
    }
    current.push({ file, preview: URL.createObjectURL(file) });
  }

  pendingShots.set(scope, current);

  if (skipped > 0) {
    showError(`[data-attach-error="${cssEscape(scope)}"]`,
      `Взято ${taken.length}: к записи можно приложить не больше ${MAX_SHOTS} картинок`);
  } else {
    clearError(`[data-attach-error="${cssEscape(scope)}"]`);
  }

  paintPendingShots();
}

/** Убрать одну выбранную картинку. */
function dropShot(scope, index) {
  const list = pendingShots.get(scope);
  if (!list?.[index]) return;

  // Ссылку на Blob освобождаем: иначе она держит файл в памяти до перезагрузки.
  URL.revokeObjectURL(list[index].preview);
  list.splice(index, 1);

  if (list.length) pendingShots.set(scope, list);
  else pendingShots.delete(scope);

  clearError(`[data-attach-error="${cssEscape(scope)}"]`);
  paintPendingShots();
}

/** Освободить все превью области: после публикации или при уходе со страницы. */
function clearShots(scope) {
  for (const item of pendingShots.get(scope) ?? []) URL.revokeObjectURL(item.preview);
  pendingShots.delete(scope);
}

function clearAllShots() {
  for (const scope of [...pendingShots.keys()]) clearShots(scope);
}

/*
 * ФОРМАТИРОВАНИЕ РЕДАКТОРА.
 *
 * Кнопки панели дергают document.execCommand — стандартный механизм жирного
 * курсива и цветов в contenteditable. Он же возвращает состояние: кнопка
 * «Жирный» держится нажатой, пока курсор внутри жирного текста. Это и есть
 * «сразу видно»: здесь нет маркеров, которые надо ждать, пока отрисуются.
 */

/** Редактор, в котором сейчас курсор. */
function activeEditor() {
  const a = document.activeElement;
  return a && a.matches?.('[contenteditable]') ? a : null;
}

/** Редактор той формы, где стоит кнопка. */
function editorFor(btn) {
  return btn.closest('form')?.querySelector('[data-editor]') ?? null;
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
function applyFormat(editor, cmd, value) {
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
function wrapInline(editor, tag) {
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

function textSample(tag) {
  return `<${tag}>текст</${tag}>`;
}

/**
 * Загрузить выбранные картинки к уже созданной записи.
 *
 * Ошибку одной картинки не считаем провалом всей публикации: пост уже
 * написан и опубликован, и терять его из-за неудачной загрузки третьего
 * скриншота нельзя. О неудаче говорим, но пост остаётся.
 *
 * @returns {Promise<string>} пустая строка или текст о неудачах
 */
async function uploadShots(scope, targetType, targetId, onProgress) {
  const list = pendingShots.get(scope) ?? [];
  if (!list.length) return '';

  const failed = [];
  for (let i = 0; i < list.length; i++) {
    onProgress?.(i + 1, list.length);
    try {
      await attachImage(targetType, targetId, list[i].file);
    } catch (err) {
      failed.push(String(err?.message ?? err));
    }
  }

  clearShots(scope);
  return failed.length ? `Не загрузились картинки: ${failed[0]}` : '';
}

/* ── Страница участника ───────────────────────────────────────────────────── */

async function loadProfile(nick) {
  mode = 'user';
  profileState.nick = nick;
  profileState.loading = true;
  profileState.error = '';
  profileState.editing = false;
  paint();

  try {
    profileState.profile = await getProfile(nick);
    profileState.posts = profileState.profile
      ? await getUserPosts(profileState.profile.id, 10)
      : [];
  } catch (err) {
    profileState.error = String(err?.message ?? err);
  } finally {
    profileState.loading = false;
    paint();
  }
}

/* ── Выпадающий список разделов (телефон) ─────────────────────────────────── */

function setPickOpen(pick, open) {
  pick.classList.toggle('is-open', open);
  pick.querySelector('[data-pick-open]')?.setAttribute('aria-expanded', String(open));
}

function closePicks() {
  if (!host) return;
  host.querySelectorAll('.pick.is-open').forEach((p) => setPickOpen(p, false));
}

/* ── Обработчики ──────────────────────────────────────────────────────────── */

function wire() {
  if (wired) return;
  wired = true;

  document.addEventListener('click', async (e) => {
    if (!host || !host.contains(e.target) || !e.target.closest) return;
    const t = e.target;

    /* ── Выпадающий список разделов: открыть/закрыть ── */

    const pickBtn = t.closest('[data-pick-open]');
    if (pickBtn && host.contains(pickBtn)) {
      /*
        Хронологии свои пикеры, форуму свои: оба обработчика живут на document
        и ловят один и тот же клик. Пикер типа в Хронологии открывает её
        обработчик, а наш закрыл бы обратно — поэтому чужие списки пропускаем.
      */
      const pick = pickBtn.closest('.pick');
      if (pick && !pick.classList.contains('pick--tl')) {
        const open = !pick.classList.contains('is-open');
        closePicks();
        if (open) setPickOpen(pick, true);
      }
      return;
    }

    /* ── Картинки в форме ── */

    /*
      «Войти и начать тему» в приветствии ведёт к форме входа: форма ниже по
      странице, а на телефоне баннер вообще за экраном. Это переход, а не
      действие — после него человек сам решает, куда идти.
    */
    const welcomeAuth = t.closest('[data-forum-welcome-auth]');
    if (welcomeAuth && host.contains(welcomeAuth)) {
      const form = host.querySelector('[data-forum-auth]');
      if (form) {
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const nick = form.querySelector('input[name="nick"]');
        nick?.focus({ preventScroll: true });
      }
      return;
    }

    const dropBtn = t.closest('[data-attach-drop]');
    if (dropBtn && host.contains(dropBtn)) {
      const [scope, index] = dropBtn.dataset.attachDrop.split(':');
      dropShot(scope, Number(index));
      return;
    }

    /* ── Опрос: показать/скрыть форму, добавить/убрать вариант ── */

    const pollToggle = t.closest('[data-forum-poll-toggle]');
    if (pollToggle && host.contains(pollToggle)) {
      const form = host.querySelector('[data-forum-poll-form]');
      if (form) form.hidden = !form.hidden;
      return;
    }

    const pollAdd = t.closest('[data-forum-poll-add]');
    if (pollAdd && host.contains(pollAdd)) {
      const container = host.querySelector('[data-forum-poll-options]');
      if (!container) return;
      const idx = container.querySelectorAll('.forum-field').length;
      if (idx >= 8) return;
      const label = document.createElement('label');
      label.className = 'forum-field';
      label.innerHTML = `<span>Вариант ${idx + 1}</span>
        <input type="text" name="poll_option_${idx}" maxlength="120" placeholder="Вариант ответа">`;
      container.appendChild(label);
      return;
    }

    const pollRemove = t.closest('[data-forum-poll-remove]');
    if (pollRemove && host.contains(pollRemove)) {
      const form = host.querySelector('[data-forum-poll-form]');
      if (form) form.hidden = true;
      return;
    }

    /*
      Панель форматирования. Кнопка применяет команду к редактору своей формы,
      стиль виден сразу — маркеров разметки больше нет. `color` отдельная
      команда: ей нужен свой аргумент (цвет), остальным — тег блока.
    */
    const mdBtn = t.closest('[data-editor-cmd]');
    if (mdBtn && host.contains(mdBtn)) {
      const editor = editorFor(mdBtn);
      if (editor) applyFormat(editor, mdBtn.dataset.editorCmd, mdBtn.dataset.editorValue);
      return;
    }
    const colorBtn = t.closest('[data-editor-color]');
    if (colorBtn && host.contains(colorBtn)) {
      const editor = editorFor(colorBtn);
      if (editor) applyFormat(editor, 'color', colorBtn.dataset.editorColor || 'inherit');
      return;
    }

    /* ── Профиль ── */

    if (t.closest('[data-profile-edit]')) {
      profileState.editing = !profileState.editing;
      paint();
      return;
    }
    if (t.closest('[data-profile-cancel]')) {
      profileState.editing = false;
      paint();
      return;
    }
    if (t.closest('[data-avatar-clear]')) {
      try {
        await clearAvatar();
        // Своя запись в состоянии тоже обновляется: аватарка стоит в шапке.
        if (state.me) state.me.avatarUrl = '';
        await loadProfile(profileState.nick);
        profileState.editing = true;
        paint();
      } catch (err) {
        showError('[data-avatar-error]', String(err?.message ?? err));
      }
      return;
    }

    // Раздел.
    const cat = t.closest('[data-forum-cat]');
    if (cat && host.contains(cat)) {
      // Выбор в выпадающем списке закрывает его; на сегментах безвредно.
      closePicks();
      state.category = cat.dataset.forumCat;
      state.openPostId = null;
      await loadFeed();
      return;
    }

    // Порядок.
    const sort = t.closest('[data-forum-sort]');
    if (sort && host.contains(sort)) {
      state.sort = sort.dataset.forumSort;
      await loadFeed();
      return;
    }

    // Правка своего поста: разворачиваем форму на месте карточки.
    if (t.closest('[data-forum-edit]')) {
      const id = t.closest('[data-forum-edit]').dataset.forumEdit;
      state.editingPostId = id;
      paint();
      return;
    }
    if (t.closest('[data-forum-edit-cancel]')) {
      const editForm = t.closest('[data-forum-edit-form]');
      const id = editForm?.dataset.forumEditForm;
      state.editingPostId = null;
      // Брошенные превью правки освобождаем — иначе они висят до ухода.
      if (id) clearShots(`edit:${id}`);
      paint();
      return;
    }

    /*
      Ответ с цитатой. Вместо того чтобы самому искать на экране нужную строку
      и переписывать её руками, человек нажимает «Цитировать» — и в поле под
      постом появляется текст записи с именем автора. Классическая механика
      форумов: спор не начинается заново каждый раз, когда ушёл на второй экран.
    */
    if (t.closest('[data-forum-quote]')) {
      const [targetType, targetId] = t.closest('[data-forum-quote]').dataset.forumQuote.split(':');
      const item = targetType === 'post'
        ? state.posts.find((p) => p.id === targetId)
        : state.comments.find((c) => c.id === targetId);
      if (!item || !state.openPostId) return;

      const editor = host.querySelector(
        `[data-forum-comment-form="${cssEscape(state.openPostId)}"] [data-editor]`
      );
      if (!editor) return;

      const L = CONFIG.forum.limits;
      const first = textOf(item.body).split(/\s+/).filter(Boolean).join(' ');
      const preview = first.length > 300 ? first.slice(0, 297).trimEnd() + '…' : first;
      const room = L.commentMax - textOf(editor.innerHTML).length;
      // Нет места — просто не вставляем, чтобы человек не понял её потом по лимиту.
      if (room < 20) return;

      const head = `${item.authorNick}: `;
      const fits = room >= head.length + preview.length;
      const cut = room - head.length - 1;
      const body = fits ? preview : cut > 0 ? preview.slice(0, cut) + '…' : '';
      if (!body) return;

      const quote = `<blockquote><p><strong>${esc(item.authorNick)}:</strong> ${esc(body)}</p></blockquote>`;
      editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      editor.focus({ preventScroll: true });
      if (typeof document.execCommand === 'function') {
        document.execCommand('insertHTML', false, quote);
      } else {
        const tpl = editor.ownerDocument.createElement('template');
        tpl.innerHTML = quote;
        editor.appendChild(tpl.content);
      }
      syncEditorEmpty(editor);
      return;
    }

    // Показать ещё.
    if (t.closest('[data-forum-more]')) {
      await loadFeed({ append: true });
      return;
    }

    if (t.closest('[data-forum-retry]')) {
      await loadFeed();
      return;
    }

    // Выход.
    if (t.closest('[data-forum-signout]')) {
      await forum.signOut();
      state.me = null;
      await loadFeed();
      return;
    }

    // Реакция.
    const react = t.closest('[data-forum-react]');
    if (react && host.contains(react)) {
      const [targetType, targetId, reactionId] = react.dataset.forumReact.split(':');
      const item = targetType === 'post'
        ? state.posts.find((p) => p.id === targetId)
        : state.comments.find((c) => c.id === targetId);

      // Повторное нажатие снимает реакцию — иначе поставленное не отменить.
      const next = item?.myReaction === reactionId ? null : reactionId;

      /*
        Реакцию показываем СРАЗУ, не дожидаясь базы. Нажатие на лайк должно
        отзываться мгновенно: это движение, а не отправка формы, и задержка
        в полсекунды читается как «не нажалось», после чего человек жмёт
        второй раз.

        Если база откажет, refreshOne вернёт настоящее значение обратно.
      */
      if (item) {
        const counts = { ...(item.reactions ?? {}) };
        if (item.myReaction) counts[item.myReaction] = Math.max(0, (counts[item.myReaction] ?? 1) - 1);
        if (next) counts[next] = (counts[next] ?? 0) + 1;
        item.reactions = counts;
        item.myReaction = next;
        paint();
      }

      try {
        await forum.setReaction(targetType, targetId, next);
        await refreshOne(targetType, targetId);
      } catch (err) {
        state.error = String(err?.message ?? err);
        // Возвращаем настоящее состояние: показанное было предположением.
        await refreshOne(targetType, targetId);
      }
      return;
    }

    // Смайлики: открыть и закрыть список.
    const emojiOpen = t.closest('[data-forum-emoji-open]');
    if (emojiOpen && host.contains(emojiOpen)) {
      const key = emojiOpen.dataset.forumEmojiOpen;
      const pop = host.querySelector(`[data-forum-emoji-pop="${cssEscape(key)}"]`);
      const wasHidden = pop?.hidden;
      host.querySelectorAll('[data-forum-emoji-pop]').forEach((p) => { p.hidden = true; });
      if (pop) pop.hidden = !wasHidden;
      return;
    }
    if (!t.closest('.forum-emoji')) {
      host.querySelectorAll('[data-forum-emoji-pop]').forEach((p) => { p.hidden = true; });
    }

    // Опрос: голосование.
    const pollOpt = t.closest('[data-forum-poll-opt]');
    if (pollOpt && host.contains(pollOpt)) {
      const [pollId, optionId] = pollOpt.dataset.forumPollOpt.split(':');
      const poll = findPoll(state, pollId);
      if (!poll || poll.closed) return;

      const mine = poll.options.find((o) => o.mine);
      const sameOption = mine?.id === optionId;

      if (!sameOption) {
        // Смена варианта в опросе с одним ответом: сначала снять старый голос.
        // База принимает голос за другой вариант только после снятия: первичный
        // ключ держит один голос за вариант, а триггер — один голос на опрос.
        if (!poll.multiple && mine) {
          try { await forum.unvotePoll(pollId, mine.id); } catch (_) {}
        }
      }

      try {
        if (sameOption) {
          await forum.unvotePoll(pollId, optionId);
        } else {
          await forum.votePoll(pollId, optionId);
        }
      } catch (_) {}

      await refreshOne('post', state.openPostId || pollPostId(state, pollId));
      return;
    }

    // Жалоба.
    const report = t.closest('[data-forum-report]');
    if (report && host.contains(report)) {
      const [targetType, targetId] = report.dataset.forumReport.split(':');
      state.pending = { kind: 'report', targetType, targetId };
      openModal('[data-forum-report-modal]');
      return;
    }
    if (t.closest('[data-forum-report-cancel]')) {
      closeModal('[data-forum-report-modal]');
      return;
    }

    // Закрепление темы (модерация).
    const pinBtn = t.closest('[data-forum-pin]');
    if (pinBtn && host.contains(pinBtn)) {
      const id = pinBtn.dataset.forumPin;
      const post = state.posts.find((p) => p.id === id);
      const next = !post?.pinned;

      /*
        Ставим сразу, а не после ответа базы: переключение должно отозваться
        мгновенно. Если база откажет (лимит, права), loadFeed вернёт настоящее
        состояние обратно.
      */
      if (post) {
        post.pinned = next;
        paint();
      }

      try {
        await forum.setPinned(id, next);
        // Порядок ленты меняется (закреплённые всегда сверху) — перерисовываем её.
        await loadFeed();
      } catch (err) {
        state.error = String(err?.message ?? err);
        await loadFeed();
      }
      return;
    }

    // Удаление.
    const delPost = t.closest('[data-forum-del-post]');
    if (delPost && host.contains(delPost)) {
      const id = delPost.dataset.forumDelPost;
      const post = state.posts.find((p) => p.id === id);
      state.pending = { kind: 'delete', targetType: 'post', targetId: id, own: post?.authorId === state.me?.id };
      openDeleteModal();
      return;
    }
    const delComment = t.closest('[data-forum-del-comment]');
    if (delComment && host.contains(delComment)) {
      const id = delComment.dataset.forumDelComment;
      const comment = state.comments.find((c) => c.id === id);
      state.pending = { kind: 'delete', targetType: 'comment', targetId: id, own: comment?.authorId === state.me?.id };
      openDeleteModal();
      return;
    }
    if (t.closest('[data-forum-delete-cancel]')) {
      closeModal('[data-forum-delete-modal]');
      return;
    }
  });

  /*
    Выбор файла — событие change, а не click: click срабатывает при открытии
    диалога, когда файла ещё нет.
  */
  /* ── Поиск по ленте ────────────────────────────────────────────────────────
    Ищем в названии и тексте записей. Держим паузу: при каждой букве лезть
    в базу — значит дёргать её на темп набора. Ключ 'search' в findByKey
    возвращает инпут после перерисовки, поэтому запрос не теряется.
  */
  let searchTimer;
  document.addEventListener('input', (e) => {
    if (!host || !host.contains(e.target)) return;

    const editor = e.target.closest?.('[data-editor]');
    if (editor) {
      syncEditorEmpty(editor);
      return;
    }

    const search = e.target.closest('[data-forum-search]');
    if (!search) return;

    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      state.query = search.value.trim();
      state.openPostId = null;
      await loadFeed();
    }, 300);
  });

  /*
    Лимит редактора держим сами: у contenteditable нет maxlength. Печатать
    дальше предела не даём (beforeinput успевает перехватить), а вставка
    идёт только текстом без формата — иначе человек случайно притащит
    в пост чужую вёрстку с картинками.
  */
  document.addEventListener('beforeinput', (e) => {
    if (!host || !host.contains(e.target)) return;
    const editor = e.target.closest?.('[data-editor]');
    if (!editor || (e.inputType !== 'insertText' && e.inputType !== 'insertCompositionText')) return;

    const limit = Number(editor.dataset.limit);
    if (!limit) return;
    const extra = (e.data ?? '').length;
    if (!extra) return;
    if (textOf(editor.innerHTML).length + extra > limit) e.preventDefault();
  });

  document.addEventListener('paste', (e) => {
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
    исчезнет и команда применится впустую. focus() на самом element, но
    предупреждённого mousedown этого шага не требует — selection просто
    остаётся на месте.
  */
  document.addEventListener('mousedown', (e) => {
    if (!host || !host.contains(e.target)) return;
    if (e.target.closest?.('[data-editor-cmd], [data-editor-color]')) e.preventDefault();
  });

  /*
    Кнопки «Жирный» и прочие держатся нажатыми, пока стиль действует: человек
    видит состояние без переключения.
  */
  document.addEventListener('selectionchange', () => {
    if (!host || typeof document.queryCommandState !== 'function') return;
    const editor = activeEditor();
    if (!editor || !host.contains(editor)) return;
    for (const btn of host.querySelectorAll('[data-editor-cmd]')) {
      if (!host.contains(btn)) continue;
      if (!['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript'].includes(btn.dataset.editorCmd)) continue;
      let state2 = false;
      try { state2 = document.queryCommandState(btn.dataset.editorCmd); } catch { /* старый браузер */ }
      btn.setAttribute('aria-pressed', state2 ? 'true' : 'false');
    }
  });

  document.addEventListener('change', async (e) => {
    if (!host || !host.contains(e.target)) return;

    const attachInput = e.target.closest('[data-attach-input]');
    if (attachInput) {
      const scope = attachInput.dataset.attachInput;
      let existing = 0;
      // При правке превью прибавляются к уже загруженным картинкам записи:
      // комнату под новые считаем от общего лимита.
      if (scope.startsWith('edit:')) {
        const postId = scope.slice(5);
        existing = state.posts.find((p) => p.id === postId)?.attachments?.length ?? 0;
      }
      addShots(scope, attachInput.files ?? [], existing);
      /*
        Поле очищаем: иначе выбор того же файла второй раз не даст события,
        и человек решит, что кнопка перестала работать.
      */
      attachInput.value = '';
      return;
    }

    const avatarInput = e.target.closest('[data-avatar-input]');
    if (avatarInput) {
      const file = avatarInput.files?.[0];
      avatarInput.value = '';
      if (!file) return;

      clearError('[data-avatar-error]');
      const label = avatarInput.closest('label');
      const span = label?.querySelector('span');
      const was = span?.textContent;
      if (span) span.textContent = 'Загружаем…';

      try {
        const url = await uploadAvatar(file);
        if (state.me) state.me.avatarUrl = url;
        await loadProfile(profileState.nick);
        profileState.editing = true;
        paint();
      } catch (err) {
        if (span) span.textContent = was;
        showError('[data-avatar-error]', String(err?.message ?? err));
      }
    }
  });

  document.addEventListener('submit', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const form = e.target;

    /*
      Кнопка не всегда известна: Enter в поле отправляет форму, и некоторые
      браузеры не сообщают, какая именно кнопка нажата. Для «Публикуем…»
      важен сам факт нажатой кнопки, а не её имя — берём первую сабмитнущую,
      если браузер промолчал.
    */
    const submitter = e.submitter ?? form.querySelector('button[type="submit"]');

    // Вход и регистрация: две кнопки в одной форме, различаем по нажатой.
    if (form.matches('[data-forum-auth]')) {
      e.preventDefault();
      const mode = submitter?.dataset.forumMode === 'signup' ? 'signup' : 'signin';
      await handleAuth(form, mode, submitter);
      return;
    }

    // Новый пост.
    if (form.matches('[data-forum-new]')) {
      e.preventDefault();
      clearError('[data-forum-new-error]');

      const pollForm = form.querySelector('[data-forum-poll-form]');
      let poll = null;
      if (pollForm && !pollForm.hidden) {
        const question = form.poll_question?.value?.trim();
        const options = [];
        for (let i = 0; i < 8; i++) {
          const opt = form[`poll_option_${i}`]?.value?.trim();
          if (opt) options.push(opt);
        }
        if (question && options.length >= 2) {
          poll = { question, multiple: Boolean(form.poll_multiple?.checked), options };
        }
      }

      const checked = validatePost({
        title: form.title.value,
        body: formBody(form),
        category: form.category.value,
      });
      if (!checked.ok) return showError('[data-forum-new-error]', checked.error);

      const draft = { ...checked.value, poll };

      await withBusy(submitter, 'Публикуем…', async () => {
        try {
          const created = await forum.createPost(draft);

          /*
            Картинки грузятся ПОСЛЕ создания поста: вложение ссылается
            на запись, значит запись должна существовать. Неудача загрузки
            не отменяет пост — он уже написан и опубликован, и терять его
            из-за третьего скриншота нельзя.
          */
          const shotError = await uploadShots('new', 'post', created.id, (i, n) => {
            if (submitter) submitter.textContent = `Картинка ${i}/${n}…`;
          });

          /*
            Форму очищаем ТОЛЬКО после успеха. Первая версия делала reset()
            до запроса — и при отказе базы текст поста исчезал вместе
            с сообщением об ошибке: человек терял написанное и не понимал,
            за что.
          */
          resetForm(form);
          state.category = 'all';
          state.sort = 'fresh';
          await loadFeed();
          // Сразу открываем созданное: человек должен увидеть результат,
          // а не искать свой пост в ленте.
          location.hash = `#/forum/${created.id}`;
          if (shotError) notice(shotError);
        } catch (err) {
          showError('[data-forum-new-error]', String(err?.message ?? err));
        }
      });
      return;
    }

    // Комментарий.
    const commentForm = form.closest('[data-forum-comment-form]');
    if (commentForm) {
      e.preventDefault();
      clearError('[data-forum-comment-error]');

      const checked = validateComment(formBody(commentForm));
      if (!checked.ok) return showError('[data-forum-comment-error]', checked.error);

      await withBusy(submitter, 'Отправляем…', async () => {
        try {
          const postId = commentForm.dataset.forumCommentForm;
          const created = await forum.addComment(postId, checked.value);

          const shotError = created?.id
            ? await uploadShots(postId, 'comment', created.id, (i, n) => {
                if (submitter) submitter.textContent = `Картинка ${i}/${n}…`;
              })
            : '';

          resetForm(commentForm);
          await loadThread(postId);
          if (shotError) notice(shotError);
        } catch (err) {
          showError('[data-forum-comment-error]', String(err?.message ?? err));
        }
      });
      return;
    }

    // Правка поста.
    if (form.matches('[data-forum-edit-form]')) {
      e.preventDefault();
      clearError('[data-forum-edit-error]');

      const id = form.dataset.forumEditForm;
      const checked = validatePost({
        title: form.title.value,
        body: formBody(form),
        category: form.category.value,
      });
      if (!checked.ok) return showError('[data-forum-edit-error]', checked.error);

      await withBusy(submitter, 'Сохраняем…', async () => {
        try {
          await forum.editPost(id, checked.value);

          const shotError = await uploadShots(`edit:${id}`, 'post', id, (i, n) => {
            if (submitter) submitter.textContent = `Картинка ${i}/${n}…`;
          });

          state.editingPostId = null;
          // После правки — туда же, где человек был: тред или лента.
          if (state.openPostId === id) await loadThread(id);
          else await loadFeed();
          if (shotError) notice(shotError);
        } catch (err) {
          showError('[data-forum-edit-error]', String(err?.message ?? err));
        }
      });
      return;
    }

    /* ── Профиль ── */
    if (form.matches('[data-profile-form]')) {
      e.preventDefault();
      clearError('[data-profile-error]');

      await withBusy(submitter, 'Сохраняем…', async () => {
        try {
          await saveProfile({
            about: form.about.value,
            allianceTag: form.allianceTag.value,
          });
          profileState.editing = false;
          await loadProfile(profileState.nick);
        } catch (err) {
          showError('[data-profile-error]', String(err?.message ?? err));
        }
      });
      return;
    }

    // Отправка жалобы.
    if (form.matches('[data-forum-report-form]')) {
      e.preventDefault();
      clearError('[data-forum-report-error]');
      const ruleId = form.ruleId.value;
      if (!ruleId) return showError('[data-forum-report-error]', 'Выберите пункт правил');

      try {
        await forum.report({
          targetType: state.pending.targetType,
          targetId: state.pending.targetId,
          ruleId,
          note: form.note.value,
        });
        closeModal('[data-forum-report-modal]');
        notice('Жалоба отправлена. Администратор разберётся.');
      } catch (err) {
        showError('[data-forum-report-error]', String(err?.message ?? err));
      }
      return;
    }

    // Подтверждение удаления.
    if (form.matches('[data-forum-delete-form]')) {
      e.preventDefault();
      clearError('[data-forum-delete-error]');

      const { targetType, targetId, own } = state.pending ?? {};
      const ruleId = form.ruleId?.value || '';

      // Свой пост удаляют без причины, чужой — только с пунктом правил.
      if (!own && !ruleId) {
        return showError('[data-forum-delete-error]', 'Выберите пункт правил: автор должен узнать причину');
      }

      try {
        const reason = own ? 'Удалено автором' : deletionReason(ruleId, form.note?.value ?? '');
        if (targetType === 'post') {
          await forum.deletePost(targetId, reason);
          closeModal('[data-forum-delete-modal]');
          if (state.openPostId === targetId) await loadThread(targetId);
          else await loadFeed();
        } else {
          await forum.deleteComment(targetId, reason);
          closeModal('[data-forum-delete-modal]');
          if (state.openPostId) await loadThread(state.openPostId);
        }
      } catch (err) {
        showError('[data-forum-delete-error]', String(err?.message ?? err));
      }
    }
  });

  // Закрытие окна по Esc: без этого на телефоне из него не выйти,
  // если кнопка «Отмена» ушла за край экрана.
  document.addEventListener('keydown', (e) => {
    if (!host) return;

    if (e.key === 'Escape') {
      closeModal('[data-forum-report-modal]');
      closeModal('[data-forum-delete-modal]');
      host.querySelectorAll('[data-forum-emoji-pop]').forEach((p) => { p.hidden = true; });
      closePicks();
      return;
    }

    /*
      Ctrl+Enter отправляет комментарий и пост.

      Про удобство на клавиатуре: в поле для многострочного текста Enter
      обязан переносить строку, иначе абзац не набрать. Значит нужен второй
      способ отправить, и Ctrl+Enter — тот, который уже знают по мессенджерам.
      Cmd+Enter для тех, кто с Mac.
    */
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const area = e.target;
      if (area?.tagName !== 'TEXTAREA' || !host.contains(area)) return;
      const form = area.closest('form');
      if (!form) return;
      e.preventDefault();
      form.requestSubmit();
    }
  });

  /*
    Нажатие мимо окна закрывает его. На телефоне это основной способ:
    кнопка «Отмена» может оказаться ниже края экрана, а тянуться к ней
    большим пальцем неудобно.
  */
  document.addEventListener('click', (e) => {
    if (!host || !host.contains(e.target) || !e.target.classList) return;
    if (e.target.matches('[data-forum-report-modal]')) closeModal('[data-forum-report-modal]');
    if (e.target.matches('[data-forum-delete-modal]')) closeModal('[data-forum-delete-modal]');
  });

  /*
    Клик мимо открытого выпадающего списка разделов закрывает его. Слушатель
    живёт без проверки host: закрыть нужно и за кликом по боку страницы.
    Esc закрывает список рядом с окнами — см. keydown выше.
  */
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.pick')) return;
    closePicks();
  });
}

/* ── Окна ─────────────────────────────────────────────────────────────────── */

function openModal(selector) {
  const modal = host?.querySelector(selector);
  if (!modal) return;
  modal.hidden = false;
  /*
    Прокрутку страницы под открытым окном запрещаем: иначе на телефоне
    палец двигает страницу, а не список пунктов правил, и окно уезжает
    из вида вместе с ней.
  */
  document.documentElement.classList.add('is-modal-open');
  // Фокус внутрь окна: с клавиатуры иначе не добраться до кнопок.
  modal.querySelector('input, button, textarea, select')?.focus({ preventScroll: true });
}

function closeModal(selector) {
  const modal = host?.querySelector(selector);
  if (!modal) return;
  modal.hidden = true;
  modal.querySelector('form')?.reset();
  modal.querySelectorAll('.forum-error').forEach((p) => { p.hidden = true; });

  // Запрет прокрутки снимаем только когда закрыты оба окна.
  const anyOpen = host?.querySelector('.forum-modal:not([hidden])');
  if (!anyOpen) document.documentElement.classList.remove('is-modal-open');
}

/** Своё удаление и чужое — разные окна по смыслу, но одно по разметке. */
function openDeleteModal() {
  const modal = host?.querySelector('[data-forum-delete-modal]');
  if (!modal) return;
  const own = Boolean(state.pending?.own);
  const isStaff = state.me?.role === 'admin' || state.me?.role === 'moderator';
  // Свой пост автор удаляет без объяснений: причина нужна тому, кому
  // удалили, а не тому, кто удалил сам.
  const needReason = !own || isStaff;

  modal.querySelector('[data-forum-delete-own]').hidden = !own;
  modal.querySelector('[data-forum-delete-rules]').hidden = !needReason || own;
  modal.querySelector('[data-forum-delete-note]').hidden = !needReason || own;

  modal.hidden = false;
  document.documentElement.classList.add('is-modal-open');
  modal.querySelector('input, button')?.focus({ preventScroll: true });
}

/**
 * Короткое сообщение об успехе.
 *
 * Отдельная полоса, а не alert: alert останавливает страницу и на телефоне
 * выглядит как ошибка сайта.
 */
function notice(text) {
  const box = document.createElement('div');
  box.className = 'forum-toast';
  box.textContent = text;
  document.body.append(box);
  window.setTimeout(() => box.remove(), 4000);
}

/** В именах реакций есть двоеточие, поэтому в селекторе его надо закрыть. */
function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&');
}

/* ── Вход и выход со страницы ─────────────────────────────────────────────── */

/**
 * Форум появился на экране.
 *
 * @param {HTMLElement} container Куда рисовать.
 * @param {any} view              Данные сайта — для полосы хроники.
 * @param {string|null} postId    Открытая тема из адреса.
 */
export async function mountForum(container, view, postId = null) {
  host = container;
  siteView = view;
  mode = 'feed';
  wire();

  /*
    Пока ждём ответа хранилища, показываем «загружаем». Без этого страница
    остаётся пустой на всё время запроса — а на медленной сети это секунды,
    и человек успевает решить, что форум не работает.
  */
  state.loading = true;
  state.error = '';
  paint();

  try {
    state.ready = await forum.isReady();
  } catch (err) {
    /*
      Настройка не прочиталась — например, в config.js стоит служебный ключ,
      и адаптер отказался работать. Это не «форум не настроен», а именно
      ошибка, и показать надо её текст: он объясняет, что исправить.
    */
    state.ready = false;
    state.error = String(err?.message ?? err);
    state.loading = false;
    paint();
    return;
  }

  state.shared = forum.capabilities.isShared;
  state.sourceName = forum.name;

  if (!state.ready) {
    state.loading = false;
    paint();
    return;
  }

  try {
    state.me = await forum.currentUser();
  } catch {
    // Просроченная сессия — не ошибка страницы: просто никто не вошёл.
    state.me = null;
  }

  /*
    Просмотр регистрируем при ОТКРЫТИИ темы, а не в loadThread: тот зовётся
    ещё и после правки, удаления или комментария, и каждая такая перерисовка
    не должна засчитывать новый просмотр. Каждый переход на пост — «я открыл
    и прочитал».

    Счётчик не ждём и не «дорисовываем»: регистрация идёт своей дорогой,
    а число показывает то, что пришло из хранилища. Дорисовка единицы здесь
    привела бы к двойному счёту на глазах у читателя — база успевает
    прибавить раньше, чем читается лента.
  */
  if (postId) {
    forum.registerView(postId).catch(() => {});
    await loadThread(postId);
  } else {
    state.openPostId = null;
    await loadFeed();
  }
}

/**
 * СТРАНИЦА УЧАСТНИКА.
 *
 * Отдельный вход, но тот же механизм отрисовки и те же обработчики: форум
 * и профиль это одна страница с двумя видами, а не два приложения. Иначе
 * пришлось бы дважды писать вход, дважды — сохранение набранного текста
 * и дважды ловить одни и те же нажатия.
 *
 * @param {HTMLElement} container
 * @param {string} nick Ник из адреса.
 */
export async function mountUser(container, nick) {
  host = container;
  wire();

  let ready = false;
  try {
    // isReady() в адаптере — обещание, но страховаться от синхронного ответа
    // дешевле, чем однажды поймать «голый boolean» в .catch() — ровно так
    // профиль не открывался у всех, кто нажимал на ник.
    ready = await forum.isReady();
  } catch {
    ready = false;
  }

  if (!ready) {
    mode = 'user';
    profileState.profile = null;
    profileState.nick = nick;
    profileState.loading = false;
    profileState.error = 'Форум ещё не подключён — профилей пока нет.';
    paint();
    return;
  }

  /*
    Кто вошёл, нужно знать и здесь: от этого зависит, своя это страница
    (с кнопкой правки) или чужая.
  */
  try {
    state.me = await forum.currentUser();
  } catch {
    state.me = null;
  }

  await loadProfile(nick);
}

/** Ушли на другую вкладку: держать чужую разметку в руках незачем. */
export function unmountForum() {
  host = null;
  mode = 'feed';
  state.openPostId = null;
  state.comments = [];
  state.query = '';
  state.editingPostId = null;

  profileState.profile = null;
  profileState.posts = [];
  profileState.editing = false;

  /*
    Ссылки на выбранные картинки освобождаем обязательно: иначе браузер держит
    файлы в памяти до перезагрузки страницы, а на телефоне это несколько
    мегабайт за каждую брошенную форму.
  */
  clearAllShots();

  /*
    Запрет прокрутки снимаем обязательно. Иначе уход со страницы при открытом
    окне оставлял бы страницу навсегда неподвижной — и починить это можно
    было бы только перезагрузкой.
  */
  document.documentElement.classList.remove('is-modal-open');
}
