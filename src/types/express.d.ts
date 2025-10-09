import type { JWTPayload } from "../auth/jwtService.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      telegramId?: string;
      jwtPayload?: JWTPayload;
    }
  }
}

export {};
