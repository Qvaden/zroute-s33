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
 * @property {boolean} [isBlogger]          Ведёт блог; метка у постов.
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
 * @property {boolean} [authorIsBlogger]  Автор ведёт блог: метка и ссылка на него.
 * @property {string}  category       Из CATEGORIES в rules.js.
 * @property {string}  title
 * @property {string}  body
 * @property {Date}    createdAt
 * @property {Date}    [editedAt]
 * @property {boolean} [pinned]       Держать сверху ленты.
 * @property {boolean} [deleted]
 * @property {string}  [deletedReason]
 * @property {number}  commentCount
 * @property {number}  views          Сколько раз открывали тему.
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
 * Уведомление участника: ответ, упоминание или согласие/несогласие.
 *
 * Пишет их база триггерами (см. supabase/rich-forum.sql), а не сайт —
 * триггер срабатывает в той же транзакции, что и вставка записи: или
 * есть и пост, и уведомление, или ни того ни другого. Адаптеры лишь
 * читают свои строки и ставят read_at.
 *
 * @typedef {Object} ForumNotification
 * @property {string}  id
 * @property {string}  userId        Кому.
 * @property {string|null} [actorId]    От кого; пусто, если аккаунт удалили.
 * @property {string}  actorNick     Копией, как ник автора у поста.
 * @property {'mention'|'reply'|'reaction'} kind
 * @property {string}  [postId]      На какой пост ведёт уведомление.
 * @property {string}  [commentId]   Для реакции на комментарий.
 * @property {string}  preview       Кусок текста, чтобы читалось без перехода.
 * @property {Date|null} readAt      null — ещё не прочитано.
 * @property {Date}    createdAt
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
 * @property {(postId: string) => Promise<void>} registerView  Один просмотр темы.
 * @property {(draft: {title: string, body: string, category: string, poll?: {question: string, multiple: boolean, options: string[]}}) => Promise<ForumPost>} createPost
 * @property {(id: string, patch: {title?: string, body?: string, category?: string}) => Promise<ForumPost>} editPost
 * @property {(id: string, reason: string) => Promise<void>} deletePost
 * @property {(id: string, pinned: boolean) => Promise<ForumPost>} setPinned
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
 * @property {(userId: string, isBlogger: boolean) => Promise<void>} setBlogger
 * @property {(userId: string) => Promise<void>} adminDeleteUser  Удалить аккаунт; посты и комментарии остаются.
 * @property {(pollId: string, optionId: string) => Promise<void>} votePoll
 * @property {(pollId: string, optionId: string) => Promise<void>} unvotePoll
 * @property {(pollId: string) => Promise<void>} closePoll
 * @property {() => Promise<ForumNotification[]>} listNotifications  Свежие сверху, только свои.
 * @property {(ids: string[]) => Promise<void>} markNotificationsRead
 * @property {() => Promise<void>} markAllNotificationsRead
 *
 * Закрытые чаты (см. supabase/chats.sql). Создаёт лидер альянса
 * (ForumUser.isLeader) или модерация; читают только участники и модерация.
 * @property {(userId: string, isLeader: boolean) => Promise<void>} setLeader
 * @property {() => Promise<ForumChat[]>} listChats
 * @property {(id: string) => Promise<ForumChat|null>} getChat
 * @property {(draft: {title: string, kind?: 'alliance'|'inter', allianceTag?: string}) => Promise<ForumChat>} createChat
 * @property {(code: string) => Promise<string>} joinChat  Возвращает id чата.
 * @property {(chatId: string) => Promise<void>} leaveChat
 * @property {(chatId: string) => Promise<ForumChatMember[]>} listChatMembers
 * @property {(chatId: string, userId: string, role: 'admin'|'member') => Promise<void>} setChatMemberRole
 * @property {(chatId: string, userId: string) => Promise<void>} kickChatMember
 * @property {(chatId: string, opts?: {limit?: number, before?: Date|null}) => Promise<ForumChatMessage[]>} listChatMessages
 * @property {(chatId: string, body: string, opts?: {replyToId?: string|null, attachments?: ChatAttachmentDraft[]}) => Promise<ForumChatMessage>} sendChatMessage
 * @property {(id: string, reason?: string) => Promise<void>} deleteChatMessage
 * @property {(chatId: string) => Promise<void>} markChatRead
 * @property {(chatId: string, patch: {title?: string, allianceTag?: string, topic?: string, avatarUrl?: string, closed?: boolean, closedReason?: string}) => Promise<void>} updateChat
 * @property {(chatId: string) => Promise<string>} rotateChatCode
 * @property {(chatId: string) => Promise<void>} adminDeleteChat
 *
 * Вложения. Загрузка отделена от отправки намеренно: файл сначала едет
 * в хранилище, и только потом появляется сообщение со ссылкой на него.
 * Обратный порядок оставлял бы в ленте сообщение с файлом, которого нет, —
 * то есть битую картинку, видную всем. Ход загрузки нужен странице, чтобы
 * показать полоску: видео едет десятки секунд, и без полоски человек решит,
 * что кнопка не сработала.
 * @property {(chatId: string, file: File, opts?: {onProgress?: (part: number) => void, durationMs?: number}) => Promise<ChatAttachmentDraft>} uploadChatFile
 * @property {(chatId: string, file: File) => Promise<string>} uploadChatAvatar  Картинка чата; возвращает ссылку.
 * @property {(messageId: string, emoji: string) => Promise<void>} toggleChatReaction
 * @property {(messageId: string, pinned: boolean) => Promise<void>} pinChatMessage
 * @property {(chatId: string) => Promise<ForumChatMessage[]>} listChatPinned
 * @property {(chatId: string, query: string, opts?: {limit?: number}) => Promise<ForumChatMessage[]>} searchChatMessages
 * @property {(chatId: string) => Promise<void>} touchChatTyping  Отметка «пишу»: гаснет сама через CONFIG.forum.chat.typingMs.
 * @property {(chatId: string) => Promise<ForumChatTyping[]>} listChatTyping
 */

