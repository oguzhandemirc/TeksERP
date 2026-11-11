// Tezgâh yük çizelgesi istemcisi — salt okuma (izin `weavingorder:read`, modül kapısı backend `requireDokumaEnabled`).
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { LoomLoadResponse } from "./types";

export const loomLoadService = {
  get: (): Promise<LoomLoadResponse> =>
    apiClient.get<ApiResponse<LoomLoadResponse>>("/api/weaving-orders/loom-load").then((r) => r.data.data),
};
