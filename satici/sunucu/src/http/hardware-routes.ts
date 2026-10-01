// DONANIM / ZAYIF TANIMA ONAY KUYRUĞU PORTAL ROTALARI (lisans v2 K8) — liste (süzme sunucuda; tuzlu özet değil etken
// etken karşılaştırma) ve karar (onay · ret: işlem kimliği + sebep zorunlu, atomik claim, kurulum kaydı). Taşıma talebi
// kalıbı; yazma `kurulum:yonet`.
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { decideHardwareTx, findHardwareRequest, listHardwareRequests } from "../services/hardware.service";
import { ClientTokenSchema, ReasonSchema, bodyOf, idParam, pageQuery, portalAction, queryEnum, type PortalRouteDef } from "./portal-http";

const HARDWARE_REQUEST_STATES = ["BEKLIYOR", "ONAYLANDI", "REDDEDILDI"] as const;
const HARDWARE_REQUEST_KINDS = ["DONANIM", "ZAYIF_TANIMA"] as const;
const DecisionBody = z.strictObject({ clientToken: ClientTokenSchema, sebep: ReasonSchema });
const withPath = (body: object, id: string) => ({ ...body, _yol: id });

/** Karar işleyicisi (onay · ret): işlem kimliği + sebep zorunlu; yol tabloda LİTERAL kalır (arayüz aynası ölçer). */
function decisionHandler(decision: "ONAYLANDI" | "REDDEDILDI"): PortalRouteDef["handler"] {
  const action = decision === "ONAYLANDI" ? "DONANIM_TALEBI_ONAYLANDI" : "DONANIM_TALEBI_REDDEDILDI";
  return async (c) => {
    const id = idParam(c.req, "id", "Donanım talebi");
    const b = bodyOf(c, DecisionBody);
    const talep = await findHardwareRequest(prisma, id);
    return portalAction(c, {
      action,
      clientToken: b.clientToken,
      body: withPath(b, id),
      run: (tx) => decideHardwareTx(tx, { talep, decision, actor: c.session.actor, reason: b.sebep, nowMs: c.nowMs }),
      respond: (row) => ({ data: { id: row.id, durum: row.durum, tur: row.tur } }),
      audit: (row) => [{ event: action, entity: "DonanimTalebi", entityId: row.id, summary: { kurulumId: row.kurulumId, tur: row.tur, sebep: b.sebep } }],
    });
  };
}

export const HARDWARE_PORTAL_ROUTES: readonly PortalRouteDef[] = [
  {
    method: "get",
    path: "/donanim-talepleri",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({
      data: await listHardwareRequests(prisma, { status: queryEnum(c.req, "durum", HARDWARE_REQUEST_STATES), kind: queryEnum(c.req, "tur", HARDWARE_REQUEST_KINDS), ...pageQuery(c.req) }),
    }),
  },
  { method: "post", path: "/donanim-talepleri/:id/onayla", permission: "kurulum:yonet", kimlik: "ISLEM_KIMLIGI", handler: decisionHandler("ONAYLANDI") },
  { method: "post", path: "/donanim-talepleri/:id/reddet", permission: "kurulum:yonet", kimlik: "ISLEM_KIMLIGI", handler: decisionHandler("REDDEDILDI") },
];
