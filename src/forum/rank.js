/**
 * УРОВЕНЬ, ДОСТИЖЕНИЯ И РЕПУТАЦИЯ ФОРУМА.
 *
 * Всё считается из чисел, которые уже отдаёт база (forum_profiles): посты,
 * ответы, «согласия», благодарности, проверенные разборы и награды владельца.
 * Отдельных счётчиков и триггеров не нужно — счёт вёдется на стороне базы
 * одним запросом, и его невозможно разъехаться с лентой.
 *
 * Две лестницы держим раздельно и намеренно: уровень отвечает на вопрос
 * «сколько человек написал», репутация — «признали ли его тексты полезными».
 * См. комментарий у REP_POINTS.
 *
 * Функции чистые: принимают числа и даты, возвращают плоские объекты. Так их
 * можно проверить без браузера и без базы, а разметка остаётся той же чистой
 * функцией, что и остальной форум.
 */

/**
 * Точки за действие. Пропорция осознанная: пост стоит больше ответа, ответ —
 * больше согласия. Согласие проще всего поставить, поэтому оно весит меньше
 * всего — иначе накрутка «лишнего» мнения была бы самым быстрым ростом.
 *
 * Благодарность весит больше согласия и стоит рядом с постом: её не снять,
 * она одна на запись от человека, свой текст ей не похвалить, и частота
 * ограничена базой. Из всех знаков внимания это самый дорогой именно потому,
 * что дешевле всего поставить его не получается.
 */
export const POINTS = { post: 10, comment: 3, like: 2, thanks: 5 };

/**
 * Уровни: название и порог точек, с которого он начинается.
 * Пороги держим круглыми — их и так никто не вычисляет на глаз, а сравнивать
 * «до следующего уровня» становится проще.
 */
export const LEVELS = [
  { level: 1, from: 0, title: 'Новичок' },
  { level: 2, from: 20, title: 'Писарь' },
  { level: 3, from: 60, title: 'Летописец' },
  { level: 4, from: 180, title: 'Ветеран' },
  { level: 5, from: 500, title: 'Легенда' },
];

/** Точки участника по его счётчикам. */
export function pointsOf(stats) {
  return (
    Number(stats?.postCount ?? 0) * POINTS.post +
    Number(stats?.commentCount ?? 0) * POINTS.comment +
    Number(stats?.likesReceived ?? 0) * POINTS.like +
    Number(stats?.thanksReceived ?? 0) * POINTS.thanks
  );
}

/**
 * Текущий уровень.
 *
 * @returns {{ level: number, title: string, from: number }}
 */
export function levelOf(stats) {
  const points = pointsOf(stats);
  let current = LEVELS[0];
  for (const l of LEVELS) {
    if (points >= l.from) current = l;
  }
  return current;
}

/** До следующего уровня: порог сверху и доля пути. Если уровень последний — нули. */
export function progressOf(stats) {
  const points = pointsOf(stats);
  const current = levelOf(stats);
  const next = LEVELS.find((l) => l.level === current.level + 1);

  if (!next) return { points, to: 0, into: current.from, pct: 100 };

  const span = next.from - current.from;
  const done = Math.min(points, next.from) - current.from;
  return { points, to: next.from, into: current.from, pct: Math.round((done / span) * 100) };
}

/**
 * Достижения.
 *
 * `done` — выполнено ли сейчас, `hint` — короткая подпись того, что нужно,
 * чтобы получить. Подсказка показывается и для выполненных (как «что это»),
 * чтобы значок был понятен без наведения.
 *
 * `confirmed` — есть у тех, где факт подтвердила не активность автора, а
 * кто-то со стороны: модерация, игроки своим «спасибо», пришедшие на встречу
 * люди. Такие значки на странице помечены: «я много писал» и «мои тексты
 * признали полезными» — разные вещи, и прятать разницу было бы нечестно.
 *
 * @param {{ postCount: number, commentCount: number, likesReceived: number,
 *   thanksReceived?: number, verifiedGuides?: number, eventsHeld?: number,
 *   avatarUrl?: string, createdAt?: Date }} profile
 * @returns {Array<{ id: string, title: string, hint: string, done: boolean,
 *   confirmed?: boolean }>}
 */
