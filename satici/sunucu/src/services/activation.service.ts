// ETKİNLEŞTİRME — tek kullanımlık kod (atomik claim) + kurulum anahtarı kaydı + HAK + KİRA.
// Kod portalda KURULUMA bağlı doğar (HAK o kurulumun installationId'sine önceden imzalıdır);
// başka kurulumda "yok" sayılır. Aynı kod + aynı anahtarla tekrar (ağ tekrarı) aynı kirayı alır;
// başka anahtarla ikinci kullanım 409 ETKINLESTIRME_KODU_KULLANILMIS.
import { createHash } from "node:crypto";
import type { EtkinlestirmeKodu, Kurulum } from "@prisma/client";
import type { ActivateRequest, LicenseResponse } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError, retryConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import type { AuthenticatedRequest } from "./installation-auth";
import {
  activeEntitlement,
  computeSanctionState,
  currentEntitlementToken,
  downloadTokens,
  issueLease,
  licenseResponse,
} from "./lease.service";

/** Kodun saklanan biçimi: sha256 (hex) — düz metin DB'ye girmez. */
export function hashActivationCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

const codeInvalid = (reason: string): VendorError => new VendorError(404, "ETKINLESTIRME_KODU_GECERSIZ", reason);

/** Tüketilmiş kodu aynı anahtar yeniden sunduysa önceki sonucu döner; aksi hâlde 409. */
async function replayOrConflict(
  tx: Tx,
  ctx: VendorContext,
  code: EtkinlestirmeKodu,
  inst: Kurulum,
  kid: string,
  nowMs: number,
): Promise<LicenseResponse> {
  if (code.kullananAnahtarKimligi !== kid || inst.anahtarKimligi !== kid || !code.kiraId) {
    throw new VendorError(409, "ETKINLESTIRME_KODU_KULLANILMIS", "Bu etkinleştirme kodu daha önce kullanıldı");
  }
  const lease = await tx.kira.findUniqueOrThrow({ where: { id: code.kiraId } });
  const hak = await activeEntitlement(tx, inst.id);
  const sanction = await computeSanctionState(tx, inst.id);
  return licenseResponse({
    hak: await currentEntitlementToken(tx, hak),
    kira: lease.belge,
    tokens: downloadTokens(ctx, inst, hak, sanction, nowMs),
    nowMs,
  });
}

export async function processActivation(
  ctx: VendorContext,
  auth: AuthenticatedRequest,
  body: ActivateRequest,
  nowMs: number,
): Promise<LicenseResponse> {
  if (body.kurulumId !== auth.request.kurulumId) {
    throw new VendorError(401, "ISTEK_KURULUM", "Gövdedeki kurulum kimliği imzalı istekle uyuşmuyor");
  }
  const codeHash = hashActivationCode(body.kod);
  const result = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, auth.installation.id);
    const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: auth.installation.id } });
    const code = await tx.etkinlestirmeKodu.findUnique({ where: { kodOzeti: codeHash } });
    if (!code || code.kurulumId !== inst.id || code.durum === "IPTAL") throw codeInvalid("Etkinleştirme kodu geçersiz");
    if (code.durum === "KULLANILDI") return { kind: "replay" as const, response: await replayOrConflict(tx, ctx, code, inst, auth.kid, nowMs) };
    if (code.gecerlilikBitis.getTime() < nowMs) throw codeInvalid("Etkinleştirme kodunun süresi dolmuş");
    if (inst.durum !== "ETKINLESMEDI" && inst.durum !== "ETKIN") {
      throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulum etkinleştirilemez (devredildi ya da iptal)");
    }
    const claim = await tx.etkinlestirmeKodu.updateMany({
      where: { id: code.id, durum: "AKTIF" },
      data: { durum: "KULLANILDI", kullanimZamani: new Date(nowMs), kullananAnahtarKimligi: auth.kid },
    });
    if (claim.count === 0) {
      const fresh = await tx.etkinlestirmeKodu.findUniqueOrThrow({ where: { id: code.id } });
      return { kind: "replay" as const, response: await replayOrConflict(tx, ctx, fresh, inst, auth.kid, nowMs) };
    }
    const hak = await activeEntitlement(tx, inst.id);
    const reactivation = inst.durum === "ETKIN";
    const keyChanged = reactivation && inst.anahtarKimligi !== auth.kid;
    await tx.kurulumKaydi.create({
      data: {
        kurulumId: inst.id,
        olay: reactivation ? "YENIDEN_ETKINLESTI" : "ETKINLESTI",
        anahtarKimligi: auth.kid,
        acikAnahtar: body.acikAnahtar,
        eskiAnahtarKimligi: keyChanged ? inst.anahtarKimligi : null,
        eskiAcikAnahtar: keyChanged ? inst.acikAnahtar : null,
        ayrinti: { kodSonu: code.kodSonu, platform: body.ortam.platform, uygulamaSurum: body.ortam.uygulamaSurum },
        yapan: "kurulum",
      },
    });
    const updated = await tx.kurulum.updateMany({
      where: { id: inst.id, durum: inst.durum, sonKiraId: inst.sonKiraId },
      data: {
        durum: "ETKIN",
        acikAnahtar: body.acikAnahtar,
        anahtarKimligi: auth.kid,
        kabulEdilenParmakIzi: body.parmakIzi,
        platform: body.ortam.platform,
        sonOrtam: body.ortam,
        etkinlesmeZamani: new Date(nowMs),
        sonKiraId: null,
      },
    });
    if (updated.count === 0) throw retryConflict();
    const fresh = await tx.kurulum.findUniqueOrThrow({ where: { id: inst.id } });
    const lease = await issueLease(tx, ctx, {
      installation: fresh,
      entitlement: hak,
      previousLeaseId: null,
      decision: "ETKINLESTIRME",
      clientFingerprint: body.parmakIzi,
      acceptedFingerprint: body.parmakIzi,
      nowMs,
    });
    const tip = await tx.kurulum.updateMany({ where: { id: inst.id, sonKiraId: null }, data: { sonKiraId: lease.id } });
    if (tip.count === 0) throw retryConflict();
    await tx.etkinlestirmeKodu.update({ where: { id: code.id }, data: { kiraId: lease.id } });
    return {
      kind: "activated" as const,
      activated: {
        response: licenseResponse({
          hak: await currentEntitlementToken(tx, hak),
          kira: lease.token,
          tokens: downloadTokens(ctx, fresh, hak, lease.sanction, nowMs),
          nowMs,
        }),
        installationDbId: inst.id,
        kodSonu: code.kodSonu,
        reactivation,
      },
    };
  });
  if (result.kind === "replay") return result.response;
  const a = result.activated;
  await recordAudit({
    event: a.reactivation ? "KURULUM_YENIDEN_ETKINLESTI" : "KURULUM_ETKINLESTI",
    entity: "Kurulum",
    entityId: a.installationDbId,
    actor: "kurulum",
    summary: { kodSonu: a.kodSonu, anahtarKimligi: auth.kid },
  });
  return a.response;
}
