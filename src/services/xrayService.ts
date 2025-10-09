import { v4 as uuidv4 } from "uuid";
import { Types } from "mongoose";

import { buildVlessURI, InboundInfo } from "../xray/inbound.js";
import { createSdkClient } from "../xray/clients/sdkClient.js";
import { createGrpcClient } from "../xray/clients/grpcClient.js";
import type { XrayClient } from "../xray/clients/types.js";
import {
  VlessAccount,
  getUserAccountsCount,
  saveTrafficSnapshot,
} from "../models/index.js";

export interface XrayServiceOptions {
  inbound: InboundInfo;
  publicHost: string;
  defaultFlow: string;
  grpcHost: string;
  grpcPort: string | number;
  protoFiles: string[];
  maxAccountsPerUser?: number;
  defaultExpiryDays?: number;
}

export interface XrayServiceDependencies {
  createSdkClient?: typeof createSdkClient;
  createGrpcClient?: typeof createGrpcClient;
  uuid?: () => string;
}

export interface CreateUserInput {
  userId: Types.ObjectId | string;
  telegramId: string;
  flow?: string;
  remark?: string;
}

export interface CreateAdminUserInput {
  email: string;
  flow?: string;
  remark?: string;
}

export interface CreateUserResult {
  id: string;
  uuid: string;
  email: string;
  inboundTag: string;
  port: number;
  security: string;
  link: string;
  qrCode?: string;
  raw: Record<string, any>;
  expiresAt?: Date;
}

export class XrayService {
  private readonly client: XrayClient;
  private readonly inbound: InboundInfo;
  private readonly publicHost: string;
  private readonly defaultFlow: string;
  private readonly uuidFn: () => string;
  private readonly maxAccountsPerUser: number;
  private readonly defaultExpiryDays: number;

  private constructor(
    client: XrayClient,
    options: XrayServiceOptions,
    uuidFn: () => string
  ) {
    this.client = client;
    this.inbound = options.inbound;
    this.publicHost = options.publicHost;
    this.defaultFlow = options.defaultFlow;
    this.uuidFn = uuidFn;
    this.maxAccountsPerUser = options.maxAccountsPerUser || 5;
    this.defaultExpiryDays = options.defaultExpiryDays || 30;
  }

  static async create(
    options: XrayServiceOptions,
    deps: XrayServiceDependencies = {}
  ): Promise<XrayService> {
    const {
      createSdkClient: createSdk = createSdkClient,
      createGrpcClient: createGrpc = createGrpcClient,
      uuid = uuidv4,
    } = deps;

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

  /**
   * Создаёт новый VLESS аккаунт с привязкой к Telegram пользователю
   */
  async createUser(input: CreateUserInput): Promise<CreateUserResult> {
    this.ensurePublicHost();

    const userId =
      typeof input.userId === "string"
        ? new Types.ObjectId(input.userId)
        : input.userId;

    // Проверка лимита аккаунтов
    const existingCount = await getUserAccountsCount(userId);
    if (existingCount >= this.maxAccountsPerUser) {
      throw new Error(
        `Maximum ${this.maxAccountsPerUser} accounts per user allowed`
      );
    }

    const uuid = this.uuidFn();
    const email = `tg${input.telegramId}_${Date.now()}@app`;
    const flow = input.flow || this.defaultFlow;

    // Добавляем пользователя в Xray через gRPC
    await this.client.addUser({
      tag: this.inbound.tag,
      email,
      uuid,
      flow,
      level: 0,
    });

    // Строим VLESS ссылку
    const { link, raw } = buildVlessURI({
      uuid,
      email,
      flow,
      remark: input.remark,
      inbound: this.inbound,
      publicHost: this.publicHost,
    });

    // Вычисляем дату истечения
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.defaultExpiryDays);

    // Сохраняем в MongoDB
    const account = await VlessAccount.create({
      userId,
      telegramId: input.telegramId,
      email,
      uuid,
      flow,
      remark: input.remark,
      inboundTag: this.inbound.tag,
      port: this.inbound.port,
      security: this.inbound.security,
      link,
      rawConfig: raw,
      isActive: true,
      expiresAt,
    });

    return {
      id: account._id.toString(),
      uuid,
      email,
      inboundTag: this.inbound.tag,
      port: this.inbound.port,
      security: this.inbound.security,
      link,
      raw,
      expiresAt,
    };
  }

