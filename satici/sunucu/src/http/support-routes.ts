// DESTEK KUTUSU rotaları (satıcı portalı, tailnet): liste · ayrıntı · ek · yanıtla · kapat.
// Yazma işlem kimliğiyle idempotent; yol parametresi gövde özetine girer (`_yol`).
import { z } from "zod";
import { SUPPORT_TEXT_MAX } from "../lisans-protokol";
import { prisma } from "../lib/prisma";
import {
  SUPPORT_STATES,
  closeSupportTicketTx,
  findSupportTicket,
  listSupportTickets,
  replySupportTicketTx,
  supportAttachment,
  supportTicketDetail,
} from "../services/support-admin.service";
import { ClientTokenSchema, bodyOf, idParam, pageQuery, portalAction, queryEnum, type PortalRouteDef } from "./portal-http";

const ReplyBody = z.strictObject({ clientToken: ClientTokenSchema, metin: z.string().trim().min(1).max(SUPPORT_TEXT_MAX) });
const CloseBody = z.strictObject({ clientToken: ClientTokenSchema, not: z.string().trim().max(SUPPORT_TEXT_MAX).nullable() });
const withPath = (body: object, id: string) => ({ ...body, _yol: id });

export const SUPPORT_PORTAL_ROUTES: readonly PortalRouteDef[] = [
  {
    method: "get",
    path: "/destek",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({ data: await listSupportTickets(prisma, { status: queryEnum(c.req, "durum", SUPPORT_STATES), ...pageQuery(c.req) }) }),
  },
  {
    method: "get",
    path: "/destek/:id",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({ data: await supportTicketDetail(prisma, idParam(c.req, "id", "Destek talebi")) }),
  },
  {
    method: "get",
    path: "/destek/:id/ek",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => {
      const ek = await supportAttachment(prisma, idParam(c.req, "id", "Destek talebi"));
      return { data: { tur: ek.tur, veri: ek.veri.toString("base64") } };
    },
  },
  {
    method: "post",
    path: "/destek/:id/yanitla",
    permission: "destek:yanitla",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Destek talebi");
      const b = bodyOf(c, ReplyBody);
      const ticket = await findSupportTicket(id);
      return portalAction(c, {
        action: "DESTEK_YANITLA",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => replySupportTicketTx(tx, { ticket, text: b.metin, actor: c.session.actor }),
        respond: (r) => ({ data: r }),
        audit: () => [{ event: "DESTEK_YANITLANDI", entity: "DestekTalebi", entityId: id, summary: { talepNo: ticket.talepNo } }],
      });
    },
  },
  {
    method: "post",
    path: "/destek/:id/kapat",
    permission: "destek:yanitla",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Destek talebi");
      const b = bodyOf(c, CloseBody);
      const ticket = await findSupportTicket(id);
      return portalAction(c, {
        action: "DESTEK_KAPAT",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => closeSupportTicketTx(tx, { ticket, note: b.not, actor: c.session.actor }),
        respond: (r) => ({ data: r }),
        audit: () => [{ event: "DESTEK_KAPANDI", entity: "DestekTalebi", entityId: id, summary: { talepNo: ticket.talepNo } }],
      });
    },
  },
];
