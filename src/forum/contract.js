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
 * @property {boolean} [isLeader]   Признак лидера альянса (производный от leaderOf).
 * @property {string} [leaderOf]    Тег альянса, лидером которого он является; пусто — не лидер.
 * @property {boolean} [isVerified] Ник подтверждён лидером/модерацией; непроверенный не может создавать чаты.
 * @property {string|null} [verifiedBy] Кто подтвердил ник.
 * @property {Date|null} [verifiedAt]
 */

/**
 * Запись форума.
 *
 * Удалённый пост исчезает с форума: причина удаления живёт в базе для
 * модерации, а читателям не показывается.
 *
 * @typedef {Object} ForumPost
 * @property {string}  id
 * @property {string}  authorId
 * @property {string}  authorNick     Копией, чтобы лента не ходила за автором.
 * @property {boolean} [authorIsBlogger]  Автор ведёт блог: метка и ссылка на него.
 * @property {boolean} [authorIsVerified] Ник автора подтверждён; непроверенный виден с меткой.
 * @property {string}  category       Из CATEGORIES в rules.js.
 * @property {string[]} [tags]        Метки темы для навигации внутри раздела.
 * @property {string}  title
 * @property {string}  body
 * @property {Date}    createdAt
 * @property {Date}    [editedAt]
 * @property {Date|null} [expiresAt]  До какого числа тема считается актуальной.
 *                                    null — срок не назначен. Для меток «Набор»,
 *                                    «Срочно» и «Обмен» его требует база; истёкшая
 *                                    тема из ленты не исчезает, она получает метку
 *                                    «срок вышел» (см. 20260925-announcement-expiry.sql).
 * @property {Date|null} [eventAt]    Момент встречи, если тема — событие
 *                                    (метка «Событие»); null — обычная тема.
 *                                    Обязательность даты при метке держит
 *                                    триггер forum_posts_event_at, а снимается
 *                                    она вместе с самой меткой.
 * @property {number|null} [eventCapacity]  Сколько мест, null — без лимита.
 *                                    Считаются ответившие «буду»; «возможно»
 *                                    места не занимает.
 * @property {string|null} [barterGives]  Что отдаёт автор объявления с меткой
 *                                    «Обмен»; null — тема не обмен. Обязательность
 *                                    обеих строк держит триггер forum_posts_barter,
 *                                    длину — проверка таблицы
 *                                    (20260926-barter-board.sql).
 * @property {string|null} [barterWants]  Что автор ищет взамен.
 * @property {Date|null} [barterClosedAt]  Когда автор снял объявление с доски;
 *                                    null — объявление открыто. Тема при этом
 *                                    остаётся: под ней могли договориться другие.
 * @property {boolean} [pinned]       Держать сверху ленты.
 * @property {boolean} [deleted]
 * @property {string}  [deletedReason]
 * @property {number}  commentCount
 * @property {number}  views          Сколько раз открывали тему.
 * @property {number}  [unread]       Сколько чужих ответов появилось после
 *                                   последнего входа этого человека. Поле есть
 *                                   только в ленте и только для вошедшего:
 *                                   база считает его представлением
 *                                   forum_topic_unread, а адаптер приклеивает
 *                                   к строке — так же, как подписку.
 * @property {Record<string, number>} reactions  Сколько каких реакций.
 * @property {string|null} myReaction  Что поставил текущий участник.
 * @property {'going'|'maybe'|'declined'|null} [myRsvp]  Ответ на приглашение
 *                                    той же строкой; есть только у тем с меткой
 *                                    «Событие» (поле my_rsvp в ленте базы).
 *                                    Своё, как my_reaction: чужие ответы ленте
 *                                    не видны.
 * @property {number|null} [myRemindMinutes]  Срок напоминания из того же
 *                                    ответа (my_remind_minutes в ленте базы):
 *                                    без него выбор «напомнить за час» в теме
 *                                    выглядел бы снятым.
 * @property {number}  [thanksCount]  Сколько человек поблагодарили автора этой
 *                                    записи (thanks_count в ленте базы).
 *                                    Число, а не список имён: связи «кто кого»
 *                                    лента не показывает никому.
 * @property {boolean} [iThanked]     Благодарил ли здесь сам вошедший. Своё,
 *                                    как my_reaction; снятой благодарность не
 *                                    бывает никогда, поэтому и метка одна.
 * @property {boolean} [saved]        Лежит ли тема в закладках у вошедшего.
 *                                    Тоже своё и тоже приклеивается отдельным
 *                                    запросом в ленте: числа у закладки нет,
 *                                    и в представление базы она не просится.
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
 * @property {boolean} [authorIsVerified] Ник автора подтверждён.
 * @property {string} [authorAlliance] Тег альянса автора на момент чтения.
 * @property {string}  authorNick
 * @property {string}  body
 * @property {Date}    createdAt
 * @property {boolean} [deleted]
 * @property {string}  [deletedReason]
 * @property {Record<string, number>} reactions
 * @property {string|null} myReaction
 * @property {number}  [thanksCount]  Сколько благодарностей автору ответа.
 * @property {boolean} [iThanked]     Своя отметка — та же граница, что у поста.
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
 * @property {'mention'|'reply'|'reaction'|'subscription'|'alliance_rank'|'moderation'|'digest'|'event'|'thanks'} kind
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
 * Апелляция на запрет писать или на тишину.
 *
 * Причина меры лежит здесь снимком (`sanction`), а не читается из профиля:
 * меру могут снять или изменить, а разбираемая заявка обязана остаться тем
 * вопросом, которым она была.
 *
 * Чужие заявки не видны никому, кроме модерации, — список «кого забанили и
 * кто спорит» читается как карта конфликтов.
 *
 * @typedef {Object} ForumAppeal
 * @property {string} id
 * @property {string} userId
 * @property {string} userNick
 * @property {'ban'|'mute'} kind      Какую меру оспаривают.
 * @property {string} sanction        Причина меры на момент заявки.
 * @property {string} message         Что говорит игрок.
 * @property {'open'|'upheld'|'rejected'} status
 * @property {string} answer          Ответ модерации; пусто, пока заявка открыта.
 * @property {Date}   createdAt
 * @property {Date|null} decidedAt
 * @property {string}  decidedByNick  Кто ответил; пустой — ещё никто.
 */

