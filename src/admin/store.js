/**
 * ЗАПИСЬ ДАННЫХ САЙТА В БАЗУ.
 *
 * Замена admin/repo.js. Тот писал в GitHub: собирал весь data/live.json
 * заново и коммитил одним файлом. Здесь пишутся отдельные строки.
 *
 * ЧТО ИЗ ЭТОГО СЛЕДУЕТ — И ЧЕГО БОЛЬШЕ НЕ НУЖНО.
 *
 * У файлового подхода была своя защита от одновременной правки: перед записью
 * панель сверяла версию файла (sha), и если его успели изменить, GitHub
 * отказывал. Иначе два редактора, заполняющие неделю в один вечер, затирали
 * работу друг друга, потому что каждый отправлял ФАЙЛ ЦЕЛИКОМ.
 *
 * Здесь этой опасности нет по устройству. Отметка «a05 победил на W7» — это
 * одна строка, и она не несёт в себе ничего о других строках. Двое редакторов
 * могут вносить одну неделю одновременно и не мешать друг другу; конфликт
 * возможен только если оба меняют один и тот же результат, и тогда побеждает
 * последний — что и правильно, потому что он видел свежие данные.
 *
 * Поэтому сверки версий здесь нет намеренно, а не по забывчивости.
 *
 * ГДЕ ЖИВУТ ПРАВА. В базе. Ни одна проверка в этом файле не является защитой:
 * запрос можно отправить мимо панели, и тогда откажут правила доступа
 * (см. site_can_edit_server в supabase/20261005-site-server-rights.sql).
 * Проверки нужны для понятных сообщений, а не вместо базы.
 *
 * ПОЧЕМУ КАЖДЫЙ ЗАПРОС НАЗЫВАЕТ СЕРВЕР. С мультиарендой идентификаторы недель,
 * событий и текстов перестали быть глобальными: «W1» — это неделя первого
 * сервера, а на четвёртом своя «W1» (см. supabase/applied/20261004-site-server-scope.sql).
 * Значит DELETE по одному `id` снёс бы строки всех серверов разом, а вставка
 * без `server_id` не попала бы в составной ключ. У альянсов идентификатор
 * глобален — поэтому `deleteAlliance` и не называет сервер, и это единственное
 * такое место в файле.
 *
 * Число берётся из `panelServer()` (src/admin/target.js) — у панели одна цель
 * на чтение, запись и черновики, и спрашивать её у каждого места по отдельности
 * значило бы позволить им разойтись.
 */
import { rest, uploadFile } from '../db/client.js';
import { datasetBody } from '../data/server.js';
import { panelServer } from './target.js';

/*
  Все изменяющие запросы начинают путь с фильтра по серверу, а не добавляют
  его в конец: адрес тогда читается как «сначала область, потом строка», и
  пропущенный сервер заметен глазами, а не после удаления чужих данных.
*/

/* ── Чтение ───────────────────────────────────────────────────────────────── */

/**
 * Всё разом, ровно в том виде, в каком раньше лежал data/live.json, — и только
 * того сервера, который панель правит.
 *
 * Так панель продолжает работать с привычным «сырым» объектом: экраны,
 * валидатор и логика правки (edit.js) написаны под него и проверены тестами.
 * Менять их заодно с хранилищем значило бы делать два больших изменения
 * в один шаг и не понять потом, какое из них что сломало.
 *
 * Номер передаётся явно, хотя база подставила бы и свой: чтение обязано назвать
 * тот же сервер, что и запись. Совпадение двух чисел — не аккуратность, а
 * защита от показывать один набор и сохранять в другой.
 */
export async function readDataset() {
  const raw = await rest('/rpc/site_dataset', {
    method: 'POST',
    body: datasetBody(panelServer()),
  });

  if (!raw || typeof raw !== 'object') {
    throw new Error(
      'База не отдала данные сайта. Похоже, не выполнен ' +
        'supabase/applied/site-data.sql, supabase/applied/20261004-site-server-scope.sql ' +
        'или supabase/20261005-site-server-rights.sql.'
    );
  }
  return raw;
}

