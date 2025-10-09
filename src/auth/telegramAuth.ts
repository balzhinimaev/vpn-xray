import crypto from "crypto";

export interface TelegramUser {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
}

export interface ParsedInitData {
  user: TelegramUser;
  auth_date: number;
  hash: string;
  query_id?: string;
  [key: string]: any;
}

/**
 * Парсит initData строку в объект
 */
export function parseInitData(initData: string): ParsedInitData {
  const params = new URLSearchParams(initData);
  const result: any = {};

  for (const [key, value] of params.entries()) {
    if (key === "user") {
      try {
        result.user = JSON.parse(value);
      } catch {
        throw new Error("Invalid user data in initData");
      }
    } else if (key === "auth_date") {
      result.auth_date = parseInt(value, 10);
    } else {
      result[key] = value;
    }
  }

  if (!result.user || !result.auth_date || !result.hash) {
    throw new Error("Missing required fields in initData");
  }

  return result as ParsedInitData;
}

/**
 * Проверяет подпись initData через HMAC-SHA256
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAge: number = 86400 // 24 часа по умолчанию
): ParsedInitData {
  if (!botToken) {
    throw new Error("BOT_TOKEN is not configured");
  }

  const parsed = parseInitData(initData);
  const { hash, auth_date, ...dataToCheck } = parsed;

  // Проверка времени жизни
  const now = Math.floor(Date.now() / 1000);
  if (now - auth_date > maxAge) {
    throw new Error("initData is too old");
  }

  // Создаём строку для проверки подписи
  const dataCheckString = Object.keys(dataToCheck)
    .sort()
    .map((key) => {
      const value = dataToCheck[key];
      return `${key}=${
        typeof value === "object" ? JSON.stringify(value) : value
      }`;
    })
    .join("\n");

  // Вычисляем секретный ключ
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  // Проверяем подпись
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (calculatedHash !== hash) {
    throw new Error("Invalid initData signature");
  }

  return parsed;
}

/**
 * Middleware для Express: проверяет initData из body
 */
export function createTelegramInitDataValidator(botToken: string) {
  return (req: any, res: any, next: any) => {
    try {
      const initData = req.body?.initData;
      if (!initData) {
        return res.status(400).json({ error: "initData is required" });
      }

      const parsed = validateTelegramInitData(initData, botToken);
      req.telegramUser = parsed.user;
      req.authDate = parsed.auth_date;
      next();
    } catch (error: any) {
      return res
        .status(401)
        .json({ error: error.message || "Invalid initData" });
    }
  };
}