/**
 * Строка модераторского списка «на этого стоит посмотреть».
 *
 * Ничего не хранится: строку считает база по темам, ответам, жалобам и
 * скрытому материалу за короткое окно (см. supabase/20260926-spam-signals.sql).
 * Поэтому у строки нет ни id, ни статуса — вчерашнего списка не существует, и
 * спорить о том, кто в него вчера попадал, не по чему.
 *
 * Балльной оценки здесь нет намеренно: «шесть сигналов» и «шесть жалоб» —
 * разные истории, а в одном числе они неразличимы. Модератор видит отдельные
 * числа и отдельный список причин.
 *
 * @typedef {Object} ForumSpamSignal
 * @property {string} userId
 * @property {string} nick
 * @property {'member'|'moderator'|'admin'} role
 * @property {number} posts20m      Темы за окно выдержки тем.
 * @property {number} comments2m    Ответы за окно выдержки ответов.
 * @property {number} posts24h
 * @property {number} comments24h
 * @property {number} openReports   Открытые жалобы на его материалы.
 * @property {number} autoHidden    Его материалов, скрытых после пяти жалоб.
 * @property {number} sectionMutes  Активных тишин по разделам.
 * @property {boolean} banned
 * @property {Date|null} mutedUntil
 * @property {Date|null} lastActivity
 * @property {string[]} signals     Причины, по которым человек здесь; пустой не бывает.
 */

/**
 * Один шаг чек-листа новичка.
 *
 * Только факт и только про себя: база отвечает «сделан ли шаг», а слова к ключу
 * подбирает страница (STARTER_STEPS в src/forum/rules.js). Своих отметок шаг не
 * хранит — он закрыт, когда в другой таблице стоит строка, поэтому у него нет
 * ни id, ни даты, ни статуса.
 *
 * Ссылки здесь тоже нет: адрес своей страницы знает код разметки, а не хранилище.
 *
 * @typedef {Object} ForumStarterStep
 * @property {string} id     Ключ шага: то же слово, что в STARTER_STEPS и в базе.
 * @property {boolean} done  Сделан ли шаг по строкам других таблиц.
 */

