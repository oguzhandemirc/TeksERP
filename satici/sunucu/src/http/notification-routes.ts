// BİLDİRİMLER rotaları (satıcı portalı, ERİŞİM): kanal durumu · son bildirimler (salt okuma, `bildirim:oku`) ·
// deneme bildirimi (`bildirim:yonet`; giden kutusuna satır — gönderimi yan konteyner yapar, satıcı dışarı bağlanmaz).
// Deneme GERÇEK e-posta/Telegram iletisi doğurur ve internetten (ERİŞİM) açıktır: kullanıcı başına 5 dk'da BİR.
import { z } from "zod";
import { VendorError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, NOTIFICATION_STATES } from "../notifications/catalog";
import { enqueueTestNotificationTx, listNotifications, notificationOverview } from "../notifications/portal-view";
import { ClientTokenSchema, bodyOf, pageQuery, portalAction, queryEnum, type PortalRouteDef } from "./portal-http";
import { CooldownLimiter } from "./rate-limit";

const TokenOnly = z.strictObject({ clientToken: ClientTokenSchema });

/** Deneme bildirimi aralığı (kullanıcı başına): yeni işlem kimliği bu süre dolmadan 429; aynı kimliğin tekrarı yanıtı alır. */
export const TEST_NOTIFICATION_INTERVAL_MS = 5 * 60_000;
const testNotificationSlots = new CooldownLimiter(TEST_NOTIFICATION_INTERVAL_MS);

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
        // Sınır YALNIZ ilk koşumda (tekrar oynatma `run`a gelmez → aynı kimlik aynı yanıtı alır); yazım düşerse yer iade.
        run: async (tx) => {
          const slot = testNotificationSlots.take(c.session.user.id, c.nowMs);
          if (!slot.ok) {
            throw new VendorError(429, "HIZ_SINIRI", `Deneme bildirimi kullanıcı başına ${TEST_NOTIFICATION_INTERVAL_MS / 60_000} dakikada bir gönderilebilir; ${slot.retryAfterSec} sn sonra tekrar deneyin`, { tekrarSn: slot.retryAfterSec });
          }
          try {
            return await enqueueTestNotificationTx(tx, b.clientToken);
          } catch (err) {
            slot.refund();
            throw err;
          }
        },
        respond: (n) => ({ status: 201, data: { yazilan: n, kanallar: NOTIFICATION_CHANNELS } }),
        audit: (n) => [{ event: "BILDIRIM_DENEME", entity: "Bildirim", entityId: null, summary: { yazilan: n } }],
      });
    },
  },
];
