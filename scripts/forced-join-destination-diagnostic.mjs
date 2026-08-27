const chatId = Number(process.env.FORCED_JOIN_SMOKE_CHAT_ID);
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || !Number.isSafeInteger(chatId)) {
  throw new Error("TELEGRAM_BOT_TOKEN and FORCED_JOIN_SMOKE_CHAT_ID are required");
}

async function call(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!body.ok) throw new Error(body.description || `Telegram ${response.status}`);
  return body.result;
}

const me = await call("getMe");
const chat = await call("getChat", { chat_id: chatId });

try {
  const membership = await call("getChatMember", { chat_id: chatId, user_id: me.id });
  console.log(JSON.stringify({ ok: true, chatId: chat.id, chatType: chat.type, title: chat.title ?? null, botMembership: membership.status }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, chatId: chat.id, chatType: chat.type, title: chat.title ?? null, membershipError: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