/**
 * Тишина в одном разделе: писать сюда нельзя, остальной форум открыт.
 *
 * Пары «человек и раздел» уникальны, поэтому продление — это та же запись,
 * а не вторая строка. Просроченная тишина ничем не отличается от снятой:
 * живёт она до тех пор, пока `mutedUntil` в будущем, и чистить её фоном
 * незачем.
 *
 * @typedef {Object} ForumSectionMute
 * @property {string} userId
 * @property {string} category   id раздела из CATEGORIES — тот же, что в теме.
 * @property {Date}   mutedUntil До когда здесь нельзя писать.
 * @property {string} reason     Пояснение, которое видит игрок.
 */

/**
 * Строка календаря: тема с меткой «Событие» плюс её момент и числа.
 *
 * Событие намеренно не отдельная сущность, а тема (см. шаг 1 миграции
 * supabase/20260925-event-rsvp.sql), поэтому здесь нет ни «отменено», ни
 * «перенесено»: отмена — это удаление темы, и работает тот же механизм, что у
 * любой удалённой записи.
 *
 * Имён в списке участников наружу нет намеренно: «кто идёт» читается как карта
 * составов альянса, поэтому представление отдаёт только количество.
 *
 * @typedef {Object} ForumEvent
 * @property {string}  id              id темы — она же событие.
 * @property {string}  title
 * @property {string}  body            Анонс: тот же текст темы.
 * @property {string}  category
 * @property {string[]} tags
 * @property {string}  authorId        Организатор — тот, кто завёл тему.
 * @property {string}  authorNick
 * @property {Date}    createdAt
 * @property {Date}    eventAt         Момент встречи.
 * @property {number|null} eventCapacity  Мест; null — без лимита.
 * @property {number}  goingCount      «Буду» — занимает места.
 * @property {number}  maybeCount      «Возможно» — мест не занимает.
 * @property {number|null} spotsLeft   null без лимита; ноль — мест нет.
 * @property {'going'|'maybe'|'declined'|null} myStatus  Ответ вошедшего; null — не отвечал.
 * @property {number|null} myRemindMinutes  Срок напоминания из того же ответа.
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
 * @property {(opts?: {category?: string, sort?: string, limit?: number, offset?: number, q?: string, saved?: boolean}) => Promise<{posts: ForumPost[], total: number}>} listPosts
 * @property {(id: string) => Promise<ForumPost|null>} getPost
 * @property {(postId: string) => Promise<void>} registerView  Один просмотр темы.
 * @property {(postId: string) => Promise<void>} markRead  Отметка «я здесь был»: по ней лента считает, сколько ответов в теме новое.
 * @property {(draft: {title: string, body: string, category: string, tags?: string[], expiresAt?: string|null, eventAt?: string|null, eventCapacity?: number|null, barterGives?: string|null, barterWants?: string|null, poll?: {question: string, multiple: boolean, options: string[]}}) => Promise<ForumPost>} createPost  Отказ из-за выдержки приходит текстом ошибки — страница показывает его как есть, объяснять человеку нечего кроме срока.
 * @property {(id: string, patch: {title?: string, body?: string, category?: string}) => Promise<ForumPost>} editPost
 * @property {(id: string, reason: string) => Promise<void>} deletePost
 * @property {(id: string, pinned: boolean) => Promise<ForumPost>} setPinned
 * @property {(id: string, expiresAt: string|null) => Promise<ForumPost>} setExpiry  Продлить срок или снять его; база считает границы, страница показывает отказ как есть.
 * @property {(id: string, closed: boolean) => Promise<ForumPost>} closeBarter  Снять объявление обмена с доски или вернуть его. Право решает RLS темы, как у setExpiry: своей строкой правит автор.
 * @property {(postId: string) => Promise<ForumComment[]>} listComments
 * @property {(postId: string, body: string) => Promise<ForumComment>} addComment
 * @property {(id: string, reason: string) => Promise<void>} deleteComment
 * @property {(targetType: 'post'|'comment', targetId: string, reactionId: string|null) => Promise<void>} setReaction
 * @property {(targetType: 'post'|'comment', targetId: string) => Promise<void>} giveThanks
 *                                    Поблагодарить автора. Отдельная сущность,
 *                                    а не реакция: согласия снимаются,
 *                                    благодарность — никогда. Отказывает база
 *                                    (forum_give_thank) своими словами, и
 *                                    локальный режим повторяет их дословно.
 * @property {(userId: string, delta: number, reason: string) => Promise<void>} [grantReputation]
 *                                    Награда владельца: одно неизменяемое
 *                                    начисление очков репутации.
 * @property {(userId: string|null) => Promise<Array<{ id: string, userId: string, nick: string, delta: number,
 *                                    reason: string, grantedByNick: string, createdAt: Date }>>} [listReputationGrants]
 *                                    История начислений: свою видит игрок,
 *                                    всю — модерация; причины наружу не идут.
 * @property {(report: {targetType: 'post'|'comment', targetId: string, ruleId: string, note?: string}) => Promise<void>} report
 * @property {() => Promise<ForumReport[]>} listReports
 * @property {(reportId: string) => Promise<void>} resolveReport
 * @property {(postId: string) => Promise<void>} subscribeTopic
 * @property {(postId: string) => Promise<void>} unsubscribeTopic
 * @property {(postId: string) => Promise<void>} bookmarkTopic
 *                                    Положить тему в закладки. Двери в базе для
 *                                    этого нет — одна своя строка, и правило
 *                                    доступа к ней есть прямо в таблице
 *                                    (forum_bookmarks). Кто поставил, решает
 *                                    токен, а не браузер.
 * @property {(postId: string) => Promise<void>} unbookmarkTopic
 *                                    Снять закладку: строка удаляется, а не
 *                                    помечается. Возвращать «удалённую»
 *                                    закладку нечем.
 * @property {(allianceId: string) => Promise<void>} subscribeAlliance
 * @property {(allianceId: string) => Promise<void>} unsubscribeAlliance
 * @property {() => Promise<string[]>} listAllianceSubscriptions
 * @property {(rows: {allianceId: string, place: number, points: number}[]) => Promise<void>} recordAllianceRankSnapshot
 * @property {(targetType: 'post'|'comment', targetId: string) => Promise<void>} restoreAutoHiddenContent
 * @property {() => Promise<{targetType: string, targetId: string, reportCount: number, priority: string}[]>} listModerationQueue
 * @property {() => Promise<{id: string, actorNick: string, targetType: string, targetId: string, targetNick: string, action: string, details: object, createdAt: Date}[]>} listModerationActions
 * @property {() => Promise<ForumUser[]>} listUsers
 * @property {() => Promise<ForumSpamSignal[]>} listSpamSignals  Кто сел на предел выдержки, у кого открытые жалобы и скрытое после пяти. Читает только модерация: игрок не узнаёт, что он в списке. Без функции в базе вызов падает, и панель называет недостающую миграцию.
 * @property {() => Promise<ForumStarterStep[]>} listStarterSteps  Пять первых шагов самого вызывающего: профиль, ответ, благодарность, закладка, подписка. Приватно — модерации этот список не показывается нигде. Вне окна новичка и гость получают пустой список, а не ошибку; без функции в базе вызов падает, и страница форума просто не рисует блок.
 *
 * Восстановление доступа (см. supabase/20260925-self-recovery.sql). Пароль
 * придумывает игрок, а заявка открывает ему дверь сама через 12 часов —
 * владелец за это время может только возразить, поэтому ни один из этих
 * вызовов не несёт пароль через панель.
 * @property {(nick: string, keyHash: string) => Promise<void>} beginRecovery  Заявка; keyHash — SHA-256 ключа из браузера игрока.
 * @property {(nick: string, key: string) => Promise<{status: 'none'|'pending'|'approved'|'rejected'|'used'|'expired', canSet: boolean, readyAt: Date|null}>} recoveryStatus  canSet считает база: на него смотрит страница, прежде чем показать поле нового пароля.
 * @property {(nick: string, key: string, password: string) => Promise<void>} finishRecovery  Ставит пароль; наружу не возвращает ничего.
 * @property {() => Promise<ForumRecoveryRequest[]>} listRecoveryRequests  Очередь для владельца; отпечатков ключей в ней нет.
 * @property {(id: string, approve: boolean) => Promise<void>} reviewRecovery  Впустить досрочно или отклонить; права проверяет база.
 * @property {(userId: string, opts: {banned?: boolean, mutedUntil?: Date|null, reason?: string}) => Promise<void>} setRestriction
 *
 * Оспаривание меры (см. supabase/20260925-sanction-appeal.sql). Забаненный
 * игрок проходит здесь, хотя писать ему нельзя: право возразить против
 * запрета не является правом писать.
 * @property {() => Promise<ForumAppeal[]>} listAppeals  Себя видит игрок, всё — модерация; без таблицы падает ошибкой, и вызывающий решает, глушить её или показать.
 * @property {(kind: 'ban'|'mute', message: string) => Promise<void>} openAppeal  Одна открытая заявка на вид меры; тексты отказа приходят из базы и показываются как есть.
 * @property {(id: string, status: 'upheld'|'rejected', answer: string) => Promise<void>} reviewAppeal  Только модерация; «upheld» снимает ровно оспоренную меру и отвечает игроку текстом.
 *
 * Тишина в одном разделе (см. supabase/20260925-section-mute.sql). Она
 * закрывает текст в этом разделе — темы и ответы; реакции, жалобы и правка
 * своего старого поста остаются открыты. Закрыть последний раздел нельзя:
 * это общий запрет, а общий запрет обязан быть оспоримым.
 * @property {(userId: string) => Promise<ForumSectionMute[]>} listSectionMutes  Игрок зовёт себя, панель — любого; без таблицы падает ошибкой, и вызывающий решает, глушить её или показать.
 * @property {(userId: string, category: string, days: number, reason: string) => Promise<void>} setSectionMute  От 1 до 30 дней и с пояснением; тексты отказа приходят из базы и показываются как есть.
 * @property {(userId: string, category: string) => Promise<void>} clearSectionMute  Снять тишину в одном разделе; общая её не трогает.
 *
 * Календарь встреч (см. supabase/20260925-event-rsvp.sql). Тема с меткой
 * «Событие» и есть событие: обсуждение, реакции, жалобы и право оспорить
 * удаление у неё общие с остальным форумом, а у календаря свои три вещи —
 * момент, места и напоминание.
 * @property {() => Promise<ForumEvent[]>} listEvents  Хронологический порядок, предстоящие и прошедшие вместе: делит их страница. Ошибку вызывающий не глушит — по ней видно, какой SQL-файл ещё не выполнен.
 * @property {(postId: string, status: 'going'|'maybe'|'declined', remindMinutes?: number|null) => Promise<void>} answerEvent  Право писать здесь не нужно, как у апелляций: забаненный спорить словами не может, а прийти ему никто не мешал. Отказ «мест больше нет» считает база.
 * @property {(id: string, eventAt: string, eventCapacity?: number|null) => Promise<ForumPost>} setEventAt  Назначить или перенести момент своей темы; границы держит база, и её текст отказа страница показывает как есть.
 * @property {(userId: string, isBlogger: boolean) => Promise<void>} setBlogger
 * @property {(userId: string) => Promise<void>} adminDeleteUser  Удалить аккаунт; посты и комментарии остаются.
 *
 * Защита ников и верификация (см. supabase/nicks-verified.sql).
 * @property {(nick: string) => Promise<{status: 'free'|'taken'|'reserved'}>} checkNick  Свободен ли ник (живая проверка формы).
 * @property {(userId: string, verified: boolean) => Promise<void>} setVerified  Подтвердить/снять ник: лидер своего альянса, модератор или владелец.
 * @property {(newNick: string, reason?: string) => Promise<void>} renameNick  Игрок меняет свой ник; пишется в журнал.
 * @property {(userId: string, newNick: string, reason: string) => Promise<void>} renameNickAs  Владелец переименовывает игрока (тролля); причина обязательна.
 * @property {() => Promise<{nick: string, createdAt: Date}[]>} listReservedNicks  Стоп-лист запрещённых ников (владелец).
 * @property {(nick: string) => Promise<void>} addReservedNick
 * @property {(nick: string) => Promise<void>} removeReservedNick
 * @property {(userId: string) => Promise<{createdAt: Date, oldNick: string, newNick: string, changedBy: string|null, reason: string}[]>} nickHistory
 * @property {(pollId: string, optionId: string) => Promise<void>} votePoll
 * @property {(pollId: string, optionId: string) => Promise<void>} unvotePoll
 * @property {(pollId: string) => Promise<void>} closePoll
 * @property {() => Promise<ForumNotification[]>} listNotifications  Свежие сверху, только свои.
 * @property {(ids: string[]) => Promise<void>} markNotificationsRead
 * @property {() => Promise<void>} markAllNotificationsRead
 *
 * Закрытые чаты (см. supabase/chats.sql). Создаёт лидер альянса
 * (ForumUser.isLeader) или модерация; читают только участники и модерация.
 * @property {(userId: string, allianceTag: string) => Promise<void>} setLeader  Назначить лидера тега allianceTag; пустой тег — снять.
 * @property {() => Promise<ForumChat[]>} listChats
 * @property {(id: string) => Promise<ForumChat|null>} getChat
 * @property {(draft: {title: string, kind?: 'alliance'|'inter', allianceTag?: string}) => Promise<ForumChat>} createChat
 * @property {(code: string) => Promise<string>} joinChat  Возвращает id чата.
 * @property {(chatId: string) => Promise<void>} leaveChat
 * @property {(chatId: string) => Promise<ForumChatMember[]>} listChatMembers
 * @property {(chatId: string, userId: string, role: 'admin'|'member') => Promise<void>} setChatMemberRole
 * @property {(chatId: string, userId: string) => Promise<void>} kickChatMember
 * @property {(chatId: string, opts?: {limit?: number, before?: Date|null}) => Promise<ForumChatMessage[]>} listChatMessages
 * @property {(chatId: string, body: string, opts?: {attachments?: any[], poll?: any, replyTo?: any}) => Promise<ForumChatMessage>} sendChatMessage
 * @property {(id: string, reason?: string) => Promise<void>} deleteChatMessage
 * @property {(chatId: string) => Promise<void>} markChatRead
 * @property {(chatId: string, patch: {title?: string, allianceTag?: string, closed?: boolean, closedReason?: string}) => Promise<void>} updateChat
 * @property {(chatId: string) => Promise<string>} rotateChatCode
 * @property {(chatId: string) => Promise<void>} deleteChat
 * @property {(chatId: string) => Promise<void>} adminDeleteChat
 * @property {(messageId: string, optionIndex: number) => Promise<void>} [voteChatPoll]
 * @property {(messageId: string, reaction: string) => Promise<void>} [reactChatMessage]
 * @property {(chatId: string, messageId: string) => Promise<void>} [pinChatMessage]
 * @property {(chatId: string) => Promise<void>} [unpinChatMessage]
 * @property {(chatId: string) => Promise<void>} [setTyping]
 * @property {(otherUserNick: string) => Promise<string>} [createDM]  Возвращает id чата.
 * @property {() => Promise<{userId: string, nick: string, avatarUrl: string, allianceTag: string, messageCount: number}[]>} [chatLeaderboard]
 * @property {(userId: string) => Promise<{liked: boolean}>} [toggleProfileLike]
 * @property {(eventId: string) => Promise<ForumEventComment[]>} [listEventComments]
 * @property {(eventId: string, body: string) => Promise<ForumEventComment>} [addEventComment]
 * @property {(id: string, reason?: string) => Promise<void>} [deleteEventComment]
 * @property {(endpoint: string, keys: Record<string,string>) => Promise<void>} [savePushSubscription]
 * @property {(endpoint: string) => Promise<void>} [removePushSubscription]
 * @property {() => Promise<ForumTournament[]>} [listTournaments]
 * @property {(allyA: string, allyB: string, title?: string) => Promise<ForumTournament>} [createTournament]
 * @property {(tournamentId: string, winnerId: string|null, notes?: string) => Promise<void>} [addTournamentRound]
 * @property {() => Promise<ForumGuide[]>} [listGuides]
 * @property {(slug: string) => Promise<ForumGuide|null>} [getGuide]
 * @property {(draft: {slug: string, title: string, category?: string, body: string}) => Promise<ForumGuide>} [createGuide]
 * @property {(id: string, patch: {title?: string, category?: string, body?: string, status?: string}) => Promise<ForumGuide>} [updateGuide]
 * @property {(id: string) => Promise<void>} [deleteGuide]
 * @property {(id: string, status: 'none'|'verified'|'outdated', note?: string) => Promise<void>} [reviewGuide]  Ставит отметку модерации; для игрока — отказ.
 * @property {(id: string, note: string) => Promise<void>} [reportGuideStale]  Сигнал «гайд устарел», один на человека.
 * @property {() => Promise<ForumGuideRequest[]>} [listGuideRequests]  Открытые — всем, разобранные: только автору и модерации.
 * @property {(draft: {title: string, details?: string}) => Promise<ForumGuideRequest>} [createGuideRequest]
 * @property {(id: string) => Promise<void>} [cancelGuideRequest]  Отзыв своей открытой заявки.
 * @property {(id: string, status: 'linked'|'closed', answer: string, guideId?: string|null) => Promise<void>} [resolveGuideRequest]  Решение модерации; для игрока — отказ.
 *
 * Пульс обновлений игры (см. supabase/20260926-update-pulse.sql). Заметку
 * пишет модерация руками: автоматического чтения чужих страниц у сайта нет ни
 * в каком режиме, и быть не может — серверной части нет вовсе.
 * @property {() => Promise<ForumUpdateNote[]>} [listUpdateNotes]  Свежие сверху; опубликованные видят и невошедшие, архив — только модерация. Ошибку вызывающий не глушит: по ней страница называет файл миграции.
 * @property {(draft: {kind: string, title: string, summary: string, sourceName: string, sourceUrl: string, sourceAt: string, gameVersion?: string}) => Promise<ForumUpdateNote>} [publishUpdateNote]  Порядок отказов одинаков в обоих режимах: право → тип → заголовок → содержание → источник → дата → версия.
 * @property {(id: string, archived: boolean) => Promise<void>} [setUpdateNoteArchived]  Убрать и вернуть одной функцией: правка текста после публикации не разрешена намеренно.
 * @property {() => Promise<{newForumPost: boolean, newForumReply: boolean}>} [getPushPrefs]
 * @property {(prefs: {newForumPost?: boolean, newForumReply?: boolean}) => Promise<void>} [setPushPrefs]
 * @property {() => Promise<ForumActivityDay[]|null>} [getServerActivity]  Последняя неделя: посты, комментарии, сообщения в чатах по дням.
 * @property {(userId: string) => Promise<ForumUserActivity|null>} [getUserActivity]  Личный GitHub-график: активность по дням.
 */