/**
 * Журнал правок: кто и что менял.
 *
 * То, что в git получалось само собой из истории коммитов. Пишется триггером
 * в базе, а не панелью, — правка из любого места всё равно попадёт в журнал.
 *
 * Сервер у журнала есть, но список не фильтруется по цели панели: база по
 * правилу доступа отдаёт владельцу все серверы, а модератору — только его, так
 * что фильтровать здесь значило бы спорить с правами, а не читать их. Номер
 * строки отдаётся экрану, чтобы соседняя правка не выглядела своей.
 */
export async function recentChanges(limit = 20) {
  const rows = await rest(`/site_audit?select=*&order=at.desc&limit=${Number(limit)}`);
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: r.id,
    at: r.at ? new Date(r.at) : null,
    actorNick: r.actor_nick || '',
    entity: r.entity,
    entityId: r.entity_id || '',
    action: r.action,
    server: Number.isInteger(r.server_id) ? r.server_id : null,
  }));
}

/* ── Итоги недели ─────────────────────────────────────────────────────────── */

/**
 * Отметки одной недели.
 *
 * @param {string} weekId
 * @param {Record<string, 'win'|'loss'|null>} marks Пусто/null — удалить запись.
 */
export async function saveWeekMarks(weekId, marks) {
  const server = panelServer();
  const rows = [];
  const remove = [];

  for (const [allianceId, outcome] of Object.entries(marks ?? {})) {
    if (outcome === 'win' || outcome === 'loss') {
      rows.push({ server_id: server, week_id: weekId, alliance_id: allianceId, outcome });
    } else {
      /*
        Пустая отметка УДАЛЯЕТ запись, а не пишет третий исход. Отсутствие
        записи означает «результат ещё не внесли» — это состояние данных,
        а не игры (см. src/data/types.js). Записать сюда что-то вроде 'none'
        значило бы придумать исход, которого в игре нет.
      */
      remove.push(allianceId);
    }
  }

  if (rows.length) {
    await rest('/site_results', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: rows,
    });
  }

  if (remove.length) {
    const list = remove.map((id) => `"${id}"`).join(',');
    await rest(
      `/site_results?server_id=eq.${server}&week_id=eq.${encodeURIComponent(weekId)}&alliance_id=in.(${encodeURIComponent(list)})`,
      { method: 'DELETE' }
    );
  }

  return { saved: rows.length, removed: remove.length };
}

/* ── Альянсы ──────────────────────────────────────────────────────────────── */

/** @param {{id: string, tag: string, name: string, color?: string, active?: boolean, note?: string, mergedInto?: string}} a */
export async function saveAlliance(a, sortOrder) {
  const body = {
    id: a.id,
    server_id: panelServer(),
    tag: a.tag,
    name: a.name,
    color: a.color || null,
    active: a.active !== false,
    note: a.note || null,
    merged_into: a.mergedInto || null,
  };
  if (sortOrder != null) body.sort_order = sortOrder;

  await rest('/site_alliances', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body,
  });
}

/**
 * Свободный номер альянса считает база, а не панель.
 *
 * Идентификатор альянса глобален (объяснение — в supabase/applied/20261004-site-server-scope.sql:
 * на него смотрят таблицы форума и VS), а данные панель видит только своего
 * сервера. Считать «следующий после максимального» по своему списку — значит
 * выдать номер, который занят у соседа, и тогда `merge-duplicates` не откажет,
 * а перезапишет чужой альянс. Отказ получился бы через триггер неподвижности
 * сервера — то есть человек увидел бы странную ошибку вместо новой строки.
 *
 * Возвращаемое число уже свободно: функция отдаёт максимум по всем серверам
 * плюс единица.
 */
export async function nextAllianceNumber() {
  const value = await rest('/rpc/site_next_alliance_id', { method: 'POST', body: {} });
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('База не дала свободный номер альянса');
  }
  return n;
}

