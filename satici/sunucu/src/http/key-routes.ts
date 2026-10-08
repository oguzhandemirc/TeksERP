// ANAHTAR KATMANI PORTAL ROTALARI (G4) — kök imzası bekleyen HAK kuyruğu · iptal belgesi + dağıtım iptali defteri · ara imzacıyla toplu
// yeniden basım. Toplu basım ara imzacı parolası taşır: imza parolası kapısı + imza boğazı (hangi yoldan imzalanacağı
// keys/signing-scope.ts). Kuyruk talebinin kendisi HAK sürüm rotasından doğar (`/haklar/:id/surum`, plan KUYRUK).
import { z } from "zod";
import { passwordBuffer } from "../keys/key-files";
import { prisma } from "../lib/prisma";
import { withSigningPasswordGuard } from "../portal/signing-guard";
import { entitlementVersionAudit, prepareIntermediateReissue, recordIntermediateReissueTx } from "../services/entitlement.service";
import { packageRevocationStatus } from "../services/package-revocation.service";
import { revocationStatus } from "../services/revocation.service";
import { cancelRootRequestTx, findRootRequest, listRootRequests } from "../services/root-queue.service";
import { ClientTokenSchema, ReasonSchema, bodyOf, idParam, pageQuery, portalAction, queryBool, queryEnum, type PortalRouteDef } from "./portal-http";

const ROOT_REQUEST_STATES = ["BEKLIYOR", "IMZALANDI", "IPTAL", "ESKIDI"] as const;
const CancelBody = z.strictObject({ clientToken: ClientTokenSchema, sebep: ReasonSchema });
const ReissueBody = z.strictObject({
  clientToken: ClientTokenSchema,
  imzaParolasi: z.string().min(1).max(200),
  sebep: ReasonSchema,
  hakIdleri: z.array(z.uuid()).min(1).max(100),
});

export const KEY_PORTAL_ROUTES: readonly PortalRouteDef[] = [
  {
    method: "get",
    path: "/kok-kuyrugu",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({
      data: await listRootRequests(prisma, { status: queryEnum(c.req, "durum", ROOT_REQUEST_STATES), urgent: queryBool(c.req, "acil"), ...pageQuery(c.req) }),
    }),
  },
  {
    method: "post",
    path: "/kok-kuyrugu/:id/iptal",
    permission: "hak:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Kök imzası talebi");
      const b = bodyOf(c, CancelBody);
      const request = await findRootRequest(prisma, id);
      return portalAction(c, {
        action: "HAK_KOK_TALEBI_IPTAL",
        clientToken: b.clientToken,
        body: { ...b, _yol: id },
        run: (tx) => cancelRootRequestTx(tx, { request, reason: b.sebep, actor: c.session.actor, nowMs: c.nowMs }),
        respond: (row) => ({ data: { id: row.id, durum: row.durum } }),
        audit: (row) => [{ event: "HAK_KOK_TALEBI_IPTAL", entity: "Hak", entityId: row.hakId, summary: { talepId: row.id, sebep: b.sebep } }],
      });
    },
  },
  {
    method: "get",
    path: "/iptal-belgeleri",
    permission: "anahtar:oku",
    kimlik: "OKUMA",
    // Dağıtım iptali (ISTEMCI · PAKET) ayrı defterdir ve dağıtım kapısı taşımaz; aynı sayfada salt okunur görünür.
    handler: async (c) => ({ data: { ...(await revocationStatus(prisma, c.ctx.keys)), dagitimIptali: await packageRevocationStatus(prisma, c.ctx.keys) } }),
  },
  {
    method: "post",
    path: "/haklar/toplu-yeniden-bas",
    permission: "hak:yaz",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = bodyOf(c, ReissueBody);
      const password = passwordBuffer(b.imzaParolasi);
      return portalAction(c, {
        action: "HAK_TOPLU_YENIDEN_BAS",
        clientToken: b.clientToken,
        body: b,
        prepare: () =>
          withSigningPasswordGuard(c.ctx, { userId: c.session.user.id, actor: c.session.actor, kind: "ARA", nowMs: c.nowMs }, () =>
            prepareIntermediateReissue(c.ctx, { entitlementIds: b.hakIdleri, password, reason: b.sebep, actor: c.session.actor, nowMs: c.nowMs }),
          ),
        run: async (tx, p) => ({ rows: await recordIntermediateReissueTx(tx, p.prepared), p }),
        respond: ({ rows, p }) => ({ status: 201, data: { basilan: rows.map((r) => ({ hakId: r.hakId, surum: r.surum, imzalayanKid: r.imzalayanKid })), sonuclar: p.results } }),
        audit: ({ rows, p }) => rows.map((r, i) => entitlementVersionAudit(r, p.prepared[i]!)),
        release: () => password.fill(0),
      });
    },
  },
];
