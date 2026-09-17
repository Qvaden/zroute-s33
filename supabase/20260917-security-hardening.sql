-- Закрытие дыры, найденной при аудите безопасности.
-- Запускать после moderation-alerts.sql; повторный запуск безопасен.
--
-- forum_moderation_alerts создавалась без RLS и политик — при стандартных
-- грантах Supabase её мог читать и править кто угодно, включая анонима:
-- видно, на что накопились «срочные» и «критичные» жалобы, и мусорить строками.

alter table public.forum_moderation_alerts enable row level security;

drop policy if exists forum_moderation_alerts_read on public.forum_moderation_alerts;
create policy forum_moderation_alerts_read on public.forum_moderation_alerts
  for select using (public.forum_is_staff());

-- Пишут только security definer-триггеры; прямых DML-грантов не даём.
revoke all on public.forum_moderation_alerts from anon, authenticated;
grant select on public.forum_moderation_alerts to authenticated;
