import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { Request, Response, NextFunction } from "express";

export interface JWTPayload {
  userId: string;
  telegramId: string;
  type: "access" | "refresh";
  iat?: number;
  exp?: number;
}

export interface JWTConfig {
  secret: string;
  accessExpiry: string;
  refreshExpiry: string;
}

export class JWTService {
  private readonly secret: string;
  private readonly accessExpiry: string;
  private readonly refreshExpiry: string;

  constructor(config: JWTConfig) {
    if (!config.secret || config.secret.length < 32) {
      throw new Error("JWT_SECRET must be at least 32 characters long");
    }
    this.secret = config.secret;
    this.accessExpiry = config.accessExpiry;
    this.refreshExpiry = config.refreshExpiry;
  }

  /**
   * Генерирует Access Token (короткоживущий)
   */
  generateAccessToken(
    userId: Types.ObjectId | string,
    telegramId: string
  ): string {
    const payload: JWTPayload = {
      userId: userId.toString(),
      telegramId,
      type: "access",
    };

    return jwt.sign(payload, this.secret, {
      expiresIn: this.accessExpiry,
      issuer: "xray-provisioner",
      audience: "telegram-mini-app",
    });
  }

  /**
   * Генерирует Refresh Token (долгоживущий)
   */
  generateRefreshToken(
    userId: Types.ObjectId | string,
    telegramId: string
  ): string {
    const payload: JWTPayload = {
      userId: userId.toString(),
      telegramId,
      type: "refresh",
    };

    return jwt.sign(payload, this.secret, {
      expiresIn: this.refreshExpiry,
      issuer: "xray-provisioner",
      audience: "telegram-mini-app",
    });
  }

  /**
   * Проверяет Access Token
   */
  verifyAccessToken(token: string): JWTPayload {
    try {
      const payload = jwt.verify(token, this.secret, {
        issuer: "xray-provisioner",
        audience: "telegram-mini-app",
      }) as JWTPayload;

      if (payload.type !== "access") {
        throw new Error("Invalid token type");
      }

      return payload;
    } catch (error: any) {
      if (error.name === "TokenExpiredError") {
        throw new Error("Access token expired");
      }
      throw new Error("Invalid access token");
    }
  }

  /**
   * Проверяет Refresh Token
   */
  verifyRefreshToken(token: string): JWTPayload {
    try {
      const payload = jwt.verify(token, this.secret, {
        issuer: "xray-provisioner",
        audience: "telegram-mini-app",
      }) as JWTPayload;

      if (payload.type !== "refresh") {
        throw new Error("Invalid token type");
      }

      return payload;
    } catch (error: any) {
      if (error.name === "TokenExpiredError") {
        throw new Error("Refresh token expired");
      }
      throw new Error("Invalid refresh token");
    }
  }

  /**
   * Генерирует пару токенов
   */
  generateTokenPair(userId: Types.ObjectId | string, telegramId: string) {
    return {
      accessToken: this.generateAccessToken(userId, telegramId),
      refreshToken: this.generateRefreshToken(userId, telegramId),
    };
  }

  /**
   * Извлекает токен из Authorization header
   */
  extractBearerToken(authHeader?: string): string {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("Missing or invalid Authorization header");
    }
    return authHeader.substring(7);
  }
}

/**
 * Middleware для Express: проверяет JWT Access Token
 */
export function createJWTMiddleware(jwtService: JWTService) {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      const token = jwtService.extractBearerToken(authHeader);
      const payload = jwtService.verifyAccessToken(token);

      req.userId = payload.userId;
      req.telegramId = payload.telegramId;
      req.jwtPayload = payload;

      next();
    } catch (error: any) {
      return res.status(401).json({ error: error.message || "Unauthorized" });
    }
  };
}