/**
 * Удаление альянса.
 *
 * Результаты уходят вместе с ним: на них стоит связь с каскадом. Это
 * не потеря истории, а её отсутствие — альянс, которого не было, не мог
 * ничего выиграть. Настоящий уход альянса из игры отмечается признаком
 * active, а не удалением; удаление нужно для опечаток при заведении.
 */
export async function deleteAlliance(id) {
  await rest(`/site_alliances?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ── Недели ───────────────────────────────────────────────────────────────── */

export async function saveWeek(w) {
  await rest('/site_weeks', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: {
      server_id: panelServer(),
      id: w.id,
      number: Number(w.number),
      start_date: asDate(w.startDate),
      end_date: asDate(w.endDate),
      note: w.note || null,
    },
  });
}

export async function deleteWeek(id) {
  await rest(
    `/site_weeks?server_id=eq.${panelServer()}&id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
}

/* ── Хронология ───────────────────────────────────────────────────────────── */

export async function saveEvent(e) {
  const urls = Array.isArray(e.imageUrls) ? e.imageUrls : (e.imageUrl ? [e.imageUrl] : []);

  await rest('/site_events', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: {
      /*
        Здесь рядом лежат два похожих поля, и путаница в них стоит чужих
        данных: server_id — чей это сайт, server_number — номер сервера,
        захваченного в игре.
      */
      server_id: panelServer(),
      id: e.id,
      event_date: asDate(e.date),
      type: e.type || 'other',
      server_number: e.serverNumber != null ? Number(e.serverNumber) : null,
      title: e.title,
      summary: e.summary || null,
      body: e.body || null,
      image_urls: urls.filter(Boolean),
      duration_days: e.durationDays != null ? Number(e.durationDays) : null,
    },
  });
}

export async function deleteEvent(id) {
  await rest(
    `/site_events?server_id=eq.${panelServer()}&id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
}

/* ── Тексты ───────────────────────────────────────────────────────────────── */

export async function saveText(t) {
  await rest('/site_texts', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: {
      server_id: panelServer(),
      key: t.key,
      title: t.title ?? '',
      body: t.body ?? '',
    },
  });
}

export async function deleteText(key) {
  await rest(
    `/site_texts?server_id=eq.${panelServer()}&key=eq.${encodeURIComponent(key)}`,
    { method: 'DELETE' }
  );
}

/* ── Фотографии ───────────────────────────────────────────────────────────── */

/**
 * Загрузка фотографии в хранилище.
 *
 * Раньше картинки коммитились в репозиторий и раздавались через
 * raw.githubusercontent.com. Работало, но каждая навсегда оставалась
 * в истории git: удалить её было нельзя, только перестать ссылаться.
 *
 * @param {{path: string, bytes: ArrayBuffer, contentType?: string}} opts
 * @returns {Promise<string>} публичная ссылка
 */
export async function uploadPhoto({ path, bytes, contentType = 'image/jpeg' }) {
  return uploadFile({ bucket: 'site-photos', path, bytes, contentType });
}

/* ── Роли ─────────────────────────────────────────────────────────────────── */

/**
 * Назначить или снять модератора.
 *
 * Идёт через функцию в базе, а не запросом к таблице профилей: правку профилей
 * разрешено модерации, а роли — только владельцу. Функция проверяет это сама,
 * поэтому право «назначить модератора» отдаётся в панель без права «менять
 * что угодно в профилях».
 *
 * Роль владельца так не выдаётся и не снимается: владелец один, и передача
 * сайта делается осознанно, запросом в базу, а не нажатием.
 */
export async function setModerator(nick, allow) {
  await rest('/rpc/site_set_moderator', {
    method: 'POST',
    body: { target_nick: nick, allow: Boolean(allow) },
  });
}

/** Дата в вид, который принимает Postgres. */
function asDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? '').trim();
  return s || null;
}
