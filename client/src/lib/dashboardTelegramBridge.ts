export type TelegramWebAppBridge = {
  initData?: string;
  version?: string;
  ready?: () => void;
  expand?: () => void;
  onEvent?: (eventType: string, callback: (payload?: unknown) => void) => void;
  offEvent?: (eventType: string, callback: (payload?: unknown) => void) => void;
};

export function getTelegramWebApp(target: TelegramBridgeWindow): TelegramWebAppBridge | null {
  return target.Telegram?.WebApp ?? null;
}

export type TelegramBridgeWindow = {
  Telegram?: { WebApp?: TelegramWebAppBridge };
};

export function readTelegramInitData(target: TelegramBridgeWindow): string | null {
  const value = target.Telegram?.WebApp?.initData?.trim();
  return value ? value : null;
}

export function prepareTelegramWebApp(target: TelegramBridgeWindow) {
  const webApp = target.Telegram?.WebApp;
  try {
    webApp?.ready?.();
    webApp?.expand?.();
  } catch {
    // Telegram Desktop can expose the bridge before all optional methods are ready.
    // Authentication only needs the signed initData, so presentation helpers are best-effort.
  }
}

export function waitForTelegramInitData(
  target: TelegramBridgeWindow,
  options: { timeoutMs?: number; intervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 250;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise(resolve => window.setTimeout(resolve, ms)));
  const startedAt = now();

  return new Promise(async (resolve, reject) => {
    while (now() - startedAt <= timeoutMs) {
      const initData = readTelegramInitData(target);
      if (initData) {
        prepareTelegramWebApp(target);
        resolve(initData);
        return;
      }
      await sleep(intervalMs);
    }
    reject(new Error("Telegram WebApp bridge did not provide signed initData before timeout"));
  });
}
