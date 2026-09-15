# Порядок SQL-миграций

Новая база: `schema.sql` → `rich-forum.sql` → `site-data.sql` → `profiles.sql` →
`nicks-verified.sql` → `topic-subscriptions.sql` → `moderation-automation.sql` →
`moderation-alerts.sql` → `20260916-forum-community.sql`.

`chats.sql`, `leaders.sql`, дневная активность и точечные `fix-*.sql` применяются
после их зависимостей по задаче. Старые разовые файлы не запускайте повторно на
боевой базе, если их задача уже выполнена.

## Еженедельный дайджест

После `20260916-forum-community.sql` включите в Supabase Cron еженедельный
вызов `select public.forum_send_weekly_digest();` (например, по понедельникам
в 09:00 UTC). Функция соберёт движения в рейтинге и три самых заметных
обсуждения за последние семь дней и положит дайджест в уведомления игроков.
