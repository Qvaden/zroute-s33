/**
 * ЛИДЕРБОРД ФОРУМА — «топ игроков по активности».
 *
 * Чистая функция: посты → ряд авторов. Никакого запроса к базе здесь нет —
 * адаптер отдал посты (уже проверив подпись, RLS и прочее), а считать можно
 * из того, что лента и так держит.
 *
 * Что считается активностью: посты + ответы на них. Это честно про «человек
 * двигал форум»: один длинный пост без ответов уступает автору, который
 * создаёт темы и отвечает на чужие. Рейтинг (score) — вторая ось: при равной
 * активности выше тот, кого больше оценили.
 *
 * Период «week» смотрит только на посты последних семи дней. Дата в будущем
 * не засчитывается: часы на устройстве могут убежать вперёд, а авторитарно
 * решать, что будущий пост «настоящий», не хочется.
 */
export function leaderboardOf(posts, { period = 'all' } = {}) {
  if (!Array.isArray(posts)) return [];

  const isWeek = period === 'week';
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const by = new Map();
  for (const p of posts) {
    if (!p || p.deleted) continue;

    const t = new Date(p.createdAt).getTime();
    if (!Number.isFinite(t)) continue;
    if (isWeek && (t < cutoff || t > Date.now() + 24 * 60 * 60 * 1000)) continue;

    const key = p.authorId || `guest:${p.authorNick || '?'}`;
    let e = by.get(key);
    if (!e) {
      e = {
        id: p.authorId,
        nick: p.authorNick || 'Удалённый',
        role: p.authorRole || 'member',
        avatar: p.authorAvatar || '',
        alliance: p.authorAlliance || '',
        posts: 0,
        comments: 0,
        score: 0,
        views: 0,
      };
      by.set(key, e);
    }
    e.posts += 1;
    e.comments += Number(p.commentCount || 0);
    e.score += Number(p.score || 0);
    e.views += Number(p.views || 0);
  }

  return [...by.values()]
    .map((e) => ({ ...e, activity: e.posts + e.comments }))
    .sort(
      (a, b) =>
        b.activity - a.activity ||
        b.score - a.score ||
        String(a.nick).localeCompare(String(b.nick))
    )
    .slice(0, 10)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}