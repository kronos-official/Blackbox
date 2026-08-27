const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.log(JSON.stringify({ ok: false, error: "TELEGRAM_BOT_TOKEN missing" }));
  process.exit(0);
}
for (const method of ["getMe", "getWebhookInfo"]) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`);
  const body = await response.json();
  if (method === "getWebhookInfo" && body?.result) {
    const { url, ...safe } = body.result;
    console.log(JSON.stringify({ method, httpStatus: response.status, ok: body.ok, result: { ...safe, urlConfigured: Boolean(url), urlHost: url ? new URL(url).host : null } }));
  } else if (method === "getMe" && body?.result) {
    const { id, is_bot, first_name, username, can_join_groups, can_read_all_group_messages, supports_inline_queries } = body.result;
    console.log(JSON.stringify({ method, httpStatus: response.status, ok: body.ok, result: { id, is_bot, first_name, username, can_join_groups, can_read_all_group_messages, supports_inline_queries } }));
  } else {
    console.log(JSON.stringify({ method, httpStatus: response.status, ok: body.ok, description: body.description }));
  }
}