  async createAdminUser(
    input: CreateAdminUserInput
  ): Promise<CreateUserResult> {
    this.ensurePublicHost();

    const uuid = this.uuidFn();
    const email = input.email;
    const flow = input.flow || this.defaultFlow;

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
      id: email,
      uuid,
      email,
      inboundTag: this.inbound.tag,
      port: this.inbound.port,
      security: this.inbound.security,
      link,
      raw,
    };
  }

  /**
   * Удаляет аккаунт по ID (с проверкой владельца)
   */
  async deleteUser(accountId: string, telegramId: string): Promise<void> {
    const account = await VlessAccount.findOne({
      _id: accountId,
      telegramId,
      isActive: true,
    });

    if (!account) {
      throw new Error("Account not found or access denied");
    }

    // Удаляем из Xray
    await this.client.removeUser(account.inboundTag, account.email);

    // Помечаем как неактивный (soft delete)
    account.isActive = false;
    await account.save();
  }

  async deleteUserByEmail(email: string): Promise<void> {
    await this.client.removeUser(this.inbound.tag, email);
  }

  /**
   * Получает статистику трафика аккаунта
   */
  async getTraffic(
    accountId: string,
    telegramId: string,
    reset: boolean = false
  ) {
    const account = await VlessAccount.findOne({
      _id: accountId,
      telegramId,
      isActive: true,
    });

    if (!account) {
      throw new Error("Account not found or access denied");
    }

    // Получаем данные из Xray
    const stats = await this.client.getTraffic(account.email, reset);

    // Сохраняем снимок в БД
    await saveTrafficSnapshot(
      account._id,
      account.email,
      stats.uplink,
      stats.downlink
    );

    return {
      accountId: account._id.toString(),
      email: account.email,
      uplink: stats.uplink,
      downlink: stats.downlink,
      total: stats.uplink + stats.downlink,
      resetApplied: reset,
    };
  }

  async getTrafficByEmail(email: string, reset: boolean = false) {
    const stats = await this.client.getTraffic(email, reset);

    return {
      email,
      uplink: stats.uplink,
      downlink: stats.downlink,
      total: stats.uplink + stats.downlink,
      resetApplied: reset,
    };
  }

  /**
   * Получает все аккаунты пользователя
   */
  async getUserAccounts(telegramId: string) {
    const accounts = await VlessAccount.find({
      telegramId,
      isActive: true,
    }).sort({ createdAt: -1 });

    return accounts.map((acc) => ({
      id: acc._id.toString(),
      email: acc.email,
      uuid: acc.uuid,
      remark: acc.remark,
      link: acc.link,
      flow: acc.flow,
      security: acc.security,
      port: acc.port,
      createdAt: acc.createdAt,
      expiresAt: acc.expiresAt,
      isActive: acc.isActive,
    }));
  }

  /**
   * Обновляет remark аккаунта
   */
  async updateAccountRemark(
    accountId: string,
    telegramId: string,
    remark: string
  ): Promise<void> {
    const account = await VlessAccount.findOne({
      _id: accountId,
      telegramId,
      isActive: true,
    });

    if (!account) {
      throw new Error("Account not found or access denied");
    }

    account.remark = remark;

    // Пересобираем ссылку с новым remark
    const { link, raw } = buildVlessURI({
      uuid: account.uuid,
      email: account.email,
      flow: account.flow,
      remark,
      inbound: this.inbound,
      publicHost: this.publicHost,
    });

    account.link = link;
    account.rawConfig = raw;
    await account.save();
  }
}
