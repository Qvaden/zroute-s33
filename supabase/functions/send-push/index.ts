// ── Supabase Edge Function: отправка Web Push уведомлений ───────────────
//
// Вызывается Database Webhook'ом при INSERT в forum_chat_messages.
// Находит подписки push_subscriptions для участников чата (кроме автора)
// и рассылает Web Push через библиотеку web-push.
//
// Настройка Supabase:
//   1. supabase functions deploy send-push
//   2. supabase secrets set VAPID_PUBLIC_KEY=<pub> VAPID_PRIVATE_KEY=<priv>
//   3. В Dashboard → Database → Webhooks создать webhook:
//        Таблица: forum_chat_messages
//        Событие: INSERT
//        URL: https://<ref>.supabase.co/functions/v1/send-push
//        Headers: Authorization=Bearer <anon_key>

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webPush from "https://esm.sh/web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") || "";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails("mailto:admin@zroute-s33.local", VAPID_PUBLIC, VAPID_PRIVATE);
}

serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload?.record;
    if (!record?.chat_id || !record?.author_id) {
      return new Response("no record", { status: 200 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Найти участников чата (кроме автора сообщения).
    const { data: members } = await admin
      .from("forum_chat_members")
      .select("user_id")
      .eq("chat_id", record.chat_id)
      .neq("user_id", record.author_id);

    if (!members?.length) {
      return new Response("no members", { status: 200 });
    }

    // Найти push-подписки для этих участников.
    const memberIds = members.map((m: { user_id: string }) => m.user_id);
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint, keys")
      .in("user_id", memberIds);

    if (!subs?.length) {
      return new Response("no subscriptions", { status: 200 });
    }

    const body = record.body || "📎 Вложение";
    const preview = body.length > 100 ? body.slice(0, 97) + "…" : body;
    const notification = JSON.stringify({
      title: `${record.author_nick || "Участник"}: сообщение`,
      body: preview,
      tag: `chat-${record.chat_id}`,
    });

    const results = await Promise.allSettled(
      subs.map(async (sub: { endpoint: string; keys: Record<string, string> }) => {
        const subscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth },
        };
        return webPush.sendNotification(subscription, notification).catch((err: Error) => {
          // Удалить мёртвую подписку (410 Gone).
          if (err?.statusCode === 410) {
            admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          }
          throw err;
        });
      })
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.filter((r) => r.status === "rejected").length;
    return new Response(JSON.stringify({ ok, fail }), { status: 200 });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});
