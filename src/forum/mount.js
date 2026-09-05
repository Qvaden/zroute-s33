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
import { validateNick, validatePassword, validatePost, validateComment, deletionReason } from './rules.js';
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
  /** Что удаляем или на что жалуемся, пока открыто окно. */
  pending: null,
};

/** Данные сайта нужны для полосы хроники сверху. */
let siteView = null;
/** Куда рисуем. null — форум не на экране. */
let host = null;
let wired = false;

/* ── Отрисовка ────────────────────────────────────────────────────────────── */

function paint() {
  if (!host) return;
  host.innerHTML = renderForum(siteView, state) + renderReportDialog() + renderDeleteDialog();
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

/* ── Загрузка ─────────────────────────────────────────────────────────────── */

async function loadFeed({ append = false } = {}) {
  state.loading = !append;
  state.error = '';
  if (!append) paint();

  try {
    const { posts, total } = await forum.listPosts({
      category: state.category,
      sort: state.sort,
      limit: CONFIG.forum.pageSize,
      offset: append ? state.posts.length : 0,
    });
    state.posts = append ? [...state.posts, ...posts] : posts;
    state.total = total;
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
  paint();
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

async function handleAuth(form, mode) {
  clearError('[data-forum-auth-error]');

  const nick = validateNick(form.nick.value);
  if (!nick.ok) return showError('[data-forum-auth-error]', nick.error);

  const password = validatePassword(form.password.value);
  if (!password.ok) return showError('[data-forum-auth-error]', password.error);

  try {
    state.me = mode === 'signup'
      ? await forum.signUp(nick.value, password.value)
      : await forum.signIn(nick.value, password.value);
    await loadFeed();
  } catch (err) {
    showError('[data-forum-auth-error]', String(err?.message ?? err));
  }
}

/* ── Обработчики ──────────────────────────────────────────────────────────── */

function wire() {
  if (wired) return;
  wired = true;

  document.addEventListener('click', async (e) => {
    if (!host || !e.target.closest) return;
    const t = e.target;

    // Раздел.
    const cat = t.closest('[data-forum-cat]');
    if (cat && host.contains(cat)) {
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
      try {
        await forum.setReaction(targetType, targetId, next);
        await refreshOne(targetType, targetId);
      } catch (err) {
        state.error = String(err?.message ?? err);
        paint();
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

  document.addEventListener('submit', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const form = e.target;

    // Вход и регистрация: две кнопки в одной форме, различаем по нажатой.
    if (form.matches('[data-forum-auth]')) {
      e.preventDefault();
      const mode = e.submitter?.dataset.forumMode === 'signup' ? 'signup' : 'signin';
      await handleAuth(form, mode);
      return;
    }

    // Новый пост.
    if (form.matches('[data-forum-new]')) {
      e.preventDefault();
      clearError('[data-forum-new-error]');

      const checked = validatePost({
        title: form.title.value,
        body: form.body.value,
        category: form.category.value,
      });
      if (!checked.ok) return showError('[data-forum-new-error]', checked.error);

      try {
        const created = await forum.createPost(checked.value);
        form.reset();
        state.category = 'all';
        state.sort = 'fresh';
        await loadFeed();
        // Сразу открываем созданное: человек должен увидеть результат,
        // а не искать свой пост в ленте.
        location.hash = `#/forum/${created.id}`;
      } catch (err) {
        showError('[data-forum-new-error]', String(err?.message ?? err));
      }
      return;
    }

    // Комментарий.
    const commentForm = form.closest('[data-forum-comment-form]');
    if (commentForm) {
      e.preventDefault();
      clearError('[data-forum-comment-error]');

      const checked = validateComment(form.body.value);
      if (!checked.ok) return showError('[data-forum-comment-error]', checked.error);

      try {
        await forum.addComment(commentForm.dataset.forumCommentForm, checked.value);
        form.reset();
        await loadThread(commentForm.dataset.forumCommentForm);
      } catch (err) {
        showError('[data-forum-comment-error]', String(err?.message ?? err));
      }
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
    if (e.key !== 'Escape' || !host) return;
    closeModal('[data-forum-report-modal]');
    closeModal('[data-forum-delete-modal]');
  });
}

/* ── Окна ─────────────────────────────────────────────────────────────────── */

function openModal(selector) {
  const modal = host?.querySelector(selector);
  if (modal) modal.hidden = false;
}

function closeModal(selector) {
  const modal = host?.querySelector(selector);
  if (!modal) return;
  modal.hidden = true;
  modal.querySelector('form')?.reset();
  modal.querySelectorAll('.forum-error').forEach((p) => { p.hidden = true; });
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
  wire();

  state.ready = await forum.isReady();
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

  if (postId) await loadThread(postId);
  else {
    state.openPostId = null;
    await loadFeed();
  }
}

/** Ушли на другую вкладку: держать чужую разметку в руках незачем. */
export function unmountForum() {
  host = null;
  state.openPostId = null;
  state.comments = [];
}