/**
 * Заявка на восстановление доступа. Поля выбраны так, чтобы ни одно из них
 * не было секретом: nick и сроки — всё, что видит владелец.
 *
 * @typedef {Object} ForumRecoveryRequest
 * @property {string} id
 * @property {string} userId
 * @property {string} nick
 * @property {'pending'|'approved'|'rejected'|'used'|'expired'} status
 * @property {Date} createdAt
 * @property {Date|null} readyAt  Час, когда заявка примет пароль без владельца.
 * @property {Date|null} decidedAt
 * @property {Date} expiresAt
 * @property {string} decidedByNick  Кто впустил досрочно; пустой — никто.
 */

/**
 * Гайд. Отметка «проверен / устарел» ставится только живым человеком:
 * дата публикации ничего не говорит о том, работает ли совет сегодня, а
 * автоматический срок превратил бы «проверено» в простую надпись.
 *
 * @typedef {Object} ForumGuide
 * @property {string} id
 * @property {string} slug
 * @property {string} title
 * @property {string} category
 * @property {string} body
 * @property {string|null} authorId
 * @property {string} authorNick
 * @property {'draft'|'published'|'archived'} status
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {'none'|'verified'|'outdated'} reviewStatus  Отметка модерации; 'none' — никто не смотрел.
 * @property {string} reviewNote  Что именно поправили или почему гайд устарел.
 * @property {Date|null} reviewedAt
 * @property {ForumGuideSignal[]} signals  Открытые сигналы об устаревании: свои, а модерации — все.
 */

