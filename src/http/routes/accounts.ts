import { Router, Request, Response } from "express";
import QRCode from "qrcode";
import { XrayService } from "../../services/xrayService.js";
import { Traffic } from "../../models/index.js";

export interface AccountsRouteOptions {
  requireAuth: (req: Request, res: Response, next: any) => void;
}

export function createAccountsRouter(
  service: XrayService,
  options: AccountsRouteOptions
) {
  const router = Router();
  const { requireAuth } = options;

  /**
   * GET /api/accounts
   * Получить все аккаунты текущего пользователя
   */
  router.get("/", requireAuth, async (req: any, res: Response) => {
    try {
      const accounts = await service.getUserAccounts(req.telegramId);

      // Добавляем трафик из кэша
      const accountsWithTraffic = await Promise.all(
        accounts.map(async (acc) => {
          const traffic = await Traffic.findOne({ email: acc.email });
          return {
            ...acc,
            traffic: traffic
              ? {
                  uplink: traffic.uplink,
                  downlink: traffic.downlink,
                  total: traffic.total,
                  lastReset: traffic.lastReset,
                }
              : { uplink: 0, downlink: 0, total: 0 },
          };
        })
      );

      res.json({
        accounts: accountsWithTraffic,
        total: accountsWithTraffic.length,
      });
    } catch (error: any) {
      console.error("[GET /api/accounts] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  /**
   * POST /api/accounts
   * Создать новый аккаунт
   */
  router.post("/", requireAuth, async (req: any, res: Response) => {
    try {
      const { remark, flow } = req.body;

      const result = await service.createUser({
        userId: req.userId,
        telegramId: req.telegramId,
        flow,
        remark,
      });

      res.status(201).json(result);
    } catch (error: any) {
      console.error("[POST /api/accounts] error:", error);
      const msg = error.message || "Internal error";
      const code = /maximum|limit|not found/i.test(msg) ? 400 : 500;
      res.status(code).json({ error: msg });
    }
  });

  /**
   * GET /api/accounts/:id
   * Получить детали аккаунта
   */
  router.get("/:id", requireAuth, async (req: any, res: Response) => {
    try {
      const accounts = await service.getUserAccounts(req.telegramId);
      const account = accounts.find((a) => a.id === req.params.id);

      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      // Получаем актуальный трафик из Xray
      const trafficData = await service.getTraffic(
        account.id,
        req.telegramId,
        false
      );

      res.json({
        ...account,
        traffic: {
          uplink: trafficData.uplink,
          downlink: trafficData.downlink,
          total: trafficData.total,
        },
      });
    } catch (error: any) {
      console.error("[GET /api/accounts/:id] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  /**
   * PATCH /api/accounts/:id
   * Обновить аккаунт (remark)
   */
  router.patch("/:id", requireAuth, async (req: any, res: Response) => {
    try {
      const { remark } = req.body;

      if (!remark || typeof remark !== "string") {
        return res.status(400).json({ error: "remark is required" });
      }

      await service.updateAccountRemark(req.params.id, req.telegramId, remark);

      res.json({ ok: true, message: "Remark updated" });
    } catch (error: any) {
      console.error("[PATCH /api/accounts/:id] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  /**
   * DELETE /api/accounts/:id
   * Удалить аккаунт
   */
  router.delete("/:id", requireAuth, async (req: any, res: Response) => {
    try {
      await service.deleteUser(req.params.id, req.telegramId);
      res.json({ ok: true, message: "Account deleted" });
    } catch (error: any) {
      console.error("[DELETE /api/accounts/:id] error:", error);
      const msg = error.message || "Internal error";
      const code = /not found|access denied/i.test(msg) ? 404 : 500;
      res.status(code).json({ error: msg });
    }
  });

  /**
   * GET /api/accounts/:id/traffic
   * Получить статистику трафика
   */
  router.get("/:id/traffic", requireAuth, async (req: any, res: Response) => {
    try {
      const reset = String(req.query.reset || "false") === "true";
      const trafficData = await service.getTraffic(
        req.params.id,
        req.telegramId,
        reset
      );

      // Получаем историю из БД
      const traffic = await Traffic.findOne({ accountId: req.params.id });
      const history = traffic?.history || [];

      res.json({
        ...trafficData,
        history: history.slice(-7).map((h) => ({
          date: h.date,
          uplink: h.uplink,
          downlink: h.downlink,
          total: h.uplink + h.downlink,
        })),
      });
    } catch (error: any) {
      console.error("[GET /api/accounts/:id/traffic] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  /**
   * POST /api/accounts/:id/traffic/reset
   * Сбросить счётчики трафика
   */
  router.post(
    "/:id/traffic/reset",
    requireAuth,
    async (req: any, res: Response) => {
      try {
        const trafficData = await service.getTraffic(
          req.params.id,
          req.telegramId,
          true
        );

        res.json({
          ok: true,
          message: "Traffic counters reset",
          traffic: trafficData,
        });
      } catch (error: any) {
        console.error("[POST /api/accounts/:id/traffic/reset] error:", error);
        res.status(500).json({ error: error.message || "Internal error" });
      }
    }
  );

  /**
   * GET /api/accounts/:id/qr
   * Получить QR-код для ссылки
   */
  router.get("/:id/qr", requireAuth, async (req: any, res: Response) => {
    try {
      const accounts = await service.getUserAccounts(req.telegramId);
      const account = accounts.find((a) => a.id === req.params.id);

      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      const qrDataURL = await QRCode.toDataURL(account.link, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 512,
      });

      res.json({
        qrCode: qrDataURL,
        link: account.link,
      });
    } catch (error: any) {
      console.error("[GET /api/accounts/:id/qr] error:", error);
      res.status(500).json({ error: error.message || "Internal error" });
    }
  });

  return router;
}
