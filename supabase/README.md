# Порядок SQL-миграций

Новая база: `schema.sql` → `rich-forum.sql` → `site-data.sql` → `profiles.sql` →
`nicks-verified.sql` → `topic-subscriptions.sql` → `moderation-automation.sql` →
`moderation-alerts.sql` → `20260916-forum-community.sql`.

`chats.sql`, `leaders.sql`, дневная активность и точечные `fix-*.sql` применяются
после их зависимостей по задаче. Старые разовые файлы не запускайте повторно на
боевой базе, если их задача уже выполнена.
