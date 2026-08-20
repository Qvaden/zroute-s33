export const DEFAULT_GUIDE_CREDIT = 'Благодарим игрока ЛиночкаКотик с SRV за предоставленную информацию';

export const DEFAULT_GUIDE_ROLES = [
  { icon: '👑', title: 'Глава альянса', tone: 'gold', intro: 'Задаёт общее направление действий и развития альянса.', items: ['Переговоры с союзом сервера.', 'Вынесение решений с учётом мнений R4.', 'Назначение и контроль работы R4.'], assistant: false },
  { icon: '⚜️', title: 'Дворецкий', tone: 'orange', intro: 'Отвечает за информирование и организацию событий альянса.', items: ['Засада и Осада: оповещения в чате и запуск.', 'Оповещение о регистрации на Пандору.', 'VS-информирование: ответы, контроль отстающих и помощь игрокам.'], assistant: true },
  { icon: '🏛️', title: 'Богиня', tone: 'violet', intro: 'Отвечает за Поезд, доску объявлений и важные сообщения.', items: ['Поезд: списки поездок, машинисты и VIP-пассажиры.', 'Контроль актуальности доски объявлений.', 'Шаблоны объявлений и срочные новости союза или сервера.'], assistant: true },
  { icon: '🛡️', title: 'Рекрутер', tone: 'cyan', intro: 'Отвечает за игровой состав альянса.', items: ['Поиск и привлечение новых игроков.', 'Анализ активности, состав и рейтинги/антирейтинги.', 'Согласование трансферов и ротация актива с академией.'], assistant: false },
  { icon: '🪖', title: 'Полководец', tone: 'red', intro: 'Отвечает за организацию военных действий альянса.', items: ['Тактика и проведение Пандоры.', 'Организация рейда VS по субботам.', 'Захват и оборона Капитолия в Безумии с учётом союзников.', 'Планирование остальных военных мероприятий.'], assistant: true },
];

export const DEFAULT_GUIDE_PAGE = {
  proofTitle: 'Что даёт сильный альянс',
  proofSubtitle: 'Не общие слова, а цифры этого сервера.',
  rolesTitle: 'Обязанности руководства',
  rolesSubtitle: 'Пример распределения ролей для успешного развития альянса. Главное — чтобы работа была разделена, а не держалась на одном человеке.',
  noticeTitle: 'Распределяем нагрузку, а не героизм',
  noticeBody: 'Часть обязанностей может передаваться от одного R4 другому — не придумываем лишнюю работу и не смотрим, как один игрок тянет всё на себе. Иначе он выгорит, и развитие альянса остановится.\n\nПомощник может поддерживать двух офицеров. По мере роста объёма работы помощников станет четыре — по одному для каждого офицера.',
  principlesTitle: 'Образцовое руководство альянсом',
  principlesBody: '',
  weekTitle: 'Ритм недели',
  weekBody: '',
  dontsTitle: 'Чего делать не стоит',
  dontsBody: '',
  benefitsTitle: 'Что даёт крупный альянс',
  benefitsBody: '',
  credit: DEFAULT_GUIDE_CREDIT,
  roles: DEFAULT_GUIDE_ROLES,
};

export function parseGuideRoles(body) {
  const page = parseGuidePage(body);
  return { roles: page.roles, credit: page.credit };
}

export function parseGuidePage(entry, legacy = {}) {
  try {
    const data = JSON.parse(String(entry?.body ?? entry ?? ''));
    if (data && Array.isArray(data.roles)) return normalizePage({ ...DEFAULT_GUIDE_PAGE, ...data });
  } catch (_) {}
  return normalizePage({
    ...DEFAULT_GUIDE_PAGE,
    principlesTitle: legacy.principles?.title || DEFAULT_GUIDE_PAGE.principlesTitle,
    principlesBody: legacy.principles?.body || '',
    weekTitle: legacy.week?.title || DEFAULT_GUIDE_PAGE.weekTitle,
    weekBody: legacy.week?.body || '',
    dontsTitle: legacy.donts?.title || DEFAULT_GUIDE_PAGE.dontsTitle,
    dontsBody: legacy.donts?.body || '',
    benefitsTitle: legacy.benefits?.title || DEFAULT_GUIDE_PAGE.benefitsTitle,
    benefitsBody: legacy.benefits?.body || '',
    roles: legacy.roles?.roles || DEFAULT_GUIDE_ROLES,
    credit: legacy.roles?.credit || DEFAULT_GUIDE_CREDIT,
  });
}

export function serializeGuideRoles(data) {
  return JSON.stringify(normalizePage(data), null, 2);
}
export const serializeGuidePage = serializeGuideRoles;

export function blankGuideRole() {
  return { icon: '✦', title: 'Новая роль', tone: 'cyan', intro: '', items: [''], assistant: false };
}

function normalizePage(data) {
  const out = { ...DEFAULT_GUIDE_PAGE, ...data };
  for (const key of ['proofTitle','proofSubtitle','rolesTitle','rolesSubtitle','noticeTitle','noticeBody','principlesTitle','principlesBody','weekTitle','weekBody','dontsTitle','dontsBody','benefitsTitle','benefitsBody','credit']) out[key] = String(out[key] ?? '');
  out.roles = Array.isArray(out.roles) ? out.roles.map(normalizeRole).filter((r) => r.title) : DEFAULT_GUIDE_ROLES.map(normalizeRole);
  return out;
}
function normalizeRole(role) {
  return { icon: String(role?.icon ?? '✦'), title: String(role?.title ?? '').trim(), tone: String(role?.tone ?? 'cyan'), intro: String(role?.intro ?? '').trim(), items: Array.isArray(role?.items) ? role.items.map((x) => String(x ?? '').trim()).filter(Boolean) : [], assistant: Boolean(role?.assistant) };
}
