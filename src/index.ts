import fs from "fs";
import path from "path";
import os from "os";
import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import { execFileSync } from "child_process";

// Вариант A: готовый SDK
let XtlsApi: any | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  XtlsApi = (await import("@remnawave/xtls-sdk")).XtlsApi;
} catch (_) {
  XtlsApi = null;
}

// Вариант B: чистый gRPC через proto-loader
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

dotenv.config();

// === Env & constants ===
const HTTP_ADDR = process.env.HTTP_ADDR || "127.0.0.1:8080";
const [HTTP_HOST, HTTP_PORT_STR] = HTTP_ADDR.split(":");
const HTTP_PORT = Number(HTTP_PORT_STR || "8080");

const GRPC_ADDR = process.env.GRPC_ADDR || "127.0.0.1:10085";
const [GRPC_HOST, GRPC_PORT_STR] = GRPC_ADDR.split(":");
const GRPC_PORT = GRPC_PORT_STR || "10085";

const CONFIG_PATH = "/usr/local/etc/xray/config.json";
const API_TOKEN = process.env.API_TOKEN || "";
const DEFAULT_FLOW = process.env.X_DEFAULT_FLOW || "xtls-rprx-vision";

// === Helpers ===
function firstExternalIPv4(): string | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

function readXrayConfig(): any {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

function safe<T>(fn: () => T, fallback?: T): T | undefined {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

type InboundInfo = {
  tag: string;
  port: number;
  security: "reality" | "tls" | string;
  network: "ws" | "tcp" | string;
  sni?: string; // для REALITY берём serverNames[0], для TLS — X_PUBLIC_HOST либо tlsSettings.serverName
  pbk?: string; // для REALITY
  shortIds?: string[]; // для REALITY
  path?: string; // для WS
  hostHeader?: string; // для WS (headers.Host)
};

function pickVlessInbound(tagOverride?: string): InboundInfo {
  const cfg = readXrayConfig();
  const inbounds: any[] = cfg.inbounds || [];

  let inbound = tagOverride
    ? inbounds.find((i) => i.tag === tagOverride)
    : inbounds.find((i) => i.protocol === "vless");

  if (!inbound) {
    throw new Error(
      tagOverride
        ? `Inbound with tag=\"${tagOverride}\" not found in ${CONFIG_PATH}`
        : `No inbound with protocol=\"vless\" found in ${CONFIG_PATH}`
    );
  }

  const port: number = Number(inbound.port);
  const stream = inbound.streamSettings || {};
  const security: string = stream.security || "none";
  const network: string = stream.network || "tcp";

  // REALITY
  const reality = stream.realitySettings || {};
  const serverNames: string[] = reality.serverNames || [];
  const privateKey: string | undefined = reality.privateKey;
  const shortIds: string[] | undefined = reality.shortIds || [];

  // TLS
  const tls = stream.tlsSettings || {};
  const tlsServerName: string | undefined = tls.serverName;

  // WS
  const ws = stream.wsSettings || {};
  const wsPath: string | undefined = ws.path;
  const wsHeaders: Record<string, string> | undefined = ws.headers;

  const info: InboundInfo = {
    tag: inbound.tag,
    port,
    security,
    network,
    sni: undefined,
    pbk: undefined,
    shortIds,
    path: wsPath,
    hostHeader: wsHeaders?.Host || wsHeaders?.host,
  };

  if (security === "reality") {
    info.sni = serverNames?.[0];

    // pbk: из privateKey -> xray x25519 -i <privateKey>, иначе X_PBK
    const envPBK = process.env.X_PBK || "";
    if (privateKey) {
      try {
        const out = execFileSync("xray", ["x25519", "-i", privateKey], {
          encoding: "utf8",
        });
        // Ожидаем строку вида: Public key: <pbk>
        const m = out.match(/Public key:\s*([A-Za-z0-9+/=\-_]+)/i);
        if (m && m[1]) info.pbk = m[1].trim();
      } catch (e) {
        // Падать не будем: попробуем взять из ENV
        if (envPBK) info.pbk = envPBK;
      }
    } else if (envPBK) {
      info.pbk = envPBK;
    }
  } else if (security === "tls") {
    info.sni = tlsServerName || process.env.X_PUBLIC_HOST || undefined;
  }

  return info;
}

function buildVlessURI(opts: {
  uuid: string;
  email: string;
  flow?: string;
  remark?: string;
  inbound: InboundInfo;
  publicHost: string;
}): { link: string; raw: Record<string, any> } {
  const { uuid, email, flow, remark, inbound, publicHost } = opts;
  const params = new URLSearchParams();
  params.set("encryption", "none");
  if (flow) params.set("flow", flow);
  params.set("fp", "chrome");

  let type = inbound.network || "tcp";
  let sni = inbound.sni || publicHost;

  if (inbound.security === "reality") {
    params.set("security", "reality");
    params.set("type", "tcp");
    type = "tcp";
    if (sni) params.set("sni", sni);
    if (inbound.pbk) params.set("pbk", inbound.pbk);
    if (inbound.shortIds && inbound.shortIds.length > 0) {
      params.set("sid", inbound.shortIds[0] || "");
    } else {
      params.set("sid", "");
    }
  } else if (inbound.security === "tls") {
    params.set("security", "tls");
    if (sni) params.set("sni", sni);
    if (type === "ws") {
      params.set("type", "ws");
      if (inbound.path) params.set("path", inbound.path);
      if (inbound.hostHeader) params.set("host", inbound.hostHeader);
    } else {
      params.set("type", "tcp");
    }
  }

  const hash = encodeURIComponent(remark || email);
  const link = `vless://${uuid}@${publicHost}:${
    inbound.port
  }?${params.toString()}#${hash}`;

  const raw = {
    address: publicHost,
    port: inbound.port,
    security: inbound.security,
    type,
    sni,
    fp: "chrome",
    pbk: inbound.pbk,
    sid: inbound.shortIds?.[0] || "",
    path: inbound.path,
    host: inbound.hostHeader,
    flow,
  };

  return { link, raw };
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!API_TOKEN) return next(); // если токен не задан — не проверяем
  const hdr = req.headers["authorization"] || "";
  const want = `Bearer ${API_TOKEN}`;
  if (hdr !== want) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

// === gRPC clients (A/B) ===
const useSdk = !!XtlsApi; // приоритет — SDK

// Вариант A — SDK
const sdk = useSdk ? new XtlsApi(GRPC_HOST, GRPC_PORT) : null;

// Вариант B — чистые протки
const PROTO_DIR = path.resolve(process.cwd(), "proto");
const PROTO_FILES = [
  path.join(PROTO_DIR, "app/proxyman/command/command.proto"),
  path.join(PROTO_DIR, "app/stats/command/command.proto"),
  path.join(PROTO_DIR, "common/serial/typed_message.proto"),
  path.join(PROTO_DIR, "common/protocol/user.proto"),
  path.join(PROTO_DIR, "proxy/vless/account.proto"),
];
let rootPkg: any = null;
let handlerClient: any = null;
let statsClient: any = null;

function initGrpcFallbackIfNeeded() {
  if (useSdk) return; // не нужно
  // Загружаем proto динамически (требует scripts/proto:fetch)
  const ok = PROTO_FILES.every((p) => fs.existsSync(p));
  if (!ok) {
    console.warn("[gRPC-B] proto files not found. Run: npm run proto:fetch");
  }
  const def = protoLoader.loadSync(PROTO_FILES, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  rootPkg = grpc.loadPackageDefinition(def) as any;
  const handlerSvc = rootPkg.xray?.app?.proxyman?.command?.HandlerService;
  const statsSvc = rootPkg.xray?.app?.stats?.command?.StatsService;
  if (!handlerSvc || !statsSvc)
    throw new Error("Failed to load gRPC services from proto.");
  handlerClient = new handlerSvc(
    `${GRPC_HOST}:${GRPC_PORT}`,
    grpc.credentials.createInsecure()
  );
  statsClient = new statsSvc(
    `${GRPC_HOST}:${GRPC_PORT}`,
    grpc.credentials.createInsecure()
  );
}

async function grpcB_addVlessUser(
  tag: string,
  email: string,
  uuid: string,
  flow?: string
): Promise<void> {
  initGrpcFallbackIfNeeded();
  const TypedMessage = rootPkg.xray.common.serial.TypedMessage;
  const User = rootPkg.xray.common.protocol.User;
  const VlessAccount = rootPkg.xray.proxy.vless.Account;
  const AddUserOperation = rootPkg.xray.app.proxyman.command.AddUserOperation;

  // Account (VLESS)
  const accountBuf: Buffer = VlessAccount.encode({
    id: uuid,
    flow: flow || "",
  }).finish();
  const accountTyped = TypedMessage.create({
    type: "xray.proxy.vless.Account",
    value: accountBuf,
  });

  // User
  const userMsg = User.create({ level: 0, email, account: accountTyped });

  // Operation
  const opBuf: Buffer = AddUserOperation.encode({
    inboundTag: tag,
    user: userMsg,
  }).finish();
  const opTyped = TypedMessage.create({
    type: "xray.app.proxyman.command.AddUserOperation",
    value: opBuf,
  });

  const req = { operation: opTyped };

  await new Promise<void>((resolve, reject) => {
    handlerClient.AlterInbound(req, (err: any, _resp: any) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function grpcB_removeUser(tag: string, email: string): Promise<void> {
  initGrpcFallbackIfNeeded();
  const TypedMessage = rootPkg.xray.common.serial.TypedMessage;
  const RemoveUserOperation =
    rootPkg.xray.app.proxyman.command.RemoveUserOperation;
  const opBuf: Buffer = RemoveUserOperation.encode({
    inboundTag: tag,
    email,
  }).finish();
  const opTyped = TypedMessage.create({
    type: "xray.app.proxyman.command.RemoveUserOperation",
    value: opBuf,
  });
  const req = { operation: opTyped };
  await new Promise<void>((resolve, reject) => {
    handlerClient.AlterInbound(req, (err: any, _resp: any) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function grpcB_getUserTraffic(
  email: string,
  reset: boolean
): Promise<{ uplink: number; downlink: number }> {
  initGrpcFallbackIfNeeded();
  function getOne(name: string): Promise<number> {
    return new Promise((resolve, reject) => {
      statsClient.GetStats({ name, reset_: reset }, (err: any, resp: any) => {
        if (err) return reject(err);
        resolve(Number(resp?.stat?.value || 0));
      });
    });
  }
  const uplink = await getOne(`user>>>${email}>>>traffic>>>uplink`);
  const downlink = await getOne(`user>>>${email}>>>traffic>>>downlink`);
  return { uplink, downlink };
}

// === Startup: choose inbound, public host, log context ===
const inboundTagOverride = process.env.X_IN_TAG;
const inbound = pickVlessInbound(inboundTagOverride);

const publicHost = process.env.X_PUBLIC_HOST || firstExternalIPv4() || "";
if (!publicHost) {
  console.error(
    "[BOOT] X_PUBLIC_HOST is not set and no external IPv4 found. Set X_PUBLIC_HOST."
  );
}

console.log("[BOOT] Selected inbound:", {
  tag: inbound.tag,
  port: inbound.port,
  security: inbound.security,
  network: inbound.network,
  sni: inbound.sni,
  pbk: inbound.pbk ? "(found)" : "(none)",
  path: inbound.path,
});

// === Express app ===
const app = express();
app.set("trust proxy", true);
app.use(helmet());
app.use(express.json());
app.use(morgan("combined"));

// CORS (по умолчанию выключено)
if (process.env.CORS_ORIGIN) {
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN.split(",").map((s) => s.trim()),
      credentials: false,
    })
  );
}

// Rate limit 60 rpm/IP
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Health (не защищён)
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Инфо (защищён)
app.get("/info", requireAuth, (_req, res) => {
  if (!publicHost)
    return res
      .status(400)
      .json({ error: "Set X_PUBLIC_HOST to build VLESS URIs" });
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

// Добавление пользователя
app.post("/users", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!publicHost)
      return res
        .status(400)
        .json({ error: "X_PUBLIC_HOST is required (or set a public IPv4)." });

    const email: string = (
      req.body?.email || `user_${Date.now()}@app`
    ).toString();
    const flow: string | undefined = (req.body?.flow || DEFAULT_FLOW) as string;
    const remark: string | undefined = req.body?.remark;
    const uuid = uuidv4();

    if (useSdk && sdk) {
      const r = await sdk.handler.addVlessUser({
        tag: inbound.tag,
        username: email,
        uuid,
        flow,
        level: 0,
      });
      if (!r?.isOk) throw new Error(r?.message || "SDK addVlessUser failed");
    } else {
      await grpcB_addVlessUser(inbound.tag, email, uuid, flow);
    }

    const { link, raw } = buildVlessURI({
      uuid,
      email,
      flow,
      remark,
      inbound,
      publicHost,
    });

    res.json({
      uuid,
      email,
      inboundTag: inbound.tag,
      port: inbound.port,
      security: inbound.security,
      link,
      raw,
    });
  } catch (err: any) {
    console.error("[POST /users] error:", err);
    const msg = err?.details || err?.message || "Internal error";
    const code = /not found|invalid|required|missing/i.test(msg) ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});

// Удаление пользователя по email
app.delete(
  "/users/:email",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const email = decodeURIComponent(req.params.email);
      if (useSdk && sdk) {
        const r = await sdk.handler.removeUser(inbound.tag, email);
        if (!r?.isOk) throw new Error(r?.message || "SDK removeUser failed");
      } else {
        await grpcB_removeUser(inbound.tag, email);
      }
      res.json({ ok: true, email });
    } catch (err: any) {
      console.error("[DELETE /users/:email] error:", err);
      const msg = err?.details || err?.message || "Internal error";
      const code = /not found|invalid|required|missing/i.test(msg) ? 400 : 500;
      res.status(code).json({ error: msg });
    }
  }
);

// Трафик пользователя (байты), reset=true сбрасывает счётчики
app.get(
  "/users/:email/traffic",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const reset = String(req.query.reset || "false") === "true";

      if (useSdk && sdk?.stats?.getUserStats) {
        const r = await sdk.stats.getUserStats(email, reset);
        if (!r?.isOk) throw new Error(r?.message || "SDK getUserStats failed");
        const data = r.data || {};
        res.json({
          email,
          uplink: Number(data.uplink || 0),
          downlink: Number(data.downlink || 0),
          resetApplied: !!reset,
        });
        return;
      }

      const stats = await grpcB_getUserTraffic(email, reset);
      res.json({ email, ...stats, resetApplied: !!reset });
    } catch (err: any) {
      console.error("[GET /users/:email/traffic] error:", err);
      const msg = err?.details || err?.message || "Internal error";
      const code = /not found|invalid|required|missing/i.test(msg) ? 400 : 500;
      res.status(code).json({ error: msg });
    }
  }
);

// Глобальная ошибка
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[ERROR]", err);
  res.status(500).json({ error: err?.message || "Internal error" });
});

app.listen(HTTP_PORT, HTTP_HOST, () => {
  console.log(
    `[BOOT] xray-provisioner listening on http://${HTTP_HOST}:${HTTP_PORT}`
  );
  console.log(
    `[BOOT] gRPC target ${GRPC_ADDR} — mode: ${useSdk ? "SDK" : "Proto"}`
  );
  if (API_TOKEN) console.log("[BOOT] Bearer auth is ENABLED");
  else
    console.log(
      "[BOOT] WARNING: API_TOKEN is empty, endpoints are NOT protected!"
    );
});
