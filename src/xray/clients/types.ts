import type { InboundInfo } from "../inbound";

export interface AddUserParams {
  tag: string;
  email: string;
  uuid: string;
  flow?: string;
  level?: number;
}

export interface XrayClient {
  readonly mode: "sdk" | "grpc";
  addUser(params: AddUserParams): Promise<void>;
  removeUser(tag: string, email: string): Promise<void>;
  getTraffic(email: string, reset: boolean): Promise<{
    uplink: number;
    downlink: number;
  }>;
}

export interface CreateLinkParams {
  email: string;
  flow?: string;
  remark?: string;
  inbound: InboundInfo;
  publicHost: string;
}
