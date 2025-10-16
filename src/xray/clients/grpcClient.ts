import fs from "fs";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

import type { XrayClient, AddUserParams } from "./types.js";

export interface GrpcClientOptions {
  host: string;
  port: string | number;
  protoFiles: string[];
}

export interface GrpcClientDependencies {
  fs?: Pick<typeof fs, "existsSync">;
  grpc?: typeof grpc;
  protoLoader?: typeof protoLoader;
  logger?: Pick<Console, "warn">;
}

const defaultDeps: Required<GrpcClientDependencies> = {
  fs,
  grpc,
  protoLoader,
  logger: console,
};

export function createGrpcClient(
  options: GrpcClientOptions,
  deps: GrpcClientDependencies = {}
): XrayClient {
  const { host, port, protoFiles } = options;
  const {
    fs: fsModule = defaultDeps.fs,
    grpc: grpcModule = defaultDeps.grpc,
    protoLoader: loader = defaultDeps.protoLoader,
    logger = defaultDeps.logger,
  } = deps;

  const protoAvailable = protoFiles.every((file) => fsModule.existsSync(file));
  if (!protoAvailable && logger) {
    logger.warn("[gRPC] proto files not found. Run: npm run proto:fetch");
  }

  const definition = loader.loadSync(protoFiles, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const rootPkg = grpcModule.loadPackageDefinition(definition) as any;
  const handlerSvc = rootPkg.xray?.app?.proxyman?.command?.HandlerService;
  const statsSvc = rootPkg.xray?.app?.stats?.command?.StatsService;
  if (!handlerSvc || !statsSvc) {
    throw new Error("Failed to load gRPC services from proto.");
  }

  const handlerClient = new handlerSvc(`${host}:${port}`, grpcModule.credentials.createInsecure());
  const statsClient = new statsSvc(`${host}:${port}`, grpcModule.credentials.createInsecure());

  return {
    mode: "grpc",
    async addUser(params: AddUserParams): Promise<void> {
      const TypedMessage = rootPkg.xray.common.serial.TypedMessage;
      const User = rootPkg.xray.common.protocol.User;
      const VlessAccount = rootPkg.xray.proxy.vless.Account;
      const AddUserOperation = rootPkg.xray.app.proxyman.command.AddUserOperation;

      const accountBuf: Buffer = VlessAccount.encode({
        id: params.uuid,
        flow: params.flow || "",
      }).finish();
      const accountTyped = TypedMessage.create({
        type: "xray.proxy.vless.Account",
        value: accountBuf,
      });

      const userMsg = User.create({
        level: params.level ?? 0,
        email: params.email,
        account: accountTyped,
      });

      const opBuf: Buffer = AddUserOperation.encode({
        inboundTag: params.tag,
        user: userMsg,
      }).finish();
      const opTyped = TypedMessage.create({
        type: "xray.app.proxyman.command.AddUserOperation",
        value: opBuf,
      });

      const req = { operation: opTyped };
      await new Promise<void>((resolve, reject) => {
        handlerClient.AlterInbound(req, (err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
    },
    async removeUser(tag: string, email: string): Promise<void> {
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
        handlerClient.AlterInbound(req, (err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
    },
    async getTraffic(email: string, reset: boolean) {
      const getOne = (name: string): Promise<number> =>
        new Promise((resolve, reject) => {
          console.log(`[gRPC] Querying stat: ${name}`);
          statsClient.GetStats({ name, reset_: reset }, (err: any, resp: any) => {
            if (err) {
              console.error(`[gRPC] GetStats error for ${name}:`, err.message || err);
              return reject(err);
            }
            const value = Number(resp?.stat?.value || 0);
            console.log(`[gRPC] Stat ${name} = ${value}`);
            resolve(value);
          });
        });

      const uplink = await getOne(`user>>>${email}>>>traffic>>>uplink`);
      const downlink = await getOne(`user>>>${email}>>>traffic>>>downlink`);
      return { uplink, downlink };
    },
  };
}
