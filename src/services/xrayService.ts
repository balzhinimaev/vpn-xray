import { v4 as uuidv4 } from "uuid";

import { buildVlessURI, InboundInfo } from "../xray/inbound";
import { createSdkClient } from "../xray/clients/sdkClient";
import { createGrpcClient } from "../xray/clients/grpcClient";
import type { XrayClient } from "../xray/clients/types";

export interface XrayServiceOptions {
  inbound: InboundInfo;
  publicHost: string;
  defaultFlow: string;
  grpcHost: string;
  grpcPort: string | number;
  protoFiles: string[];
}

export interface XrayServiceDependencies {
  createSdkClient?: typeof createSdkClient;
  createGrpcClient?: typeof createGrpcClient;
  uuid?: () => string;
}

export interface CreateUserInput {
  email: string;
  flow?: string;
  remark?: string;
}

export interface CreateUserResult {
  uuid: string;
  email: string;
  inboundTag: string;
  port: number;
  security: string;
  link: string;
  raw: Record<string, any>;
}

export class XrayService {
  private readonly client: XrayClient;
  private readonly inbound: InboundInfo;
  private readonly publicHost: string;
  private readonly defaultFlow: string;
  private readonly uuidFn: () => string;

  private constructor(client: XrayClient, options: XrayServiceOptions, uuidFn: () => string) {
    this.client = client;
    this.inbound = options.inbound;
    this.publicHost = options.publicHost;
    this.defaultFlow = options.defaultFlow;
    this.uuidFn = uuidFn;
  }

  static async create(
    options: XrayServiceOptions,
    deps: XrayServiceDependencies = {}
  ): Promise<XrayService> {
    const { createSdkClient: createSdk = createSdkClient, createGrpcClient: createGrpc = createGrpcClient, uuid = uuidv4 } =
      deps;

    const sdkClient = await createSdk({
      host: options.grpcHost,
      port: options.grpcPort,
    }).catch(() => null);

    const client =
      sdkClient ||
      createGrpc({
        host: options.grpcHost,
        port: options.grpcPort,
        protoFiles: options.protoFiles,
      });

    return new XrayService(client, options, uuid);
  }

  get mode(): "sdk" | "grpc" {
    return this.client.mode;
  }

  getInboundInfo(): InboundInfo {
    return this.inbound;
  }

  getPublicHost(): string {
    return this.publicHost;
  }

  ensurePublicHost(): void {
    if (!this.publicHost) {
      throw new Error("Set X_PUBLIC_HOST to build VLESS URIs");
    }
  }

  async createUser(input: CreateUserInput): Promise<CreateUserResult> {
    this.ensurePublicHost();

    const email = input.email;
    const flow = input.flow || this.defaultFlow;
    const uuid = this.uuidFn();

    await this.client.addUser({
      tag: this.inbound.tag,
      email,
      uuid,
      flow,
      level: 0,
    });

    const { link, raw } = buildVlessURI({
      uuid,
      email,
      flow,
      remark: input.remark,
      inbound: this.inbound,
      publicHost: this.publicHost,
    });

    return {
      uuid,
      email,
      inboundTag: this.inbound.tag,
      port: this.inbound.port,
      security: this.inbound.security,
      link,
      raw,
    };
  }

  async deleteUser(email: string): Promise<void> {
    await this.client.removeUser(this.inbound.tag, email);
  }

  async getTraffic(email: string, reset: boolean) {
    return this.client.getTraffic(email, reset);
  }
}
