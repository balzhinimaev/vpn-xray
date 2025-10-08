import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import rateLimit from "express-rate-limit";

import { createUsersRouter } from "./http/routes/users";
import { XrayService } from "./services/xrayService";

export interface AppOptions {
  service: XrayService;
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
  const { service, apiToken, corsOrigin } = options;
  const app = express();

  app.set("trust proxy", true);
  app.use(helmet());
  app.use(express.json());
  app.use(morgan("combined"));

  if (corsOrigin) {
    app.use(
      cors({
        origin: corsOrigin.split(",").map((s) => s.trim()),
        credentials: false,
      })
    );
  }

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const requireAuth = createAuthMiddleware(apiToken);
  app.use("/", createUsersRouter(service, { requireAuth }));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[ERROR]", err);
    res.status(500).json({ error: err?.message || "Internal error" });
  });

  return app;
}
