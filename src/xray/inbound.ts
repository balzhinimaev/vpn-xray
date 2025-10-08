import fs from "fs";
import { execFileSync } from "child_process";

import { config } from "../config/index.js";

export type InboundInfo = {
  tag: string;
  port: number;
  security: "reality" | "tls" | string;
  network: "ws" | "tcp" | string;
  sni?: string;
  pbk?: string;
  shortIds?: string[];
  path?: string;
  hostHeader?: string;
};

export function readXrayConfig(): any {
  const raw = fs.readFileSync(config.CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

export function pickVlessInbound(tagOverride?: string): InboundInfo {
  const cfg = readXrayConfig();
  const inbounds: any[] = cfg.inbounds || [];

  const inbound = tagOverride
    ? inbounds.find((i) => i.tag === tagOverride)
    : inbounds.find((i) => i.protocol === "vless");

  if (!inbound) {
    throw new Error(
      tagOverride
        ? `Inbound with tag="${tagOverride}" not found in ${config.CONFIG_PATH}`
        : `No inbound with protocol="vless" found in ${config.CONFIG_PATH}`
    );
  }

  const port: number = Number(inbound.port);
  const stream = inbound.streamSettings || {};
  const security: string = stream.security || "none";
  const network: string = stream.network || "tcp";

  const reality = stream.realitySettings || {};
  const serverNames: string[] = reality.serverNames || [];
  const privateKey: string | undefined = reality.privateKey;
  const shortIds: string[] | undefined = reality.shortIds || [];

  const tls = stream.tlsSettings || {};
  const tlsServerName: string | undefined = tls.serverName;

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

    const envPBK = process.env.X_PBK || "";
    if (privateKey) {
      try {
        const out = execFileSync("xray", ["x25519", "-i", privateKey], {
          encoding: "utf8",
        });
        const match = out.match(/Public key:\s*([A-Za-z0-9+/=\-_]+)/i);
        if (match && match[1]) info.pbk = match[1].trim();
      } catch (err) {
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

export function buildVlessURI(opts: {
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
