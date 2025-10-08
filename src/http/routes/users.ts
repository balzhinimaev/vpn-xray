import { Router, RequestHandler, Request, Response } from "express";

import { XrayService } from "../../services/xrayService.js";

export interface UsersRouteOptions {
  requireAuth?: RequestHandler;
}

function normalizeEmail(value: unknown): string {
  if (!value) {
    return `user_${Date.now()}@app`;
  }
  return value.toString();
}

export function createUsersRouter(
  service: XrayService,
  options: UsersRouteOptions = {}
) {
  const router = Router();
  const requireAuth = options.requireAuth ?? ((_req, _res, next) => next());

  router.get("/info", requireAuth, (_req: Request, res: Response) => {
    const inbound = service.getInboundInfo();
    const publicHost = service.getPublicHost();
    if (!publicHost) {
      return res
        .status(400)
        .json({ error: "Set X_PUBLIC_HOST to build VLESS URIs" });
    }

    res.json({
      inboundTag: inbound.tag,
      port: inbound.port,
      security: inbound.security,
      network: inbound.network,
      sni: inbound.sni,
      pbk: inbound.pbk,
      path: inbound.path,
      hostHeader: inbound.hostHeader,
      publicHost,
    });
  });

  router.post("/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const flow = req.body?.flow?.toString();
      const remark = req.body?.remark?.toString();

      const result = await service.createUser({ email, flow, remark });
      res.json(result);
    } catch (err: any) {
      console.error("[POST /users] error:", err);
      const msg = err?.details || err?.message || "Internal error";
      const code = /not found|invalid|required|missing/i.test(msg) ? 400 : 500;
      res.status(code).json({ error: msg });
    }
  });

  router.delete(
    "/users/:email",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const email = decodeURIComponent(req.params.email);
        await service.deleteUser(email);
        res.json({ ok: true, email });
      } catch (err: any) {
        console.error("[DELETE /users/:email] error:", err);
        const msg = err?.details || err?.message || "Internal error";
        const code = /not found|invalid|required|missing/i.test(msg) ? 400 : 500;
        res.status(code).json({ error: msg });
      }
    }
  );

  router.get(
    "/users/:email/traffic",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const email = decodeURIComponent(req.params.email);
        const reset = String(req.query.reset || "false") === "true";
        const stats = await service.getTraffic(email, reset);
        res.json({ email, ...stats, resetApplied: !!reset });
      } catch (err: any) {
        console.error("[GET /users/:email/traffic] error:", err);
        const msg = err?.details || err?.message || "Internal error";
        const code = /not found|invalid|required|missing/i.test(msg) ? 400 : 500;
        res.status(code).json({ error: msg });
      }
    }
  );

  return router;
}
