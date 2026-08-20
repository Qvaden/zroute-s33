export const DEFAULT_GUIDE_CREDIT = 'Благодарим игрока ЛиночкаКотик с SRV за предоставленную информацию';

export const DEFAULT_GUIDE_ROLES = [
  { icon: '👑', title: 'Глава альянса', tone: 'gold', intro: 'Задаёт общее направление действий и развития альянса.', items: ['Переговоры с союзом сервера.', 'Вынесение решений с учётом мнений R4.', 'Назначение и контроль работы R4.'], assistant: false },
  { icon: '⚜️', title: 'Дворецкий', tone: 'orange', intro: 'Отвечает за информирование и организацию событий альянса.', items: ['Засада и Осада: оповещения в чате и запуск.', 'Оповещение о регистрации на Пандору.', 'VS-информирование: ответы, контроль отстающих и помощь игрокам.'], assistant: true },
  { icon: '🏛️', title: 'Богиня', tone: 'violet', intro: 'Отвечает за Поезд, доску объявлений и важные сообщения.', items: ['Поезд: списки поездок, машинисты и VIP-пассажиры.', 'Контроль актуальности доски объявлений.', 'Шаблоны объявлений и срочные новости союза или сервера.'], assistant: true },
  { icon: '🛡️', title: 'Рекрутер', tone: 'cyan', intro: 'Отвечает за игровой состав альянса.', items: ['Поиск и привлечение новых игроков.', 'Анализ активности, состав и рейтинги/антирейтинги.', 'Согласование трансферов и ротация актива с академией.'], assistant: false },
  { icon: '🪖', title: 'Полководец', tone: 'red', intro: 'Отвечает за организацию военных действий альянса.', items: ['Тактика и проведение Пандоры.', 'Организация рейда VS по субботам.', 'Захват и оборона Капитолия в Безумии с учётом союзников.', 'Планирование остальных военных мероприятий.'], assistant: true },
];

export function parseGuideRoles(body) {
  try {
    const data = JSON.parse(String(body ?? ''));
    if (!Array.isArray(data.roles)) throw new Error('roles');
    return { roles: data.roles.map(normalizeRole).filter((r) => r.title), credit: String(data.credit ?? DEFAULT_GUIDE_CREDIT) };
  } catch {
    return { roles: DEFAULT_GUIDE_ROLES.map(normalizeRole), credit: DEFAULT_GUIDE_CREDIT };
  }
}

export function serializeGuideRoles(data) {
  return JSON.stringify({
    roles: (data?.roles ?? []).map(normalizeRole),
    credit: String(data?.credit ?? '').trim(),
  }, null, 2);
}

function normalizeRole(role) {
  return {
    icon: String(role?.icon ?? '✦'), title: String(role?.title ?? '').trim(), tone: String(role?.tone ?? 'cyan'),
    intro: String(role?.intro ?? '').trim(), items: Array.isArray(role?.items) ? role.items.map((x) => String(x ?? '').trim()).filter(Boolean) : [],
    assistant: Boolean(role?.assistant),
  };
}

export function blankGuideRole() {
  return { icon: '✦', title: 'Новая роль', tone: 'cyan', intro: '', items: [''], assistant: false };
}
