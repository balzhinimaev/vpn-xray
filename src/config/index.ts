import path from "path";
import dotenv from "dotenv";
import type { SignOptions } from "jsonwebtoken";

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

// MongoDB
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/xray-provisioner";

// JWT
const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_ACCESS_EXPIRY: SignOptions["expiresIn"] =
  (process.env.JWT_ACCESS_EXPIRY || "15m") as SignOptions["expiresIn"];
const JWT_REFRESH_EXPIRY: SignOptions["expiresIn"] =
  (process.env.JWT_REFRESH_EXPIRY || "7d") as SignOptions["expiresIn"];

// Telegram
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const TELEGRAM_MINI_APP_URL = process.env.TELEGRAM_MINI_APP_URL || "";

// User Limits
const MAX_ACCOUNTS_PER_USER = parseInt(
  process.env.MAX_ACCOUNTS_PER_USER || "5",
  10
);
const DEFAULT_ACCOUNT_EXPIRY_DAYS = parseInt(
  process.env.DEFAULT_ACCOUNT_EXPIRY_DAYS || "30",
  10
);

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
  MONGO_URI,
  JWT_SECRET,
  JWT_ACCESS_EXPIRY,
  JWT_REFRESH_EXPIRY,
  BOT_TOKEN,
  TELEGRAM_MINI_APP_URL,
  MAX_ACCOUNTS_PER_USER,
  DEFAULT_ACCOUNT_EXPIRY_DAYS,
} as const;

export type AppConfig = typeof config;
