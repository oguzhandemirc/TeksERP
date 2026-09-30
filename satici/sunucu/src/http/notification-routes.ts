// BİLDİRİMLER rotaları (satıcı portalı, tailnet): kanal durumu · son bildirimler (salt okuma, `bildirim:oku`) ·
// deneme bildirimi (`bildirim:yonet`; giden kutusuna satır — gönderimi yan konteyner yapar, satıcı dışarı bağlanmaz).
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, NOTIFICATION_STATES } from "../notifications/catalog";
import { enqueueTestNotificationTx, listNotifications, notificationOverview } from "../notifications/portal-view";
import { ClientTokenSchema, bodyOf, pageQuery, portalAction, queryEnum, type PortalRouteDef } from "./portal-http";

const TokenOnly = z.strictObject({ clientToken: ClientTokenSchema });

export const NOTIFICATION_PORTAL_ROUTES: readonly PortalRouteDef[] = [
  {
    method: "get",
    path: "/bildirimler",
    permission: "bildirim:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({
      data: await listNotifications(prisma, {
        status: queryEnum(c.req, "durum", NOTIFICATION_STATES),
        channel: queryEnum(c.req, "kanal", NOTIFICATION_CHANNELS),
        event: queryEnum(c.req, "olay", NOTIFICATION_EVENTS),
        ...pageQuery(c.req),
      }),
    }),
  },
  {
    method: "get",
    path: "/bildirimler/durum",
    permission: "bildirim:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({ data: await notificationOverview(prisma, c.ctx.config, c.nowMs) }),
  },
  {
    method: "post",
    path: "/bildirimler/deneme",
    permission: "bildirim:yonet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = bodyOf(c, TokenOnly);
      return portalAction(c, {
        action: "BILDIRIM_DENEME",
        clientToken: b.clientToken,
        body: b,
        run: (tx) => enqueueTestNotificationTx(tx, b.clientToken),
        respond: (n) => ({ status: 201, data: { yazilan: n, kanallar: NOTIFICATION_CHANNELS } }),
        audit: (n) => [{ event: "BILDIRIM_DENEME", entity: "Bildirim", entityId: null, summary: { yazilan: n } }],
      });
    },
  },
];