/**
 * @typedef {Object} ForumGuideSignal
 * @property {string} userId   Кому принадлежит сигнал.
 * @property {string} note
 * @property {Date} createdAt
 */

/**
 * Заявка на гайд: тему называет игрок, разбирает модерация. Голосов у неё нет
 * намеренно — счётчик показывал бы не потребность, а активность одного
 * кружка. Исход видит только автор и модерация, поэтому `guideId` здесь —
 * именно id, а не название: карточка сама найдёт гайд в уже загруженном
 * списке, и архивный или удалённый гайд станет «гайд недоступен» вместо
 * ссылки в никуда.
 *
 * @typedef {Object} ForumGuideRequest
 * @property {string} id
 * @property {string} userId
 * @property {string} userNick
 * @property {string} title
 * @property {string} details   Необязательное «где именно встал».
 * @property {'open'|'linked'|'closed'|'cancelled'} status
 * @property {string|null} guideId  Гайд, которым закрыли вопрос.
 * @property {string} answer  Пояснение модерации; пусто, пока заявка открыта.
 * @property {Date} createdAt
 * @property {Date|null} decidedAt  У отозванной — момент отзыва.
 * @property {string|null} decidedByNick  Кто решил; при отзыве — сам автор.
 */

/**
 * Заметка об обновлении игры. Дата здесь — не момент публикации на форуме, а
 * момент, когда текст вышел у первоисточника: читателя интересует свежесть
 * перемены в игре, а не то, когда её пересказал дежурный модератор.
 *
 * Правки у заметки нет сознательно: это датированное свидетельство, и текст,
 * который можно переписать молча, перестаёт им быть. Ошиблись — в архив и
 * новую, поэтому `archivedAt` и `archivedByNick` описывают ровно одно
 * движение.
 *
 * @typedef {Object} ForumUpdateNote
 * @property {string} id
 * @property {'patch'|'notice'|'issue'} kind
 * @property {string} title
 * @property {string} summary  Пересказ изменения своими словами.
 * @property {string} sourceName  Как называется первоисточник: «Официальный сайт».
 * @property {string} sourceUrl  Только HTTPS; ссылка на то, откуда это взято.
 * @property {Date} sourceAt  Дата публикации у первоисточника.
 * @property {string} gameVersion  Пустая строка, если версии нет.
 * @property {'published'|'archived'} status
 * @property {string} authorNick  Кто положил заметку в список.
 * @property {Date} createdAt
 * @property {Date|null} archivedAt
 * @property {string|null} archivedByNick  Кто убрал; пусто, пока заметка открыта.
 */