/**
 * @typedef {Object} ForumChat
 * @property {string} id
 * @property {string} title
 * @property {'alliance'|'inter'} kind
 * @property {string} allianceTag
 * @property {string} topic         Короткое описание чата: о чём он и какие в нём правила.
 * @property {string} avatarUrl     Картинка чата; пусто — показывается метка из букв.
 * @property {string|null} ownerId
 * @property {string} ownerNick
 * @property {string} inviteCode   Виден только участникам (политики базы).
 * @property {number} maxMembers
 * @property {boolean} closed
 * @property {string} closedReason
 * @property {Date} createdAt
 * @property {number} memberCount
 * @property {'owner'|'admin'|'member'|null} myRole
 * @property {number} unread
 * @property {string} lastBody
 * @property {string} lastNick
 * @property {string} lastKind     Вид вложения последнего сообщения: 'image', 'file'… Пусто, если вложение только текстовое.
 * @property {Date|null} lastAt
 * @property {number} pinnedCount  Сколько сообщений закреплено.
 */

/**
 * Вложение сообщения.
 *
 * Хранится отдельной строкой, а не списком внутри сообщения: файл нужно
 * уметь удалить поимённо (чат удаляют — файлы должны уйти вместе с ним),
 * а предел числа вложений проще держать триггером на строку.
 *
 * @typedef {Object} ForumChatAttachment
 * @property {string} id
 * @property {'image'|'video'|'audio'|'file'} kind
 * @property {string} url            Прямая ссылка на файл.
 * @property {string} name           Имя файла, как его видит человек.
 * @property {string} mime
 * @property {number} sizeBytes
 * @property {number} width          Пиксели, если это картинка или видео; иначе 0.
 * @property {number} height
 * @property {number} durationMs     Длительность голосового; иначе 0.
 */

/**
 * Вложение, уже лежащее в хранилище, но ещё не привязанное к сообщению.
 * Возвращает uploadChatFile, принимает sendChatMessage.
 *
 * @typedef {Object} ChatAttachmentDraft
 * @property {'image'|'video'|'audio'|'file'} kind
 * @property {string} url
 * @property {string} [storagePath]  Путь в хранилище; у локального режима пусто.
 * @property {string} name
 * @property {string} [mime]
 * @property {number} [sizeBytes]
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [durationMs]
 */

/**
 * Реакция на сообщение в чате.
 *
 * В чате реакции другие, чем на форуме: там это «согласен — не согласен»,
 * здесь быстрый отклик на реплику, и счёт идёт не к очкам, а к разговору.
 * `mine` — поставил ли её текущий участник: база считает это тем же запросом,
 * чтобы страница не делала второй запрос на каждое сообщение.
 *
 * @typedef {Object} ForumChatReaction
 * @property {string} emoji
 * @property {number} count
 * @property {boolean} mine
 * @property {string[]} nicks        Кто поставил; имена для подсказки.
 */

/**
 * Кто-то пишет в чат прямо сейчас.
 *
 * Отметка живёт в базе несколько секунд и не хранит историю: «пишет…» —
 * это состояние, а не запись. Гаснет сама, поэтому закрытая вкладка
 * не оставляет человека вечно печатающим.
 *
 * @typedef {Object} ForumChatTyping
 * @property {string} userId
 * @property {string} nick
 */

/**
 * @typedef {Object} ForumChatMember
 * @property {string} chatId
 * @property {string} userId
 * @property {string} nick
 * @property {string} avatarUrl
 * @property {string} allianceTag
 * @property {boolean} isLeader
 * @property {'owner'|'admin'|'member'} role
 * @property {Date} joinedAt
 */

/**
 * @typedef {Object} ForumChatMessage
 * @property {string} id
 * @property {string} chatId
 * @property {string|null} authorId
 * @property {string} authorNick
 * @property {string} authorAvatar
 * @property {string} authorAlliance
 * @property {string} authorRole
 * @property {boolean} authorIsLeader
 * @property {string} body
 * @property {boolean} deleted
 * @property {string} deletedReason
 * @property {Date} createdAt
 * @property {ForumChatAttachment[]} attachments
 * @property {ForumChatReaction[]} reactions
 * @property {boolean} pinned
 * @property {string|null} replyToId     На кого отвечают.
 * @property {string} replyNick          Ник автора того сообщения, копией: он мог удалить аккаунт.
 * @property {string} replyBody          Кусок текста, чтобы ответ читался без перехода.
 * @property {boolean} replyDeleted
 */

export {};
