// TAŞIMA — aynı kurulum kimliği (DB taşındı), YENİ makine anahtarı + parmak izi. Her taşıma
// satıcı ONAYIYLA (kullanıcı kararı): talep BEKLIYOR → ONAYLANDI | REDDEDILDI (atomik claim).
// Onayda eski anahtar kurulum kaydına düşer (o anahtarla gelen istek 403 KURULUM_IPTAL) ve
// zincir yeniden başlar (yeni anahtarın ilk kirası kök).
import type { TasimaTalebi } from "@prisma/client";
import { z } from "zod";
import { TransferResponseSchema, type TransferRequestSchema } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError, retryConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma } from "../lib/prisma";
import { isUniqueViolation } from "../lib/prisma-errors";
import type { VendorContext } from "./context";
import { notifyDoorbell } from "./doorbell";
import type { AuthenticatedRequest } from "./installation-auth";
import { renewLease } from "./renewal.service";

type TransferRequest = z.infer<typeof TransferRequestSchema>;
type TransferResponse = z.infer<typeof TransferResponseSchema>;

const pendingElsewhere = (): VendorError =>
  new VendorError(409, "TASIMA_ONAYI_BEKLIYOR", "Bu kurulum için başka bir taşıma talebi onay bekliyor");

export async function processTransferRequest(
  ctx: VendorContext,
  auth: AuthenticatedRequest,
  body: TransferRequest,
  nowMs: number,
): Promise<TransferResponse> {
  if (body.kurulumId !== auth.request.kurulumId) {
    throw new VendorError(401, "ISTEK_KURULUM", "Gövdedeki kurulum kimliği imzalı istekle uyuşmuyor");
  }
  const inst = auth.installation;
  if (inst.durum === "ETKINLESMEDI") {
    throw new VendorError(400, "GOVDE_GECERSIZ", "Kurulum henüz etkinleşmedi; taşıma yerine etkinleştirme kodu kullanın");
  }
  if (inst.durum !== "ETKIN") throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulum taşınamaz (devredildi ya da iptal)");

  if (auth.kid === inst.anahtarKimligi) {
    const approved = await prisma.tasimaTalebi.findUnique({
      where: { kurulumId_yeniAnahtarKimligi: { kurulumId: inst.id, yeniAnahtarKimligi: auth.kid } },
    });
    if (!approved || approved.durum !== "ONAYLANDI") {
      throw new VendorError(400, "GOVDE_GECERSIZ", "Bu kurulum anahtarı zaten lisanslı; taşıma gerekmiyor");
    }
    const renewed = await renewLease(ctx, {
      installationDbId: inst.id,
      kid: auth.kid,
      presentedLeaseId: null,
      measured: body.parmakIzi,
      clientEntitlement: null,
      telemetry: null,
      nowMs,
    });
    return TransferResponseSchema.parse({ v: 1, talepId: approved.id, durum: "ONAYLANDI", lisans: renewed.response });
  }

  const talep = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, inst.id);
    const existing = await tx.tasimaTalebi.findUnique({
      where: { kurulumId_yeniAnahtarKimligi: { kurulumId: inst.id, yeniAnahtarKimligi: auth.kid } },
    });
    if (existing) {
      if (existing.durum === "ONAYLANDI") {
        throw new VendorError(403, "KURULUM_IPTAL", "Bu anahtarın taşıması onaylanmıştı ama lisans sonra başka makineye geçti");
      }
      return { talep: existing, created: false };
    }
    const other = await tx.tasimaTalebi.findFirst({ where: { kurulumId: inst.id, durum: "BEKLIYOR" } });
    if (other) throw pendingElsewhere();
    try {
      const created = await tx.tasimaTalebi.create({
        data: {
          kurulumId: inst.id,
          yeniAcikAnahtar: body.acikAnahtar,
          yeniAnahtarKimligi: auth.kid,
          yeniParmakIzi: body.parmakIzi,
          ortam: body.ortam,
          gerekce: body.gerekce,
        },
      });
      return { talep: created, created: true };
    } catch (err) {
      if (isUniqueViolation(err)) throw pendingElsewhere();
      throw err;
    }
  });
  if (talep.created) {
    await recordAudit({
      event: "TASIMA_TALEBI",
      entity: "TasimaTalebi",
      entityId: talep.talep.id,
      actor: "kurulum",
      summary: { kurulumId: inst.id, yeniAnahtarKimligi: auth.kid },
    });
  }
  return TransferResponseSchema.parse({ v: 1, talepId: talep.talep.id, durum: talep.talep.durum, lisans: null });
}

