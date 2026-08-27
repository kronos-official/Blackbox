export type TelegramRetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

type TelegramLikeError = {
  response?: {
    error_code?: number;
    parameters?: { retry_after?: number };
  };
};

function retryDelay(error: unknown, attempt: number, options: Required<TelegramRetryOptions>): number | null {
  const telegramError = error as TelegramLikeError;
  const errorCode = telegramError.response?.error_code;
  if (errorCode && errorCode !== 429 && errorCode < 500) return null;

  const retryAfterSeconds = telegramError.response?.parameters?.retry_after;
  if (retryAfterSeconds && retryAfterSeconds > 0) return retryAfterSeconds * 1000;

  const exponentialDelay = options.baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 125);
  return Math.min(exponentialDelay + jitter, options.maxDelayMs);
}

/** Retries transient Telegram and network failures without retrying definitive 4xx responses. */
export async function withTelegramRetry<T>(operation: () => Promise<T>, options: TelegramRetryOptions = {}): Promise<T> {
  const resolved: Required<TelegramRetryOptions> = {
    attempts: options.attempts ?? 4,
    baseDelayMs: options.baseDelayMs ?? 300,
    maxDelayMs: options.maxDelayMs ?? 8_000,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < resolved.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const delay = retryDelay(error, attempt, resolved);
      if (delay === null || attempt === resolved.attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
