// Bayi alt-portalı — taşıma talebi: kendi kurulumunu hedefleyen talepleri görür, BEKLEYENİ reddeder (B1k çıkışı:
// sahte talep gerçek taşımayı tutuyorsa). Onay ve taşıma kodu satıcıda kalır; fabrikanın talep cevabı değişmez.
import { z } from "zod";
import { notFoundError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import * as q from "../portal/queries";
import { findTransferRequest, rejectTransferAsDealerTx, transferTargetInstallation } from "../services/transfer.service";
import { dealerOf, ownedInstallation, withPath } from "./dealer-scope";
import { ClientTokenSchema, ReasonSchema, bodyOf, idParam, portalAction, type PortalRouteDef } from "./portal-http";

const TransferReject = z.strictObject({ clientToken: ClientTokenSchema, sebep: ReasonSchema });

export const DEALER_TRANSFER_ROUTES: readonly PortalRouteDef[] = [
  {
    method: "get",
    path: "/kurulumlar/:id/tasima-talepleri",
    permission: "bayi:portal",
    kimlik: "OKUMA",
    handler: async (c) => {
      const inst = await ownedInstallation(prisma, dealerOf(c), idParam(c.req, "id", "Kurulum"));
      return { data: await q.listDealerTransfers(prisma, inst) };
    },
  },
  {
    method: "post",
    path: "/tasima-talepleri/:id/reddet",
    permission: "bayi:tasima-reddet",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const dealerId = dealerOf(c);
      const id = idParam(c.req, "id", "Taşıma talebi");
      const b = bodyOf(c, TransferReject);
      // Başka bayinin ya da hiçbir kuruluma işaret etmeyen (kimliksiz) talep bayiye "yok"tur.
      const talep = await findTransferRequest(id);
      const target = await transferTargetInstallation(prisma, talep);
      if (!target || target.bayiId !== dealerId) throw notFoundError("Taşıma talebi");
      return portalAction(c, {
        action: "BAYI_TASIMA_REDDET",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => rejectTransferAsDealerTx(tx, c.ctx, { dealerId, customerId: target.musteriId, talep, actor: c.session.actor, reason: b.sebep }),
        respond: (r) => ({ data: { id: r.talep.id, durum: r.talep.durum, kararZamani: r.talep.kararZamani, kararSebebi: r.talep.kararSebebi } }),
        audit: (r) => [{ event: "TASIMA_REDDEDILDI", entity: "TasimaTalebi", entityId: r.talep.id, summary: { sebep: b.sebep, kurulumId: target.id, bayiId: dealerId } }],
      });
    },
  },
];
