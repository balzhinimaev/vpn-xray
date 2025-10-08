import type { XrayClient, AddUserParams } from "./types.js";

export interface SdkClientOptions {
  host: string;
  port: string | number;
}

export interface SdkClientDependencies {
  loadSdk?: () => Promise<{ XtlsApi?: any }>;
  logger?: Pick<Console, "warn">;
}

const defaultDeps: Required<SdkClientDependencies> = {
  loadSdk: async () => await import("@remnawave/xtls-sdk"),
  logger: console,
};

export async function createSdkClient(
  options: SdkClientOptions,
  deps: SdkClientDependencies = {}
): Promise<XrayClient | null> {
  const { host, port } = options;
  const { loadSdk = defaultDeps.loadSdk, logger = defaultDeps.logger } = deps;

  try {
    const mod = await loadSdk();
    const Api = mod?.XtlsApi;
    if (!Api) return null;
    const sdkInstance = new Api(host, port);

    return {
      mode: "sdk",
      async addUser(params: AddUserParams): Promise<void> {
        const result = await sdkInstance.handler.addVlessUser({
          tag: params.tag,
          username: params.email,
          uuid: params.uuid,
          flow: params.flow,
          level: params.level ?? 0,
        });
        if (!result?.isOk) {
          throw new Error(result?.message || "SDK addVlessUser failed");
        }
      },
      async removeUser(tag: string, email: string): Promise<void> {
        const result = await sdkInstance.handler.removeUser(tag, email);
        if (!result?.isOk) {
          throw new Error(result?.message || "SDK removeUser failed");
        }
      },
      async getTraffic(email: string, reset: boolean) {
        if (!sdkInstance.stats?.getUserStats) {
          throw new Error("SDK stats.getUserStats is not available");
        }
        const result = await sdkInstance.stats.getUserStats(email, reset);
        if (!result?.isOk) {
          throw new Error(result?.message || "SDK getUserStats failed");
        }
        const data = result.data || {};
        return {
          uplink: Number(data.uplink || 0),
          downlink: Number(data.downlink || 0),
        };
      },
    } satisfies XrayClient;
  } catch (err: any) {
    if (logger && process.env.NODE_ENV !== "test") {
      logger.warn(`[SDK] Failed to initialise XTLS SDK: ${err?.message || err}`);
    }
    return null;
  }
}
