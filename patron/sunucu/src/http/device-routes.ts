// Bildirim cihazı rotaları — hesap API'si tablosunun parçası (`API_ROUTES`e yayılır); servis `services/device.service.ts`.
import { z } from "zod";
import { deactivateDevice, listDevices, registerDevice, releaseDeviceByToken } from "../services/device.service";
import { body, param, s, type ApiRouteDef } from "./api-route-kit";

export const DEVICE_ROUTES: readonly ApiRouteDef[] = [
  {
    method: "post",
    path: "/cihazlar",
    auth: "OTURUM",
    kimlik: { muaf: "push belirteci doğal kimliktir (tesis + belirteç özeti TEKİL); tekrar aynı satırı günceller" },
    handler: async (c) => {
      const b = body(c, z.strictObject({ platform: z.enum(["ios", "android", "web"]), belirtec: z.string().min(8).max(4096), ad: z.string().trim().min(1).max(120).optional() }));
      return { status: 201, data: await registerDevice(c.ctx, s(c), { platform: b.platform, token: b.belirtec, ...(b.ad ? { ad: b.ad } : {}) }) };
    },
  },
  { method: "get", path: "/cihazlar", auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => ({ data: await listDevices(c.ctx, s(c)) }) },
  {
    method: "post",
    path: "/cihazlar/birak",
    auth: "OTURUM",
    kimlik: { muaf: "çıkışta belirteç özetiyle kendi etkin satırları pasife çeker; tekrarı 0 döner" },
    handler: async (c) => {
      const b = body(c, z.strictObject({ belirtec: z.string().min(8).max(4096) }));
      return { data: await releaseDeviceByToken(c.ctx, s(c), b.belirtec) };
    },
  },
  {
    method: "post",
    path: "/cihazlar/:id/kaldir",
    auth: "OTURUM",
    kimlik: { muaf: "atomik claim active → pasif; tekrarı aynı sonuç" },
    handler: async (c) => ({ data: await deactivateDevice(c.ctx, s(c), param(c, "id")) }),
  },
];
