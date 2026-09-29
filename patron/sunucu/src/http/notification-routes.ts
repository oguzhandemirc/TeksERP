// Bildirim ayarları ve geçmişi rotaları (B5) — hesap API'si tablosunun parçası (`API_ROUTES`e yayılır).
import { z } from "zod";
import { SettingsSchema } from "../catalog/notifications";
import { getSettingsView, listOwnNotifications, setFacilityDefaults, setOwnSettings } from "../services/notification-settings.service";
import { body, page, s, uuidCursor, webPushKey, type ApiRouteDef } from "./api-route-kit";

export const NOTIFICATION_ROUTES: readonly ApiRouteDef[] = [
  { method: "get", path: "/bildirim/ayarlar", auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => ({ data: await getSettingsView(c.ctx, s(c), webPushKey(c)) }) },
  {
    method: "post",
    path: "/bildirim/ayarlar",
    auth: "OTURUM",
    kimlik: { muaf: "hesabın kendi ayarının TAM yerine konması; tekrarı aynı sonuç" },
    handler: async (c) => ({ data: await setOwnSettings(c.ctx, s(c), body(c, z.strictObject({ ayarlar: SettingsSchema.nullable() })).ayarlar, webPushKey(c)) }),
  },
  {
    method: "post",
    path: "/bildirim/tesis-varsayilani",
    auth: "OTURUM",
    kimlik: { muaf: "tesis varsayılanının TAM yerine konması (bulut:hesap:yonet); tekrarı aynı sonuç" },
    handler: async (c) => ({ data: await setFacilityDefaults(c.ctx, s(c), body(c, z.strictObject({ ayarlar: SettingsSchema })).ayarlar, webPushKey(c)) }),
  },
  {
    method: "get",
    path: "/bildirimler",
    auth: "OTURUM",
    kimlik: "OKUMA",
    handler: async (c) => {
      const { cursor, limit } = page(c);
      return { data: await listOwnNotifications(c.ctx, s(c), { cursor: uuidCursor(cursor), limit }) };
    },
  },
];