async function decide(
  talepId: string,
  decision: "ONAYLANDI" | "REDDEDILDI",
  actor: string,
  reason: string,
): Promise<TasimaTalebi> {
  if (!reason.trim()) throw new VendorError(400, "GOVDE_GECERSIZ", "Taşıma kararı için sebep zorunlu");
  const talep = await prisma.tasimaTalebi.findUnique({ where: { id: talepId } });
  if (!talep) throw new VendorError(404, "GOVDE_GECERSIZ", "Taşıma talebi bulunamadı");
  return prisma.$transaction(async (tx) => {
    await lockInstallation(tx, talep.kurulumId);
    const claim = await tx.tasimaTalebi.updateMany({
      where: { id: talepId, durum: "BEKLIYOR" },
      data: { durum: decision, kararZamani: new Date(), kararVeren: actor, kararSebebi: reason },
    });
    if (claim.count === 0) throw new VendorError(409, "GOVDE_GECERSIZ", "Taşıma talebi zaten karara bağlanmış");
    if (decision === "ONAYLANDI") {
      const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: talep.kurulumId } });
      if (inst.durum !== "ETKIN") throw new VendorError(409, "KURULUM_IPTAL", "Kurulum ETKİN değil; taşıma onaylanamaz");
      await tx.kurulumKaydi.create({
        data: {
          kurulumId: inst.id,
          olay: "TASINDI",
          anahtarKimligi: talep.yeniAnahtarKimligi,
          acikAnahtar: talep.yeniAcikAnahtar,
          eskiAnahtarKimligi: inst.anahtarKimligi,
          eskiAcikAnahtar: inst.acikAnahtar,
          ayrinti: { talepId: talep.id, sebep: reason },
          yapan: actor,
        },
      });
      const moved = await tx.kurulum.updateMany({
        where: { id: inst.id, anahtarKimligi: inst.anahtarKimligi },
        data: {
          acikAnahtar: talep.yeniAcikAnahtar,
          anahtarKimligi: talep.yeniAnahtarKimligi,
          kabulEdilenParmakIzi: talep.yeniParmakIzi ?? undefined,
          sonOrtam: talep.ortam ?? undefined,
          sonKiraId: null,
        },
      });
      if (moved.count === 0) throw retryConflict();
      await notifyDoorbell(tx, inst.id, "lisans");
    }
    return tx.tasimaTalebi.findUniqueOrThrow({ where: { id: talepId } });
  });
}

/** Portal eylemi: taşımayı onayla (eski anahtar düşer, yeni anahtar sonraki isteğinde kira alır). */
export async function approveTransfer(g: { talepId: string; actor: string; reason: string }): Promise<TasimaTalebi> {
  const talep = await decide(g.talepId, "ONAYLANDI", g.actor, g.reason);
  await recordAudit({ event: "TASIMA_ONAYLANDI", entity: "TasimaTalebi", entityId: talep.id, actor: g.actor, summary: { sebep: g.reason } });
  return talep;
}

export async function rejectTransfer(g: { talepId: string; actor: string; reason: string }): Promise<TasimaTalebi> {
  const talep = await decide(g.talepId, "REDDEDILDI", g.actor, g.reason);
  await recordAudit({ event: "TASIMA_REDDEDILDI", entity: "TasimaTalebi", entityId: talep.id, actor: g.actor, summary: { sebep: g.reason } });
  return talep;
}