/**
 * @typedef {Object} ForumActivityDay
 * @property {Date} day             День, по местному времени.
 * @property {number} forumPosts    Тем на форуме за этот день.
 * @property {number} forumComments Ответов на форуме за этот день.
 * @property {number} chatMessages  Сообщений в чатах за этот день.
 */

/**
 * @typedef {Object} ForumUserActivity
 * @property {ForumActivityDay[]} days  Активность по дням, старые сверху.
 * @property {number|null} chatsJoined  Сколько чатов у человека; null — чужая статистика скрыта.
 */

/**
 * @typedef {Object} ForumTournament
 * @property {string} id
 * @property {string} title
 * @property {string} allyA
 * @property {string} allyB
 * @property {number} winsA
 * @property {number} winsB
 * @property {number} draws
 * @property {'active'|'finished'} status
 * @property {string|null} winner
 * @property {Date} createdAt
 */

/**
 * @typedef {Object} ForumChat
 * @property {string} id
 * @property {string} title
 * @property {'alliance'|'inter'|'dm'} kind
 * @property {string} allianceTag
 * @property {string|null} ownerId
 * @property {string} ownerNick
 * @property {string} inviteCode   Виден только участникам (политики базы).
 * @property {number} maxMembers
 * @property {boolean} closed
 * @property {string} closedReason
 * @property {string} avatarUrl
 * @property {Date} createdAt
 * @property {number} memberCount
 * @property {number} onlineCount
 * @property {'owner'|'admin'|'member'|null} myRole
 * @property {number} unread
 * @property {Date|null} myLastReadAt  Когда пользователь последний раз дочитал чат (forum_chat_members.last_read_at); null — отметки нет, все сообщения считаются прочитанными.
 * @property {string} lastBody
 * @property {string} lastNick
 * @property {Date|null} lastAt
 * @property {string|null} pinnedBody
 * @property {string|null} pinnedNick
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
 * @property {Date|null} lastSeenAt
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
 * @property {boolean} authorIsVerified
 * @property {string} body
 * @property {any[]} [attachments]
 * @property {any|null} [poll]
 * @property {any|null} [replyTo]
 * @property {Record<string, number>} [reactions]
 * @property {boolean} deleted
 * @property {string} deletedReason
 * @property {Date} createdAt
 */

/**
 * @typedef {Object} ForumEventComment
 * @property {string} id
 * @property {string} eventId
 * @property {string|null} authorId
 * @property {string} authorNick
 * @property {string} body
 * @property {boolean} deleted
 * @property {string} deletedReason
 * @property {Date} createdAt
 */

export {};
