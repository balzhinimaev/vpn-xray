import { config } from "./config";
import { pickVlessInbound } from "./xray/inbound";
import { XrayService } from "./services/xrayService";
import { createApp } from "./app";
import { firstExternalIPv4 } from "./utils/network";

async function bootstrap() {
  const inbound = pickVlessInbound(config.INBOUND_TAG);
  const publicHost = config.PUBLIC_HOST || firstExternalIPv4() || "";

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

  const service = await XrayService.create({
    inbound,
    publicHost,
    defaultFlow: config.DEFAULT_FLOW,
    grpcHost: config.GRPC_HOST,
    grpcPort: config.GRPC_PORT,
    protoFiles: config.PROTO_FILES,
  });

  const app = createApp({
    service,
    apiToken: config.API_TOKEN,
    corsOrigin: config.CORS_ORIGIN,
  });

  app.listen(config.HTTP_PORT, config.HTTP_HOST, () => {
    console.log(
      `[BOOT] xray-provisioner listening on http://${config.HTTP_HOST}:${config.HTTP_PORT}`
    );
    console.log(
      `[BOOT] gRPC target ${config.GRPC_ADDR} — mode: ${service.mode === "sdk" ? "SDK" : "Proto"}`
    );
    if (config.API_TOKEN) {
      console.log("[BOOT] Bearer auth is ENABLED");
    } else {
      console.log("[BOOT] WARNING: API_TOKEN is empty, endpoints are NOT protected!");
    }
  });
}

bootstrap().catch((err) => {
  console.error("[BOOT] Failed to start application", err);
  process.exitCode = 1;
});
