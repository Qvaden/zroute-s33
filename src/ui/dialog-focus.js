/*
  Клавиатура в диалоге: не выпускать наружу и вернуть туда, откуда пришли.

  ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Окна есть и на витрине (жалоба на запись, удаление),
  и в панели (запрет писать, переименование, выбор цвета гайда, оценка
  репутации). Разметка у них своя, закрывание своё, а требование одно:
  человек, открывший окно с клавиатуры, не обязан искать глазами, куда делся
  фокус.

  ЧТО МЕРЯЛОСЬ ЖИВЬЁМ (../scratch/keyboard.mjs). До этого модуля обход Tab-ом
  из окна выходил в страницу за ним: браузер считает диалог обычным блоком,
  потому что `aria-modal="true"` — обещание программе чтения с экрана, а не
  правило раскладки. И второе: закрытие окна возврат фокуса не делало —
  activeElement оставался на удалённом узле и спрыгивал на <body>, то есть
  следующий Tab начинался с самой ссылки «К содержимому», а не с того места,
  где человек остановился.

  ПОЧЕМУ НЕ `inert`. Сделать неактивными всех соседей окна — самый короткий
  способ удержать фокус внутри, но окно живёт внутри той же колонки, что и
  остальное содержимое: пометить родителя значит выключить и само окно.
  Перенос окон в отдельный слой — правка раскладки двух приложений ради
  одного атрибута; здесь за порядок отвечает обработчик Tab.

  ПОЧЕМУ СПИСОК УЗЛОВ СЧИТАЕТСЯ КАЖДЫЙ РАЗ. Содержимое окна перекрашивается
  вместе с ответом базы (список правил, строка ошибки, скрытие чужих блоков),
  и заученный на открытии ряд устарел бы на первом же обновлении.
*/

const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]';
const trapped = new Map();

/** Видимые фокусируемые узлы внутри контейнера — в порядке обхода. */
function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.disabled || el.getAttribute('tabindex') === '-1' || el.type === 'hidden') return false;
    if (el.closest('[hidden],[aria-hidden=true]')) return false;
    /* offsetParent у fixed-узла null, но окно целиком лежит в fixed-слое:
       проверяем не родителя, а самого себя на нулевой коробке. */
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  });
}

/**
 * Ставим фокус на узел и показываем его внутри окна.
 *
 * `preventScroll` нужен, чтобы страница за окном не дёрнулась. Но у самого
 * окна прокрутка своя (пунктов правил больше, чем экран), и с этим флагом
 * браузер не докручивает её: ряд замкнулся на первый пункт, окно прокручено
 * вниз — и человек остался с фокусом, которого не видно. Поэтому прокручиваем
 * сами, до краёв самого окна: документ под открытым окном всё равно залочен
 * (`.is-modal-open { overflow: hidden }`), так что дёрнуться ему нечем.
 */
function focusAndReveal(el) {
  if (!el) return el;
  el.focus({ preventScroll: true });
  /* `instant` — не украшение: у документа стоит `scroll-behavior: smooth`, и
     без явного указания возврат фокуса превращался бы в плавный перелёт. */
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  return el;
}

/**
 * Ставим фокус на первый видимый узел окна и возвращаем его.
 *
 * Помощник общий, потому что окно могут открыть уже после того, как часть
 * его пунктов спрятали или, наоборот, показали: ряд «кто первый» считается
 * по текущему кадру, а не заучивается на открытии.
 */
export function focusFirstIn(modal) {
  return focusAndReveal(modal ? focusables(modal)[0] : null);
}

/**
 * Вызывается в момент, когда окно стало видимым, — до того как фокус
 * передали первому узлу внутри: открывающая кнопка тогда и остаётся тем,
 * кому фокус вернётся.
 */
export function trapDialog(modal) {
  if (!modal || trapped.has(modal)) return;
  /* Перерисовка экрана выбрасывает окно из документа вместе с его узлом, и
     тогда запись в ряду остаётся висеть на мёртвом узле: снимаем такие,
     пока не разросся сам ряд. */
  for (const [m] of trapped) if (!m.isConnected) trapped.delete(m);
  const opener = document.activeElement && !modal.contains(document.activeElement)
    ? document.activeElement : null;
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const list = focusables(modal);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const cur = document.activeElement;
    if (!modal.contains(cur)) return;
    /* На краях ряд замыкаем; с середины не мешаем браузеру. */
    if (e.shiftKey && (cur === first || cur === modal)) {
      e.preventDefault();
      focusAndReveal(last);
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault();
      focusAndReveal(first);
    }
  };
  modal.addEventListener('keydown', onKey);
  trapped.set(modal, { opener, onKey });
}

/**
 * Вызов до или после `hidden = true` — без разницы: возврат проверяется по
 * факту «узел ещё в документе и виден», а не по состоянию окна.
 */
export function releaseDialog(modal) {
  const entry = trapped.get(modal);
  if (!entry) return;
  modal.removeEventListener('keydown', entry.onKey);
  trapped.delete(modal);
  const opener = entry.opener;
  if (!opener || !opener.isConnected) return;
  /* Кнопка могла остаться в разметке, но спрятаться внутри свёрнутого
     <details>: список «Ещё действия с постом» сворачивают и по Escape, и
     перекраска строки. К невидимому узлу фокус не переезжает — браузер
     отдаёт его <body>, и человек теряет место. Поэтому ветку списка сначала
     раскрываем, и только потом смотрим, видна ли сама кнопка. */
  for (let d = opener.closest('details'); d; d = d.parentElement?.closest('details')) {
    if (!d.open) d.open = true;
  }
  /* Кнопка, открывшая окно, могла исчезнуть вместе с перерисовкой строки.
     Возвращать фокус в несуществующий или невидимый узел нельзя: браузер
     молча оставит его на <body>, и человек потеряется. */
  if (opener.offsetParent === null && getComputedStyle(opener).position !== 'fixed') return;
  /* Прокрутку здесь разрешаем: окно уже закрыто, запрет на документ снят, а
     раскрытый только что <details> отодвинул кнопку вниз — без прокрутки
     человек получил бы фокус за краем экрана. */
  focusAndReveal(opener);
}

/** Только для проверок: сколько окон сейчас держит клавиатуру. */
export function trappedCount() {
  return trapped.size;
}