export function achievementsOf(profile) {
  const p = profile ?? {};
  const posts = Number(p.postCount ?? 0);
  const comments = Number(p.commentCount ?? 0);
  const likes = Number(p.likesReceived ?? 0);
  const thanks = Number(p.thanksReceived ?? 0);
  const guides = Number(p.verifiedGuides ?? 0);
  const events = Number(p.eventsHeld ?? 0);
  const age = p.createdAt instanceof Date ? Date.now() - p.createdAt.getTime() : 0;
  const month = 30 * 24 * 3600 * 1000;

  return [
    {
      id: 'first_post',
      title: 'Первый пост',
      hint: 'написать первую тему',
      done: posts >= 1,
    },
    {
      id: 'ten_posts',
      title: 'Летописец ленты',
      hint: 'десять тем на форуме',
      done: posts >= 10,
    },
    {
      id: 'fifty_comments',
      title: 'Любит поговорить',
      hint: 'пятьдесят ответов',
      done: comments >= 50,
    },
    {
      id: 'hundred_likes',
      title: 'Душка сервера',
      hint: 'сто «согласен» от людей',
      done: likes >= 100,
    },
    {
      id: 'has_avatar',
      title: 'Оформился',
      hint: 'своя аватарка в профиле',
      done: Boolean(p.avatarUrl),
    },
    {
      id: 'month_old',
      title: 'Свой человек',
      hint: 'месяц на форуме',
      done: age >= month,
    },
    /*
      Три подтверждённых значка. Пороги держатся здесь, а не в базе: база
      отдаёт числа (forum_profiles считает их по строкам), а название заслуги —
      дело страницы.
    */
    {
      id: 'thanked_five',
      title: 'За что говорят спасибо',
      hint: 'пять благодарностей от людей',
      done: thanks >= 5,
      confirmed: true,
    },
    {
      id: 'verified_guide',
      title: 'Автор проверенных разборов',
      hint: 'модерация подтвердила, что ваш гайд работает',
      done: guides >= 1,
      confirmed: true,
    },
    {
      id: 'event_held',
      title: 'Организатор',
      hint: 'встреча состоялась и на неё пришли',
      done: events >= 1,
      confirmed: true,
    },
  ];
}

/** Сколько достижений выполнено (для подписи «2 из 6»). */
export function doneCount(profile) {
  return achievementsOf(profile).filter((a) => a.done).length;
}

/* ── Репутация ────────────────────────────────────────────────────────────── */

/**
 * Очки репутации.
 *
 * ДВЕ РАЗНЫЕ ЛЕСТНИЦЫ — И ЭТО НЕ СЛУЧАЙНОСТЬ. Уровень выше считается по
 * активности: сколько человек написал. Репутация отвечает на другой вопрос —
 * что его тексты признали: разбор прошёл модерацию (25 очков за каждый) или
 * владелец выдал награду. Активных людей много, полезных — меньше, и одно
 * число про оба вопроса врёт всегда.
 *
 * Благодарности очков репутации НЕ приносят, хотя и стоят дороже согласия
 * в активности. Причина простая: благодарность ставит любой игрок в один
 * клик, и репутация превратилась бы в счётчик симпатий, который перекупается
 * за вечер. Она видна числом и вешает значок — этого достаточно.
 *
 * Сумма может стать отрицательной: снятие награды — это обратная запись,
 * а не молчаливая правка истории.
 */
export const REP_POINTS = { verifiedGuide: 25 };

/** Итоговые очки репутации. */
export function reputationOf(stats) {
  return (
    Number(stats?.verifiedGuides ?? 0) * REP_POINTS.verifiedGuide +
    Number(stats?.repGrantPoints ?? 0)
  );
}

/**
 * Откуда взялись очки — список для самого человека.
 *
 * Показывается только хозяину профиля: причины наград читают тот, кому они
 * написаны, а гостю видно итоговое число.
 *
 * Здесь числа, а не слова: подписи с окончаниями рисует страница (см.
 * renderRank в src/pages/user.js), как и остальной форум.
 *
 * @returns {Array<{ source: 'guide'|'grant', count: number, points: number }>}
 */
export function reputationSourcesOf(stats) {
  const guides = Number(stats?.verifiedGuides ?? 0);
  const grants = Number(stats?.repGrantPoints ?? 0);
  const out = [];
  if (guides) out.push({ source: 'guide', count: guides, points: guides * REP_POINTS.verifiedGuide });
  if (grants) out.push({ source: 'grant', count: Number(stats?.repGrantCount ?? 0), points: grants });
  return out;
}