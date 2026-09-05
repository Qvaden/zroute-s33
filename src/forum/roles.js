/**
 * РОЛИ И ПОДПИСИ — ОДИН СЛОВАРЬ НА САЙТ И НА ПАНЕЛЬ.
 *
 * До этого файла подпись роли собиралась в четырёх местах: в шапке форума,
 * на странице участника, в панели и в списке игроков. Каждое место писало
 * «администратор» по-своему, и добавление одной роли означало четыре правки —
 * из которых одну обязательно забудешь.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ. Внешний вид роли: как её называть, каким цветом, каким
 * значком. Права здесь НЕ живут — они в db/account.js и, по-настоящему,
 * в правилах доступа базы. Разделение важное: цвет подписи можно менять
 * свободно, а права нельзя.
 *
 * ПОЧЕМУ «ВЛАДЕЛЕЦ» ОТДЕЛЬНО ОТ «АДМИНИСТРАТОРА».
 *
 * В базе роль одна — admin. Владелец сайта и назначенный им администратор
 * имеют одинаковые права, и это правильно: делить их на уровни означало бы
 * заводить в схеме ещё одну роль ради подписи.
 *
 * Но человек, создавший сайт, и человек, которому дали права, — не одно и то
 * же для читателя. Поэтому владелец определяется НЕ ролью, а тем, что он
 * первый: `created_at` самой ранней записи с ролью admin. Подпись разная,
 * права одинаковые.
 */

/**
 * @typedef {Object} RoleLook
 * @property {string} label  Как называть.
 * @property {string} short  Короткая подпись — для мест, где мало места.
 * @property {string} glyph  Значок. Один символ: два уже мусор.
 * @property {string} tone   Цвет метки.
 */

/** @type {Record<string, RoleLook>} */
export const ROLE_LOOK = {
  /*
    Владелец. Корона — потому что это единственный значок, который в игровой
    среде читается однозначно и не требует подписи.
  */
  owner: {
    label: 'владелец',
    short: 'владелец',
    glyph: '👑',
    tone: '#ffc93c',
  },
  admin: {
    label: 'администратор',
    short: 'админ',
    glyph: '⚡',
    tone: '#ff6a2b',
  },
  moderator: {
    label: 'модератор',
    short: 'модератор',
    glyph: '🛡',
    tone: '#a7a3c2',
  },
  /*
    Редактор — не роль, а признак (can_edit_site). Но в подписи он выглядит
    как роль, потому что для читателя это ровно то же: «этот человек ведёт
    сайт». Права при этом другие, см. db/account.js.
  */
  editor: {
    label: 'редактор',
    short: 'редактор',
    glyph: '✎',
    tone: '#35d07f',
  },
  member: {
    label: 'участник',
    short: '',
    glyph: '',
    tone: '',
  },
};

/**
 * Какую подпись показать человеку.
 *
 * Порядок проверок — это порядок значимости: владелец важнее администратора,
 * администратор важнее модератора. Показываем ОДНУ, самую значимую: «модератор,
 * редактор» через запятую читается как перечень обязанностей, а не как звание,
 * и в узкой строке не помещается.
 *
 * @param {{role?: string, canEditSite?: boolean, isOwner?: boolean}|null} account
 * @returns {string} ключ в ROLE_LOOK
 */
export function roleKey(account) {
  if (!account) return 'member';
  if (account.isOwner) return 'owner';
  if (account.role === 'admin') return 'admin';
  if (account.role === 'moderator') return 'moderator';
  if (account.canEditSite) return 'editor';
  return 'member';
}

/** @param {any} account */
export function roleLook(account) {
  return ROLE_LOOK[roleKey(account)] ?? ROLE_LOOK.member;
}

/**
 * Подпись словом. Для мест, где значок не нужен.
 * @param {any} account
 */
export function roleLabel(account) {
  return roleLook(account).label;
}

/**
 * Метка рядом с ником: значок и слово.
 *
 * Участник метки не получает вовсе, и это осознанно. Если подписать всех,
 * подпись перестаёт значить что-либо: она нужна, чтобы отличить того,
 * кто отвечает за сайт, от остальных. «Участник» рядом с каждым ником —
 * шум в каждой строке ленты.
 *
 * ВАЖНО: возвращает разметку, поэтому ник и прочее содержимое сюда
 * не подставляется — только заранее известные строки из словаря выше.
 *
 * @param {any} account
 * @param {{short?: boolean}} [opts]
 */
export function roleBadge(account, { short = false } = {}) {
  const key = roleKey(account);
  if (key === 'member') return '';

  const look = ROLE_LOOK[key];
  const text = short ? look.short : look.label;
  if (!text) return '';

  return (
    `<span class="role-badge role-badge--${key}" style="--role-tone:${look.tone}">` +
    (look.glyph ? `<i aria-hidden="true">${look.glyph}</i>` : '') +
    `<b>${text}</b>` +
    '</span>'
  );
}
