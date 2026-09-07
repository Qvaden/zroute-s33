/**
 * УРОВЕНЬ И ДОСТИЖЕНИЯ ФОРУМА.
 *
 * Всё считается из чисел, которые уже отдаёт база (forum_profiles): посты,
 * ответы и «согласия». Отдельных счётчиков и триггеров не нужно — счёт вёдется
 * на стороне базы одним запросом, и его невозможно разъехаться с лентой.
 *
 * Функции чистые: принимают числа и даты, возвращают плоские объекты. Так их
 * можно проверить без браузера и без базы, а разметка остаётся той же чистой
 * функцией, что и остальной форум.
 */

/**
 * Точки за действие. Пропорция осознанная: пост стоит больше ответа, ответ —
 * больше согласия. Согласие проще всего поставить, поэтому оно весит меньше
 * всего — иначе накрутка «лишнего» мнения была бы самым быстрым ростом.
 */
export const POINTS = { post: 10, comment: 3, like: 2 };

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
    Number(stats?.likesReceived ?? 0) * POINTS.like
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
 * @param {{ postCount: number, commentCount: number, likesReceived: number,
 *   avatarUrl?: string, createdAt?: Date }} profile
 * @returns {Array<{ id: string, title: string, hint: string, done: boolean }>}
 */
export function achievementsOf(profile) {
  const p = profile ?? {};
  const posts = Number(p.postCount ?? 0);
  const comments = Number(p.commentCount ?? 0);
  const likes = Number(p.likesReceived ?? 0);
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
  ];
}

/** Сколько достижений выполнено (для подписи «2 из 6»). */
export function doneCount(profile) {
  return achievementsOf(profile).filter((a) => a.done).length;
}