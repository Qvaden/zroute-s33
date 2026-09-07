/**
 * КОНТРАКТ ФОРУМА.
 *
 * Тот же приём, что и у данных сайта (см. src/data/): страницы разговаривают
 * только с этим контрактом и не знают, где на самом деле лежат посты —
 * в браузере или в общей базе. Причина та же, что и там: вопрос «кто через
 * год будет платить за хранилище» до конца не решён, и переезд не должен
 * означать переписывание форума.
 *
 * Разница с данными сайта одна, но принципиальная: там всё только читается,
 * а здесь пишется. Поэтому в контракте есть вход, права и модерация —
 * то, чего у адаптеров сайта нет вовсе.
 *
 * Здесь только JSDoc-типы, никакого кода — файл ничего не исполняет.
 */

/**
 * Участник форума.
 *
 * Почты нет — вход по нику и паролю. Восстановление пароля делает
 * администратор руками, см. решение в config.js.
 *
 * @typedef {Object} ForumUser
 * @property {string} id            Постоянный идентификатор. Не меняется никогда.
 * @property {string} nick          Как его видят люди.
 * @property {'member'|'moderator'|'admin'} role
 * @property {Date}   createdAt
 * @property {Date|null} [mutedUntil]  До этого времени писать нельзя.
 * @property {boolean} [banned]     Запрет без срока.
 * @property {string} [banReason]
 */

/**
 * Запись форума.
 *
 * УДАЛЁННЫЙ ПОСТ НЕ ИСЧЕЗАЕТ. У него ставится `deleted`, и на его месте
 * остаётся заглушка с причиной. Так сделано нарочно: молча исчезнувший пост
 * выглядит как поломка сайта и порождает второй такой же пост, а причина
 * удаления — это единственный способ, которым правило вообще чему-то учит.
 *
 * @typedef {Object} ForumPost
 * @property {string}  id
 * @property {string}  authorId
 * @property {string}  authorNick     Копией, чтобы лента не ходила за автором.
 * @property {string}  category       Из CATEGORIES в rules.js.
 * @property {string}  title
 * @property {string}  body
 * @property {Date}    createdAt
 * @property {Date}    [editedAt]
 * @property {boolean} [pinned]       Держать сверху ленты.
 * @property {boolean} [deleted]
 * @property {string}  [deletedReason]
 * @property {number}  commentCount
 * @property {Record<string, number>} reactions  Сколько каких реакций.
 * @property {string|null} myReaction  Что поставил текущий участник.
 * @property {number}  score          Согласны минус не согласны.
 */

/**
 * Комментарий. Одноуровневый: ответов на ответы нет.
 *
 * Ветки обсуждения выглядят богаче, но на телефоне превращаются в лестницу
 * шириной в три слова. Аудитория здесь заходит с телефона — см. первую
 * строку styles-v8.css.
 *
 * @typedef {Object} ForumComment
 * @property {string}  id
 * @property {string}  postId
 * @property {string}  authorId
 * @property {string}  authorNick
 * @property {string}  body
 * @property {Date}    createdAt
 * @property {boolean} [deleted]
 * @property {string}  [deletedReason]
 * @property {Record<string, number>} reactions
 * @property {string|null} myReaction
 */

/**
 * Жалоба на запись. Смысловые правила проверяет человек, а не код,
 * поэтому жалоба — рабочий инструмент модерации, а не украшение.
 *
 * @typedef {Object} ForumReport
 * @property {string} id
 * @property {'post'|'comment'} targetType
 * @property {string} targetId
 * @property {string} reporterId
 * @property {string} reporterNick
 * @property {string} ruleId       Пункт правил, на который жалуются.
 * @property {string} [note]
 * @property {Date}   createdAt
 * @property {boolean} [resolved]
 */

/**
 * Что умеет конкретный адаптер форума.
 *
 * Здесь абстракция протекает честно, как и у данных сайта: локальный режим
 * физически не может показать пост другому человеку, и делать вид, что может,
 * было бы обманом — страница обязана сказать об этом прямо.
 *
 * @typedef {Object} ForumCapabilities
 * @property {boolean} canWrite   Можно ли вообще писать.
 * @property {boolean} isShared   Видят ли написанное другие люди.
 * @property {boolean} canAuth    Есть ли настоящая регистрация.
 * @property {boolean} canModerate
 */

/**
 * Контракт, который обязан реализовать каждый адаптер форума.
 * Все методы асинхронные — даже там, где localStorage ответил бы сразу.
 * Иначе при переезде на базу поедут все места вызова.
 *
 * @typedef {Object} ForumAdapter
 * @property {string} name
 * @property {ForumCapabilities} capabilities
 * @property {() => Promise<boolean>} isReady        Настроен ли источник.
 * @property {() => Promise<ForumUser|null>} currentUser
 * @property {(nick: string, password: string) => Promise<ForumUser>} signUp
 * @property {(nick: string, password: string) => Promise<ForumUser>} signIn
 * @property {() => Promise<void>} signOut
 * @property {(opts?: {category?: string, sort?: string, limit?: number, offset?: number, q?: string}) => Promise<{posts: ForumPost[], total: number}>} listPosts
 * @property {(id: string) => Promise<ForumPost|null>} getPost
 * @property {(draft: {title: string, body: string, category: string}) => Promise<ForumPost>} createPost
 * @property {(id: string, patch: {title?: string, body?: string, category?: string}) => Promise<ForumPost>} editPost
 * @property {(id: string, reason: string) => Promise<void>} deletePost
 * @property {(postId: string) => Promise<ForumComment[]>} listComments
 * @property {(postId: string, body: string) => Promise<ForumComment>} addComment
 * @property {(id: string, reason: string) => Promise<void>} deleteComment
 * @property {(targetType: 'post'|'comment', targetId: string, reactionId: string|null) => Promise<void>} setReaction
 * @property {(report: {targetType: 'post'|'comment', targetId: string, ruleId: string, note?: string}) => Promise<void>} report
 * @property {() => Promise<ForumReport[]>} listReports
 * @property {(reportId: string) => Promise<void>} resolveReport
 * @property {() => Promise<ForumUser[]>} listUsers
 * @property {(userId: string, password: string) => Promise<void>} resetPassword
 * @property {(userId: string, opts: {banned?: boolean, mutedUntil?: Date|null, reason?: string}) => Promise<void>} setRestriction
 */

export {};
