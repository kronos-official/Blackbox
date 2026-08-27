import { initializeTelegramBot } from "./bot";
import { notifyBotInitializationFailure } from "./runtimeAlerts";
import { botRuntimeState } from "./routes";

/** Starts the webhook-only bot runtime and escalates startup failures to the owner. */
export async function startTelegramRuntime() {
  try {
    await initializeTelegramBot();
    botRuntimeState.botReady = true;
  } catch (error) {
    console.error("[Kronos Guard] Telegram bot initialization failed", error);
    await notifyBotInitializationFailure(error);
  }
}
