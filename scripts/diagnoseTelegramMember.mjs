const token = process.env.TELEGRAM_BOT_TOKEN;
const actorId = 8375579910;
const chatId = "@anonymousgapsecret";

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is unavailable in this diagnostic runtime");

async function call(method, params) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`${method} failed: ${body.description ?? response.status}`);
  return body.result;
}

const [chat, member, administrators] = await Promise.all([
  call("getChat", { chat_id: chatId }),
  call("getChatMember", { chat_id: chatId, user_id: actorId }),
  call("getChatAdministrators", { chat_id: chatId }),
]);

const listedAdmin = administrators.find(entry => entry?.user?.id === actorId);
console.log(JSON.stringify({
  chatId: chat.id,
  chatType: chat.type,
  memberStatus: member.status,
  memberIsAnonymous: member.is_anonymous === true,
  memberUserId: member?.user?.id ?? null,
  rosterContainsActor: Boolean(listedAdmin),
  rosterActorStatus: listedAdmin?.status ?? null,
  rosterActorIsAnonymous: listedAdmin?.is_anonymous === true,
  administratorCount: administrators.length,
}, null, 2));
