import path from "path";
import dotenv from "dotenv";

dotenv.config();

const HTTP_ADDR = process.env.HTTP_ADDR || "127.0.0.1:8080";
const [HTTP_HOST, HTTP_PORT_STR] = HTTP_ADDR.split(":");
const HTTP_PORT = Number(HTTP_PORT_STR || "8080");

const GRPC_ADDR = process.env.GRPC_ADDR || "127.0.0.1:10085";
const [GRPC_HOST, GRPC_PORT_STR] = GRPC_ADDR.split(":");
const GRPC_PORT = GRPC_PORT_STR || "10085";

const CONFIG_PATH =
  process.env.CONFIG_PATH || "/usr/local/etc/xray/config.json";

const DEFAULT_FLOW = process.env.X_DEFAULT_FLOW || "xtls-rprx-vision";
const API_TOKEN = process.env.API_TOKEN || "";
const INBOUND_TAG = process.env.X_IN_TAG;
const PUBLIC_HOST = process.env.X_PUBLIC_HOST || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN;
const PROTO_DIR = path.resolve(process.cwd(), "proto");
const PROTO_FILES = [
  path.join(PROTO_DIR, "app/proxyman/command/command.proto"),
  path.join(PROTO_DIR, "app/stats/command/command.proto"),
  path.join(PROTO_DIR, "common/serial/typed_message.proto"),
  path.join(PROTO_DIR, "common/protocol/user.proto"),
  path.join(PROTO_DIR, "proxy/vless/account.proto"),
];

export const config = {
  HTTP_ADDR,
  HTTP_HOST,
  HTTP_PORT,
  GRPC_ADDR,
  GRPC_HOST,
  GRPC_PORT,
  CONFIG_PATH,
  DEFAULT_FLOW,
  API_TOKEN,
  INBOUND_TAG,
  PUBLIC_HOST,
  CORS_ORIGIN,
  PROTO_FILES,
} as const;

export type AppConfig = typeof config;
