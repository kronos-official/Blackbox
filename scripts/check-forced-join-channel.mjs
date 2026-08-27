const rawChatReference = process.argv[2];
const membershipUserId = Number(process.argv[3]);
const numericChatId = Number(rawChatReference);
const chatReference = Number.isSafeInteger(numericChatId) ? numericChatId : rawChatReference;
const token = process.env.TELEGRAM_BOT_TOKEN;

if ((typeof chatReference !== "number" || chatReference >= 0) && (typeof chatReference !== "string" || !/^@[A-Za-z0-9_]{5,}$/.test(chatReference))) {
  throw new Error("Provide a negative Telegram channel chat ID or a public @channelusername.");
}
if (!token) throw new Error("Telegram bot token is not available in this environment.");

async function telegram(method, params = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(`${method}: ${payload.description ?? "Telegram request failed"}`);
  return payload.result;
}

const [me, chat, webhook] = await Promise.all([
  telegram("getMe"),
  telegram("getChat", { chat_id: chatReference }),
  telegram("getWebhookInfo"),
]);
const membership = await telegram("getChatMember", { chat_id: chat.id, user_id: me.id });
const checkedUser = Number.isSafeInteger(membershipUserId) && membershipUserId > 0
  ? await telegram("getChatMember", { chat_id: chat.id, user_id: membershipUserId })
  : null;

console.log(JSON.stringify({
  chatId: chat.id,
  chatTitle: "title" in chat ? chat.title : null,
  botMembershipStatus: membership.status,
  canVerifyMembers: membership.status === "administrator" || membership.status === "creator",
  canDeleteMessages: "can_delete_messages" in membership ? Boolean(membership.can_delete_messages) : false,
  canRestrictMembers: "can_restrict_members" in membership ? Boolean(membership.can_restrict_members) : false,
  canManageChat: "can_manage_chat" in membership ? Boolean(membership.can_manage_chat) : false,
  checkedUserMembershipStatus: checkedUser?.status ?? null,
  checkedUserIsMember: checkedUser ? ["creator", "owner", "administrator", "member"].includes(checkedUser.status) || (checkedUser.status === "restricted" && checkedUser.is_member === true) : null,
  webhookConfigured: Boolean(webhook.url),
  webhookPendingUpdateCount: Number(webhook.pending_update_count ?? 0),
  webhookLastError: webhook.last_error_message ?? null,
}, null, 2));
