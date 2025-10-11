import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import rateLimit from "express-rate-limit";

import { createUsersRouter } from "./http/routes/users.js";
import { createAuthRouter } from "./http/routes/auth.js";
import { createAccountsRouter } from "./http/routes/accounts.js";
import { createJWTMiddleware, JWTService } from "./auth/jwtService.js";
import { XrayService } from "./services/xrayService.js";

export interface AppOptions {
  service: XrayService;
  jwtService: JWTService;
  botToken?: string;
  apiToken: string;
  corsOrigin?: string;
}

function createAuthMiddleware(apiToken: string) {
  if (!apiToken) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  return (req: Request, res: Response, next: NextFunction) => {
    const hdr = req.headers["authorization"] || "";
    const want = `Bearer ${apiToken}`;
    if (hdr !== want) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return next();
  };
}

export function createApp(options: AppOptions) {
  const { service, jwtService, botToken, apiToken, corsOrigin } = options;
  const app = express();

  const trustProxyEnv = process.env.TRUST_PROXY?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (trustProxyEnv && trustProxyEnv.length > 0) {
    app.set("trust proxy", trustProxyEnv);
  } else {
    app.set("trust proxy", false);
  }
  app.use(helmet());
  app.use(express.json());
  app.use(morgan("combined"));

  if (corsOrigin) {
    app.use(
      cors({
        origin: corsOrigin.split(",").map((s) => s.trim()),
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
          "Content-Type",
          "Authorization",
          "Telegram-Web-App-Data",
        ],
      })
    );
  }

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.method === "OPTIONS",
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const requireApiTokenAuth = createAuthMiddleware(apiToken);
  const requireJWTAuth = createJWTMiddleware(jwtService);

  if (botToken) {
    app.use(
      "/auth",
      createAuthRouter({
        jwtService,
        botToken,
        requireAuth: requireJWTAuth,
      })
    );
  }

  app.use(
    "/api/accounts",
    requireJWTAuth,
    createAccountsRouter(service, { requireAuth: requireJWTAuth })
  );

  app.use("/", createUsersRouter(service, { requireAuth: requireApiTokenAuth }));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[ERROR]", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  });

  return app;
}
