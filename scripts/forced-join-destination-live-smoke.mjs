const chatId = Number(process.env.FORCED_JOIN_SMOKE_CHAT_ID ?? "-1003795743979");
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || !Number.isSafeInteger(chatId)) {
  throw new Error("TELEGRAM_BOT_TOKEN and a valid FORCED_JOIN_SMOKE_CHAT_ID are required");
}

async function call(method, payload = {}) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.description || `Telegram ${response.status}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 350 * 2 ** attempt));
    }
  }
  throw lastError;
}

const me = await call("getMe");
const [chat, membership] = await Promise.all([
  call("getChat", { chat_id: chatId }),
  call("getChatMember", { chat_id: chatId, user_id: me.id }),
]);

if (!["administrator", "creator", "owner"].includes(membership.status)) {
  throw new Error(`Bot membership is ${membership.status}, not administrator`);
}

console.log(JSON.stringify({ ok: true, chatId: chat.id, chatType: chat.type, botMembership: membership.status, title: chat.title ?? null }));
