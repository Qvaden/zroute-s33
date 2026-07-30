/**
 * ПОРЯДОК НЕДЕЛЬ — ПО ДАТЕ, А НЕ ПО НОМЕРУ.
 *
 * Раньше недели сортировались по полю `number`, и это работало ровно до конца
 * календарного года. Дело в том, что номер недели у людей чаще всего означает
 * номер внутри года: 27 июля 2026 — это неделя 31. А значит в январе счёт
 * пойдёт заново: ...52, потом 1, 2, 3.
 *
 * При сортировке по номеру неделя 1 января 2027 года встала бы ПЕРЕД неделей 31
 * июля 2026-го. И тогда посыпалось бы всё, что опирается на порядок: график
 * гонки очков, накопленные серии, история мест, «итоги недели» — сайт показал бы
 * январь как начало сезона и посчитал бы очки в неправильном порядке.
 *
 * Сломалось бы это не сразу, а через несколько месяцев после запуска, и выглядело
 * бы как «сайт врёт», а не как ошибка сортировки.
 *
 * Дата — единственный порядок, который не зависит от того, как люди решили
 * нумеровать недели. Номер остаётся подписью для человека, а хронологию
 * определяет календарь.
 */

/** @param {unknown} value */
function timeOf(value) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.getTime() : null;
}

/**
 * Сравнение недель по началу: от старых к новым.
 *
 * Недели без даты уходят в конец и там упорядочиваются по номеру — данные
 * неполные, но терять их из-за этого нельзя.
 *
 * @param {{startDate?: Date, number?: number}} a
 * @param {{startDate?: Date, number?: number}} b
 */
export function byWeekStart(a, b) {
  const at = timeOf(a?.startDate);
  const bt = timeOf(b?.startDate);

  if (at !== null && bt !== null) {
    if (at !== bt) return at - bt;
  } else if (at !== null) {
    return -1;
  } else if (bt !== null) {
    return 1;
  }

  return (Number(a?.number) || 0) - (Number(b?.number) || 0);
}

/** То же самое, но свежие недели первыми. */
export function byWeekStartDesc(a, b) {
  return byWeekStart(b, a);
}

/**
 * Неделя, которая идёт сейчас.
 *
 * Нужна против самой обидной путаницы: недели заводятся на месяц вперёд, и без
 * этой функции панель открывалась на последней ЗАВЕДЁННОЙ неделе — то есть
 * на той, которая ещё не наступила. Человек вносил результаты в будущее
 * и не имел ни одного повода это заметить.
 *
 * Если сегодня не попало ни в одну неделю, отдаём последнюю прошедшую: сразу
 * после VS правят её, а не ту, что начнётся в понедельник.
 *
 * @param {{startDate?: Date, endDate?: Date}[]} weeks
 * @param {Date} [now]
 */
export function findCurrentWeek(weeks, now = new Date()) {
  const ordered = [...(weeks ?? [])].sort(byWeekStart);
  if (!ordered.length) return null;

  const t = now.getTime();

  const inside = ordered.find((w) => {
    const start = timeOf(w.startDate);
    const end = timeOf(w.endDate);
    if (start === null || end === null) return false;
    /*
      Конец недели — это дата последнего дня, а не его начало. Без сдвига
      на сутки воскресенье оказывалось бы «уже не в этой неделе», и в день
      после VS панель показывала бы не ту неделю.
    */
    return t >= start && t < end + 24 * 60 * 60 * 1000;
  });
  if (inside) return inside;

  const past = ordered.filter((w) => {
    const end = timeOf(w.endDate);
    return end !== null && end < t;
  });
  if (past.length) return past[past.length - 1];

  // Всё ещё впереди: сайт только запустили, первая неделя не началась.
  return ordered[0];
}
