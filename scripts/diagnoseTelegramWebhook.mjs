const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is unavailable in this diagnostic runtime");
}

const response = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
const payload = await response.json();
const info = payload?.result ?? {};

console.log(JSON.stringify({
  ok: payload?.ok === true,
  httpStatus: response.status,
  url: typeof info.url === "string" ? info.url : null,
  pendingUpdateCount: typeof info.pending_update_count === "number" ? info.pending_update_count : null,
  lastErrorDate: typeof info.last_error_date === "number" ? info.last_error_date : null,
  lastErrorMessage: typeof info.last_error_message === "string" ? info.last_error_message : null,
  ipAddress: typeof info.ip_address === "string" ? info.ip_address : null,
  hasCustomCertificate: info.has_custom_certificate === true,
}, null, 2));
